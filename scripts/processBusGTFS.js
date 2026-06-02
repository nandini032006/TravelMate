/**
 * processBusGTFS.js
 * =================
 * Converts TSRTC GTFS data into a lightweight optimized JSON file
 * compatible with the TravelMate routing engine.
 *
 * Input:  data/bus_data/{stops,routes,trips,stop_times}.txt
 * Output: frontend/src/data/bus.json
 *
 * Pipeline:
 *   GTFS files → parse → index → select best trip per route → write JSON
 */

'use strict'

const fs   = require('fs')
const path = require('path')
const { parse } = require('csv-parse')

// ── Paths ─────────────────────────────────────────────────────────────────────

const ROOT     = path.resolve(__dirname, '..')
const BUS_DIR  = path.join(ROOT, 'data', 'bus_data')
const OUT_FILE = path.join(ROOT, 'frontend', 'src', 'data', 'bus.json')

// ── Colour palette ────────────────────────────────────────────────────────────
// Eight distinct blues/greens used across bus routes — deterministic per route_id.

const BUS_COLORS = [
  '#1976D2', '#0288D1', '#00796B', '#388E3C',
  '#7B1FA2', '#C62828', '#E65100', '#F57F17',
]

function routeColor(routeId) {
  let h = 5381
  for (let i = 0; i < routeId.length; i++) {
    h = ((h << 5) + h) ^ routeId.charCodeAt(i)
    h = h & h   // keep 32-bit
  }
  return BUS_COLORS[Math.abs(h) % BUS_COLORS.length]
}

// ── Frequency estimation ──────────────────────────────────────────────────────
// Counts one-direction trips only (direction_id = 0, or half of total).
// Assumes 16 operating hours (960 min) per day.

function estimateFrequency(tripCount) {
  if (tripCount <= 0) return 30
  const oneDir = Math.ceil(tripCount / 2)          // rough one-direction count
  const freq   = Math.round(960 / oneDir)
  if (freq <= 5)  return 5
  if (freq <= 10) return 10
  if (freq <= 15) return 15
  if (freq <= 20) return 20
  if (freq <= 30) return 30
  return 45
}

// ── Streaming CSV parser ──────────────────────────────────────────────────────
// Yields row objects one at a time — avoids loading the whole file into memory.

