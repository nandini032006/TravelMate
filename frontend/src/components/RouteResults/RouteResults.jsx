import { motion } from 'framer-motion'
import { getMeta }   from '../../utils/modeColors'
import { useLang }   from '../../contexts/LanguageContext'
import { RouteCard } from './RouteCard'
import './RouteResults.css'

function _mins(sec) {
  const m = Math.round(sec / 60)
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)}h ${m % 60}m`
}
function _dist(m) {
  return m >= 1000 ? `${(m / 1000).toFixed(1)}km` : `${Math.round(m)}m`
}
function _modeName(route) {
  const meta = getMeta(route.primary_mode)
  const firstTransit = (route.steps || []).find(s => s.mode !== 'walk' && s.mode !== 'auto')
  const line = firstTransit?.line_name
  return line ? `${meta.label} ${line}` : meta.label
}

/* ── Route helpers ────────────────────────────────────────────────────────── */

const MODE_META = {
  bus:   { icon: '🚌', label: 'Bus',   color: '#f97316', bg: 'rgba(249,115,22,0.10)', border: '#fdd5bb' },
  metro: { icon: '🚇', label: 'Metro', color: '#3b82f6', bg: 'rgba(59,130,246,0.10)',  border: '#bfdbfe' },
  mmts:  { icon: '🚆', label: 'MMTS',  color: '#d97706', bg: 'rgba(217,119,6,0.10)',   border: '#fde68a' },
}

/* Minimum freq_mins across transit steps — lower = more frequent */
function routeFreq(route) {
  const freqs = (route.steps || [])
    .filter(s => s.mode !== 'walk' && s.mode !== 'auto')
    .map(s => s.freq_mins)
    .filter(f => f > 0)
  return freqs.length ? Math.min(...freqs) : 999
}

/* All bus routes from raw data, sorted: most frequent first, then fastest
   The router returns bus routes under the key "rtc" (not "bus") */
function getAllBusRoutes(rawRoutes) {
  const buses = rawRoutes?.rtc?.all || []
  return [...buses].sort((a, b) => {
    const fd = routeFreq(a) - routeFreq(b)
    if (fd !== 0) return fd
    return a.total_duration_sec - b.total_duration_sec
  })
}

/* Single best route for metro / mmts from strategies */
function getBestSingleRoute(strategies, mode) {
  const seen = new Set()
  let best = null
  for (const s of (strategies || [])) {
    for (const r of (s.routes || [])) {
      if (r.primary_mode !== mode) continue
      const key = `${r.total_duration_sec}:${r.total_cost_inr}`
      if (seen.has(key)) continue
      seen.add(key)
      if (!best || r.total_duration_sec < best.total_duration_sec) best = r
    }
  }
  return best
}

/* ── Comparison bar ───────────────────────────────────────────────────────── */

function ComparisonBar({ comparison }) {
  if (!comparison || comparison.totalRoutes < 2) return null

  const { fastest, cheapest, safest, leastWalking, leastCrowded, ecoFriendly, mostReliable } = comparison
  const rows = [
    fastest      && { icon: '⚡', cat: 'Fastest',   mode: _modeName(fastest),      val: _mins(fastest.total_duration_sec) },
    cheapest     && { icon: '💰', cat: 'Cheapest',  mode: _modeName(cheapest),     val: `₹${Math.round(cheapest.total_cost_inr)}` },
    safest       && { icon: '🛡', cat: 'Safest',    mode: _modeName(safest),       val: 'Lowest risk' },
    leastCrowded && { icon: '😌', cat: 'Quietest',  mode: _modeName(leastCrowded), val: 'Low crowd' },
    ecoFriendly  && { icon: '🌿', cat: 'Eco',       mode: _modeName(ecoFriendly),  val: ecoFriendly.primary_mode === 'metro' ? 'Zero emission' : 'Low emission' },
    mostReliable && { icon: '🎯', cat: 'Reliable',  mode: _modeName(mostReliable), val: 'Consistent' },
    leastWalking && { icon: '🚶', cat: 'Min Walk',  mode: _modeName(leastWalking), val: _dist(leastWalking.walking_distance_m) },
  ].filter(Boolean).slice(0, 6)

  return (
    <motion.div
      className="rcb"
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
    >
      <div className="rcb__head">
        <span className="rcb__title">Route Comparison</span>
        <span className="rcb__count">{comparison.totalRoutes} routes found</span>
      </div>
      <div className="rcb__rows">
        {rows.map((row) => (
          <div key={row.cat} className="rcb__row">
            <div className="rcb__row-cat">
              <span className="rcb__row-icon">{row.icon}</span>
              <span className="rcb__row-label">{row.cat}</span>
            </div>
            <span className="rcb__row-mode">{row.mode}</span>
            <span className="rcb__row-val">{row.val}</span>
          </div>
        ))}
      </div>
    </motion.div>
  )
}

/* ── Main export ──────────────────────────────────────────────────────────── */

export function RouteResults({
  strategies, rawRoutes, comparison, loading, error,
  onSelectRoute, onHoverRoute, onViewDetails, selectedRoute, liveConditions,
}) {
  const { t } = useLang()

  if (loading) {
    return (
      <div className="rr rr--loading" role="status" aria-live="polite" aria-busy="true">
        <div className="rr__spinner" aria-hidden="true" />
        <p>{t.findingBest}</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="rr rr--error" role="alert" aria-live="assertive">
        <span className="rr__error-icon" aria-hidden="true">⚠</span>
        <p>{error}</p>
      </div>
    )
  }

  if (!strategies) return null

  const hasAny = strategies.some(s => s.routes?.length > 0)
  if (!hasAny) {
    return (
      <div className="rr rr--empty" role="status">
        <span aria-hidden="true">🔍</span>
        <p>{t.noRoutes}</p>
      </div>
    )
  }

  const busRoutes  = getAllBusRoutes(rawRoutes)
  const metroRoute = getBestSingleRoute(strategies, 'metro')
  const mmtsRoute  = getBestSingleRoute(strategies, 'mmts')

  /* Sections in order: bus (all), metro (best), mmts (best) */
  const sections = [
    { mode: 'bus',   routes: busRoutes,                   multi: true  },
    { mode: 'metro', routes: metroRoute ? [metroRoute] : [], multi: false },
    { mode: 'mmts',  routes: mmtsRoute  ? [mmtsRoute]  : [], multi: false },
  ]

  return (
    <div className="rr" aria-live="polite" aria-label="Route options">
      <ComparisonBar comparison={comparison} />

      <div className="rr__mode-list">
        {sections.map(({ mode, routes, multi }, si) => {
          const mm = MODE_META[mode]
          const hasRoutes = routes.length > 0
          return (
            <motion.div
              key={mode}
              className="rr__mode-section"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.22, delay: si * 0.06 }}
            >
              {/* Mode header */}
              <div className="rr__mode-header">
                <span className="rr__mode-icon" style={{ background: mm.bg, color: mm.color, borderColor: mm.border }}>
                  {mm.icon}
                </span>
                <span className="rr__mode-label" style={{ color: mm.color }}>{mm.label}</span>
                {hasRoutes
                  ? <span className="rr__mode-avail">
                      {multi && routes.length > 1 ? `${routes.length} routes` : 'Available'}
                    </span>
                  : <span className="rr__mode-unavail">Not available</span>
                }
              </div>

              {/* Route cards */}
              {hasRoutes ? (
                <div className="rr__mode-cards">
                  {routes.map((route, ri) => (
                    <RouteCard
                      key={`${mode}-${ri}`}
                      route={route}
                      selected={selectedRoute === route}
                      dimmed={false}
                      index={ri}
                      accentColor={mm.color}
                      onSelect={onSelectRoute}
                      onHover={onHoverRoute}
                      onViewDetails={onViewDetails}
                      liveConditions={liveConditions}
                    />
                  ))}
                </div>
              ) : (
                <div className="rr__unavailable">
                  No {mm.label} routes found for this journey
                </div>
              )}
            </motion.div>
          )
        })}
      </div>
    </div>
  )
}
