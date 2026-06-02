/**
 * processMetroGTFS.js
 * ===================
 * Converts Hyderabad Metro GTFS data into a lightweight optimized JSON file
 * compatible with the TravelMate routing engine.
 *
 * Input:  data/metro_data/{stops,routes,trips,stop_times,shapes}.txt
 * Output: frontend/src/data/metro.json
 *
 * Metro-specific handling:
 *  - stops.txt has two levels: parent stations (location_type=1) and platforms
 *    (location_type=0). stop_times reference platform IDs. Output uses parent IDs.
 *  - route_color is provided by GTFS — used directly.
 *  - shapes.txt is processed and stored per route as a compact [[lat,lon],...] array,
 *    enabling the router to render realistic curved polylines instead of straight lines.
 *  - One representative trip per route chosen: direction_id=0, longest unique-station seq.
 */

'use strict'

const fs   = require('fs')
const path = require('path')
const { parse } = require('csv-parse')

// ── Paths ─────────────────────────────────────────────────────────────────────

const ROOT      = path.resolve(__dirname, '..')
const METRO_DIR = path.join(ROOT, 'data', 'metro_data')
const OUT_FILE  = path.join(ROOT, 'frontend', 'src', 'data', 'metro.json')

// ── Helpers ───────────────────────────────────────────────────────────────────

function streamCsv(filename, onRow) {
  return new Promise((resolve, reject) => {
    const parser = parse({ columns: true, skip_empty_lines: true, trim: true })
    parser.on('readable', () => {
      let row
      while ((row = parser.read()) !== null) onRow(row)
    })
    parser.on('error', reject)
    parser.on('end',   resolve)
    fs.createReadStream(path.join(METRO_DIR, filename)).pipe(parser)
  })
}

/** Collect all rows of a small file into an array. */
async function parseCsvAll(filename) {
  const rows = []
  await streamCsv(filename, row => rows.push(row))
  return rows
}