function streamCsv(filename, onRow) {
  return new Promise((resolve, reject) => {
    const parser = parse({ columns: true, skip_empty_lines: true, trim: true })
    parser.on('readable', () => {
      let row
      while ((row = parser.read()) !== null) onRow(row)
    })
    parser.on('error', reject)
    parser.on('end',   resolve)
    fs.createReadStream(path.join(BUS_DIR, filename)).pipe(parser)
  })
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('TravelMate — GTFS Bus Preprocessing Pipeline')
  console.log('=============================================\n')

  // ── Step 1: Stops ──────────────────────────────────────────────────────────
  console.log('[1/4] Parsing stops.txt …')
  const stopsById = {}   // stop_id → { name, lat, lon }

  await streamCsv('stops.txt', row => {
    const lat = parseFloat(row.stop_lat)
    const lon = parseFloat(row.stop_lon)
    if (!row.stop_id || isNaN(lat) || isNaN(lon)) return
    stopsById[row.stop_id] = {
      name: (row.stop_name || row.stop_id).trim(),
      lat,
      lon,
    }
  })

  const totalStops = Object.keys(stopsById).length
  console.log(`    ${totalStops} stops loaded\n`)

  // ── Step 2: Routes ─────────────────────────────────────────────────────────
  console.log('[2/4] Parsing routes.txt …')
  const routeMeta = {}   // route_id → { line_name }

  await streamCsv('routes.txt', row => {
    if (!row.route_id) return
    routeMeta[row.route_id] = {
      line_name: (row.route_short_name || row.route_id).trim(),
    }
  })

  const totalRoutes = Object.keys(routeMeta).length
  console.log(`    ${totalRoutes} routes loaded\n`)

  // ── Step 3: Trips ──────────────────────────────────────────────────────────
  console.log('[3/4] Parsing trips.txt …')
  const tripToRoute = {}   // trip_id  → route_id
  const routeTrips  = {}   // route_id → [trip_id, …]
  let totalTrips = 0

  await streamCsv('trips.txt', row => {
    if (!row.trip_id || !row.route_id) return
    tripToRoute[row.trip_id] = row.route_id
    if (!routeTrips[row.route_id]) routeTrips[row.route_id] = []
    routeTrips[row.route_id].push(row.trip_id)
    totalTrips++
  })

  console.log(`    ${totalTrips} trips loaded\n`)

  // ── Step 4: Stop times (large file — streamed) ─────────────────────────────
  console.log('[4/4] Parsing stop_times.txt (large — streaming) …')

  // We only need the best (longest) trip per route.
  // Track: for each route_id, the trip with the most stops seen so far.
  const routeBestTrip   = {}   // route_id → { tripId, stopIds[] }
  const currentTripBuf  = {}   // trip_id  → [stop entries being accumulated]

  // Since stop_times.txt is sorted by trip_id (sequential), we flush each trip
  // when we encounter a new trip_id, keeping only the longest per route.

  let lastTripId = null
  let totalStopTimes = 0

  function flushTrip(tripId, entries) {
    if (!tripId || entries.length < 2) return
    const routeId = tripToRoute[tripId]
    if (!routeId) return

    // Sort by stop_sequence then extract stop_ids
    entries.sort((a, b) => a.seq - b.seq)
    const stopIds = entries.map(e => e.stop_id).filter(sid => stopsById[sid])
    if (stopIds.length < 2) return

    const best = routeBestTrip[routeId]
    if (!best || stopIds.length > best.stopIds.length) {
      routeBestTrip[routeId] = { tripId, stopIds }
    }
  }

  await streamCsv('stop_times.txt', row => {
    const { trip_id, stop_sequence, stop_id } = row
    if (!trip_id || !stop_id) return
    totalStopTimes++

    if (trip_id !== lastTripId) {
      // Flush the previous trip
      if (lastTripId && currentTripBuf[lastTripId]) {
        flushTrip(lastTripId, currentTripBuf[lastTripId])
        delete currentTripBuf[lastTripId]   // free memory immediately
      }
      lastTripId = trip_id
    }

    if (!currentTripBuf[trip_id]) currentTripBuf[trip_id] = []
    currentTripBuf[trip_id].push({ seq: parseInt(stop_sequence, 10) || 0, stop_id })
  })

  // Flush the final trip
  if (lastTripId && currentTripBuf[lastTripId]) {
    flushTrip(lastTripId, currentTripBuf[lastTripId])
  }

  console.log(`    ${totalStopTimes} stop_time entries processed\n`)

  // ── Build output ───────────────────────────────────────────────────────────
  console.log('Building optimized output …')

  const outStops  = {}   // only stops actually used by a generated route
  const outRoutes = {}
  let generatedRoutes = 0

  for (const [routeId, meta] of Object.entries(routeMeta)) {
    const best = routeBestTrip[routeId]
    if (!best || best.stopIds.length < 2) continue

    // Register only the stops this route needs
    for (const sid of best.stopIds) {
      if (!outStops[sid]) outStops[sid] = stopsById[sid]
    }

    const tripCount = (routeTrips[routeId] || []).length

    outRoutes[routeId] = {
      line_name:      meta.line_name,
      color:          routeColor(routeId),
      frequency_mins: estimateFrequency(tripCount),
      is_premium:     false,
      stops:          best.stopIds,
    }

    generatedRoutes++
  }

  // ── Write output ───────────────────────────────────────────────────────────
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true })
  fs.writeFileSync(OUT_FILE, JSON.stringify({ stops: outStops, routes: outRoutes }))

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log('\n=============================================')
  console.log('                   SUMMARY')
  console.log('=============================================')
  console.log(`  Stops loaded from GTFS      : ${totalStops}`)
  console.log(`  Routes loaded from GTFS     : ${totalRoutes}`)
  console.log(`  Trips loaded from GTFS      : ${totalTrips}`)
  console.log(`  Stop-time entries processed : ${totalStopTimes}`)
  console.log(`  Routes generated            : ${generatedRoutes}`)
  console.log(`  Stops in output (used only) : ${Object.keys(outStops).length}`)
  const outSize = Math.round(fs.statSync(OUT_FILE).size / 1024)
  console.log(`  Output file size            : ${outSize} KB`)
  console.log(`  Output written to           : ${OUT_FILE}`)
  console.log('=============================================\n')
}

main().catch(err => {
  console.error('\nFatal error:', err.message)
  process.exit(1)
})
