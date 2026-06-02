/**
 * TomTom Traffic Flow integration.
 * Gracefully returns null when API key is absent or request fails.
 * Set VITE_TOMTOM_KEY in .env to enable live traffic data.
 */

const KEY = import.meta.env.VITE_TOMTOM_KEY

const _cache = new Map()
const TTL    = 5 * 60 * 1000   // 5 minutes

async function _flowPoint(lat, lon, signal) {
  const url =
    `https://api.tomtom.com/traffic/services/4/flowSegmentData/absolute/10/json` +
    `?point=${lat},${lon}&key=${KEY}`
  try {
    const res = await fetch(url, { signal })
    if (!res.ok) return null
    const seg = (await res.json()).flowSegmentData
    if (!seg || !seg.freeFlowSpeed) return null
    return { currentSpeed: seg.currentSpeed, freeFlowSpeed: seg.freeFlowSpeed }
  } catch {
    return null
  }
}

function _congestionMeta(ratio, avgSpeed) {
  const congestion_pct = Math.round(Math.max(0, (1 - ratio)) * 100)
  if (ratio >= 0.85) return { level: 'free',       label: 'Free flow',  icon: '🟢', penalty: 0,  congestion_pct, avg_speed: avgSpeed, delay_mins: 0  }
  if (ratio >= 0.65) return { level: 'moderate',   label: 'Moderate',   icon: '🟡', penalty: 8,  congestion_pct, avg_speed: avgSpeed, delay_mins: 7  }
  if (ratio >= 0.40) return { level: 'heavy',      label: 'Heavy',      icon: '🟠', penalty: 16, congestion_pct, avg_speed: avgSpeed, delay_mins: 18 }
  return                    { level: 'standstill', label: 'Standstill', icon: '🔴', penalty: 22, congestion_pct, avg_speed: avgSpeed, delay_mins: 30 }
}

export async function analyzeTraffic(route) {
  if (!KEY || !route?.steps?.length) return null

  // Collect all available coordinates from route
  const allCoords = []
  for (const step of route.steps) {
    if (step.from_coord?.lat) allCoords.push(step.from_coord)
    if (step.polyline?.length) {
      for (let i = 0; i < step.polyline.length; i += 2) {
        if (step.polyline[i]?.lat) allCoords.push(step.polyline[i])
      }
    }
  }
  const last = route.steps[route.steps.length - 1]
  if (last?.to_coord?.lat) allCoords.push(last.to_coord)

  if (!allCoords.length) return null

  // Pick up to 5 evenly distributed points
  const N   = Math.min(5, allCoords.length)
  const pts = N === 1
    ? [allCoords[0]]
    : Array.from({ length: N }, (_, i) =>
        allCoords[Math.round(i * (allCoords.length - 1) / (N - 1))]
      ).filter(p => p?.lat)

  const first = pts[0], last2 = pts[pts.length - 1]
  const cacheKey = `${first?.lat?.toFixed(3)}|${last2?.lat?.toFixed(3)}|${N}`

  const hit = _cache.get(cacheKey)
  if (hit && Date.now() - hit.ts < TTL) return hit.data

  const ctrl    = new AbortController()
  const timeout = setTimeout(() => ctrl.abort(), 6000)

  try {
    const results = await Promise.allSettled(pts.map(p => _flowPoint(p.lat, p.lon, ctrl.signal)))
    clearTimeout(timeout)

    const valid = results
      .filter(r => r.status === 'fulfilled' && r.value)
      .map(r => r.value)
      .filter(f => f.freeFlowSpeed > 0)

    if (!valid.length) return null

    const ratios   = valid.map(f => f.currentSpeed / f.freeFlowSpeed)
    const avgRatio = ratios.reduce((s, r) => s + r, 0) / ratios.length
    const minRatio = Math.min(...ratios)
    const avgSpeed = Math.round(valid.reduce((s, f) => s + f.currentSpeed, 0) / valid.length)

    const data = { ..._congestionMeta(avgRatio, avgSpeed), avgRatio, minRatio }
    _cache.set(cacheKey, { data, ts: Date.now() })
    return data
  } catch {
    clearTimeout(timeout)
    return null
  }
}
