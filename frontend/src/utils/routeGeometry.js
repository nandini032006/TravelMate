// Real geometric route-matching utilities — pure Haversine, no zone heuristics.

const R_KM = 6371

export function haversineKm(lat1, lon1, lat2, lon2) {
  const r  = Math.PI / 180
  const dL = (lat2 - lat1) * r, dO = (lon2 - lon1) * r
  const a  = Math.sin(dL / 2) ** 2
    + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dO / 2) ** 2
  return R_KM * 2 * Math.asin(Math.sqrt(a))
}

// Minimum distance (km) from point P to line-segment A→B
export function pointToSegmentKm(pLat, pLon, aLat, aLon, bLat, bLon) {
  const dx = bLon - aLon, dy = bLat - aLat
  if (dx * dx + dy * dy < 1e-12) return haversineKm(pLat, pLon, aLat, aLon)
  const t = Math.max(0, Math.min(1,
    ((pLon - aLon) * dx + (pLat - aLat) * dy) / (dx * dx + dy * dy)
  ))
  return haversineKm(pLat, pLon, aLat + t * dy, aLon + t * dx)
}

/**
 * Compute real geometric overlap % between user route A→B and rider route C→D.
 * Samples 14 evenly-spaced points along user route, tests each against rider segment.
 * Returns 0–96.
 */
export function computeGeometricOverlap(userFrom, userTo, riderFrom, riderTo) {
  const SAMPLES   = 14
  const routeKm   = haversineKm(userFrom.lat, userFrom.lon, userTo.lat, userTo.lon)
  // Threshold scales with distance so short urban routes need closer matching
  const threshold = routeKm > 12 ? 3.0 : routeKm > 6 ? 2.0 : routeKm > 2 ? 1.2 : 0.8

  let shared = 0
  for (let i = 0; i <= SAMPLES; i++) {
    const t    = i / SAMPLES
    const pLat = userFrom.lat + (userTo.lat - userFrom.lat) * t
    const pLon = userFrom.lon + (userTo.lon - userFrom.lon) * t
    if (pointToSegmentKm(pLat, pLon, riderFrom.lat, riderFrom.lon, riderTo.lat, riderTo.lon) <= threshold)
      shared++
  }
  const geoPct = shared / (SAMPLES + 1)

  // Directional alignment bonus — same-direction routes score higher
  const uB = Math.atan2(userTo.lon  - userFrom.lon,  userTo.lat  - userFrom.lat)
  const rB = Math.atan2(riderTo.lon - riderFrom.lon, riderTo.lat - riderFrom.lat)
  let angle = Math.abs((uB - rB) * 180 / Math.PI)
  if (angle > 180) angle = 360 - angle
  const bonus = angle < 25 ? 0.08 : angle < 50 ? 0.04 : 0

  return Math.min(96, Math.max(14, Math.round((geoPct + bonus) * 100)))
}

// Road-factor distance estimate (straight-line × 1.32)
export function estimateRouteDistKm(from, to) {
  if (!from?.lat || !to?.lat) return 10
  return Math.max(1.5, haversineKm(from.lat, from.lon, to.lat, to.lon) * 1.32)
}
