/**
 * processMmtsGTFS.js
 * ==================
 * Converts MMTS (Multi-Modal Transport System) GTFS data into a lightweight
 * optimized JSON file compatible with the TravelMate routing engine.
 *
 * Input:  data/mmts_data/{stops,routes,trips,stop_times}.txt
 * Output: frontend/src/data/mmts.json
 *
 * MMTS-specific handling:
 *  - 143 route_ids are service variants of ~20 unique physical corridors
 *    (e.g. 26× "HYB-LPI", 29× "LPI-FM", …).  Routes are grouped by
 *    route_long_name and only the variant with the most stops is kept.
 *  - The output route_id is set to the route_long_name (e.g. "HYB-LPI").
 *  - No color in GTFS — a fixed MMTS brown/orange is used.
 *  - Frequency is estimated from the number of service variants per corridor.
 *  - stop_times column order differs from bus/metro: stop_id precedes
 *    stop_sequence (handled transparently via csv-parse column names).
 */

'use strict'

const fs   = require('fs')
const path = require('path')
const { parse } = require('csv-parse')

// ── Paths ─────────────────────────────────────────────────────────────────────

const ROOT     = path.resolve(__dirname, '..')
const MMTS_DIR = path.join(ROOT, 'data', 'mmts_data')
const OUT_FILE = path.join(ROOT, 'frontend', 'src', 'data', 'mmts.json')

// ── MMTS colour ───────────────────────────────────────────────────────────────
// Consistent with existing mmts.json — warm brown used for all MMTS routes.

const MMTS_COLOR = '#8B5A2B'

// ── Frequency estimation ──────────────────────────────────────────────────────
// variantCount = number of service variants sharing the same corridor.
// Assumes 16 operating hours (960 min).  MMTS is infrequent — floor at 20 min.

function estimateFrequency(variantCount) {
  if (variantCount <= 0) return 60
  const freq = Math.round(960 / variantCount)
  if (freq <= 20) return 20
  if (freq <= 30) return 30
  if (freq <= 45) return 45
  return 60
}

// ── Streaming CSV parser ──────────────────────────────────────────────────────

