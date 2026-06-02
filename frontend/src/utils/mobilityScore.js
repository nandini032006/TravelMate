// Area Mobility Score — 0-100 (100 = excellent mobility conditions)
// Computed purely from live and structural route data. Nothing hardcoded.

export function computeMobilityScore(route, traffic, aqi, weather, infra, safety, corridor) {
  let score = 100
  const factors  = []
  const positives = []

  // ── Traffic (max −20) ─────────────────────────────────────────────────────
  const tRatio = traffic?.avgRatio ?? null
  if (tRatio !== null) {
    const p = tRatio < 0.35 ? 20 : tRatio < 0.55 ? 14 : tRatio < 0.75 ? 8 : tRatio < 0.90 ? 3 : 0
    if (p) { score -= p; factors.push({ key: 'traffic', label: `Traffic ${Math.round((1 - tRatio) * 100)}% congested`, penalty: p, icon: '🚦' }) }
    else positives.push('Light traffic flowing freely')
  } else {
    const h = new Date().getHours()
    const isPeak = (h >= 8 && h < 11) || (h >= 17 && h < 21)
    if (isPeak) { score -= 10; factors.push({ key: 'traffic', label: 'Peak hour (estimated)', penalty: 10, icon: '🚦' }) }
    else positives.push('Off-peak — light estimated traffic')
  }

  // ── Air Quality (max −15) ─────────────────────────────────────────────────
  if (aqi?.value != null) {
    const p = aqi.value > 200 ? 15 : aqi.value > 150 ? 10 : aqi.value > 100 ? 6 : aqi.value > 50 ? 2 : 0
    if (p) { score -= p; factors.push({ key: 'aqi', label: `AQI ${aqi.value} — ${aqi.label}`, penalty: p, icon: '🌬' }) }
    else positives.push('Clean air on route')
  }

  // ── Weather (max −12) ─────────────────────────────────────────────────────
  if (weather) {
    const p = Math.min(12, weather.penalty ?? 0)
    if (p) { score -= p; factors.push({ key: 'weather', label: weather.label, penalty: p, icon: weather.icon ?? '🌤' }) }
    else positives.push('Clear weather conditions')
  }

  // ── Safety zones (max −12) ────────────────────────────────────────────────
  if (safety?.matched?.length) {
    const vhigh = safety.matched.filter(a => a.riskLevel === 'very_high').length
    const high  = safety.matched.filter(a => a.riskLevel === 'high').length
    const p = Math.min(12, vhigh * 5 + high * 2 + Math.max(0, safety.matched.length - vhigh - high))
    if (p) { score -= p; factors.push({ key: 'risk', label: `${safety.matched.length} risk zone${safety.matched.length > 1 ? 's' : ''} on route`, penalty: p, icon: '⚠' }) }
  } else if (safety !== null && safety !== undefined) {
    positives.push('No risk zones detected')
  }

  // ── Infrastructure (max −10) ──────────────────────────────────────────────
  if (infra) {
    let p = 0
    if      (infra.signalDensity > 7) p += 6
    else if (infra.signalDensity > 4) p += 3
    if (infra.isHighwayHeavy)   p += 4
    if (infra.isCommercialZone) p += 2
    p = Math.min(10, p)
    if (p) { score -= p; factors.push({ key: 'infra', label: 'Dense signals & road complexity', penalty: p, icon: '🚥' }) }
    else positives.push('Simple road infrastructure')
  }

  // ── Transfers (max −6) ────────────────────────────────────────────────────
  const transfers = route?.transfers ?? 0
  if (transfers > 0) {
    const p = Math.min(6, transfers * 2)
    score -= p; factors.push({ key: 'transfers', label: `${transfers} mode transfer${transfers > 1 ? 's' : ''}`, penalty: p, icon: '🔄' })
  } else {
    positives.push('No transfers required')
  }

  // ── Walk burden (max −8) ──────────────────────────────────────────────────
  if ((corridor?.walkRatio ?? 0) > 0.15) {
    const p = Math.min(8, Math.round(corridor.walkRatio * 35))
    score -= p; factors.push({ key: 'walk', label: `${Math.round(corridor.walkRatio * 100)}% walking exposure`, penalty: p, icon: '🚶' })
  }

  // ── Connectivity factor (−8 max) ─────────────────────────────────────────
  const hasBus   = route?.steps?.some(step => step.mode === 'bus')
  const hasMetro = route?.steps?.some(step => step.mode === 'metro')
  const primaryMode = route?.primary_mode ?? ''

  if (hasBus && hasMetro) {
    score += 2
    positives.push('Multi-modal connectivity (bus + metro)')
  } else if (transfers <= 1) {
    positives.push('Direct route, high connectivity')
  } else if (transfers === 0 && primaryMode === 'walk') {
    const p = 8
    score -= p
    factors.push({ key: 'connectivity', label: 'Walking-only route with no transit options', penalty: p, icon: '🚶' })
  }

  // ── Transit Availability (−6 / +6) ───────────────────────────────────────
  const transitCount = infra?.transitCount ?? 0
  if (transitCount === 0) {
    score -= 6
    factors.push({ key: 'transitAvailability', label: 'No transit stops nearby', penalty: 6, icon: '🚫' })
  } else {
    const bonus = Math.min(6, transitCount)
    score += bonus
    if (bonus > 0) positives.push(`${transitCount} transit stop${transitCount > 1 ? 's' : ''} nearby`)
  }

  // ── Road Complexity (−5 max) ─────────────────────────────────────────────
  const segmentCount = corridor?.segmentCount ?? 0
  if (segmentCount > 12) {
    score -= 5
    factors.push({ key: 'roadComplexity', label: 'Complex multi-leg route', penalty: 5, icon: '🔀' })
  } else if (segmentCount > 6) {
    score -= 3
    factors.push({ key: 'roadComplexity', label: 'Moderately complex route', penalty: 3, icon: '🔀' })
  }

  // ── Night (max −8) ────────────────────────────────────────────────────────
  const h = new Date().getHours()
  if (h >= 22 || h < 5) {
    const p = (h >= 23 || h < 4) ? 8 : 4
    score -= p; factors.push({ key: 'night', label: 'Night-time travel risk', penalty: p, icon: '🌙' })
  }

  // ── Monsoon flood zones (max −4) ──────────────────────────────────────────
  const month = new Date().getMonth() + 1
  if (month >= 6 && month <= 10 && safety?.matched?.some(a => a.monsoonRisk)) {
    score -= 4; factors.push({ key: 'monsoon', label: 'Monsoon flood-risk area on route', penalty: 4, icon: '🌧' })
  }

  // ── Mode positives ────────────────────────────────────────────────────────
  if (route?.primary_mode === 'metro') positives.push('Metro — fast, weatherproof, reliable')
  if (route?.primary_mode === 'mmts')  positives.push('MMTS rail — climate-insulated, avoids road traffic')

  const finalScore = Math.max(18, Math.min(96, Math.round(score)))
  const dataPoints = [traffic, aqi, weather, infra].filter(Boolean).length
  const confidence = dataPoints >= 3 ? 'High' : dataPoints >= 2 ? 'Medium' : dataPoints >= 1 ? 'Low' : 'Estimated'

  return {
    score: finalScore,
    confidence,
    factors:   factors.sort((a, b) => b.penalty - a.penalty).slice(0, 5),
    positives: positives.slice(0, 3),
  }
}

export function mobilityScoreMeta(score) {
  if (score >= 82) return { label: 'Excellent', color: '#16a34a', bg: 'rgba(22,163,74,0.08)',  border: 'rgba(22,163,74,0.22)' }
  if (score >= 68) return { label: 'Good',      color: '#22c55e', bg: 'rgba(34,197,94,0.08)',  border: 'rgba(34,197,94,0.22)' }
  if (score >= 52) return { label: 'Moderate',  color: '#d97706', bg: 'rgba(217,119,6,0.08)',  border: 'rgba(217,119,6,0.22)' }
  if (score >= 36) return { label: 'Difficult', color: '#ea580c', bg: 'rgba(234,88,12,0.08)',  border: 'rgba(234,88,12,0.22)' }
  return                  { label: 'Poor',      color: '#dc2626', bg: 'rgba(220,38,38,0.08)',  border: 'rgba(220,38,38,0.22)' }
}