/** Round to 5 decimal places (~1 m accuracy). */
const r5 = n => Math.round(n * 1e5) / 1e5

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('TravelMate — GTFS Metro Preprocessing Pipeline')
  console.log('===============================================\n')

  // ── Step 1: Stops ──────────────────────────────────────────────────────────
  console.log('[1/5] Parsing stops.txt …')

  const parentStops      = {}   // station_id → { name, lat, lon }
  const platformToParent = {}   // platform_id → parent_station_id
  let rawStopCount = 0

  await streamCsv('stops.txt', row => {
    rawStopCount++
    const locType = (row.location_type || '0').trim()
    if (locType === '1') {
      const lat = parseFloat(row.stop_lat)
      const lon = parseFloat(row.stop_lon)
      if (!row.stop_id || isNaN(lat) || isNaN(lon)) return
      parentStops[row.stop_id.trim()] = { name: (row.stop_name || row.stop_id).trim(), lat, lon }
    } else if (row.parent_station && row.parent_station.trim()) {
      platformToParent[row.stop_id.trim()] = row.parent_station.trim()
    }
  })

  const totalParentStops = Object.keys(parentStops).length
  console.log(`    ${rawStopCount} raw stops → ${totalParentStops} parent stations\n`)

  // ── Step 2: Routes ─────────────────────────────────────────────────────────
  console.log('[2/5] Parsing routes.txt …')

  const routeMeta = {}
  await streamCsv('routes.txt', row => {
    if (!row.route_id) return
    const rawColor = (row.route_color || '1976D2').trim()
    routeMeta[row.route_id.trim()] = {
      line_name:  (row.route_long_name || row.route_short_name || row.route_id).trim(),
      color:      '#' + rawColor,
      is_premium: true,
    }
  })

  const totalRoutes = Object.keys(routeMeta).length
  console.log(`    ${totalRoutes} routes loaded\n`)

  // ── Step 3: Trips ──────────────────────────────────────────────────────────
  console.log('[3/5] Parsing trips.txt …')

  const tripToRoute   = {}   // trip_id  → route_id
  const tripToShape   = {}   // trip_id  → shape_id
  const tripDirMap    = {}   // trip_id  → direction_id
  const routeTripDirs = {}   // route_id → [{ tripId, dirId }]
  let totalTrips = 0

  await streamCsv('trips.txt', row => {
    const tripId  = row.trip_id  && row.trip_id.trim()
    const routeId = row.route_id && row.route_id.trim()
    const dirId   = (row.direction_id || '0').trim()
    const shapeId = row.shape_id && row.shape_id.trim()
    if (!tripId || !routeId) return

    tripToRoute[tripId] = routeId
    tripDirMap[tripId]  = dirId
    if (shapeId) tripToShape[tripId] = shapeId

    if (!routeTripDirs[routeId]) routeTripDirs[routeId] = []
    routeTripDirs[routeId].push({ tripId, dirId })
    totalTrips++
  })

  console.log(`    ${totalTrips} trips loaded\n`)

  // ── Step 4: Shapes ─────────────────────────────────────────────────────────
  console.log('[4/5] Parsing shapes.txt …')

  // shapes: shape_id → [[lat, lon], ...] sorted by sequence
  const shapesBuf = {}   // shape_id → [{ seq, lat, lon }]

  await streamCsv('shapes.txt', row => {
    const shapeId = row.shape_id && row.shape_id.trim()
    const lat = parseFloat(row.shape_pt_lat)
    const lon = parseFloat(row.shape_pt_lon)
    const seq = parseInt(row.shape_pt_sequence, 10)
    if (!shapeId || isNaN(lat) || isNaN(lon) || isNaN(seq)) return
    if (!shapesBuf[shapeId]) shapesBuf[shapeId] = []
    shapesBuf[shapeId].push({ seq, lat, lon })
  })

  const shapes = {}
  for (const [id, pts] of Object.entries(shapesBuf)) {
    pts.sort((a, b) => a.seq - b.seq)
    shapes[id] = pts.map(p => [r5(p.lat), r5(p.lon)])
  }

  const shapeCount = Object.keys(shapes).length
  let totalShapePts = Object.values(shapes).reduce((s, arr) => s + arr.length, 0)
  console.log(`    ${shapeCount} shapes · ${totalShapePts} points total\n`)

  // ── Step 5: Stop times (streamed) ──────────────────────────────────────────
  console.log('[5/5] Parsing stop_times.txt (streaming) …')

  // routeBestTrip: route_id → { tripId, parentIds[], dirId, shapeId }
  const routeBestTrip  = {}
  const currentTripBuf = {}
  let lastTripId = null
  let totalStopTimes = 0

  function flushTrip(tripId, entries) {
    if (!tripId || entries.length < 2) return
    const routeId = tripToRoute[tripId]
    if (!routeId) return

    entries.sort((a, b) => a.seq - b.seq)

    // Resolve platform IDs → parent station IDs, deduplicate consecutive
    const parentIds = []
    for (const { parentId } of entries) {
      if (parentId && parentStops[parentId]) {
        if (parentIds[parentIds.length - 1] !== parentId) parentIds.push(parentId)
      }
    }
    if (parentIds.length < 2) return

    const best    = routeBestTrip[routeId]
    const dirId   = tripDirMap[tripId] || '1'
    const shapeId = tripToShape[tripId] || null

    const betterDir  = !best || (dirId === '0' && best.dirId !== '0')
    const longerSame = best && dirId === best.dirId && parentIds.length > best.parentIds.length

    if (!best || betterDir || longerSame) {
      routeBestTrip[routeId] = { tripId, parentIds, dirId, shapeId }
    }
  }

  await streamCsv('stop_times.txt', row => {
    const tripId = row.trip_id && row.trip_id.trim()
    const stopId = row.stop_id && row.stop_id.trim()
    const seqRaw = row.stop_sequence
    if (!tripId || !stopId) return
    totalStopTimes++

    if (tripId !== lastTripId) {
      if (lastTripId && currentTripBuf[lastTripId]) {
        flushTrip(lastTripId, currentTripBuf[lastTripId])
        delete currentTripBuf[lastTripId]
      }
      lastTripId = tripId
    }

    const parentId = platformToParent[stopId] || stopId
    if (!currentTripBuf[tripId]) currentTripBuf[tripId] = []
    currentTripBuf[tripId].push({ seq: parseInt(seqRaw, 10) || 0, parentId })
  })

  if (lastTripId && currentTripBuf[lastTripId]) {
    flushTrip(lastTripId, currentTripBuf[lastTripId])
  }

  console.log(`    ${totalStopTimes} stop_time entries processed\n`)

  // ── Build output ───────────────────────────────────────────────────────────
  console.log('Building optimized output …')

  const outStops  = {}
  const outRoutes = {}
  let generatedRoutes = 0

  function estimateFrequency(routeId) {
    const trips = routeTripDirs[routeId] || []
    if (!trips.length) return 10
    const oneDir = Math.ceil(trips.length / 2)
    const freq   = Math.round(1080 / oneDir)
    if (freq <= 3) return 3
    if (freq <= 5) return 5
    if (freq <= 10) return 10
    return 15
  }

  for (const [routeId, meta] of Object.entries(routeMeta)) {
    const best = routeBestTrip[routeId]
    if (!best || best.parentIds.length < 2) {
      console.warn(`  ⚠ No valid trip for route ${routeId}`)
      continue
    }

    for (const sid of best.parentIds) {
      if (!outStops[sid]) outStops[sid] = parentStops[sid]
    }

    // Attach shape if available for this route's representative trip
    const shape = (best.shapeId && shapes[best.shapeId]) || null

    outRoutes[routeId] = {
      line_name:      meta.line_name,
      color:          meta.color,
      frequency_mins: estimateFrequency(routeId),
      is_premium:     meta.is_premium,
      stops:          best.parentIds,
      ...(shape ? { shape } : {}),
    }

    generatedRoutes++
  }

  // ── Write output ───────────────────────────────────────────────────────────
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true })
  fs.writeFileSync(OUT_FILE, JSON.stringify({ stops: outStops, routes: outRoutes }))

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log('\n===============================================')
  console.log('                  SUMMARY')
  console.log('===============================================')
  console.log(`  Raw stops in GTFS           : ${rawStopCount}`)
  console.log(`  Parent stations             : ${totalParentStops}`)
  console.log(`  Routes in GTFS              : ${totalRoutes}`)
  console.log(`  Trips in GTFS               : ${totalTrips}`)
  console.log(`  Shape lines                 : ${shapeCount}`)
  console.log(`  Shape points                : ${totalShapePts}`)
  console.log(`  Stop-time entries           : ${totalStopTimes}`)
  console.log(`  Routes generated            : ${generatedRoutes}`)
  console.log(`  Stops in output             : ${Object.keys(outStops).length}`)
  const outSize = Math.round(fs.statSync(OUT_FILE).size / 1024)
  console.log(`  Output file size            : ${outSize} KB`)
  console.log(`  Output written to           : ${OUT_FILE}`)
  console.log('===============================================\n')

  console.log('Route breakdown:')
  for (const [id, r] of Object.entries(outRoutes)) {
    const shapePts = r.shape ? r.shape.length : 0
    console.log(`  ${id.padEnd(8)} ${r.color}  ${r.frequency_mins} min  ${r.stops.length} stops  ${shapePts} shape pts`)
  }
}

main().catch(err => {
  console.error('\nFatal error:', err.message)
  process.exit(1)
})
