import { getAllStops } from '../services/transitData'

const MODE_ORDER = { metro: 0, mmts: 1, bus: 2 }
const MODE_SPEED = { metro: 50, mmts: 40, bus: 20 }

const STRATEGIES = [
  {
    id: 'least_waiting',
    name: 'Least Waiting',
    icon: '🚀',
    shortDesc: 'Minimize time spent waiting',
    weights: { freq: 0.40, duration: 0.20, cost: 0.15, walk: 0.10, transfers: 0.10, mode: 0.05 },
  },
  {
    id: 'fastest_arrival',
    name: 'Fastest Arrival',
    icon: '⚡',
    shortDesc: 'Shortest total travel time',
    weights: { duration: 0.50, freq: 0.15, cost: 0.20, walk: 0.05, transfers: 0.10, mode: 0.00 },
  },
  {
    id: 'metro_preferred',
    name: 'Metro Preferred',
    icon: '🚇',
    shortDesc: 'Prioritize metro where available',
    weights: { industry_focus: 'metro', mode_bonus: 25, duration: 0.25, cost: 0.20, freq: 0.20, walk: 0.10, transfers: 0.25 },
  },
  {
    id: 'mmts_preferred',
    name: 'MMTS Preferred',
    icon: '🚆',
    shortDesc: 'Prioritize MMTS trains',
    weights: { industry_focus: 'mmts', mode_bonus: 25, duration: 0.25, cost: 0.20, freq: 0.20, walk: 0.10, transfers: 0.25 },
  },
  {
    id: 'bus_preferred',
    name: 'Bus Preferred',
    icon: '🚌',
    shortDesc: 'Most extensive network, often cheapest',
    weights: { industry_focus: 'bus', mode_bonus: 20, duration: 0.20, cost: 0.30, freq: 0.20, walk: 0.10, transfers: 0.20 },
  },
  {
    id: 'local_commuter',
    name: 'Local Commuter',
    icon: '🎯',
    shortDesc: 'What locals actually ride',
    weights: { industry_focus: 'local', duration: 0.25, cost: 0.20, freq: 0.25, walk: 0.10, transfers: 0.20, mode: 0.00 },
  },
]

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000
  const toRad = (d) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function getAllRoutesFlat(routeGroups) {
  const all = []
  for (const modeGroup of Object.values(routeGroups)) {
    if (modeGroup?.all) all.push(...modeGroup.all)
  }
  return all
}

function computeFrequencyScore(route) {
  const transitSteps = (route.steps || []).filter(s => s.mode !== 'walk' && s.mode !== 'auto')
  const freqs = transitSteps.map(s => s.freq_mins).filter(f => f > 0)
  if (!freqs.length) return 30
  const minFreq = Math.min(...freqs)
  if (minFreq <= 3) return 95
  if (minFreq <= 5) return 85
  if (minFreq <= 10) return 70
  if (minFreq <= 15) return 55
  if (minFreq <= 20) return 40
  if (minFreq <= 30) return 25
  return 10
}

function computeDurationScore(route) {
  const mins = route.total_duration_sec / 60
  if (mins <= 15) return 95
  if (mins <= 25) return 85
  if (mins <= 35) return 75
  if (mins <= 45) return 65
  if (mins <= 60) return 50
  if (mins <= 75) return 35
  if (mins <= 90) return 20
  return 10
}

function computeCostScore(route) {
  const cost = route.total_cost_inr
  if (cost <= 10) return 95
  if (cost <= 20) return 80
  if (cost <= 30) return 65
  if (cost <= 50) return 50
  if (cost <= 75) return 35
  if (cost <= 100) return 20
  return 10
}

function computeWalkScore(route) {
  const walk = route.walking_distance_m
  if (walk <= 200) return 95
  if (walk <= 400) return 85
  if (walk <= 700) return 70
  if (walk <= 1000) return 55
  if (walk <= 1500) return 35
  if (walk <= 2000) return 20
  return 5
}

function computeTransferScore(route) {
  const t = route.transfers || 0
  if (t === 0) return 95
  if (t === 1) return 60
  if (t === 2) return 25
  return 10
}

function computeModeBonus(route, focusMode) {
  if (!focusMode) return 0
  if (focusMode === 'local') {
    if (route.primary_mode === 'metro') return 10
    return 5
  }
  if (route.primary_mode === focusMode) return 25
  if (focusMode === 'bus') return 0
  return -5
}

