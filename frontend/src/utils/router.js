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

// ── Mode-specific search radii (metres) ───────────────────────────────────────
const NEARBY_RADIUS = {
  bus:   1000,
  mmts:  1500,
  metro: 2000,
}

const TRANSFER_RADIUS = {
  bus:   200,
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
  return result.slice(0, 20)
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
function buildSrcRouteMap(nearbyStops) {
  const map = new Map()
  for (const { stop, dist } of nearbyStops) {
    for (const routeId of getRoutesForStop(stop.id)) {
      const route = getRoute(routeId)
      if (!route) continue
      const idx = route.stops.findIndex(s => s.id === stop.id)
      if (idx === -1) continue
      const ex = map.get(routeId)
      if (!ex || idx < ex.stopIdx) map.set(routeId, { stopIdx: idx, stop, dist })
    }
  }
  return map
}

function buildDstRouteMaps(nearbyStops) {
  const latest   = new Map()
  const earliest = new Map()
  for (const { stop, dist } of nearbyStops) {
    for (const routeId of getRoutesForStop(stop.id)) {
      const route = getRoute(routeId)
      if (!route) continue
      const idx = route.stops.findIndex(s => s.id === stop.id)
      if (idx === -1) continue
      const el = latest.get(routeId)
      if (!el || idx > el.stopIdx) latest.set(routeId, { stopIdx: idx, stop, dist })
      const ee = earliest.get(routeId)
      if (!ee || idx < ee.stopIdx) earliest.set(routeId, { stopIdx: idx, stop, dist })
    }
  }
  return { latest, earliest }
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
function scoreRoute(route) {
  let score = 55

  const transitSteps = route.steps.filter(st => st.mode !== 'walk' && st.mode !== 'auto')
  const hasAuto      = route.steps.some(st => st.mode === 'auto')

  // Transfers — the dominant factor for commuters
  if      (route.transfers === 0) score += 30
  else if (route.transfers === 1) score -= 20
  else if (route.transfers === 2) score -= 55
  else                             score -= 90

  // Mode reliability premium (metro/MMTS run on dedicated tracks, no traffic)
  if      (route.primary_mode === 'metro') score += 15
  else if (route.primary_mode === 'mmts')  score += 8

  // Service frequency (lower = better for waiting time comfort)
  const bestFreq = transitSteps.reduce(
    (best, st) => (st.freq_mins > 0 && st.freq_mins < best ? st.freq_mins : best), 999,
  )
  if      (bestFreq <= 5)  score += 12
  else if (bestFreq <= 10) score += 8
  else if (bestFreq <= 20) score += 5
  else if (bestFreq <= 30) score += 2

  // Walking distance penalty
  const walk = route.walking_distance_m
  if      (walk > 2000) score -= 22
  else if (walk > 1500) score -= 15
  else if (walk > 1000) score -= 10
  else if (walk > 700)  score -= 5
  else if (walk > 400)  score -= 2

  // Auto-rickshaw penalty: uncertain pricing, negotiation required, less comfortable
  if (hasAuto) score -= 8

  // Duration penalty for very long journeys (relative to direct alternatives)
  const mins = route.total_duration_sec / 60
  if      (mins > 90) score -= 8
  else if (mins > 60) score -= 3

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
  const nearbyR   = NEARBY_RADIUS[mode]
  const xferR     = TRANSFER_RADIUS[mode]
  const srcNearby = getNearbyStops(srcLat, srcLon, nearbyR, mode)
  const dstNearby = getNearbyStops(dstLat, dstLon, nearbyR, mode)

  if (!srcNearby.length || !dstNearby.length) return { ...EMPTY_MODE }

  const srcRouteMap          = buildSrcRouteMap(srcNearby)
  const { latest: dstFwd,
          earliest: dstRev } = buildDstRouteMaps(dstNearby)

  const collected = []
  const seenFPs   = new Set()

  function collect(steps) {
    const ro = assembleRoute(steps)
    const fp = fingerprint(ro)
    if (!seenFPs.has(fp)) { seenFPs.add(fp); collected.push(ro) }
  }

  // ── Direct routes ─────────────────────────────────────────────────────────
  for (const [routeId, boardEntry] of srcRouteMap) {
    const route = getRoute(routeId)
    if (!route) continue

    const alightFwd = dstFwd.get(routeId)
    if (alightFwd && boardEntry.stopIdx < alightFwd.stopIdx) {
      collect(buildLegSteps(
        srcLat, srcLon, srcName, dstLat, dstLon, dstName,
        boardEntry.stopIdx, alightFwd.stopIdx, route.stops, route, fares,
      ))
      continue
    }

    if (BIDIRECTIONAL.has(mode)) {
      const alightRev = dstRev.get(routeId)
      if (alightRev && boardEntry.stopIdx > alightRev.stopIdx) {
        const dir = resolveDirection(route, boardEntry.stop.id, alightRev.stop.id, mode)
        if (dir) {
          collect(buildLegSteps(
            srcLat, srcLon, srcName, dstLat, dstLon, dstName,
            dir.boardIdx, dir.alightIdx, dir.stops, route, fares,
          ))
        }
      }
    }
  }

  // ── One-transfer routes: only when no direct route was found ──────────────
  if (collected.length === 0) {
    outerLoop:
    for (const [routeId1, boardEntry1] of srcRouteMap) {
      const route1 = getRoute(routeId1)
      if (!route1) continue

      const downstream = route1.stops.slice(boardEntry1.stopIdx + 1)

      for (let di = 0; di < downstream.length; di++) {
        const xferStop = downstream[di]
        const xferIdx  = boardEntry1.stopIdx + 1 + di

        const candidates = [xferStop]
        for (const { stop: nb } of getNearbyStops(xferStop.lat, xferStop.lon, xferR, mode)) {
          if (nb.id !== xferStop.id) candidates.push(nb)
        }

        for (const xStop of candidates) {
          for (const routeId2 of getRoutesForStop(xStop.id)) {
            if (routeId2 === routeId1) continue
            const route2 = getRoute(routeId2)
            if (!route2 || route2.mode !== mode) continue

            const af2 = dstFwd.get(routeId2)
            if (af2) {
              const dir2 = resolveDirection(route2, xStop.id, af2.stop.id, mode)
              if (dir2) {
                const stepsL1 = buildLegSteps(
                  srcLat, srcLon, srcName,
                  xferStop.lat, xferStop.lon, xferStop.name,
                  boardEntry1.stopIdx, xferIdx, route1.stops, route1, fares,
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
              }
            }

            if (BIDIRECTIONAL.has(mode)) {
              const ar2 = dstRev.get(routeId2)
              if (ar2) {
                const dir2 = resolveDirection(route2, xStop.id, ar2.stop.id, mode)
                if (dir2) {
                  const stepsL1 = buildLegSteps(
                    srcLat, srcLon, srcName,
                    xferStop.lat, xferStop.lon, xferStop.name,
                    boardEntry1.stopIdx, xferIdx, route1.stops, route1, fares,
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
                }
              }
            }
          }
        }
        if (collected.length >= 20) break
      }
    }
  }

  if (!collected.length) return { ...EMPTY_MODE }

  // ── Score and sort ────────────────────────────────────────────────────────
  for (const ro of collected) {
    ro.commuter_score = scoreRoute(ro)
    ro.corridor_label = corridorLabel(ro)
  }

  collected.sort((a, b) =>
    b.commuter_score - a.commuter_score ||
    a.total_duration_sec - b.total_duration_sec ||
    b._corridor_stops - a._corridor_stops
  )

  // Tag fastest / cheapest
  if (collected.length) {
    const fi = collected.reduce((mi, r, i) => r.total_duration_sec < collected[mi].total_duration_sec ? i : mi, 0)
    const ci = collected.reduce((mi, r, i) => r.total_cost_inr    < collected[mi].total_cost_inr    ? i : mi, 0)
    collected[fi].tags.push('fastest')
    if (ci !== fi) collected[ci].tags.push('cheapest')
    else           collected[ci].tags.push('cheapest')
  }

  const all = collected.slice(0, MAX_ALL[mode])

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
