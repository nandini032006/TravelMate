/**
 * transitData.js
 * ==============
 * Single source-of-truth for all local transit data imported from static JSON.
 * Call init() once at app startup (App.jsx).  All other exports are synchronous
 * after init() resolves.
 *
 * Data files are loaded via dynamic import so Vite code-splits them into
 * separate chunks, keeping the initial JS bundle smaller.
 */

// ── Internal state ────────────────────────────────────────────────────────────
let _initialised      = false
let _stops            = []              // [{id, raw_id, name, lat, lon, mode}]
let _stopById         = new Map()       // id → stop
let _routes           = {}              // id → route object
let _stopToRoutes     = {}              // stopId → [routeId]
// directRouteIndex[boardStopId][alightStopId] = [routeId, ...] where board < alight
// Used for fast O(1) direct-route lookup: "does any route go directly from A to B?"
let _directRouteIndex = {}
let _fares            = {}

// ── Metro line name prettifier ────────────────────────────────────────────────
function _prettyMetroLine(line_name) {
  if (/red/i.test(line_name))   return 'Metro Red Line'
  if (/green/i.test(line_name)) return 'Metro Green Line'
  if (/blue/i.test(line_name))  return 'Metro Blue Line'
  return line_name
}

// ── Initialise ────────────────────────────────────────────────────────────────
export function init() {
  if (_initialised) return Promise.resolve()

  return Promise.all([
    import('../data/metro.json'),
    import('../data/mmts.json'),
    import('../data/bus.json'),
    import('../data/fares.json'),
  ]).then(([metroMod, mmtsMod, busMod, faresMod]) => {
    const metroRaw = metroMod.default
    const mmtsRaw  = mmtsMod.default
    const busRaw   = busMod.default
    _fares = faresMod.default

    const datasets = [
      { raw: metroRaw, mode: 'metro' },
      { raw: mmtsRaw,  mode: 'mmts'  },
      { raw: busRaw,   mode: 'bus'   },
    ]

    for (const { raw, mode } of datasets) {
      const rawStops  = raw.stops  || {}
      const rawRoutes = raw.routes || {}

      // ── Build stops ──────────────────────────────────────────────────────
      for (const [rawId, info] of Object.entries(rawStops)) {
        const id = `${mode}:${rawId}`
        const stop = {
          id,
          raw_id: rawId,
          name:   info.name,
          lat:    info.lat,
          lon:    info.lon,
          mode,
        }
        _stops.push(stop)
        _stopById.set(id, stop)
        // Also allow lookup by raw id for stop_times cross-referencing
        if (!_stopById.has(rawId)) _stopById.set(rawId, stop)
      }

      // ── Build routes ─────────────────────────────────────────────────────
      for (const [rawId, info] of Object.entries(rawRoutes)) {
        const id = `${mode}:${rawId}`

        // Resolve stop references to full stop objects
        const stopObjs = (info.stops || [])
          .map(sid => {
            const fullId = `${mode}:${sid}`
            return _stopById.get(fullId) || _stopById.get(sid) || null
          })
          .filter(Boolean)

        const line_name = mode === 'metro'
          ? _prettyMetroLine(info.line_name)
          : info.line_name

        _routes[id] = {
          id,
          raw_id:         rawId,
          line_name,
          color:          info.color,
          frequency_mins: info.frequency_mins,
          is_premium:     info.is_premium,
          mode,
          stops:          stopObjs,
          shape:          info.shape || null,   // [[lat,lon],...] for metro shape polylines
        }
      }
    }

    // ── Build inverted index: stopId → [routeId] ────────────────────────────
    for (const [routeId, route] of Object.entries(_routes)) {
      for (const stop of route.stops) {
        if (!_stopToRoutes[stop.id]) _stopToRoutes[stop.id] = []
        _stopToRoutes[stop.id].push(routeId)
      }
    }

    // ── Build direct-route index: boardStopId → alightStopId → [routeId] ───
    // Enables O(1) answer to "does any single route connect stop A to stop B?"
    for (const [routeId, route] of Object.entries(_routes)) {
      const stopIds = route.stops.map(s => s.id)
      for (let i = 0; i < stopIds.length; i++) {
        const board = stopIds[i]
        if (!_directRouteIndex[board]) _directRouteIndex[board] = {}
        for (let j = i + 1; j < stopIds.length; j++) {
          const alight = stopIds[j]
          if (!_directRouteIndex[board][alight]) _directRouteIndex[board][alight] = []
          _directRouteIndex[board][alight].push(routeId)
        }
      }
    }

    _initialised = true
  })
}

// ── Public API ────────────────────────────────────────────────────────────────

/** All stops as a flat array */
export function getAllStops() {
  return _stops
}

/** Look up a single stop by its namespaced id (e.g. "metro:MYP") */
export function getStop(id) {
  return _stopById.get(id) || null
}

/** Look up a single route by its namespaced id (e.g. "bus:219") */
export function getRoute(id) {
  return _routes[id] || null
}

/** All routes as an object keyed by namespaced id */
export function getAllRoutes() {
  return _routes
}