function computeStrategyScore(route, weights) {
  const modeScore = weights.mode_bonus
    ? computeModeBonus(route, weights.industry_focus)
    : 0

  const weightsObj = weights.industry_focus
    ? { duration: weights.duration, cost: weights.cost, freq: weights.freq, walk: weights.walk, transfers: weights.transfers }
    : weights

  let score = 0
  if ('freq' in weightsObj) score += weightsObj.freq * computeFrequencyScore(route)
  if ('duration' in weightsObj) score += weightsObj.duration * computeDurationScore(route)
  if ('cost' in weightsObj) score += weightsObj.cost * computeCostScore(route)
  if ('walk' in weightsObj) score += weightsObj.walk * computeWalkScore(route)
  if ('transfers' in weightsObj) score += weightsObj.transfers * computeTransferScore(route)
  score += modeScore

  return Math.max(0, Math.min(100, Math.round(score)))
}

function findFallback(strategyId, allRoutes) {
  const modesAvailable = new Set(allRoutes.map(r => r.primary_mode))

  if (strategyId === 'metro_preferred' && !modesAvailable.has('metro')) {
    const metroStops = getAllStops().filter(s => s.mode === 'metro')
    return {
      type: 'mode_unavailable',
      message: 'No metro route available for this journey',
      alternative: 'Consider taking a bus to the nearest metro station, or switch to Bus strategy',
    }
  }
  if (strategyId === 'mmts_preferred' && !modesAvailable.has('mmts')) {
    return {
      type: 'mode_unavailable',
      message: 'No MMTS route available for this journey',
      alternative: 'MMTS may still be reachable by bus. Try the Local Commuter strategy.',
    }
  }
  if (strategyId === 'bus_preferred' && !modesAvailable.has('bus')) {
    return {
      type: 'mode_unavailable',
      message: 'No direct bus route found',
      alternative: 'Check metro or MMTS options for this journey.',
    }
  }
  return null
}

function tagStrategyWinners(routes) {
  if (!routes.length) return
  const fastestIdx  = routes.reduce((best, cur, i) =>
    routes[best].total_duration_sec  <= cur.total_duration_sec  ? best : i, 0)
  const cheapestIdx = routes.reduce((best, cur, i) =>
    routes[best].total_cost_inr      <= cur.total_cost_inr      ? best : i, 0)
  const minWalkIdx  = routes.reduce((best, cur, i) =>
    routes[best].walking_distance_m  <= cur.walking_distance_m  ? best : i, 0)

  if (!routes[fastestIdx].tags) routes[fastestIdx].tags = []
  if (!routes[fastestIdx].tags.includes('fastest')) routes[fastestIdx].tags.push('fastest')

  if (cheapestIdx !== fastestIdx) {
    if (!routes[cheapestIdx].tags) routes[cheapestIdx].tags = []
    if (!routes[cheapestIdx].tags.includes('cheapest')) routes[cheapestIdx].tags.push('cheapest')
  }

  if (minWalkIdx !== fastestIdx && minWalkIdx !== cheapestIdx) {
    if (!routes[minWalkIdx].tags) routes[minWalkIdx].tags = []
    if (!routes[minWalkIdx].tags.includes('least_walking')) routes[minWalkIdx].tags.push('least_walking')
  }
}

export function generateStrategies(routeGroups) {
  const allRoutes = getAllRoutesFlat(routeGroups)

  if (!allRoutes.length) {
    return STRATEGIES.map(s => ({
      ...s,
      routes: [],
      bestRoute: null,
      strategyScore: null,
      fallback: null,
    }))
  }

  return STRATEGIES.map(strategy => {
    const weights = strategy.weights || {}
    const fallback = findFallback(strategy.id, allRoutes)

    const scored = allRoutes
      .map(route => ({
        ...route,
        strategy_score: computeStrategyScore(route, weights),
      }))
      .sort((a, b) => b.strategy_score - a.strategy_score)

    tagStrategyWinners(scored)

    const displayRoutes = scored.slice(0, 3)
    const bestRoute = scored[0]
    const strategyScore = bestRoute?.strategy_score ?? null

    return {
      id: strategy.id,
      name: strategy.name,
      icon: strategy.icon,
      shortDesc: strategy.shortDesc,
      routes: displayRoutes,
      bestRoute,
      strategyScore,
      fallback,
    }
  })
}

export function getStrategyIcon(strategyId) {
  const s = STRATEGIES.find(st => st.id === strategyId)
  return s ? s.icon : '🎯'
}

export function getStrategyName(strategyId) {
  const s = STRATEGIES.find(st => st.id === strategyId)
  return s ? s.name : strategyId
}

export function getStrategyTip(strategyId, route) {
  if (!route) return ''
  switch (strategyId) {
    case 'least_waiting':
      return 'Best for avoiding long waits between connections'
    case 'fastest_arrival':
      return 'Optimized for getting there as fast as possible'
    case 'metro_preferred':
      return 'Metro runs on dedicated tracks — no traffic delays'
    case 'mmts_preferred':
      return 'MMTS avoids road traffic but check the timetable'
    case 'bus_preferred':
      return 'Buses cover every corner of Hyderabad'
    case 'local_commuter':
      return 'The route most Hyderabad commuters would take'
    default:
      return ''
  }
}