function streamCsv(filename, onRow) {
  return new Promise((resolve, reject) => {
    const parser = parse({ columns: true, skip_empty_lines: true, trim: true })
    parser.on('readable', () => {
      let row
      while ((row = parser.read()) !== null) onRow(row)
    })
    parser.on('error', reject)
    parser.on('end',   resolve)
    fs.createReadStream(path.join(MMTS_DIR, filename)).pipe(parser)
  })
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('TravelMate — GTFS MMTS Preprocessing Pipeline')
  console.log('==============================================\n')

  // ── Step 1: Stops ──────────────────────────────────────────────────────────
  console.log('[1/4] Parsing stops.txt …')

  const stopsById = {}   // stop_id → { name, lat, lon }

  await streamCsv('stops.txt', row => {
    const lat = parseFloat(row.stop_lat)
    const lon = parseFloat(row.stop_lon)
    if (!row.stop_id || isNaN(lat) || isNaN(lon)) return
    stopsById[row.stop_id.trim()] = {
      name: (row.stop_name || row.stop_id).trim(),
      lat,
      lon,
    }
  })

  const totalStops = Object.keys(stopsById).length
  console.log(`    ${totalStops} stops loaded\n`)

  // ── Step 2: Routes ─────────────────────────────────────────────────────────
  // Group route variants by route_long_name (the physical corridor).
  // corridors: corridor_name → { routeIds[], shortName }

  console.log('[2/4] Parsing routes.txt …')

  const routeToCorridor = {}   // route_id → corridor_name (route_long_name)
  const corridors       = {}   // corridor_name → { routeIds[], shortName }
  let totalRawRoutes = 0

  await streamCsv('routes.txt', row => {
    if (!row.route_id) return
    const routeId   = row.route_id.trim()
    const corridor  = (row.route_long_name  || row.route_id).trim()
    const shortName = (row.route_short_name || row.route_id).trim()
    totalRawRoutes++

    routeToCorridor[routeId] = corridor

    if (!corridors[corridor]) {
      corridors[corridor] = { routeIds: [], shortName }
    }
    corridors[corridor].routeIds.push(routeId)
  })

  const uniqueCorridors = Object.keys(corridors).length
  console.log(`    ${totalRawRoutes} raw routes → ${uniqueCorridors} unique corridors\n`)

  // ── Step 3: Trips ──────────────────────────────────────────────────────────
  // MMTS has exactly one trip per route_id (1:1).
  // trip_id format: "TR_<route_id>"

  console.log('[3/4] Parsing trips.txt …')

  const tripToRoute = {}   // trip_id → route_id
  let totalTrips = 0

  await streamCsv('trips.txt', row => {
    const tripId  = row.trip_id  && row.trip_id.trim()
    const routeId = row.route_id && row.route_id.trim()
    if (!tripId || !routeId) return
    tripToRoute[tripId] = routeId
    totalTrips++
  })

  console.log(`    ${totalTrips} trips loaded\n`)

  // ── Step 4: Stop times ─────────────────────────────────────────────────────
  // Note: MMTS stop_times column order is trip_id, stop_id, stop_sequence, …
  // (stop_id comes before stop_sequence — handled by csv-parse column names).

  console.log('[4/4] Parsing stop_times.txt …')

  // For each route_id, record its stop sequence
  const routeStopSeq = {}   // route_id → [{ seq, stop_id }]
  let totalStopTimes = 0

  await streamCsv('stop_times.txt', row => {
    const tripId = row.trip_id && row.trip_id.trim()
    const stopId = row.stop_id && row.stop_id.trim()
    const seq    = parseInt(row.stop_sequence, 10)
    if (!tripId || !stopId || isNaN(seq)) return
    totalStopTimes++

    const routeId = tripToRoute[tripId]
    if (!routeId) return

    if (!routeStopSeq[routeId]) routeStopSeq[routeId] = []
    routeStopSeq[routeId].push({ seq, stop_id: stopId })
  })

  // Sort each route's stop sequence
  for (const arr of Object.values(routeStopSeq)) {
    arr.sort((a, b) => a.seq - b.seq)
  }

  console.log(`    ${totalStopTimes} stop_time entries processed\n`)

  // ── Build output ───────────────────────────────────────────────────────────
  console.log('Building optimized output …')

  const outStops  = {}
  const outRoutes = {}
  let generatedRoutes = 0

  for (const [corridorName, { routeIds, shortName }] of Object.entries(corridors)) {
    // Find the variant with the most valid stops
    let bestRouteId   = null
    let bestStopIds   = []

    for (const routeId of routeIds) {
      const seq = routeStopSeq[routeId]
      if (!seq || seq.length < 2) continue

      const stopIds = seq.map(e => e.stop_id).filter(sid => stopsById[sid])
      if (stopIds.length > bestStopIds.length) {
        bestStopIds  = stopIds
        bestRouteId  = routeId
      }
    }

    if (!bestRouteId || bestStopIds.length < 2) {
      console.warn(`  ⚠ No valid trip found for corridor "${corridorName}"`)
      continue
    }

    // Register only the stops this route uses
    for (const sid of bestStopIds) {
      if (!outStops[sid]) outStops[sid] = stopsById[sid]
    }

    // Use corridor name as the route_id (clean, human-readable key)
    const outputRouteId = corridorName

    outRoutes[outputRouteId] = {
      line_name:      corridorName,
      color:          MMTS_COLOR,
      frequency_mins: estimateFrequency(routeIds.length),
      is_premium:     false,
      stops:          bestStopIds,
    }

    generatedRoutes++
  }

  // ── Write output ───────────────────────────────────────────────────────────
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true })
  fs.writeFileSync(OUT_FILE, JSON.stringify({ stops: outStops, routes: outRoutes }, null, 2))

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log('\n==============================================')
  console.log('                  SUMMARY')
  console.log('==============================================')
  console.log(`  Stops loaded from GTFS      : ${totalStops}`)
  console.log(`  Raw routes in GTFS          : ${totalRawRoutes}`)
  console.log(`  Unique corridors            : ${uniqueCorridors}`)
  console.log(`  Trips loaded from GTFS      : ${totalTrips}`)
  console.log(`  Stop-time entries processed : ${totalStopTimes}`)
  console.log(`  Routes generated            : ${generatedRoutes}`)
  console.log(`  Stops in output (used only) : ${Object.keys(outStops).length}`)
  const outSize = Math.round(fs.statSync(OUT_FILE).size / 1024)
  console.log(`  Output file size            : ${outSize} KB`)
  console.log(`  Output written to           : ${OUT_FILE}`)
  console.log('==============================================\n')

  // Print corridor breakdown
  console.log('Corridor breakdown:')
  for (const [id, r] of Object.entries(outRoutes)) {
    const variants = corridors[id] ? corridors[id].routeIds.length : '?'
    console.log(`  ${String(id).padEnd(22)} ${r.frequency_mins} min  ${r.stops.length} stops  (${variants} variants)`)
  }
}

main().catch(err => {
  console.error('\nFatal error:', err.message)
  process.exit(1)
})
