// pts: [[lat, lon], ...] in Leaflet order
// Returns [[lat, lon], ...] road-following geometry, or null on failure/timeout
export async function fetchOsrmRoute(pts, timeoutMs = 6000) {
  if (!pts || pts.length < 2) return null
  try {
    const wp   = pts.map(([lat, lon]) => `${lon},${lat}`).join(';')
    const ctrl = new AbortController()
    const tid  = setTimeout(() => ctrl.abort(), timeoutMs)
    const res  = await fetch(
      `https://router.project-osrm.org/route/v1/driving/${wp}?overview=full&geometries=geojson`,
      { signal: ctrl.signal }
    )
    clearTimeout(tid)
    const data = await res.json()
    const c = data.routes?.[0]?.geometry?.coordinates
    return c?.length ? c.map(([lon, lat]) => [lat, lon]) : null
  } catch {
    return null
  }
}

// Sample pts evenly down to at most maxN points while keeping first and last
export function sampleWaypoints(pts, maxN = 8) {
  if (!pts || pts.length <= maxN) return pts
  const out  = [pts[0]]
  const step = (pts.length - 1) / (maxN - 1)
  for (let i = 1; i < maxN - 1; i++) out.push(pts[Math.round(i * step)])
  out.push(pts[pts.length - 1])
  return out
}
