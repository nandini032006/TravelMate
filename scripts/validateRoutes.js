/**
 * validateRoutes.js — TravelMate routing engine benchmark
 * ========================================================
 * Tests 100 real Hyderabad journeys against the routing engine.
 * Run: node scripts/validateRoutes.js
 *
 * A journey PASSES if at least 1 route is found.
 * Additional mode-specific checks are run where expected (metro / MMTS journeys).
 */

'use strict'

const fs   = require('fs')
const path = require('path')

// ── Load data ──────────────────────────────────────────────────────────────────

const DATA_DIR    = path.join(__dirname, '..', 'frontend', 'src', 'data')
const busRaw      = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'bus.json'),   'utf8'))
const metroRaw    = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'metro.json'), 'utf8'))
const mmtsRaw     = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'mmts.json'),  'utf8'))
const faresRaw    = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'fares.json'), 'utf8'))
const netIntel    = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'networkIntelligence.json'), 'utf8'))

// ── Build transit data structures (mirrors transitData.js) ────────────────────

const _stops        = []
const _stopById     = new Map()
const _routes       = {}
const _stopToRoutes = {}
const HUBS          = netIntel.hubs
const TRUNK_ROUTES  = new Set(netIntel.trunkCorridors)
const LONG_JOURNEY_M = netIntel.distanceThresholdLongJourney

function prettyMetro(name) {
  if (/red/i.test(name))   return 'Metro Red Line'
  if (/green/i.test(name)) return 'Metro Green Line'
  if (/blue/i.test(name))  return 'Metro Blue Line'
  return name
}

for (const { raw, mode } of [
  { raw: metroRaw, mode: 'metro' },
  { raw: mmtsRaw,  mode: 'mmts'  },
  { raw: busRaw,   mode: 'bus'   },
]) {
  for (const [rawId, info] of Object.entries(raw.stops || {})) {
    const id   = `${mode}:${rawId}`
    const stop = { id, raw_id: rawId, name: info.name, lat: info.lat, lon: info.lon, mode }
    _stops.push(stop)
    _stopById.set(id, stop)
    if (!_stopById.has(rawId)) _stopById.set(rawId, stop)
  }

  for (const [rawId, info] of Object.entries(raw.routes || {})) {
    const id       = `${mode}:${rawId}`
    const stopObjs = (info.stops || [])
      .map(sid => _stopById.get(`${mode}:${sid}`) || _stopById.get(sid) || null)
      .filter(Boolean)
    _routes[id] = {
      id, raw_id: rawId,
      line_name:      mode === 'metro' ? prettyMetro(info.line_name) : info.line_name,
      frequency_mins: info.frequency_mins,
      mode,
      stops: stopObjs,
    }
  }
}

for (const [routeId, route] of Object.entries(_routes)) {
  for (const stop of route.stops) {
    if (!_stopToRoutes[stop.id]) _stopToRoutes[stop.id] = []
    _stopToRoutes[stop.id].push(routeId)
  }
}

console.log(`Loaded: ${_stops.length} stops, ${Object.keys(_routes).length} routes`)

// ── Core routing helpers (mirrors router.js) ──────────────────────────────────

