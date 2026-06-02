import RISK_AREAS from '../data/riskAreas.json'
import {
  computeTrafficRisk, computeWeatherRisk, computeInfraRisk,
  computeNightRisk, aggregateSafetyScore,
} from './dynamicRisk'

const CORRIDOR_M  = 2000
const MAX_SHOWN   = 5
const SAMPLE_STEP = 3

// Structural penalty for comparison (not shown to user directly)
const STRUCT_PENALTY = { very_high: 18, high: 11, moderate_high: 6 }

// ── Geometry ──────────────────────────────────────────────────────────────────

function _haversine(lat1, lon1, lat2, lon2) {
  const R  = 6371000
  const φ1 = (lat1 * Math.PI) / 180, φ2 = (lat2 * Math.PI) / 180
  const Δφ = ((lat2 - lat1) * Math.PI) / 180
  const Δλ = ((lon2 - lon1) * Math.PI) / 180
  const a  = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function _sampleCoords(route) {
  const coords = []
  for (const step of (route.steps || [])) {
    if (step.from_coord?.lat) coords.push(step.from_coord)
    if (step.polyline?.length) {
      for (let i = 0; i < step.polyline.length; i += SAMPLE_STEP)
        coords.push(step.polyline[i])
    }
  }
  const steps = route.steps || []
  const last = steps[steps.length - 1]
  if (last?.to_coord?.lat) coords.push(last.to_coord)
  return coords
}

function _closestOnRoute(area, coords) {
  let minDist = Infinity, minIdx = 0
  for (let i = 0; i < coords.length; i++) {
    const d = _haversine(area.lat, area.lon, coords[i].lat, coords[i].lon)
    if (d < minDist) { minDist = d; minIdx = i }
  }
  return { dist: minDist, idx: minIdx }
}

// ── Peak window display (from TomTom ratio, not hardcoded) ────────────────────

export function fmtPeakWindow() { return null }  // replaced by live congestion display

// ── Structural analysis (fast, sync — used for route cards + comparison) ──────

export function analyzeRouteSafety(route) {
  if (!route?.steps?.length) return null

  const coords = _sampleCoords(route)
  if (!coords.length) return null

  const hour    = new Date().getHours()
  const isNight = hour >= 21 || hour < 5
  const monsoon = (() => { const m = new Date().getMonth() + 1; return m >= 6 && m <= 10 })()

  const matched = []
  for (const area of RISK_AREAS) {
    const { dist, idx } = _closestOnRoute(area, coords)
    if (dist > CORRIDOR_M) continue

    // isActive: night + high-risk areas are always worth flagging; monsoon for flood areas
    const isActive = (isNight && area.riskLevel !== 'moderate_high') || (monsoon && area.monsoonRisk)

    matched.push({
      ...area,
      distanceM:     Math.round(dist),
      routeIdx:      idx,
      isActive,
      isPeakActive:  false,   // determined by live traffic in AnalysisPanel
      isNightActive: isNight && area.riskLevel !== 'moderate_high',
      activeReasons: [
        isNight && area.riskLevel !== 'moderate_high' && 'Night zone',
        monsoon && area.monsoonRisk && 'Monsoon risk',
      ].filter(Boolean),
    })
  }

  matched.sort((a, b) => a.routeIdx - b.routeIdx)

  // Structural score: based on which dangerous locations the route passes through
  // This is used for route comparison, not the live display score
  let penalty = 0
  for (const a of matched) penalty += STRUCT_PENALTY[a.riskLevel] ?? 3
  if (route.primary_mode === 'metro') penalty = Math.round(penalty * 0.35)
  const score = Math.max(20, 100 - penalty)

  // Suggestion from structural data only (no API needed for comparison)
  const hasVHigh   = matched.some(a => a.riskLevel === 'very_high')
  const hasMetro   = (route.steps || []).some(s => s.mode === 'metro')
  const hasHighway = (route.steps || []).some(s => s.mode === 'auto')
  const hasFlood   = matched.some(a => a.monsoonRisk) && monsoon

  let suggestion = null
  if (hasFlood) suggestion = 'Flood-prone areas on route — check for waterlogging; avoid underpasses in heavy rain'
  else if (isNight && hasHighway && hasVHigh) suggestion = 'High-speed road segments at night — stay alert and follow speed limits'
  else if (hasVHigh && !hasMetro) suggestion = 'Route passes high-risk corridors — consider Metro if available'

  return {
    matched:    matched.slice(0, MAX_SHOWN),
    allMatched: matched,
    score,
    suggestion,
    peakWindow: null,  // no static timing
  }
}

// ── Live-adjusted display score — uses dynamic engine ─────────────────────────

export function computeLiveAdjustedScore(baseScore, traffic, weather, aqi, infra) {
  if (baseScore === null || baseScore === undefined) return null

  const hour = new Date().getHours()

  // If we have live API data, use the full dynamic engine
  if (traffic || weather || infra) {
    const tRisk = computeTrafficRisk(traffic)
    const wRisk = computeWeatherRisk(weather, aqi)
    const iRisk = computeInfraRisk(infra)
    const nRisk = computeNightRisk(hour, infra)
    return aggregateSafetyScore(tRisk, wRisk, iRisk, nRisk)
  }

  // Fallback: just apply weather + AQI penalties to the structural score
  const weatherPenalty = weather?.penalty ?? 0
  const aqiPenalty     = aqi?.penalty     ?? 0
  return Math.min(100, Math.max(0, baseScore - weatherPenalty - aqiPenalty))
}

// ── Smart alerts — data-driven, no static area flags ─────────────────────────

export function generateAlerts(safety, traffic, weather, aqi, infra) {
  if (!safety) return []

  const hour    = new Date().getHours()
  const isNight = hour >= 21 || hour < 5
  const monsoon = (() => { const m = new Date().getMonth() + 1; return m >= 6 && m <= 10 })()
  const { matched } = safety
  const alerts  = []

  // Live congestion alert (data-driven peak detection)
  if (traffic) {
    const ratio = traffic.avgRatio ?? 1
    if (ratio < 0.35) {
      alerts.push({ icon: '🚦', text: `Severe road congestion — traffic at ${traffic.avg_speed ?? '?'} km/h (${Math.round((1-ratio)*100)}% below normal)`, level: 'high' })
    } else if (ratio < 0.55) {
      alerts.push({ icon: '🚦', text: `Heavy traffic on route — congestion ${Math.round((1-ratio)*100)}% above normal, expect delays`, level: 'moderate' })
    }
  }

  // Night risk (general, not area-specific)
  if (isNight) {
    const hasHighway = infra?.isHighwayHeavy
    if (hasHighway) {
      alerts.push({ icon: '🌙', text: 'Late-night highway exposure — vehicles travel at high speed with reduced visibility', level: 'high' })
    } else {
      alerts.push({ icon: '🌙', text: 'Night travel — reduced road visibility and decreased reaction times', level: 'moderate' })
    }
  }

  // Geographic alerts for matched areas (factual, not timing-based)
  const nightHighRisk = matched.filter(a => a.isNightActive && a.riskLevel === 'very_high')
  if (nightHighRisk.length) {
    alerts.push({ icon: '⚠', text: 'Elevated-risk corridor at night — poor visibility and overspeeding risk on this route', level: 'high' })
  }

  // Monsoon / waterlogging
  const floodAreas = matched.filter(a => a.monsoonRisk && monsoon)
  if (floodAreas.length) {
    alerts.push({ icon: '🌧', text: 'Route passes flood-prone stretch — check for waterlogging, avoid underpasses in heavy rain', level: 'moderate' })
  }

  // Dense junction warning from Overpass data
  if (infra && infra.signalDensity > 6) {
    alerts.push({ icon: '🚥', text: `Dense junction corridor — ${infra.signalCount} traffic signals on route, expect frequent stops`, level: 'moderate' })
  }

  // Weather alerts
  if (weather?.level === 'severe') {
    alerts.push({ icon: '⛈', text: 'Severe weather — consider delaying non-essential travel', level: 'high' })
  } else if (weather?.rain_1h >= 5 && monsoon) {
    alerts.push({ icon: '🌧', text: `Rain ${weather.rain_1h}mm/h on corridor — reduced visibility and grip`, level: 'moderate' })
  }
  if (weather?.temp_c >= 42) {
    alerts.push({ icon: '🌡', text: `Extreme heat ${weather.temp_c}°C (feels ${weather.feels_like ?? weather.temp_c}°C) — stay hydrated, tyre blowout risk`, level: 'moderate' })
  }

  // AQI alerts
  if (aqi?.value > 200) {
    alerts.push({ icon: '😷', text: `Very poor air quality (AQI ${aqi.value}) — wear N95 mask for this commute`, level: 'high' })
  } else if (aqi?.value > 100) {
    alerts.push({ icon: '🌬', text: `Moderate air quality (AQI ${aqi.value}) — sensitive groups should take precautions`, level: 'moderate' })
  }

  return alerts.slice(0, 5)
}

// ── Tag safest route (highest structural score = safest for comparison) ────────

export function tagSafestRoute(routeGroups) {
  if (!routeGroups) return routeGroups
  const all = [
    ...(routeGroups.rtc?.all   || []),
    ...(routeGroups.mmts?.all  || []),
    ...(routeGroups.metro?.all || []),
  ]
  if (all.length < 2) return routeGroups

  let safestRoute = null, high = -1
  for (const r of all) {
    const score = analyzeRouteSafety(r)?.score ?? 85
    if (score > high) { high = score; safestRoute = r }
  }
  if (safestRoute && !safestRoute.tags.includes('safest'))
    safestRoute.tags = [...safestRoute.tags, 'safest']
  return routeGroups
}

// ── Metadata helpers ──────────────────────────────────────────────────────────

export function safetyScoreMeta(score) {
  if (score >= 85) return { label: 'Low risk',   color: '#16a34a', bg: 'rgba(22,163,74,0.10)',  border: 'rgba(22,163,74,0.28)'  }
  if (score >= 70) return { label: 'Manageable', color: '#22c55e', bg: 'rgba(34,197,94,0.10)',  border: 'rgba(34,197,94,0.28)'  }
  if (score >= 50) return { label: 'Moderate',   color: '#d97706', bg: 'rgba(217,119,6,0.10)',  border: 'rgba(217,119,6,0.28)'  }
  if (score >= 35) return { label: 'Elevated',   color: '#ea580c', bg: 'rgba(234,88,12,0.10)',  border: 'rgba(234,88,12,0.28)'  }
  return                  { label: 'Heavy risk', color: '#dc2626', bg: 'rgba(220,38,38,0.10)',  border: 'rgba(220,38,38,0.28)'  }
}

export function riskLevelMeta(level) {
  switch (level) {
    case 'very_high':    return { label: 'Elevated', color: '#ef4444', bg: 'rgba(239,68,68,0.08)',  border: 'rgba(239,68,68,0.25)'  }
    case 'high':         return { label: 'High',     color: '#f97316', bg: 'rgba(249,115,22,0.08)', border: 'rgba(249,115,22,0.25)' }
    case 'moderate_high':return { label: 'Moderate', color: '#d97706', bg: 'rgba(217,119,6,0.07)',  border: 'rgba(217,119,6,0.22)'  }
    default:             return { label: 'Low',      color: '#22c55e', bg: 'rgba(34,197,94,0.07)',  border: 'rgba(34,197,94,0.18)'  }
  }
}
