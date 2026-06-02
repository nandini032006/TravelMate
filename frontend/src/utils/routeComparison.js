import { analyzeRouteSafety } from './routeSafety'

// ── Crowd estimation ──────────────────────────────────────────────────────────

function _computeCrowdScore(route, traffic) {
  const hour   = new Date().getHours()
  const isPeak = (hour >= 8 && hour < 11) || (hour >= 17 && hour < 22)

  // Base score by mode (lower = less crowded)
  let score = route.primary_mode === 'mmts'  ? 22
            : route.primary_mode === 'metro' ? 48
            :                                  44  // bus

  if (isPeak) score += 18

  // Traffic level correlates with transit crowding
  score += (traffic?.penalty ?? 0) * 0.4

  // High-frequency routes attract more riders
  const transitSteps = (route.steps || []).filter(s => s.mode !== 'walk' && s.mode !== 'auto')
  const minFreq = transitSteps.reduce(
    (min, s) => (s.freq_mins > 0 && s.freq_mins < min ? s.freq_mins : min), 999,
  )
  if      (minFreq <= 5)  score += 18
  else if (minFreq <= 10) score += 10
  else if (minFreq <= 20) score += 4
  else if (minFreq > 30)  score -= 8

  return Math.min(100, Math.max(0, Math.round(score)))
}

export function computeCrowdScore(route, traffic) {
  return _computeCrowdScore(route, traffic)
}

export function crowdMeta(score) {
  if (score <= 25) return { label: 'Very Low',  short: 'Very low',  color: '#16a34a', bg: '#dcfce7', border: '#86efac' }
  if (score <= 40) return { label: 'Low',       short: 'Low',       color: '#22c55e', bg: '#f0fdf4', border: '#bbf7d0' }
  if (score <= 58) return { label: 'Moderate',  short: 'Moderate',  color: '#d97706', bg: '#fef3c7', border: '#fde68a' }
  if (score <= 74) return { label: 'High',      short: 'High',      color: '#ea580c', bg: '#ffedd5', border: '#fed7aa' }
  return                  { label: 'Very High', short: 'Very high', color: '#dc2626', bg: '#fee2e2', border: '#fecaca' }
}

// ── ETA ───────────────────────────────────────────────────────────────────────

export function fmtETA(durationSec) {
  const eta = new Date(Date.now() + durationSec * 1000)
  return eta.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true })
}

// ── Cross-mode comparison + tagging ──────────────────────────────────────────

/**
 * Computes cross-mode route comparison, tags winners, and returns summary data.
 * Clears all existing route tags before re-assigning. Idempotent.
 */
export function buildComparison(routeGroups, traffic) {
  const all = [
    ...(routeGroups?.rtc?.all   || []),
    ...(routeGroups?.mmts?.all  || []),
    ...(routeGroups?.metro?.all || []),
  ]
  if (!all.length) return null

  // Reset tags so cross-mode comparison is the single source of truth
  for (const r of all) r.tags = []

  // Pre-compute all scores
  const crowdScores  = new Map(all.map(r => [r, _computeCrowdScore(r, traffic)]))
  const safetyData   = new Map(all.map(r => [r, analyzeRouteSafety(r)]))
  // Score is 0–100 where 100 = very safe; no data → assume 95 (no risk areas found)
  const safetyScores = new Map(all.map(r => [r, safetyData.get(r)?.score ?? 95]))

  // Find winners
  const fastest      = all.reduce((a, b) => a.total_duration_sec < b.total_duration_sec ? a : b)
  const cheapest     = all.reduce((a, b) => a.total_cost_inr     < b.total_cost_inr     ? a : b)
  const leastWalking = all.reduce((a, b) => a.walking_distance_m < b.walking_distance_m ? a : b)
  const leastCrowded = all.reduce((a, b) => crowdScores.get(a)   < crowdScores.get(b)   ? a : b)
  const safest       = all.reduce((a, b) => safetyScores.get(a)  > safetyScores.get(b)  ? a : b)

  // Eco score: metro > mmts > bus (per passenger vs private car)
  const ecoOf        = r => r.primary_mode === 'metro' ? 3 : r.primary_mode === 'mmts' ? 2 : 1
  const ecoFriendly  = all.reduce((a, b) => ecoOf(a) > ecoOf(b) ? a : b)

  // Fewest transfers — only tag if it's actually better than the max
  const maxT          = Math.max(...all.map(r => r.transfers || 0))
  const fewestTransfers = maxT > 0 ? all.reduce((a, b) => (a.transfers || 0) < (b.transfers || 0) ? a : b) : null

  // Most reliable: crowd (40%) + safety (40%) + transfers inverse (20%)
  const reliabilityOf = r =>
    (100 - crowdScores.get(r)) * 0.40 +
    safetyScores.get(r) * 0.40 +
    ((maxT + 1 - (r.transfers || 0)) / (maxT + 1)) * 20 * 100 / 100
  const mostReliable = all.reduce((a, b) => reliabilityOf(a) > reliabilityOf(b) ? a : b)

  // Tag winners — multiple tags per route are allowed
  const _tag = (r, t) => { if (r && !r.tags.includes(t)) r.tags = [...r.tags, t] }
  _tag(fastest,        'fastest')
  _tag(cheapest,       'cheapest')
  _tag(leastWalking,   'least_walking')
  _tag(leastCrowded,   'least_crowded')
  _tag(safest,         'safest')
  _tag(ecoFriendly,    'eco_friendly')
  _tag(mostReliable,   'most_reliable')
  if (fewestTransfers) _tag(fewestTransfers, 'fewest_transfers')

  return {
    fastest,
    cheapest,
    safest,
    leastWalking,
    leastCrowded,
    ecoFriendly,
    mostReliable,
    fewestTransfers,
    crowdScores,
    safetyScores,
    totalRoutes: all.length,
  }
}
