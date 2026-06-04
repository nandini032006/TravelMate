/**
 * router.js — Hyderabad multimodal route planner
 *
 * findRoutes() returns { rtc, mmts, metro }
 * Each section: { direct[], fastest[], cheapest[], all[] }
 *
 * Rules:
 *  - Each mode searched independently (no bus+metro mixing in one route)
 *  - Walk / auto steps only for first-mile / last-mile access
 *  - Metro and MMTS routes are bidirectional — engine handles both directions
 *  - Metro steps use GTFS shape polylines when available (realistic curves)
 */

import {
  getAllStops,
  getRoute,
  getRoutesForStop,
  getFares,
} from '../services/transitData'
import networkIntelligence from '../data/networkIntelligence.json'

// ── Network intelligence constants ────────────────────────────────────────────
const HUBS          = networkIntelligence.hubs
const TRUNK_ROUTES  = new Set(networkIntelligence.trunkCorridors)
const LONG_JOURNEY_M = networkIntelligence.distanceThresholdLongJourney  // 10 000 m

// ── Mode-specific search radii (metres) ───────────────────────────────────────
const NEARBY_RADIUS = {
  bus:   2000,   // wide enough to handle Photon geocoder coordinate variance (~1.5km off for named areas)
  mmts:  1500,
  metro: 2000,
}

const TRANSFER_RADIUS = {
  bus:   400,    // was 200 — Hyderabad interchanges (MGBS, Kachiguda, Mehdipatnam) have stops 300-500m apart
  mmts:  300,
  metro: 500,
}

const MAX_ALL = {
  bus:   3,
  mmts:  2,
  metro: 2,
}

const BIDIRECTIONAL = new Set(['metro', 'mmts', 'bus'])

// ── Speed / fare constants ─────────────────────────────────────────────────────
const SPEED = { metro: 50, mmts: 40, bus: 20, walk: 4.5, auto: 20 }
const AUTO_BASE   = 30
const AUTO_PER_KM = 15