function haversine(lat1, lon1, lat2, lon2) {
  const R  = 6_371_000
  const φ1 = (lat1 * Math.PI) / 180, φ2 = (lat2 * Math.PI) / 180
  const Δφ = ((lat2 - lat1) * Math.PI) / 180
  const Δλ = ((lon2 - lon1) * Math.PI) / 180
  const a  = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

const NEARBY_RADIUS  = { bus: 1200, mmts: 1500, metro: 2000 }
const TRANSFER_RADIUS = { bus: 400, mmts: 300, metro: 500  }

function getNearbyStops(lat, lon, maxDist, mode) {
  const result = []
  for (const stop of _stops) {
    if (stop.mode !== mode) continue
    const d = haversine(lat, lon, stop.lat, stop.lon)
    if (d <= maxDist) result.push({ stop, dist: d })
  }
  result.sort((a, b) => a.dist - b.dist)
  return result.slice(0, 30)
}

function getNearestHubScore(lat, lon, maxDistM = 500) {
  let best = 0
  for (const hub of HUBS) {
    const d = haversine(lat, lon, hub.lat, hub.lon)
    if (d <= maxDistM) {
      const w = hub.hubScore * (1 - (d / maxDistM) * 0.5)
      if (w > best) best = w
    }
  }
  return best
}

function isTrunkRoute(routeId) {
  const r = _routes[routeId]
  return r ? TRUNK_ROUTES.has(r.line_name) : false
}

function buildSrcRouteMap(nearby) {
  const map = new Map()
  for (const { stop, dist } of nearby) {
    for (const routeId of (_stopToRoutes[stop.id] || [])) {
      const route = _routes[routeId]
      if (!route) continue
      const idx = route.stops.findIndex(s => s.id === stop.id)
      if (idx === -1) continue
      const ex = map.get(routeId)
      if (!ex || dist < ex.dist) map.set(routeId, { stopIdx: idx, stop, dist })
    }
  }
  return map
}

function buildDstStopMap(nearby) {
  const map = new Map()
  for (const { stop, dist } of nearby) {
    for (const routeId of (_stopToRoutes[stop.id] || [])) {
      const route = _routes[routeId]
      if (!route) continue
      const idx = route.stops.findIndex(s => s.id === stop.id)
      if (idx === -1) continue
      if (!map.has(routeId)) map.set(routeId, [])
      map.get(routeId).push({ stopIdx: idx, stop, dist })
    }
  }
  for (const entries of map.values()) entries.sort((a, b) => a.dist - b.dist)
  return map
}

function resolveDirection(route, boardStopId, alightStopId) {
  const fwdB = route.stops.findIndex(s => s.id === boardStopId)
  const fwdA = route.stops.findIndex(s => s.id === alightStopId)
  if (fwdB !== -1 && fwdA !== -1 && fwdB < fwdA) return true

  const rev  = [...route.stops].reverse()
  const revB = rev.findIndex(s => s.id === boardStopId)
  const revA = rev.findIndex(s => s.id === alightStopId)
  return revB !== -1 && revA !== -1 && revB < revA
}

/**
 * Lightweight canRoute(): returns { direct: bool, transfer: bool }
 * for one mode without assembling full step objects.
 */
function canRoute(srcLat, srcLon, dstLat, dstLon, mode) {
  const nearbyR = NEARBY_RADIUS[mode]
  const xferR   = TRANSFER_RADIUS[mode]
  const srcN    = getNearbyStops(srcLat, srcLon, nearbyR, mode)
  const dstN    = getNearbyStops(dstLat, dstLon, nearbyR, mode)
  if (!srcN.length || !dstN.length) return { direct: false, transfer: false }

  const srcMap = buildSrcRouteMap(srcN)
  const dstMap = buildDstStopMap(dstN)

  // Sort: trunk first, then frequency
  const entries = [...srcMap.entries()].sort(([aId], [bId]) => {
    const at = isTrunkRoute(aId) ? 0 : 1, bt = isTrunkRoute(bId) ? 0 : 1
    if (at !== bt) return at - bt
    const af = _routes[aId]?.frequency_mins || 999
    const bf = _routes[bId]?.frequency_mins || 999
    return af - bf
  })

  let foundDirect   = false
  let foundTransfer = false

  // Direct
  for (const [routeId, board] of entries) {
    const route = _routes[routeId]
    if (!route) continue
    const dstEntries = dstMap.get(routeId)
    if (!dstEntries) continue
    for (const alight of dstEntries) {
      if (alight.stopIdx === board.stopIdx) continue
      if (resolveDirection(route, board.stop.id, alight.stop.id)) {
        foundDirect = true
        break
      }
    }
    if (foundDirect) break
  }

  // One-transfer (capped at 8 route1 candidates to keep script fast)
  const limit = Math.min(entries.length, 8)
  outerLoop:
  for (let ei = 0; ei < limit; ei++) {
    const [routeId1, board1] = entries[ei]
    const route1 = _routes[routeId1]
    if (!route1) continue
    // Use the direction with more downstream stops (terminus fix)
    let r1Stops = route1.stops, r1BoardIdx = board1.stopIdx
    const fwdCount = route1.stops.length - board1.stopIdx - 1
    const rev = [...route1.stops].reverse()
    const revBoardIdx = rev.findIndex(s => s.id === board1.stop.id)
    if (revBoardIdx !== -1 && rev.length - revBoardIdx - 1 > fwdCount) {
      r1Stops = rev; r1BoardIdx = revBoardIdx
    }
    const downstream = r1Stops.slice(r1BoardIdx + 1)
    for (let di = 0; di < downstream.length; di++) {
      const xStop = downstream[di]
      const nearbyX = getNearbyStops(xStop.lat, xStop.lon, xferR, mode)
        .map(x => x.stop).filter(s => s.id !== xStop.id)
      const candidates = [xStop, ...nearbyX]
        .sort((a, b) => getNearestHubScore(b.lat, b.lon) - getNearestHubScore(a.lat, a.lon))
      for (const xS of candidates) {
        for (const routeId2 of (_stopToRoutes[xS.id] || [])) {
          if (routeId2 === routeId1) continue
          const route2 = _routes[routeId2]
          if (!route2 || route2.mode !== mode) continue
          const dst2 = dstMap.get(routeId2)
          if (!dst2) continue
          for (const alight2 of dst2) {
            if (resolveDirection(route2, xS.id, alight2.stop.id)) {
              foundTransfer = true
              break outerLoop
            }
          }
        }
      }
    }
  }

  return { direct: foundDirect, transfer: foundTransfer }
}

// ── Benchmark journeys ────────────────────────────────────────────────────────

// Coordinates: [lat, lon]
const LOC = {
  // IT corridor (NW)
  miyapur:         [17.4966, 78.3730],  // actual metro station coords (not city centre)
  lingampally:     [17.4948, 78.3168],
  kukatpally:      [17.4843, 78.3949],
  jntu:            [17.4941, 78.3930],
  hafeezpet:       [17.4783, 78.3617],
  madhapur:        [17.4485, 78.3891],
  hitechCity:      [17.4504, 78.3815],
  gachibowli:      [17.4396, 78.3635],
  kondapur:        [17.4640, 78.3670],
  moosapet:        [17.4599, 78.4279],

  // Central
  ameerpet:        [17.4374, 78.4487],
  punjagutta:      [17.4322, 78.4453],
  begumpet:        [17.4434, 78.4685],
  srNagar:         [17.4494, 78.4274],
  lakdiKaPul:      [17.4092, 78.4598],
  khairtabad:      [17.4241, 78.4570],
  filmNagar:       [17.4131, 78.4121],
  jubileeHills:    [17.4317, 78.4139],
  banjaraHills:    [17.4207, 78.4483],

  // North (Secunderabad side)
  paradise:        [17.4399, 78.4983],
  secunderabad:    [17.4345, 78.5048],
  rtcCrossroads:   [17.4085, 78.4976],
  malkajgiri:      [17.4497, 78.5233],
  alwal:           [17.4817, 78.5218],
  ecil:            [17.4798, 78.5531],
  tirumalagiri:    [17.4427, 78.5270],
  bowenpally:      [17.4712, 78.4903],

  // South / old city
  nampally:        [17.3906, 78.4718],
  kachiguda:       [17.3907, 78.4894],
  mgbs:            [17.3769, 78.4793],
  koti:            [17.3831, 78.4828],
  charminar:       [17.3616, 78.4747],
  mehdipatnam:     [17.3947, 78.4401],

  // East
  lbNagar:         [17.3467, 78.5537],
  dilsukhnagar:    [17.3680, 78.5280],
  uppal:           [17.4010, 78.5592],
  nagole:          [17.3740, 78.5533],
  saroornagar:     [17.3549, 78.5343],
  vanasthalipuram: [17.3366, 78.5476],
  hayathnagar:     [17.3420, 78.5870],
  boduppal:        [17.4097, 78.5720],
  ghatkesar:       [17.4473, 78.6944],

  // MMTS nodes
  lingampallyMmts: [17.4948, 78.3168],  // same as lingampally
  kachigudaMmts:   [17.3907, 78.4894],
  nampallyStn:     [17.3906, 78.4718],
  secStn:          [17.4345, 78.5048],
  uppalMmts:       [17.4010, 78.5592],
  malkajgiriMmts:  [17.4497, 78.5233],

  // Outskirts
  patancheru:      [17.5378, 78.2657],
  qutubullapur:    [17.5448, 78.4060],
  tolichowki:      [17.4003, 78.4226],
}

// Journey definition: { id, from, to, src, dst, expectedModes, note }
// expectedModes: array of modes that MUST each find at least 1 route
// If expectedModes is empty, only the basic "any mode finds something" check is done
const JOURNEYS = [
  // ── 1–10: IT corridor ↔ Old city (long journeys >10 km, metro preferred) ──
  { id:  1, from: 'Hitech City',     to: 'MGBS',          src: LOC.hitechCity,   dst: LOC.mgbs,          expectedModes: ['metro','bus'], note: 'IT→old city, metro Blue Line' },
  { id:  2, from: 'Gachibowli',      to: 'Charminar',     src: LOC.gachibowli,   dst: LOC.charminar,     expectedModes: ['bus'],         note: 'IT→old city deep south' },
  { id:  3, from: 'Kondapur',        to: 'Secunderabad',  src: LOC.kondapur,     dst: LOC.secunderabad,  expectedModes: ['bus'],         note: 'NW→NE long' },
  { id:  4, from: 'Madhapur',        to: 'Koti',          src: LOC.madhapur,     dst: LOC.koti,          expectedModes: ['bus'],         note: 'IT hub→old city bus hub' },
  { id:  5, from: 'Raidurg',         to: 'Nampally',      src: LOC.hitechCity,   dst: LOC.nampally,      expectedModes: ['metro','bus'], note: 'Blue Line terminus→Nampally' },
  { id:  6, from: 'Miyapur',         to: 'LB Nagar',      src: LOC.miyapur,      dst: LOC.lbNagar,       expectedModes: ['metro'],       note: 'Metro Blue Line full traverse' },
  { id:  7, from: 'Lingampally',     to: 'Uppal',         src: LOC.lingampally,  dst: LOC.uppal,         expectedModes: ['bus'],         note: 'West terminus→east cross-city' },
  { id:  8, from: 'Gachibowli',      to: 'MGBS',          src: LOC.gachibowli,   dst: LOC.mgbs,          expectedModes: ['bus'],         note: 'IT hub→major bus terminus' },
  { id:  9, from: 'Hitech City',     to: 'Dilsukhnagar',  src: LOC.hitechCity,   dst: LOC.dilsukhnagar,  expectedModes: ['metro','bus'], note: 'IT→SE via metro' },
  { id: 10, from: 'Kondapur',        to: 'Kachiguda',     src: LOC.kondapur,     dst: LOC.kachiguda,     expectedModes: ['bus'],         note: 'NW IT→south station' },

  // ── 11–20: Metro Blue Line corridors ──
  { id: 11, from: 'Miyapur',         to: 'Ameerpet',      src: LOC.miyapur,      dst: LOC.ameerpet,      expectedModes: ['metro'],       note: 'Blue Line NW segment' },
  { id: 12, from: 'Ameerpet',        to: 'Hitech City',   src: LOC.ameerpet,     dst: LOC.hitechCity,    expectedModes: ['metro'],       note: 'Blue Line central→west' },
  { id: 13, from: 'Kukatpally',      to: 'Ameerpet',      src: LOC.kukatpally,   dst: LOC.ameerpet,      expectedModes: ['metro'],       note: 'Blue Line mid-section' },
  { id: 14, from: 'Miyapur',         to: 'Punjagutta',    src: LOC.miyapur,      dst: LOC.punjagutta,    expectedModes: ['metro'],       note: 'Blue Line NW→central' },
  { id: 15, from: 'Ameerpet',        to: 'LB Nagar',      src: LOC.ameerpet,     dst: LOC.lbNagar,       expectedModes: ['metro'],       note: 'Blue Line→SE terminus' },
  { id: 16, from: 'LB Nagar',        to: 'Miyapur',       src: LOC.lbNagar,      dst: LOC.miyapur,       expectedModes: ['metro'],       note: 'Blue Line full reverse' },
  { id: 17, from: 'Nagole',          to: 'Ameerpet',      src: LOC.nagole,       dst: LOC.ameerpet,      expectedModes: ['metro'],       note: 'Green Line→Blue Line interchange' },
  { id: 18, from: 'Uppal',           to: 'Nagole',        src: LOC.uppal,        dst: LOC.nagole,        expectedModes: ['metro'],       note: 'Green Line east section' },
  { id: 19, from: 'Ameerpet',        to: 'Paradise',      src: LOC.ameerpet,     dst: LOC.paradise,      expectedModes: ['metro'],       note: 'Red Line from Ameerpet' },
  { id: 20, from: 'Begumpet',        to: 'Secunderabad',  src: LOC.begumpet,     dst: LOC.secunderabad,  expectedModes: ['metro'],       note: 'Red Line north' },

  // ── 21–30: MMTS corridor journeys ──
  { id: 21, from: 'Lingampally',     to: 'Secunderabad',  src: LOC.lingampally,  dst: LOC.secunderabad,  expectedModes: ['mmts'],        note: 'MMTS Lingampally–Secunderabad' },
  { id: 22, from: 'Secunderabad',    to: 'Kachiguda',     src: LOC.secunderabad, dst: LOC.kachiguda,     expectedModes: ['mmts'],        note: 'MMTS Sec→Kachiguda' },
  { id: 23, from: 'Lingampally',     to: 'Kachiguda',     src: LOC.lingampally,  dst: LOC.kachiguda,     expectedModes: ['mmts'],        note: 'MMTS full western line' },
  { id: 24, from: 'Nampally',        to: 'Secunderabad',  src: LOC.nampally,     dst: LOC.secunderabad,  expectedModes: ['mmts'],        note: 'MMTS Nampally→Sec' },
  { id: 25, from: 'Secunderabad',    to: 'Malkajgiri',    src: LOC.secunderabad, dst: LOC.malkajgiri,    expectedModes: ['mmts'],        note: 'MMTS eastern branch' },
  { id: 26, from: 'Kachiguda',       to: 'Uppal',         src: LOC.kachiguda,    dst: LOC.uppal,         expectedModes: ['bus','metro'], note: 'No MMTS to Uppal; bus+metro serve it' },
  { id: 27, from: 'Nampally',        to: 'Kachiguda',     src: LOC.nampally,     dst: LOC.kachiguda,     expectedModes: ['mmts','bus'],  note: 'Close stations, MMTS or bus' },
  { id: 28, from: 'Lingampally',     to: 'Nampally',      src: LOC.lingampally,  dst: LOC.nampally,      expectedModes: ['mmts'],        note: 'MMTS western segment' },
  { id: 29, from: 'Secunderabad',    to: 'Tirumalagiri',  src: LOC.secunderabad, dst: LOC.tirumalagiri,  expectedModes: ['mmts'],        note: 'MMTS cantonment branch' },
  { id: 30, from: 'Kachiguda',       to: 'Secunderabad',  src: LOC.kachiguda,    dst: LOC.secunderabad,  expectedModes: ['mmts'],        note: 'MMTS reverse' },

  // ── 31–45: Hub-to-hub bus journeys ──
  { id: 31, from: 'MGBS',            to: 'Secunderabad',  src: LOC.mgbs,         dst: LOC.secunderabad,  expectedModes: ['bus'],         note: 'Tier-1 hub to tier-1 hub' },
  { id: 32, from: 'Ameerpet',        to: 'MGBS',          src: LOC.ameerpet,     dst: LOC.mgbs,          expectedModes: ['bus'],         note: 'Tier-1 hub to tier-1 hub' },
  { id: 33, from: 'Secunderabad',    to: 'Mehdipatnam',   src: LOC.secunderabad, dst: LOC.mehdipatnam,   expectedModes: ['bus'],         note: 'Cross-city N→SW' },
  { id: 34, from: 'MGBS',            to: 'Miyapur',       src: LOC.mgbs,         dst: LOC.miyapur,       expectedModes: ['bus'],         note: 'South→NW long bus' },
  { id: 35, from: 'Mehdipatnam',     to: 'MGBS',          src: LOC.mehdipatnam,  dst: LOC.mgbs,          expectedModes: ['bus'],         note: 'SW hub→central hub' },
  { id: 36, from: 'Kukatpally',      to: 'Ameerpet',      src: LOC.kukatpally,   dst: LOC.ameerpet,      expectedModes: ['bus','metro'], note: 'NW→central via metro or bus' },
  { id: 37, from: 'LB Nagar',        to: 'MGBS',          src: LOC.lbNagar,      dst: LOC.mgbs,          expectedModes: ['bus'],         note: 'SE hub→southern hub' },
  { id: 38, from: 'Dilsukhnagar',    to: 'Ameerpet',      src: LOC.dilsukhnagar, dst: LOC.ameerpet,      expectedModes: ['metro','bus'], note: 'SE→central' },
  { id: 39, from: 'Koti',            to: 'Ameerpet',      src: LOC.koti,         dst: LOC.ameerpet,      expectedModes: ['bus'],         note: 'Old city→central' },
  { id: 40, from: 'RTC Crossroads',  to: 'Ameerpet',      src: LOC.rtcCrossroads,dst: LOC.ameerpet,      expectedModes: ['bus'],         note: 'RTC hub→metro hub' },
  { id: 41, from: 'Mehdipatnam',     to: 'Ameerpet',      src: LOC.mehdipatnam,  dst: LOC.ameerpet,      expectedModes: ['bus'],         note: 'SW hub→metro hub' },
  { id: 42, from: 'JNTU',            to: 'Ameerpet',      src: LOC.jntu,         dst: LOC.ameerpet,      expectedModes: ['bus'],         note: 'NW university hub→central' },
  { id: 43, from: 'Hafeezpet',       to: 'Secunderabad',  src: LOC.hafeezpet,    dst: LOC.secunderabad,  expectedModes: ['bus'],         note: 'Original 216K/L test journey' },
  { id: 44, from: 'Hafeezpet',       to: 'Lingampally',   src: LOC.hafeezpet,    dst: LOC.lingampally,   expectedModes: ['bus'],         note: 'Hafeezpet local' },
  { id: 45, from: 'Hafeezpet',       to: 'Miyapur',       src: LOC.hafeezpet,    dst: LOC.miyapur,       expectedModes: ['bus'],         note: 'Hafeezpet→Miyapur' },

  // ── 46–60: Short local bus journeys ──
  { id: 46, from: 'Ameerpet',        to: 'Punjagutta',    src: LOC.ameerpet,     dst: LOC.punjagutta,    expectedModes: ['bus'],         note: 'Short adjacent stops' },
  { id: 47, from: 'Begumpet',        to: 'Ameerpet',      src: LOC.begumpet,     dst: LOC.ameerpet,      expectedModes: ['bus'],         note: 'Short central hop' },
  { id: 48, from: 'Nampally',        to: 'Koti',          src: LOC.nampally,     dst: LOC.koti,          expectedModes: ['bus'],         note: 'Adjacent old city stops' },
  { id: 49, from: 'Kachiguda',       to: 'MGBS',          src: LOC.kachiguda,    dst: LOC.mgbs,          expectedModes: ['bus'],         note: 'Close south stations' },
  { id: 50, from: 'RTC Crossroads',  to: 'Secunderabad',  src: LOC.rtcCrossroads,dst: LOC.secunderabad,  expectedModes: ['bus'],         note: 'North corridor short hop' },
  { id: 51, from: 'MGBS',            to: 'Koti',          src: LOC.mgbs,         dst: LOC.koti,          expectedModes: ['bus'],         note: 'Adjacent major hubs' },
  { id: 52, from: 'Koti',            to: 'Charminar',     src: LOC.koti,         dst: LOC.charminar,     expectedModes: ['bus'],         note: 'Old city internal' },
  { id: 53, from: 'Mehdipatnam',     to: 'Punjagutta',    src: LOC.mehdipatnam,  dst: LOC.punjagutta,    expectedModes: ['bus'],         note: 'SW→central short' },
  { id: 54, from: 'Lakdi Ka Pul',    to: 'Ameerpet',      src: LOC.lakdiKaPul,   dst: LOC.ameerpet,      expectedModes: ['bus','metro'], note: 'Central corridor short' },
  { id: 55, from: 'Secunderabad',    to: 'Bowenpally',    src: LOC.secunderabad, dst: LOC.bowenpally,    expectedModes: ['bus'],         note: 'Sec north' },
  { id: 56, from: 'Ameerpet',        to: 'SR Nagar',      src: LOC.ameerpet,     dst: LOC.srNagar,       expectedModes: ['bus'],         note: 'Short NW bus' },
  { id: 57, from: 'Moosapet',        to: 'Kukatpally',    src: LOC.moosapet,     dst: LOC.kukatpally,    expectedModes: ['bus'],         note: 'NW local hop' },
  { id: 58, from: 'JNTU',            to: 'Kukatpally',    src: LOC.jntu,         dst: LOC.kukatpally,    expectedModes: ['bus'],         note: 'NW university area' },
  { id: 59, from: 'Dilsukhnagar',    to: 'LB Nagar',      src: LOC.dilsukhnagar, dst: LOC.lbNagar,       expectedModes: ['bus','metro'], note: 'SE corridor short' },
  { id: 60, from: 'Saroornagar',     to: 'LB Nagar',      src: LOC.saroornagar,  dst: LOC.lbNagar,       expectedModes: ['bus'],         note: 'SE local' },

  // ── 61–75: Cross-city bus journeys requiring transfers ──
  { id: 61, from: 'Hafeezpet',       to: 'Koti',          src: LOC.hafeezpet,    dst: LOC.koti,          expectedModes: ['bus'],         note: 'NW→old city via transfer' },
  { id: 62, from: 'Hafeezpet',       to: 'Charminar',     src: LOC.hafeezpet,    dst: LOC.charminar,     expectedModes: ['bus'],         note: 'NW→old city deep' },
  { id: 63, from: 'Kondapur',        to: 'Dilsukhnagar',  src: LOC.kondapur,     dst: LOC.dilsukhnagar,  expectedModes: ['bus'],         note: 'NW IT→SE cross-city' },
  { id: 64, from: 'Gachibowli',      to: 'Secunderabad',  src: LOC.gachibowli,   dst: LOC.secunderabad,  expectedModes: ['bus'],         note: 'SW IT→NE' },
  { id: 65, from: 'Miyapur',         to: 'Nagole',        src: LOC.miyapur,      dst: LOC.nagole,        expectedModes: ['metro','bus'], note: 'NW→SE long metro' },
  { id: 66, from: 'Lingampally',     to: 'LB Nagar',      src: LOC.lingampally,  dst: LOC.lbNagar,       expectedModes: ['bus'],         note: 'West→SE full cross' },
  { id: 67, from: 'Kondapur',        to: 'Uppal',         src: LOC.kondapur,     dst: LOC.uppal,         expectedModes: ['bus'],         note: 'NW IT→east' },
  { id: 68, from: 'Mehdipatnam',     to: 'Dilsukhnagar',  src: LOC.mehdipatnam,  dst: LOC.dilsukhnagar,  expectedModes: ['bus'],         note: 'SW→SE via transfer' },
  { id: 69, from: 'JNTU',            to: 'Secunderabad',  src: LOC.jntu,         dst: LOC.secunderabad,  expectedModes: ['bus'],         note: 'NW→NE long bus' },
  { id: 70, from: 'Ecil',            to: 'Ameerpet',      src: LOC.ecil,         dst: LOC.ameerpet,      expectedModes: ['bus'],         note: 'NE suburb→central' },
  { id: 71, from: 'Alwal',           to: 'MGBS',          src: LOC.alwal,        dst: LOC.mgbs,          expectedModes: ['bus'],         note: 'Far north→south hub' },
  { id: 72, from: 'Malkajgiri',      to: 'Ameerpet',      src: LOC.malkajgiri,   dst: LOC.ameerpet,      expectedModes: ['bus'],         note: 'NE→central' },
  { id: 73, from: 'Tolichowki',      to: 'MGBS',          src: LOC.tolichowki,   dst: LOC.mgbs,          expectedModes: ['bus'],         note: 'SW→south hub' },
  { id: 74, from: 'Film Nagar',      to: 'Ameerpet',      src: LOC.filmNagar,    dst: LOC.ameerpet,      expectedModes: ['bus'],         note: 'SW residential→central' },
  { id: 75, from: 'Jubilee Hills',   to: 'Secunderabad',  src: LOC.jubileeHills, dst: LOC.secunderabad,  expectedModes: ['bus'],         note: 'Central residential→N' },

  // ── 76–85: Outskirts / difficult journeys ──
  { id: 76, from: 'Hayathnagar',     to: 'MGBS',          src: LOC.hayathnagar,  dst: LOC.mgbs,          expectedModes: ['bus'],         note: 'Far SE suburb→south hub' },
  { id: 77, from: 'Boduppal',        to: 'Uppal',         src: LOC.boduppal,     dst: LOC.uppal,         expectedModes: ['bus'],         note: 'East suburb→metro' },
  { id: 78, from: 'Vanasthalipuram', to: 'LB Nagar',      src: LOC.vanasthalipuram,dst: LOC.lbNagar,     expectedModes: ['bus'],         note: 'Far SE→metro terminus' },
  { id: 79, from: 'Ecil',            to: 'Secunderabad',  src: LOC.ecil,         dst: LOC.secunderabad,  expectedModes: ['bus'],         note: 'NE suburb→Sec railway' },
  { id: 80, from: 'AS Rao Nagar',    to: 'Secunderabad',  src: [17.4677, 78.5573],dst: LOC.secunderabad, expectedModes: ['bus'],         note: 'NE suburb bus' },
  { id: 81, from: 'Bowenpally',      to: 'Ameerpet',      src: LOC.bowenpally,   dst: LOC.ameerpet,      expectedModes: ['bus'],         note: 'Sec north suburb→metro' },
  { id: 82, from: 'Kondapur',        to: 'Miyapur',       src: LOC.kondapur,     dst: LOC.miyapur,       expectedModes: ['bus'],         note: 'Kondapur has no metro within 2km; bus only' },
  { id: 83, from: 'Moosapet',        to: 'Ameerpet',      src: LOC.moosapet,     dst: LOC.ameerpet,      expectedModes: ['bus','metro'], note: 'NW→metro hub' },
  { id: 84, from: 'Tolichowki',      to: 'Mehdipatnam',   src: LOC.tolichowki,   dst: LOC.mehdipatnam,   expectedModes: ['bus'],         note: 'SW local' },
  { id: 85, from: 'Banjara Hills',   to: 'Ameerpet',      src: LOC.banjaraHills, dst: LOC.ameerpet,      expectedModes: ['bus'],         note: 'Residential→metro hub' },

  // ── 86–95: Symmetry / reverse of key journeys ──
  { id: 86, from: 'MGBS',            to: 'Hitech City',   src: LOC.mgbs,         dst: LOC.hitechCity,    expectedModes: ['bus'],         note: 'Reverse: old city→IT (bus)' },
  { id: 87, from: 'LB Nagar',        to: 'Ameerpet',      src: LOC.lbNagar,      dst: LOC.ameerpet,      expectedModes: ['metro'],       note: 'Blue Line reverse' },
  { id: 88, from: 'Secunderabad',    to: 'Lingampally',   src: LOC.secunderabad, dst: LOC.lingampally,   expectedModes: ['mmts'],        note: 'MMTS reverse' },
  { id: 89, from: 'Paradise',        to: 'Ameerpet',      src: LOC.paradise,     dst: LOC.ameerpet,      expectedModes: ['metro'],       note: 'Red Line reverse' },
  { id: 90, from: 'Charminar',       to: 'MGBS',          src: LOC.charminar,    dst: LOC.mgbs,          expectedModes: ['bus'],         note: 'Old city reverse' },
  { id: 91, from: 'Dilsukhnagar',    to: 'Kondapur',      src: LOC.dilsukhnagar, dst: LOC.kondapur,      expectedModes: ['bus'],         note: 'SE→NW IT reverse' },
  { id: 92, from: 'Uppal',           to: 'Gachibowli',    src: LOC.uppal,        dst: LOC.gachibowli,    expectedModes: ['bus'],         note: 'East→west IT long' },
  { id: 93, from: 'Mehdipatnam',     to: 'Secunderabad',  src: LOC.mehdipatnam,  dst: LOC.secunderabad,  expectedModes: ['bus'],         note: 'SW→NE cross city' },
  { id: 94, from: 'Koti',            to: 'Miyapur',       src: LOC.koti,         dst: LOC.miyapur,       expectedModes: ['bus'],         note: 'Old city→NW long' },
  { id: 95, from: 'Secunderabad',    to: 'MGBS',          src: LOC.secunderabad, dst: LOC.mgbs,          expectedModes: ['bus'],         note: 'N hub→S hub reverse' },

  // ── 96–100: Edge cases ──
  { id:  96, from: 'Patancheru',     to: 'Lingampally',   src: LOC.patancheru,   dst: LOC.lingampally,   expectedModes: [],              note: 'Far west outskirts — any route' },
  { id:  97, from: 'Ghatkesar',      to: 'Uppal',         src: LOC.ghatkesar,    dst: LOC.uppal,         expectedModes: [],              note: 'Far east outskirts' },
  { id:  98, from: 'Qutubullapur',   to: 'Kukatpally',    src: LOC.qutubullapur, dst: LOC.kukatpally,    expectedModes: [],              note: 'North outskirts→NW' },
  { id:  99, from: 'Ameerpet',       to: 'Ameerpet',      src: LOC.ameerpet,     dst: [17.4375, 78.4489],expectedModes: [],              note: 'Same-area trivial: should be empty' },
  { id: 100, from: 'Hafeezpet',      to: 'MGBS',          src: LOC.hafeezpet,    dst: LOC.mgbs,          expectedModes: ['bus'],         note: 'Hafeezpet→south hub via 216K/L transfer' },
]

// ── Run benchmarks ────────────────────────────────────────────────────────────

const MODES = ['bus', 'metro', 'mmts']
const PASS_COLOUR  = '\x1b[32m✓\x1b[0m'
const FAIL_COLOUR  = '\x1b[31m✗\x1b[0m'
const WARN_COLOUR  = '\x1b[33m⚠\x1b[0m'
const SKIP_COLOUR  = '\x1b[90m–\x1b[0m'

let passed = 0, failed = 0, warned = 0

console.log('\n══════════════════════════════════════════════════════════════')
console.log('   TravelMate — Route Validation Benchmark (100 journeys)')
console.log('══════════════════════════════════════════════════════════════\n')
console.log('  ID  From → To                                   Modes    Result')
console.log('  ──  ──────────────────────────────────────────  ───────  ──────')

for (const j of JOURNEYS) {
  const [srcLat, srcLon] = j.src
  const [dstLat, dstLon] = j.dst

  // Special case: same area → expect no routes
  const distM = haversine(srcLat, srcLon, dstLat, dstLon)
  if (distM < 150) {
    const tag   = `${j.id.toString().padStart(3)}  ${j.from.padEnd(20)} → ${j.to.padEnd(20)}`
    console.log(`  ${SKIP_COLOUR} ${tag.padEnd(45)}  same-area  skipped`)
    continue
  }

  const modeResults = {}
  for (const mode of MODES) {
    const { direct, transfer } = canRoute(srcLat, srcLon, dstLat, dstLon, mode)
    modeResults[mode] = direct || transfer
  }

  const anyFound  = Object.values(modeResults).some(Boolean)
  const modesStr  = MODES.map(m => modeResults[m] ? m[0].toUpperCase() : '.').join('')  // B, M, m

  let verdict, symbol
  if (j.expectedModes.length === 0) {
    // No specific mode required — just note what was found
    verdict = anyFound ? 'ok' : 'none'
    symbol  = anyFound ? PASS_COLOUR : WARN_COLOUR
    if (!anyFound) warned++
    else passed++
  } else {
    const missing = j.expectedModes.filter(m => !modeResults[m])
    if (missing.length === 0) {
      verdict = 'PASS'
      symbol  = PASS_COLOUR
      passed++
    } else {
      verdict = `FAIL (no ${missing.join(',')})`
      symbol  = FAIL_COLOUR
      failed++
    }
  }

  const label = `${j.id.toString().padStart(3)}  ${(j.from + ' → ' + j.to).padEnd(42)}`
  console.log(`  ${symbol} ${label}  [${modesStr}]  ${verdict}`)
}

console.log('\n══════════════════════════════════════════════════════════════')
console.log(`  Results: ${passed} passed  ${warned} warned  ${failed} failed  out of ${JOURNEYS.length}`)
console.log('══════════════════════════════════════════════════════════════\n')

if (failed > 0) process.exit(1)