/**
 * Returns route ids where a passenger can board at boardStopId and ride
 * directly (no transfer) to alightStopId.  Both ids must be namespaced
 * (e.g. "bus:O2WcwZw9").  Returns [] if no direct route exists.
 */
export function getDirectRoutes(boardStopId, alightStopId) {
  return _directRouteIndex[boardStopId]?.[alightStopId] || []
}

/** All route ids that serve a given stop */
export function getRoutesForStop(stopId) {
  return _stopToRoutes[stopId] || []
}

/** Fare tables for all three modes */
export function getFares() {
  return _fares
}

/**
 * Search stops by name.
 *
 * Groups all stops with the same name into a single result, merging their
 * transport modes (metro/mmts/bus).  Uses the highest-priority mode's
 * coordinates as the canonical location (metro > mmts > bus).
 *
 * Returns [{label, lat, lon, type, modes, id, ids}]
 */
// Lightweight Levenshtein distance (word-level typo tolerance)
function _lev(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 99
  const m = a.length, n = b.length
  const row = Array.from({ length: n + 1 }, (_, i) => i)
  for (let i = 1; i <= m; i++) {
    let prev = i
    for (let j = 1; j <= n; j++) {
      const val = a[i-1] === b[j-1] ? row[j-1] : 1 + Math.min(row[j], prev, row[j-1])
      row[j-1] = prev
      prev = val
    }
    row[n] = prev
  }
  return row[n]
}

// Returns true if any word in nameLower is within edit-distance 1 of q
function _fuzzyMatch(nameLower, q) {
  if (q.length < 4) return false
  return nameLower.split(/\s+/).some(word => word.length >= 4 && _lev(q, word) <= 1)
}

export function searchStops(query, limit = 8) {
  if (!query || query.trim().length < 1) return []
  const q = query.trim().toLowerCase()
  const modeOrder = { metro: 0, mmts: 1, bus: 2 }

  // Group stops by normalised name — one entry per unique place name
  const groups = new Map()

  for (const stop of _stops) {
    const nameLower = stop.name.toLowerCase()
    const isPrefix  = nameLower.startsWith(q)
    const isSub     = !isPrefix && nameLower.includes(q)
    const isFuzzy   = !isPrefix && !isSub && _fuzzyMatch(nameLower, q)
    if (!isPrefix && !isSub && !isFuzzy) continue

    const key = nameLower.trim()
    if (!groups.has(key)) {
      groups.set(key, {
        stop,
        modes:     [stop.mode],
        ids:       [stop.id],
        isPrefix,
        isSub,
        bestOrder: modeOrder[stop.mode],
      })
    } else {
      const g = groups.get(key)
      if (!g.modes.includes(stop.mode)) {
        g.modes.push(stop.mode)
        g.ids.push(stop.id)
        if (modeOrder[stop.mode] < g.bestOrder) {
          g.stop      = stop
          g.bestOrder = modeOrder[stop.mode]
        }
      }
      if (isPrefix) g.isPrefix = true
      if (isSub)    g.isSub    = true
    }
  }

  // Sort: prefix > substring > fuzzy, then mode priority, then alphabetical
  const sorted = [...groups.values()].sort((a, b) => {
    const rankA = a.isPrefix ? 0 : a.isSub ? 1 : 2
    const rankB = b.isPrefix ? 0 : b.isSub ? 1 : 2
    if (rankA !== rankB) return rankA - rankB
    return (a.bestOrder - b.bestOrder) || a.stop.name.localeCompare(b.stop.name)
  })

  return sorted.slice(0, limit).map(({ stop, modes, ids }) => ({
    label: stop.name,
    lat:   stop.lat,
    lon:   stop.lon,
    type:  'transit',
    modes,
    id:    ids[0],
    ids,
  }))
}

/**
 * Returns shape polylines for metro lines, suitable for drawing on a map.
 * [{color, line_name, points: [{lat, lon}]}]
 *
 * The points are derived from the ordered stop list of each metro route
 * (direction 0 only, avoiding duplicates).
 */
export function getMetroShapes() {
  const shapes = []
  for (const route of Object.values(_routes)) {
    if (route.mode !== 'metro') continue
    const points = route.stops.map(s => ({ lat: s.lat, lon: s.lon }))
    if (points.length < 2) continue
    shapes.push({
      color:     route.color,
      line_name: route.line_name,
      points,
    })
  }
  return shapes
}

/**
 * Returns corridor polylines for MMTS, suitable for drawing on a map.
 * [{color, line_name, points: [{lat, lon}]}]
 *
 * Points are derived from the ordered stop list of each MMTS corridor.
 */
export function getMmtsShapes() {
  const shapes = []
  for (const route of Object.values(_routes)) {
    if (route.mode !== 'mmts') continue
    const points = route.stops.map(s => ({ lat: s.lat, lon: s.lon }))
    if (points.length < 2) continue
    shapes.push({
      color:     route.color,
      line_name: route.line_name,
      points,
    })
  }
  return shapes
}
