/**
 * Dynamic risk engine — all scoring from live API data + route geometry.
 * Score: 0 = highest risk, 100 = lowest risk.
 */

// ── Traffic risk (0–35) ───────────────────────────────────────────────────────

export function computeTrafficRisk(traffic, corridorProfile) {
  if (!traffic) return _estimateTrafficFallback(corridorProfile)

  const ratio         = traffic.avgRatio ?? 1
  const congestionPct = Math.round(Math.max(0, 1 - ratio) * 100)
  const isPeak        = ratio < 0.75

  let score, label
  if      (ratio < 0.35) { score = 35; label = `Severe congestion — ${congestionPct}% below normal flow` }
  else if (ratio < 0.55) { score = 26; label = `Heavy traffic — ${congestionPct}% congestion on route` }
  else if (ratio < 0.75) { score = 15; label = `Moderate congestion — periodic slowdowns expected` }
  else if (ratio < 0.90) { score = 5;  label = `Light traffic — route flowing well` }
  else                   { score = 0;  label = `Free flowing — favourable travel conditions` }

  return { score, label, isPeak, congestionPct, avgRatio: ratio, isEstimated: false }
}

function _estimateTrafficFallback(corridorProfile) {
  const hour          = new Date().getHours()
  const isMorningPeak = hour >= 8  && hour < 11
  const isEveningPeak = hour >= 17 && hour < 21
  const isLunch       = hour >= 12 && hour < 14
  const isLateNight   = hour >= 23 || hour < 5
  const type          = corridorProfile?.corridorType ?? 'urban_mixed'

  let score, label, ratio

  if (isLateNight) {
    score = 2; ratio = 0.93; label = 'Estimated light traffic — late-night corridor'
  } else if (isMorningPeak || isEveningPeak) {
    if (type === 'urban_dense' || type === 'urban_commercial') {
      score = 22; ratio = 0.52; label = 'Estimated heavy congestion — peak hour on dense corridor'
    } else if (type === 'highway') {
      score = 14; ratio = 0.65; label = 'Estimated moderate congestion — highway peak flow'
    } else if (type === 'metro_corridor' || type === 'rail_corridor') {
      score = 6;  ratio = 0.82; label = 'Estimated manageable traffic — transit-served corridor'
    } else {
      score = 16; ratio = 0.62; label = 'Estimated moderate to heavy congestion — urban peak hour'
    }
  } else if (isLunch) {
    score = 8; ratio = 0.78; label = 'Estimated moderate midday traffic'
  } else {
    score = 4; ratio = 0.88; label = 'Estimated light traffic — off-peak period'
  }

  return { score, label, isPeak: score >= 14, congestionPct: Math.round((1 - ratio) * 100), avgRatio: ratio, isEstimated: true }
}

// ── Weather risk (0–22) ───────────────────────────────────────────────────────

export function computeWeatherRisk(weather, aqi) {
  const items = []
  let score = 0

  if (weather) {
    if (weather.rain_1h >= 10) {
      score += 14; items.push(`Heavy rain ${weather.rain_1h}mm/h — significantly reduced grip`)
    } else if (weather.rain_1h >= 2) {
      score += 7;  items.push(`Rain ${weather.rain_1h}mm/h — wet roads, reduce speed`)
    }
    if (weather.temp_c >= 42) {
      score += 5;  items.push(`Extreme heat ${weather.temp_c}°C — tyre and overheating risk`)
    }
    if (weather.wind_speed > 45) {
      score += 5;  items.push(`Strong winds ${weather.wind_speed}km/h — control and visibility affected`)
    }
    if (weather.humidity > 90 && weather.rain_1h > 0) {
      score += 3;  items.push(`High humidity with rain — fog risk on low-lying stretches`)
    }
  }

  if (aqi) {
    if (aqi.value > 200) {
      score += 6; items.push(`Poor air quality AQI ${aqi.value} — limit outdoor exposure`)
    } else if (aqi.value > 100) {
      score += 3; items.push(`Moderate AQI ${aqi.value} — sensitive groups take precautions`)
    }
  }

  return { score: Math.min(22, score), items }
}

// ── Infrastructure risk (0–22) ────────────────────────────────────────────────