// ── Haversine distance (metres) ───────────────────────────────────────────────
function haversine(lat1, lon1, lat2, lon2) {
  const R  = 6_371_000
  const φ1 = (lat1 * Math.PI) / 180
  const φ2 = (lat2 * Math.PI) / 180
  const Δφ = ((lat2 - lat1) * Math.PI) / 180
  const Δλ = ((lon2 - lon1) * Math.PI) / 180
  const a  = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

// ── Hub intelligence helpers ──────────────────────────────────────────────────

// Distance-weighted hub significance at a given coordinate.
// Returns 0 if no hub within maxDistM; up to hubScore at centre.
function getNearestHubScore(lat, lon, maxDistM = 800) {
  let best = 0
  for (const hub of HUBS) {
    const d = haversine(lat, lon, hub.lat, hub.lon)
    if (d <= maxDistM) {
      // Linear weight: 1.0 at 0m → 0.5 at maxDistM
      const weighted = hub.hubScore * (1 - (d / maxDistM) * 0.5)
      if (weighted > best) best = weighted
    }
  }
  return best
}

// Bonus points for a route whose endpoints pass through/near major hubs.
// Tier-1 hub (MGBS/Secunderabad/Ameerpet) → +6; tier-2 → +3; tier-3 → +1.
function computeHubPassageBonus(route) {
  let bonus = 0
  for (const step of route.steps) {
    if (step.mode === 'walk' || step.mode === 'auto') continue
    for (const hub of HUBS) {
      const dFrom = haversine(step.from_coord.lat, step.from_coord.lon, hub.lat, hub.lon)
      const dTo   = haversine(step.to_coord.lat,   step.to_coord.lon,   hub.lat, hub.lon)
      if (dFrom <= hub.transferRadius || dTo <= hub.transferRadius) {
        const b = hub.tier === 1 ? 6 : hub.tier === 2 ? 3 : 1
        if (b > bonus) bonus = b
      }
    }
    if (bonus >= 6) break   // tier-1 already found — can't do better
  }
  return Math.min(bonus, 10)
}

// True if a line name is (or is a lettered variant of) a trunk corridor.
// "216K/L" → matches trunk "216" because next char after prefix is a letter.
// "10H" → matches trunk "10H" exactly; does NOT false-match trunk "1" because
// next char after "1" is "0" (digit), not a letter.
function isTrunkLineName(name) {
  if (TRUNK_ROUTES.has(name)) return true
  for (const trunk of TRUNK_ROUTES) {
    if (name.length > trunk.length &&
        name.startsWith(trunk) &&
        /[A-Za-z/]/.test(name[trunk.length])) return true
  }
  return false
}

// True if this route_id maps to one of the high-frequency trunk corridors.
function isTrunkRoute(routeId) {
  const route = getRoute(routeId)
  return route ? isTrunkLineName(route.line_name) : false
}

// ── Time / cost helpers ───────────────────────────────────────────────────────
function travelSec(distM, mode) { return Math.round((distM / 1000 / SPEED[mode]) * 3600) }
function walkSec(distM)          { return travelSec(distM, 'walk') }
function autoCost(distM)         { return Math.round(AUTO_BASE + AUTO_PER_KM * (distM / 1000)) }

function transitCost(distM, mode, fares) {
  const km    = distM / 1000
  const table = fares[mode] || fares.bus
  for (const slab of table) { if (km <= slab.max_km) return slab.fare }
  return table[table.length - 1].fare
}

// ── Shape slicing for realistic metro polylines ───────────────────────────────
// Finds the nearest shape points to boardStop and alightStop, then slices
// the shape array between those indices (reversing if necessary).

function sliceShape(shape, boardStop, alightStop) {
  if (!shape || shape.length < 2) return null

  let boardIdx = 0, boardDist = Infinity
  let alightIdx = 0, alightDist = Infinity

  for (let i = 0; i < shape.length; i++) {
    const [lat, lon] = shape[i]
    const d1 = haversine(boardStop.lat, boardStop.lon, lat, lon)
    const d2 = haversine(alightStop.lat, alightStop.lon, lat, lon)
    if (d1 < boardDist) { boardDist = d1; boardIdx = i }
    if (d2 < alightDist) { alightDist = d2; alightIdx = i }
  }

  const lo = Math.min(boardIdx, alightIdx)
  const hi = Math.max(boardIdx, alightIdx)
  const slice = shape.slice(lo, hi + 1)

  // Reverse if traveling against the shape direction
  const ordered = boardIdx <= alightIdx ? slice : slice.slice().reverse()
  return ordered.map(([lat, lon]) => ({ lat, lon }))
}

// ── Nearby stops (mode-filtered) ─────────────────────────────────────────────
function getNearbyStops(lat, lon, maxDist, mode) {
  const result = []
  for (const stop of getAllStops()) {
    if (stop.mode !== mode) continue
    const d = haversine(lat, lon, stop.lat, stop.lon)
    if (d <= maxDist) result.push({ stop, dist: d })
  }
  result.sort((a, b) => a.dist - b.dist)
  return result.slice(0, 30)   // was 20 — denser areas need more coverage
}

// ── Step builders ─────────────────────────────────────────────────────────────
function makeWalkStep(fromLat, fromLon, fromName, toLat, toLon, toName) {
  const distM = haversine(fromLat, fromLon, toLat, toLon)
  const sec   = walkSec(distM)
  const mins  = Math.max(1, Math.round(sec / 60))
  return {
    mode: 'walk',
    instruction:   `Walk ${Math.round(distM)}m to ${toName} (~${mins} min)`,
    from_name:     fromName, to_name: toName,
    from_coord:    { lat: fromLat, lon: fromLon },
    to_coord:      { lat: toLat,   lon: toLon   },
    distance_m:    Math.round(distM), duration_sec: sec, cost_inr: 0,
    line_name: '', route_id: '', stop_sequence: [],
    polyline:      [{ lat: fromLat, lon: fromLon }, { lat: toLat, lon: toLon }],
    service_level: '', freq_mins: 0,
  }
}

function makeAutoStep(fromLat, fromLon, fromName, toLat, toLon, toName) {
  const distM = haversine(fromLat, fromLon, toLat, toLon)
  const sec   = travelSec(distM, 'auto')
  const cost  = autoCost(distM)
  const mins  = Math.max(1, Math.round(sec / 60))
  const km    = (distM / 1000).toFixed(1)
  return {
    mode: 'auto',
    instruction:   `Auto-rickshaw to ${toName}, ${km}km, ~${mins} min, approx Rs.${cost}`,
    from_name:     fromName, to_name: toName,
    from_coord:    { lat: fromLat, lon: fromLon },
    to_coord:      { lat: toLat,   lon: toLon   },
    distance_m:    Math.round(distM), duration_sec: sec, cost_inr: cost,
    line_name: '', route_id: '', stop_sequence: [],
    polyline:      [{ lat: fromLat, lon: fromLon }, { lat: toLat, lon: toLon }],
    service_level: '', freq_mins: 0,
  }
}

function makeTransitStep(route, boardStop, alightStop, stopSlice, fares) {
  const mode      = route.mode
  const nStops    = Math.max(1, stopSlice.length - 1)
  const freqMins  = route.frequency_mins || 0
  const sinuosity = mode === 'metro' ? 1.2 : 1.4
  const distM     = haversine(boardStop.lat, boardStop.lon, alightStop.lat, alightStop.lon) * sinuosity
  const sec       = travelSec(distM, mode)
  const cost      = transitCost(distM, mode, fares)
  const mins      = Math.max(1, Math.round(sec / 60))
  const freqText  = freqMins ? ` every ~${freqMins} min` : ''
  const svcLevel  = freqMins <= 5 ? 'high' : freqMins <= 15 ? 'medium' : 'low'

  let instruction
  if (mode === 'metro') {
    instruction = `Take ${route.line_name} from ${boardStop.name} to ${alightStop.name}, ${nStops} stops, ~${mins} min`
  } else if (mode === 'mmts') {
    instruction = `Board MMTS at ${boardStop.name}, alight at ${alightStop.name}, ${nStops} stops, ~${mins} min`
  } else {
    instruction = `Take ${route.line_name} bus from ${boardStop.name} to ${alightStop.name}, ${nStops} stops, ~${mins} min${freqText}`
  }

  // Use GTFS shape polyline for metro (realistic curves), fall back to stop sequence
  const shapedPolyline = mode === 'metro'
    ? (sliceShape(route.shape, boardStop, alightStop) || stopSlice.map(s => ({ lat: s.lat, lon: s.lon })))
    : stopSlice.map(s => ({ lat: s.lat, lon: s.lon }))

  return {
    mode,
    instruction,
    from_name:     boardStop.name,  to_name: alightStop.name,
    from_coord:    { lat: boardStop.lat,  lon: boardStop.lon  },
    to_coord:      { lat: alightStop.lat, lon: alightStop.lon },
    distance_m:    Math.round(distM), duration_sec: sec, cost_inr: cost,
    line_name:     route.line_name,
    route_id:      route.raw_id || route.id,
    stop_sequence: stopSlice.map(s => s.name),
    polyline:      shapedPolyline,
    service_level: svcLevel,
    freq_mins:     freqMins,
  }
}

// ── Build one leg's steps (walk-in + transit + walk-out) ─────────────────────
function buildLegSteps(srcLat, srcLon, srcName, dstLat, dstLon, dstName,
                        boardIdx, alightIdx, effectiveStops, route, fares) {
  const steps      = []
  const boardStop  = effectiveStops[boardIdx]
  const alightStop = effectiveStops[alightIdx]
  const stopSlice  = effectiveStops.slice(boardIdx, alightIdx + 1)

  const dIn = haversine(srcLat, srcLon, boardStop.lat, boardStop.lon)
  if (dIn >= 20) {
    steps.push(dIn > 1000
      ? makeAutoStep(srcLat, srcLon, srcName, boardStop.lat, boardStop.lon, boardStop.name)
      : makeWalkStep(srcLat, srcLon, srcName, boardStop.lat, boardStop.lon, boardStop.name))
  }

  steps.push(makeTransitStep(route, boardStop, alightStop, stopSlice, fares))

  const dOut = haversine(alightStop.lat, alightStop.lon, dstLat, dstLon)
  if (dOut >= 20) {
    steps.push(dOut > 1000
      ? makeAutoStep(alightStop.lat, alightStop.lon, alightStop.name, dstLat, dstLon, dstName)
      : makeWalkStep(alightStop.lat, alightStop.lon, alightStop.name, dstLat, dstLon, dstName))
  }

  return steps
}

// ── Bidirectional direction resolver ─────────────────────────────────────────
function resolveDirection(route, boardStopId, alightStopId, mode) {
  const fwdBoard  = route.stops.findIndex(s => s.id === boardStopId)
  const fwdAlight = route.stops.findIndex(s => s.id === alightStopId)

  if (fwdBoard !== -1 && fwdAlight !== -1 && fwdBoard < fwdAlight) {
    return { stops: route.stops, boardIdx: fwdBoard, alightIdx: fwdAlight }
  }

  if (BIDIRECTIONAL.has(mode)) {
    const rev       = [...route.stops].reverse()
    const revBoard  = rev.findIndex(s => s.id === boardStopId)
    const revAlight = rev.findIndex(s => s.id === alightStopId)
    if (revBoard !== -1 && revAlight !== -1 && revBoard < revAlight) {
      return { stops: rev, boardIdx: revBoard, alightIdx: revAlight }
    }
  }

  return null
}

// ── Route-map builders ────────────────────────────────────────────────────────

// For board stop: prefer the NEAREST stop to the origin, not the earliest in
// the route sequence. The old logic (earliest index) forced passengers to walk
// to a distant stop-0 when a much closer stop existed further along the route.
function buildSrcRouteMap(nearbyStops) {
  const map = new Map()
  for (const { stop, dist } of nearbyStops) {
    for (const routeId of getRoutesForStop(stop.id)) {
      const route = getRoute(routeId)
      if (!route) continue
      const idx = route.stops.findIndex(s => s.id === stop.id)
      if (idx === -1) continue
      const ex = map.get(routeId)
      if (!ex || dist < ex.dist) map.set(routeId, { stopIdx: idx, stop, dist })
    }
  }
  return map
}

// For alight stop: collect ALL stops near destination per route, sorted by
// distance from destination. The direction-check loop tries them nearest-first,
// so passengers alight as close to their destination as possible.
function buildDstStopMap(nearbyStops) {
  const map = new Map()
  for (const { stop, dist } of nearbyStops) {
    for (const routeId of getRoutesForStop(stop.id)) {
      const route = getRoute(routeId)
      if (!route) continue
      const idx = route.stops.findIndex(s => s.id === stop.id)
      if (idx === -1) continue
      if (!map.has(routeId)) map.set(routeId, [])
      map.get(routeId).push({ stopIdx: idx, stop, dist })
    }
  }
  // Sort each route's alight candidates nearest-first
  for (const entries of map.values()) entries.sort((a, b) => a.dist - b.dist)
  return map
}

// ── Route assembly ────────────────────────────────────────────────────────────
function assembleRoute(steps) {
  const totalDist     = steps.reduce((s, st) => s + st.distance_m, 0)
  const totalDuration = steps.reduce((s, st) => s + st.duration_sec, 0)
  const totalCost     = steps.reduce((s, st) => s + st.cost_inr, 0)
  const walkDist      = steps.filter(st => st.mode === 'walk').reduce((s, st) => s + st.distance_m, 0)
  const transitSteps  = steps.filter(st => st.mode !== 'walk' && st.mode !== 'auto')
  const primaryMode   = transitSteps[0]?.mode || 'bus'
  const transfers     = Math.max(0, transitSteps.length - 1)

  return {
    steps,
    primary_mode:       primaryMode,
    total_duration_sec: totalDuration,
    total_cost_inr:     totalCost,
    total_distance_m:   totalDist,
    walking_distance_m: walkDist,
    transfers,
    modes_used:         [...new Set(steps.map(st => st.mode))],
    tags:               [],
    commuter_score:     0,
    corridor_label:     'regularService',
    _corridor_stops:    transitSteps.reduce((s, st) => s + (st.stop_sequence?.length || 0), 0),
  }
}

// ── Commuter score ─────────────────────────────────────────────────────────────
function scoreRoute(route, journeyDistM = 0) {
  let score = 55

  const transitSteps = route.steps.filter(st => st.mode !== 'walk' && st.mode !== 'auto')
  const hasAuto      = route.steps.some(st => st.mode === 'auto')

  // Transfers — important but calibrated so a fast 1-transfer beats a 90-min direct.
  if      (route.transfers === 0) score += 15
  else if (route.transfers === 1) score -= 8
  else if (route.transfers === 2) score -= 35
  else                             score -= 70

  // Mode reliability premium (metro/MMTS run on dedicated tracks, no traffic)
  if      (route.primary_mode === 'metro') score += 15
  else if (route.primary_mode === 'mmts')  score += 8

  // Service frequency (lower = better for waiting time comfort).
  // Deliberately not too steep — a trunk corridor route every 15 min should
  // still beat an obscure route every 5 min on the same journey.
  const bestFreq = transitSteps.reduce(
    (best, st) => (st.freq_mins > 0 && st.freq_mins < best ? st.freq_mins : best), 999,
  )
  if      (bestFreq <= 5)  score += 8
  else if (bestFreq <= 10) score += 6
  else if (bestFreq <= 20) score += 4
  else if (bestFreq <= 30) score += 2

  // Walking distance — finer granularity so stop-proximity matters.
  // A stop 5m away (direct service) should outrank one 150m away even if
  // frequency is marginally better. Bonus at ≤50m rewards routes whose
  // stops are right at the boarding/alighting point.
  const walk = route.walking_distance_m
  if      (walk <= 50)   score += 4
  else if (walk <= 200)  score -= 0
  else if (walk <= 400)  score -= 2
  else if (walk <= 700)  score -= 4
  else if (walk <= 1000) score -= 7
  else if (walk <= 1500) score -= 10
  else if (walk <= 2000) score -= 15
  else                   score -= 22

  // Auto-rickshaw penalty: uncertain pricing, negotiation required, less comfortable
  if (hasAuto) score -= 8

  // Duration: bonus for short journeys, graduated penalty for long ones.
  // A fast 1-transfer should beat a very slow direct route.
  const mins = route.total_duration_sec / 60
  if      (mins <= 20) score += 15
  else if (mins <= 35) score += 8
  else if (mins <= 75) score += 0
  else if (mins <= 90) score -= 8
  else                  score -= 15

  // Trunk corridor bonus: commonly used Hyderabad commuter routes (219, 216,
  // 300, 8A, 222A, etc.) and their lettered variants (216K/L, 219S/502…)
  // are familiar, reliable services that commuters actively seek out.
  const isTrunk = route.steps
    .filter(st => st.mode !== 'walk' && st.mode !== 'auto')
    .some(st => isTrunkLineName(st.line_name))
  if (isTrunk) score += 6

  // Hub passage bonus: routes through major hubs are more practically useful.
  score += computeHubPassageBonus(route)

  // Long-journey multi-modal boost: >10 km strongly prefer metro/MMTS.
  // Buses on 10+ km journeys are usually much slower due to stops and traffic.
  if (journeyDistM > LONG_JOURNEY_M) {
    if      (route.primary_mode === 'metro') score += 10
    else if (route.primary_mode === 'mmts')  score += 6
  }

  return Math.max(0, Math.min(100, score))
}

function corridorLabel(route) {
  const freqs   = route.steps
    .filter(st => st.mode !== 'walk' && st.mode !== 'auto')
    .map(st => st.freq_mins)
    .filter(Boolean)
  const minFreq = freqs.length ? Math.min(...freqs) : 999

  if (route.primary_mode === 'metro' || minFreq <= 5) return 'majorCorridor'
  if (minFreq <= 10) return 'frequentService'
  if (minFreq <= 20) return 'regularService'
  return 'limitedService'
}

// Fingerprint by journey endpoints + transit route IDs — deduplicates exact
// replays while keeping distinct options that share one leg.
function fingerprint(route) {
  const transit = route.steps.filter(st => st.mode !== 'walk' && st.mode !== 'auto')
  return transit.map(st => st.route_id).join('→')
}

// ── Per-mode route finder ─────────────────────────────────────────────────────
const EMPTY_MODE = Object.freeze({ direct: [], fastest: [], cheapest: [], all: [] })

function findModeRoutes(mode, srcLat, srcLon, srcName, dstLat, dstLon, dstName, fares) {
  const nearbyR      = NEARBY_RADIUS[mode]
  const xferR        = TRANSFER_RADIUS[mode]
  const journeyDistM = haversine(srcLat, srcLon, dstLat, dstLon)
  const srcNearby    = getNearbyStops(srcLat, srcLon, nearbyR, mode)
  const dstNearby    = getNearbyStops(dstLat, dstLon, nearbyR, mode)

  if (!srcNearby.length || !dstNearby.length) return { ...EMPTY_MODE }

  const srcRouteMap = buildSrcRouteMap(srcNearby)
  const dstStopMap  = buildDstStopMap(dstNearby)

  // Phase 4 — Corridor Intelligence: explore trunk corridors first, then by
  // frequency ascending (more frequent routes generate better options sooner,
  // which matters because the transfer loop caps at 20 collected routes).
  const srcRouteEntries = [...srcRouteMap.entries()].sort(([aId], [bId]) => {
    const aTrunk = isTrunkRoute(aId) ? 0 : 1
    const bTrunk = isTrunkRoute(bId) ? 0 : 1
    if (aTrunk !== bTrunk) return aTrunk - bTrunk
    const aFreq = getRoute(aId)?.frequency_mins || 999
    const bFreq = getRoute(bId)?.frequency_mins || 999
    return aFreq - bFreq
  })

  const collected = []
  const seenFPs   = new Set()

  function collect(steps) {
    if (!steps.length) return
    const ro = assembleRoute(steps)
    const fp = fingerprint(ro)
    if (!seenFPs.has(fp)) { seenFPs.add(fp); collected.push(ro) }
  }

  // ── Direct routes ─────────────────────────────────────────────────────────
  // For each boardable route from origin, try destination stops nearest-first.
  // resolveDirection handles both forward and reverse travel on bidirectional routes.
  for (const [routeId, boardEntry] of srcRouteEntries) {
    const route = getRoute(routeId)
    if (!route) continue

    const dstEntries = dstStopMap.get(routeId)
    if (!dstEntries) continue

    for (const alightEntry of dstEntries) {
      if (alightEntry.stopIdx === boardEntry.stopIdx) continue
      const dir = resolveDirection(route, boardEntry.stop.id, alightEntry.stop.id, mode)
      if (dir) {
        collect(buildLegSteps(
          srcLat, srcLon, srcName, dstLat, dstLon, dstName,
          dir.boardIdx, dir.alightIdx, dir.stops, route, fares,
        ))
        break   // nearest valid alight stop found — stop trying farther ones
      }
    }
  }

  // ── One-transfer routes ───────────────────────────────────────────────────
  // Always attempted: a poor direct route should not suppress a better
  // 1-transfer option. Scoring ranks them together afterward.
  outerLoop:
  for (const [routeId1, boardEntry1] of srcRouteEntries) {
    const route1 = getRoute(routeId1)
    if (!route1) continue

    // Choose the direction on route1 with the most downstream stops.
    // Critical for terminus stops (e.g., Raidurg on Blue Line): forward gives
    // 0 downstream stops, but reverse gives 22 — without this fix, no transfers
    // are ever found from a bidirectional terminus.
    let r1Stops    = route1.stops
    let r1BoardIdx = boardEntry1.stopIdx

    if (BIDIRECTIONAL.has(mode)) {
      const fwdCount = route1.stops.length - boardEntry1.stopIdx - 1
      const rev = [...route1.stops].reverse()
      const revBoardIdx = rev.findIndex(s => s.id === boardEntry1.stop.id)
      const revCount = revBoardIdx !== -1 ? rev.length - revBoardIdx - 1 : 0
      if (revCount > fwdCount) {
        r1Stops    = rev
        r1BoardIdx = revBoardIdx
      }
    }

    const downstream = r1Stops.slice(r1BoardIdx + 1)

    for (let di = 0; di < downstream.length; di++) {
      const xferStop = downstream[di]
      const xferIdx  = r1BoardIdx + 1 + di

      // Phase 6 — Hub-First Transfer Generation: collect candidate transfer
      // stops and sort them hub-score-descending so we try major interchange
      // points (MGBS, Ameerpet, Kachiguda, …) before roadside stops.
      const nearbyXfer = getNearbyStops(xferStop.lat, xferStop.lon, xferR, mode)
        .map(x => x.stop)
        .filter(s => s.id !== xferStop.id)
      const candidates = [xferStop, ...nearbyXfer]
        .sort((a, b) => getNearestHubScore(b.lat, b.lon, 500) - getNearestHubScore(a.lat, a.lon, 500))

      for (const xStop of candidates) {
        for (const routeId2 of getRoutesForStop(xStop.id)) {
          if (routeId2 === routeId1) continue
          const route2 = getRoute(routeId2)
          if (!route2 || route2.mode !== mode) continue

          const dstEntries2 = dstStopMap.get(routeId2)
          if (!dstEntries2) continue

          // Try destination stops nearest-first for the second leg
          for (const alightEntry2 of dstEntries2) {
            const dir2 = resolveDirection(route2, xStop.id, alightEntry2.stop.id, mode)
            if (dir2) {
              const stepsL1 = buildLegSteps(
                srcLat, srcLon, srcName,
                xferStop.lat, xferStop.lon, xferStop.name,
                r1BoardIdx, xferIdx, r1Stops, route1, fares,
              )
              const xd = haversine(xferStop.lat, xferStop.lon, xStop.lat, xStop.lon)
              const xferSteps = xd >= 20
                ? [makeWalkStep(xferStop.lat, xferStop.lon, xferStop.name, xStop.lat, xStop.lon, xStop.name)]
                : []
              const stepsL2 = buildLegSteps(
                xStop.lat, xStop.lon, xStop.name,
                dstLat, dstLon, dstName,
                dir2.boardIdx, dir2.alightIdx, dir2.stops, route2, fares,
              )
              collect([...stepsL1, ...xferSteps, ...stepsL2])
              if (collected.length >= 20) break outerLoop
              break   // nearest valid alight for route2 found
            }
          }
        }
      }
      if (collected.length >= 20) break
    }
  }

  if (!collected.length) return { ...EMPTY_MODE }

  // ── Score and sort ────────────────────────────────────────────────────────
  for (const ro of collected) {
    ro.commuter_score = scoreRoute(ro, journeyDistM)
    ro.corridor_label = corridorLabel(ro)
  }

  collected.sort((a, b) =>
    b.commuter_score - a.commuter_score ||
    a.total_duration_sec - b.total_duration_sec ||
    b._corridor_stops - a._corridor_stops
  )

  if (mode === 'bus') {
    console.log('[TM-DEBUG router.js] collected[] AFTER score+sort:')
    collected.forEach((r, i) => {
      const name = r.steps?.find(s => s.mode !== 'walk' && s.mode !== 'auto')?.line_name ?? '?'
      const freq = r.steps?.find(s => s.mode !== 'walk' && s.mode !== 'auto')?.freq_mins ?? '?'
      console.log(`  collected[${i}] "${name}" score=${r.commuter_score} freq=${freq} dur=${Math.round(r.total_duration_sec/60)}min xfers=${r.transfers}`)
    })
  }

  // Tag fastest / cheapest
  if (collected.length) {
    const fi = collected.reduce((mi, r, i) => r.total_duration_sec < collected[mi].total_duration_sec ? i : mi, 0)
    const ci = collected.reduce((mi, r, i) => r.total_cost_inr    < collected[mi].total_cost_inr    ? i : mi, 0)
    collected[fi].tags.push('fastest')
    collected[ci].tags.push('cheapest')
  }

  const all = collected.slice(0, MAX_ALL[mode])

  if (mode === 'bus') {
    console.log(`[TM-DEBUG router.js] .all[] after slice(${MAX_ALL[mode]}):`)
    all.forEach((r, i) => {
      const name = r.steps?.find(s => s.mode !== 'walk' && s.mode !== 'auto')?.line_name ?? '?'
      console.log(`  all[${i}] "${name}" score=${r.commuter_score}`)
    })
  }

  return {
    direct:   all.filter(r => r.transfers === 0),
    fastest:  [...all].sort((a, b) => a.total_duration_sec - b.total_duration_sec).slice(0, 1),
    cheapest: [...all].sort((a, b) => a.total_cost_inr    - b.total_cost_inr).slice(0, 1),
    all,
  }
}

// ── Main export ───────────────────────────────────────────────────────────────
export function findRoutes(srcLat, srcLon, srcName, dstLat, dstLon, dstName) {
  const fares = getFares()
  return {
    rtc:   findModeRoutes('bus',   srcLat, srcLon, srcName, dstLat, dstLon, dstName, fares),
    mmts:  findModeRoutes('mmts',  srcLat, srcLon, srcName, dstLat, dstLon, dstName, fares),
    metro: findModeRoutes('metro', srcLat, srcLon, srcName, dstLat, dstLon, dstName, fares),
  }
}
