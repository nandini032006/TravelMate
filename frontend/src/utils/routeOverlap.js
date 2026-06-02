import { classifyZone } from '../data/mockRideDemand'

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371
  const toRad = d => d * Math.PI / 180
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1)
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon/2)**2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))
}

export function estimateDistanceKm(from, to) {
  if (!from?.lat || !to?.lat) return 10
  return Math.max(1.5, haversineKm(from.lat, from.lon, to.lat, to.lon) * 1.32)
}

export function computeOverlapPct(userFrom, userTo, riderFrom, riderTo) {
  const fzU = classifyZone(userFrom.lat, userFrom.lon)
  const tzU = classifyZone(userTo.lat, userTo.lon)
  const fzR = classifyZone(riderFrom.lat, riderFrom.lon)
  const tzR = classifyZone(riderTo.lat, riderTo.lon)

  if (fzU === fzR && tzU === tzR) return 82 + Math.round(Math.random() * 12)  // 82–94
  if (tzU === tzR)                 return 62 + Math.round(Math.random() * 18)  // 62–80
  if (fzU === fzR)                 return 52 + Math.round(Math.random() * 15)  // 52–67
  return                                    38 + Math.round(Math.random() * 18)  // 38–56
}

export function computeDetourMin(overlapPct, distKm) {
  const base = Math.max(0, ((100 - overlapPct) / 100) * distKm * 0.9)
  return Math.round(Math.min(14, base + 1.5))
}