export function computeInfraRisk(infra) {
  if (!infra) return { score: 6, items: [] }

  const { signalDensity, transitDensity, isHighwayHeavy, signalCount, routeKm, isCommercialZone } = infra
  const items = []
  let score = 2  // baseline urban road

  if (signalDensity > 7) {
    score += 12; items.push(`${signalCount} traffic signals on ${routeKm?.toFixed(0)}km — very frequent stop-and-go`)
  } else if (signalDensity > 4) {
    score += 7;  items.push(`${signalCount} signalized junctions — expect stop-and-go sections`)
  } else if (signalDensity > 1.5) {
    score += 3
  }

  if (isHighwayHeavy) {
    score += 10; items.push('Route includes high-speed highway segments — elevated speed differential')
  }

  if (transitDensity > 7) {
    score += 5; items.push('Dense transit corridor — frequent bus merges and pedestrian activity')
  } else if (transitDensity > 4) {
    score += 2
  }

  if (isCommercialZone) score += 3

  return { score: Math.min(22, score), items }
}

// ── Night risk (0–18) ─────────────────────────────────────────────────────────

export function computeNightRisk(hour, infra) {
  const isLateNight = hour >= 23 || hour < 4
  const isNight     = hour >= 21 || hour < 5
  if (!isNight) return { score: 0, isNight: false, isLateNight: false, items: [] }

  const items = []
  let score = isLateNight ? 11 : 6

  if (isLateNight) {
    items.push('Late-night travel — reduced road visibility and elevated speed risk')
  } else {
    items.push('Night travel — reduced visibility and pedestrian detection risk')
  }

  if (infra?.isHighwayHeavy) {
    score += 7; items.push('Highway sections at night — high-speed vehicles with limited enforcement')
  }

  return { score: Math.min(18, score), isNight, isLateNight, items }
}

// ── Aggregate safety score (0–100, higher = safer) ────────────────────────────

export function aggregateSafetyScore(trafficRisk, weatherRisk, infraRisk, nightRisk) {
  const total = trafficRisk.score + weatherRisk.score + infraRisk.score + nightRisk.score
  return Math.max(15, Math.min(92, 100 - total))
}

// ── Crowd level (0–100) ───────────────────────────────────────────────────────

export function computeDynamicCrowd(infra, traffic, hour, corridorProfile) {
  let level = 15

  const day       = new Date().getDay()
  const isWeekend = day === 0 || day === 6
  const month     = new Date().getMonth() + 1
  const isMonsoon = month >= 6 && month <= 10
  const type      = corridorProfile?.corridorType ?? 'urban_mixed'

  // Live traffic is the strongest signal
  if (traffic) {
    const ratio = traffic.avgRatio ?? 1
    if      (ratio < 0.35) level += 50
    else if (ratio < 0.55) level += 35
    else if (ratio < 0.75) level += 20
    else if (ratio < 0.90) level += 8
  }

  if (infra) {
    if      (infra.transitDensity > 7) level += 20
    else if (infra.transitDensity > 4) level += 12
    if (infra.signalDensity > 6) level += 6
    if (infra.isCommercialZone)  level += 12
  }

  // Time-based estimate when no live traffic data
  if (!traffic) {
    const isMorning   = hour >= 7  && hour < 11
    const isEvening   = hour >= 17 && hour < 21
    const isLunch     = hour >= 12 && hour < 14
    const isLateNight = hour >= 23 || hour < 5
    const isSchool    = hour >= 8  && hour < 9   // school drop-off peak

    if (isLateNight) {
      level -= 12
    } else if (isMorning || isEvening) {
      // Corridor-specific crowd patterns
      if (type === 'metro_corridor') {
        // IT + metro corridor is most crowded on weekday peak
        level += isWeekend ? 10 : 32
      } else if (type === 'urban_dense' || type === 'urban_commercial') {
        level += isWeekend ? 22 : 28
      } else if (type === 'highway') {
        level += 14
      } else if (type === 'rail_corridor') {
        level += isWeekend ? 14 : 22
      } else {
        level += isWeekend ? 16 : 22
      }

      // School hour spike in residential zones
      if (isSchool && type === 'urban_mixed') level += 8

    } else if (isLunch) {
      if (type === 'urban_commercial') level += 18
      else level += 8
    }

    // Monsoon adds crowd pressure — traffic is slower, more people pile into transit
    if (isMonsoon && (isMorning || isEvening)) level += 8

    // Weekend market zones stay busy all day
    if (isWeekend && type === 'urban_commercial' && hour >= 10 && hour < 20) level += 14
  }

  return Math.min(100, Math.max(0, level))
}

