// Dynamic pricing engine — fares change with traffic, weather, time, demand.
// No fixed fares. Every call produces a contextual breakdown.

const BASE_KM     = 13    // ₹/km base pool rate
const BASE_FIXED  = 35    // ₹ flag-fall equivalent
const CAB_KM      = 15    // Ola/Uber estimate Hyderabad
const CAB_FIXED   = 50
const AUTO_KM     = 11
const AUTO_FIXED  = 25
const POINTS_PER_KM = 4   // 1 pt = ₹1

/**
 * Compute context-aware fares.
 * @param {number} distKm  Road-distance km
 * @param {number} overlapPct  0–96 geometric overlap
 * @param {number} hour  0–23
 * @param {number} dayOfWeek  0=Sun … 6=Sat
 * @param {'light'|'moderate'|'heavy'} traffic
 * @param {'clear'|'rain'|'storm'} weather
 */
export function computeDynamicFares(distKm, overlapPct, hour, dayOfWeek, traffic, weather = 'clear') {
  const isWeekend    = dayOfWeek === 0 || dayOfWeek === 6
  const isMorningPeak = !isWeekend && hour >= 8  && hour < 11
  const isEveningPeak = !isWeekend && hour >= 17 && hour < 21
  const isLateNight   = hour >= 23 || hour < 5

  let surge = 1.0
  const reasons = []

  if (isMorningPeak)            { surge += 0.18; reasons.push('Morning peak +18%') }
  if (isEveningPeak)            { surge += 0.15; reasons.push('Evening peak +15%') }
  if (isLateNight)              { surge += 0.08; reasons.push('Late night +8%') }
  if (traffic === 'heavy')      { surge += 0.15; reasons.push('Heavy traffic +15%') }
  else if (traffic === 'moderate') { surge += 0.06 }
  if (weather === 'rain')       { surge += 0.10; reasons.push('Rain surge +10%') }
  if (weather === 'storm')      { surge += 0.20; reasons.push('Storm surge +20%') }
  if (isWeekend && !isLateNight){ surge -= 0.05 }  // weekend discount

  surge = Math.max(1.0, Math.round(surge * 100) / 100)

  const soloFare  = Math.round((BASE_FIXED + distKm * BASE_KM) * surge)
  const discount  = overlapPct >= 85 ? 0.48
                  : overlapPct >= 70 ? 0.38
                  : overlapPct >= 55 ? 0.28
                  : 0.18
  const poolFare  = Math.round(soloFare * (1 - discount))
  const savings   = soloFare - poolFare

  const isPeak    = isMorningPeak || isEveningPeak
  const cabFare   = Math.round((CAB_FIXED + distKm * CAB_KM) * (isPeak ? 1.22 : surge > 1 ? 1.1 : 1.0))
  const autoFare  = Math.round((AUTO_FIXED + distKm * AUTO_KM) * (isLateNight ? 1.15 : 1.0))

  return {
    soloFare, poolFare, savings,
    cabFare, autoFare,
    savingsVsCab:  Math.max(0, cabFare  - poolFare),
    savingsVsAuto: Math.max(0, autoFare - poolFare),
    surgeMultiplier: surge,
    fareReasons: reasons,
    discountPct: Math.round(discount * 100),
    distKm: Math.round(distKm * 10) / 10,
    pointsEarned: Math.round(distKm * POINTS_PER_KM),
    pointsPerKm:  POINTS_PER_KM,
    isPeak, isLateNight,
  }
}
