export function fmtDuration(sec, lang = 'en') {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  if (lang === 'te') {
    if (h > 0) return `${h}గం ${m}నిమి`
    return `${m} నిమి`
  }
  if (h > 0) return `${h}h ${m}m`
  return `${m} min`
}

export function fmtDist(m, lang = 'en') {
  if (lang === 'te') {
    if (m < 1000) return `${Math.round(m)}మీ`
    return `${(m / 1000).toFixed(1)}కి.మీ`
  }
  if (m < 1000) return `${Math.round(m)}m`
  return `${(m / 1000).toFixed(1)}km`
}

export function fmtCost(inr) {
  return `₹${Math.round(inr)}`
}