export function crowdMeta(level) {
  if (level >= 65) return { label: 'Heavy',    icon: '🔴', color: '#dc2626', bg: 'rgba(220,38,38,0.07)',  border: 'rgba(220,38,38,0.18)'  }
  if (level >= 35) return { label: 'Moderate', icon: '🟡', color: '#d97706', bg: 'rgba(217,119,6,0.07)',  border: 'rgba(217,119,6,0.18)'  }
  return                  { label: 'Light',    icon: '🟢', color: '#16a34a', bg: 'rgba(22,163,74,0.07)',  border: 'rgba(22,163,74,0.18)'  }
}

// ── Route insights — generated from actual route metrics ──────────────────────

export function generateDynamicInsights(tRisk, wRisk, iRisk, nRisk, traffic, infra, corridor) {
  const lines = []

  if (tRisk.label) lines.push(tRisk.label)

  if (infra) {
    if (infra.signalDensity > 7 && infra.signalCount > 0)
      lines.push(`${infra.signalCount} traffic signals on route — frequent signal interruptions expected`)
    else if (infra.signalDensity > 4 && infra.signalCount > 0)
      lines.push(`${infra.signalCount} signalized intersections — allow for stop-and-go sections`)

    if (corridor?.isHighway)
      lines.push('Elevated highway section on route — speed differential increases risk at entry points')

    if (infra.transitDensity > 6)
      lines.push('Dense bus and auto stop corridor — pedestrian merging and boarding conflicts frequent')

    if (infra.isCommercialZone)
      lines.push('Commercial activity zone — high pedestrian movement and parking manoeuvres expected')
  }

  if (corridor) {
    if (corridor.transfers >= 2)
      lines.push(`${corridor.transfers} mode transfers — allow extra time for boarding and interchange`)
    if (corridor.walkRatio > 0.15)
      lines.push(`${Math.round(corridor.walkRatio * 100)}% of route on foot — pedestrian exposure on open roads`)
    if (corridor.corridorType === 'urban_commercial')
      lines.push('Dense commercial corridor — vehicle conflicts near market and junction areas')
  }

  for (const item of (wRisk.items ?? [])) lines.push(item)
  for (const item of (nRisk.items ?? [])) lines.push(item)

  if (!lines.length) lines.push('No significant risk factors detected on this corridor')

  return lines.slice(0, 5)
}

// ── Best time advice ──────────────────────────────────────────────────────────

export function bestTimeAdvice(traffic, corridor) {
  const ratio = traffic?.avgRatio ?? null
  const hour  = new Date().getHours()

  if (ratio === null) {
    const isMorningPeak = hour >= 8  && hour < 11
    const isEveningPeak = hour >= 17 && hour < 21
    const type = corridor?.corridorType ?? 'urban_mixed'

    if (isMorningPeak || isEveningPeak) {
      if (type === 'metro_corridor') return 'Metro service active — transit advisable over road alternatives'
      if (type === 'highway') return 'Peak hour on highway — expect congestion near entry and exit points'
      return 'Peak hours active — allow additional travel time for this corridor'
    }
    if (hour >= 23 || hour < 5) return 'Late-night travel — road likely clear, stay alert on highway sections'
    return 'Off-peak — generally good conditions on this route'
  }

  if (ratio >= 0.88) return 'Now — traffic is flowing freely on this corridor'

  if (ratio < 0.40) {
    const clearHour = hour < 10 ? '11:30 AM' : hour < 19 ? '9:30 PM' : '6:00 AM'
    return `Severe congestion active — consider departing after ${clearHour}`
  }
  if (ratio < 0.60) return 'Heavy congestion — allow 20–30 minutes extra or use an alternate route'
  if (ratio < 0.75) return 'Moderate congestion — allow 10–15 extra minutes'
  return 'Light traffic — minor delays possible, good conditions overall'
}
