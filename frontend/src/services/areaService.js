import { getAllStops } from './transitData'
import { HYDERABAD_AREAS, AREA_TYPE } from '../data/hyderabadAreas'

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000
  const toRad = (d) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

let _areaClusters = null

export function buildAreaClusters() {
  if (_areaClusters) return _areaClusters
  const allStops = getAllStops()
  _areaClusters = {}

  for (const area of HYDERABAD_AREAS) {
    const nearby = allStops
      .map(stop => ({ ...stop, dist: haversine(area.lat, area.lon, stop.lat, stop.lon) }))
      .filter(s => s.dist <= 1500)
      .sort((a, b) => a.dist - b.dist)

    const stopCounts = { bus: 0, metro: 0, mmts: 0 }
    for (const s of nearby) stopCounts[s.mode]++

    const nearestMetro = nearby.find(s => s.mode === 'metro')
    const nearestMmts = nearby.find(s => s.mode === 'mmts')
    const nearestBus = nearby.find(s => s.mode === 'bus')

    _areaClusters[area.id] = {
      ...area,
      nearbyStops: nearby,
      stopCounts,
      nearestStops: {
        metro: nearestMetro ? { id: nearestMetro.id, name: nearestMetro.name, dist: Math.round(nearestMetro.dist) } : null,
        mmts: nearestMmts ? { id: nearestMmts.id, name: nearestMmts.name, dist: Math.round(nearestMmts.dist) } : null,
        bus: nearestBus ? { id: nearestBus.id, name: nearestBus.name, dist: Math.round(nearestBus.dist) } : null,
      },
      transitScore: (stopCounts.metro * 3 + stopCounts.mmts * 2 + stopCounts.bus) / 3,
    }
  }

  return _areaClusters
}

export function getAreaClusters() {
  if (!_areaClusters) buildAreaClusters()
  return _areaClusters
}

const CHIP_ICONS = {
  [AREA_TYPE.IT_HUB]: '🏢',
  [AREA_TYPE.TRANSIT_HUB]: '🚇',
  [AREA_TYPE.RESIDENTIAL]: '🏠',
  [AREA_TYPE.COMMERCIAL]: '🏪',
  [AREA_TYPE.OLD_CITY]: '🕌',
  [AREA_TYPE.INDUSTRIAL]: '🏭',
  [AREA_TYPE.GROWTH_ZONE]: '🌱',
  [AREA_TYPE.AIRPORT_CORRIDOR]: '✈',
}

export function getQuickChips(limit = 8) {
  const clusters = getAreaClusters()
  return Object.values(clusters)
    .sort((a, b) => b.transitScore - a.transitScore || b.population - a.population)
    .slice(0, limit)
    .map(c => ({
      icon: CHIP_ICONS[c.areaType] || '📍',
      label: c.name.split('/')[0].trim(),
      lat: c.lat,
      lon: c.lon,
      name: `${c.name}, Hyderabad`,
      areaId: c.id,
      areaType: c.areaType,
      transitScore: Math.round(c.transitScore),
    }))
}

export function searchAreas(query) {
  if (!query || query.trim().length < 2) return []
  const q = query.trim().toLowerCase()
  const clusters = getAreaClusters()

  const results = []
  for (const area of Object.values(clusters)) {
    const nameLower = area.name.toLowerCase()
    if (nameLower.includes(q)) {
      results.push({
        label: area.name,
        lat: area.lat,
        lon: area.lon,
        type: 'area',
        modes: Object.entries(area.stopCounts)
          .filter(([, count]) => count > 0)
          .map(([mode]) => mode),
        areaId: area.id,
        areaType: area.areaType,
        stopCount: Object.values(area.stopCounts).reduce((a, b) => a + b, 0),
      })
    }
  }

  return results
}

export function getHubs(limit = 10) {
  const clusters = getAreaClusters()
  return Object.values(clusters)
    .sort((a, b) => b.transitScore - a.transitScore)
    .slice(0, limit)
}

export function getNearbyHub(lat, lon) {
  const clusters = getAreaClusters()
  let closest = null
  let minDist = Infinity
  for (const area of Object.values(clusters)) {
    const d = haversine(lat, lon, area.lat, area.lon)
    if (d < minDist) {
      minDist = d
      closest = { ...area, distance: Math.round(d) }
    }
  }
  return closest
}
