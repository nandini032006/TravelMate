/**
 * OpenStreetMap Overpass API — fetches road infrastructure density for a route bbox.
 * No API key needed. Cached 6h (infrastructure is stable).
 */

const OVERPASS = 'https://overpass-api.de/api/interpreter'
const _cache = new Map()
const TTL = 6 * 60 * 60 * 1000  // 6 hours

// Compute axis-aligned bounding box from route steps + polylines, padded 500m
function _routeBbox(route) {
  const lats = [], lons = []
  for (const step of (route.steps || [])) {
    if (step.from_coord?.lat) { lats.push(step.from_coord.lat); lons.push(step.from_coord.lon) }
    if (step.to_coord?.lat)   { lats.push(step.to_coord.lat);   lons.push(step.to_coord.lon) }
    for (const p of (step.polyline || [])) {
      if (p?.lat) { lats.push(p.lat); lons.push(p.lon) }
    }
  }
  if (!lats.length) return null
  const pad = 0.008
  return {
    south: Math.min(...lats) - pad, north: Math.max(...lats) + pad,
    west:  Math.min(...lons) - pad, east:  Math.max(...lons) + pad,
  }
}

// Estimate route length in km from step distances or coordinate span
function _routeLengthKm(route) {
  let km = 0
  for (const step of (route.steps || [])) {
    if (step.distance_m > 0) km += step.distance_m / 1000
  }
  if (km > 0) return km
  if (route.total_distance_m > 0) return route.total_distance_m / 1000
  return 15  // fallback
}

// POST a count-only Overpass query; returns integer
async function _count(queryBody, signal) {
  try {
    const res = await fetch(OVERPASS, {
      method: 'POST',
      body: 'data=' + encodeURIComponent(queryBody),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      signal,
    })
    if (!res.ok) return 0
    const json = await res.json()
    const tags = json.elements?.[0]?.tags ?? {}
    return parseInt(tags.total ?? tags.nodes ?? tags.ways ?? '0', 10) || 0
  } catch {
    return 0
  }
}

export async function fetchRouteInfrastructure(route) {
  const bbox = _routeBbox(route)
  if (!bbox) return null

  const { south, west, north, east } = bbox
  const key = `${south.toFixed(3)}|${west.toFixed(3)}|${north.toFixed(3)}|${east.toFixed(3)}`

  const hit = _cache.get(key)
  if (hit && Date.now() - hit.ts < TTL) return hit.data

  const bb      = `${south},${west},${north},${east}`
  const routeKm = _routeLengthKm(route)

  const ctrl    = new AbortController()
  const timeout = setTimeout(() => ctrl.abort(), 9000)

  try {
    const [signalCount, transitCount, hwCount, amenityCount, urbanRoadCount] = await Promise.all([
      _count(
        `[out:json][timeout:8];node["highway"="traffic_signals"](${bb});out count;`,
        ctrl.signal,
      ),
      _count(
        `[out:json][timeout:8];(node["public_transport"="stop_position"](${bb});node["railway"~"station|halt"](${bb});node["amenity"="bus_station"](${bb}););out count;`,
        ctrl.signal,
      ),
      _count(
        `[out:json][timeout:8];way["highway"~"^(motorway|trunk|primary)$"](${bb});out count;`,
        ctrl.signal,
      ),
      _count(
        `[out:json][timeout:8];node["amenity"](${bb});out count;`,
        ctrl.signal,
      ),
      _count(
        `[out:json][timeout:8];way["highway"~"^(secondary|tertiary|residential)$"](${bb});out count;`,
        ctrl.signal,
      ),
    ])

    clearTimeout(timeout)

    const signalDensity  = routeKm > 0 ? signalCount  / routeKm : 0
    const transitDensity = routeKm > 0 ? transitCount / routeKm : 0
    const amenityDensity   = routeKm > 0 ? amenityCount   / routeKm : 0
    const urbanRoadDensity = routeKm > 0 ? urbanRoadCount / routeKm : 0

    const data = {
      signalCount, transitCount, hwCount,
      amenityCount, urbanRoadCount,
      routeKm,
      signalDensity,   // signals per km
      transitDensity,  // transit stops per km
      amenityDensity,
      urbanRoadDensity,
      isHighwayHeavy:   hwCount > 4,
      isCommercialZone: amenityDensity > 15,
    }

    _cache.set(key, { data, ts: Date.now() })
    return data
  } catch {
    clearTimeout(timeout)
    return null
  }
}
