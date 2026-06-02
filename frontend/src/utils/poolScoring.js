// poolScoring.js — comfort + overlap + traffic display metadata only.
// Fare computation is now in dynamicPricing.js.
// Kept for backward compat with RidePoolCard + RidePoolInsights imports.

export function computeComfortScore(occupancy, detourMin, overlapPct, trafficLevel) {
  let score = 100
  score -= (occupancy - 1) * 13
  score -= detourMin * 2.2
  score -= (100 - overlapPct) * 0.28
  if (trafficLevel === 'heavy')    score -= 12
  else if (trafficLevel === 'moderate') score -= 5
  return Math.max(18, Math.min(100, Math.round(score)))
}

export function comfortMeta(score) {
  if (score >= 68) return { label: 'Comfortable', icon: '🟢', color: '#16a34a', bg: 'rgba(22,163,74,0.08)',  border: 'rgba(22,163,74,0.22)'  }
  if (score >= 42) return { label: 'Moderate',    icon: '🟡', color: '#d97706', bg: 'rgba(217,119,6,0.08)',  border: 'rgba(217,119,6,0.22)'  }
  return                  { label: 'Crowded',     icon: '🔴', color: '#dc2626', bg: 'rgba(220,38,38,0.08)',  border: 'rgba(220,38,38,0.22)'  }
}

export function overlapMeta(pct) {
  if (pct >= 80) return { label: 'Excellent match', color: '#16a34a', bg: 'rgba(22,163,74,0.1)',  border: 'rgba(22,163,74,0.25)'  }
  if (pct >= 65) return { label: 'Good match',      color: '#22c55e', bg: 'rgba(34,197,94,0.1)',  border: 'rgba(34,197,94,0.25)'  }
  if (pct >= 50) return { label: 'Fair match',      color: '#d97706', bg: 'rgba(217,119,6,0.1)',  border: 'rgba(217,119,6,0.25)'  }
  return                { label: 'Low overlap',     color: '#ea580c', bg: 'rgba(234,88,12,0.1)',  border: 'rgba(234,88,12,0.25)'  }
}

export function trafficMeta(level) {
  if (level === 'heavy')    return { label: 'Heavy traffic',    color: '#dc2626', icon: '🔴' }
  if (level === 'moderate') return { label: 'Moderate traffic', color: '#d97706', icon: '🟡' }
  return                           { label: 'Light traffic',    color: '#16a34a', icon: '🟢' }
}
