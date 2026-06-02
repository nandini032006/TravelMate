import { useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { fmtDuration, fmtCost } from '../../utils/formatters'
import {
  safetyScoreMeta,
  computeLiveAdjustedScore,
} from '../../utils/routeSafety'
import {
  computeTrafficRisk, computeWeatherRisk, computeInfraRisk,
  computeNightRisk, aggregateSafetyScore,
  computeDynamicCrowd, crowdMeta,
  generateDynamicInsights, bestTimeAdvice,
} from '../../utils/dynamicRisk'
import {
  corridorTypeMeta, characteristicMeta,
} from '../../utils/routeAnalysis'
import { computeMobilityScore, mobilityScoreMeta } from '../../utils/mobilityScore'
import { computeFirstLastMile } from '../../utils/firstLastMile'
import { getRouteZoneProfiles } from '../../utils/zonePeakProfiles'
import { useLang } from '../../contexts/LanguageContext'
import { translateStopName } from '../../translations/stationNames'
import './AnalysisPanel.css'

const PANEL_VARIANTS = {
  hidden:  { opacity: 0, x: 32 },
  visible: { opacity: 1, x: 0,  transition: { duration: 0.28, ease: [0.25, 0.46, 0.45, 0.94] } },
  exit:    { opacity: 0, x: 24, transition: { duration: 0.18 } },
}

const ITEM_VARIANTS = {
  hidden:  { opacity: 0, y: 10 },
  visible: (i) => ({ opacity: 1, y: 0, transition: { delay: i * 0.06, duration: 0.22 } }),
}

// ── Smart alerts ──────────────────────────────────────────────────────────────
function SmartAlertsSection({ alerts }) {
  if (!alerts?.length) return null
  return (
    <motion.div className="ap__section" variants={ITEM_VARIANTS} custom={0.5}>
      <div className="ap__section-title"><span>⚡</span> Smart Alerts</div>
      <div className="ap__alerts">
        {alerts.map((alert, i) => (
          <div key={i} className={`ap__alert ap__alert--${alert.level}`}>
            <span className="ap__alert-icon">{alert.icon}</span>
            <span className="ap__alert-text">{alert.text}</span>
          </div>
        ))}
      </div>
    </motion.div>
  )
}

// ── Traffic ───────────────────────────────────────────────────────────────────
function TrafficSection({ traffic, corridor }) {
  const tRisk = computeTrafficRisk(traffic, corridor)

  const colorMap = {
    '0':  { color: '#16a34a', bg: '#f0fdf4', border: '#bbf7d0' },
    '5':  { color: '#16a34a', bg: '#f0fdf4', border: '#bbf7d0' },
    '15': { color: '#d97706', bg: '#fef9c3', border: '#fde68a' },
    '26': { color: '#ea580c', bg: '#fff7ed', border: '#fed7aa' },
    '35': { color: '#dc2626', bg: '#fff1f2', border: '#fecaca' },
  }
  const c = colorMap[String(tRisk.score)] || colorMap['15']

  return (
    <motion.div className="ap__section" variants={ITEM_VARIANTS} custom={1}>
      <div className="ap__section-title"><span>🚦</span> Live Traffic</div>

      <div className="ap__traffic-chip"
        style={{ background: c.bg, borderColor: c.border, color: c.color }}>
        <span className="ap__traffic-dot"
          style={{ background: c.color }} />
        <span className="ap__traffic-label">{tRisk.label}</span>
        {tRisk.isEstimated && (
          <span className="ap__est-badge">est.</span>
        )}
      </div>

      {traffic && (traffic.avg_speed > 0 || traffic.delay_mins > 0) && (
        <div className="ap__traffic-meta">
          {traffic.avg_speed > 0 && (
            <span className="ap__traffic-stat">
              <span>🏎</span> {traffic.avg_speed} km/h avg
            </span>
          )}
          {traffic.delay_mins > 0 && (
            <span className="ap__traffic-stat ap__traffic-stat--warn">
              <span>⏱</span> +{traffic.delay_mins} min delay
            </span>
          )}
        </div>
      )}
    </motion.div>
  )
}

// ── Weather ───────────────────────────────────────────────────────────────────
function WeatherSection({ weather }) {
  if (!weather) return null
  return (
    <motion.div className="ap__section" variants={ITEM_VARIANTS} custom={2}>
      <div className="ap__section-title"><span>{weather.icon}</span> Weather Along Route</div>

      <div className="ap__weather-main">
        <span className="ap__weather-temp">{weather.temp_c}°C</span>
        <div className="ap__weather-right">
          <span className="ap__weather-desc">{weather.label}</span>
          {weather.feels_like != null && weather.feels_like !== weather.temp_c && (
            <span className="ap__weather-feels">Feels like {weather.feels_like}°C</span>
          )}
        </div>
      </div>

      {(weather.humidity != null || weather.wind_speed > 0 || weather.rain_1h > 0 || weather.temp_c >= 38) && (
        <div className="ap__weather-chips">
          {weather.humidity != null && (
            <span className="ap__weather-chip">💧 {weather.humidity}%</span>
          )}
          {weather.wind_speed > 0 && (
            <span className="ap__weather-chip">💨 {weather.wind_speed}km/h</span>
          )}
          {weather.rain_1h > 0 && (
            <span className="ap__weather-chip ap__weather-chip--rain">🌧 {weather.rain_1h}mm/h</span>
          )}
          {weather.rain_1h >= 10 && (
            <span className="ap__weather-chip ap__weather-chip--rain-heavy">🌦 ~80% est.</span>
          )}
          {weather.rain_1h >= 2 && weather.rain_1h < 10 && (
            <span className="ap__weather-chip ap__weather-chip--rain-moderate">🌦 ~50% est.</span>
          )}
          {weather.rain_1h > 0 && weather.rain_1h < 2 && (
            <span className="ap__weather-chip ap__weather-chip--rain-light">🌦 ~20% est.</span>
          )}
          {weather.label?.includes('Fog') && (
            <span className="ap__weather-chip ap__weather-chip--vis-low">👁 &lt; 1 km vis</span>
          )}
          {(weather.label?.includes('Mist') || weather.label?.includes('Haze')) && (
            <span className="ap__weather-chip ap__weather-chip--vis-moderate">👁 2–4 km vis</span>
          )}
          {weather.label?.includes('Clear') && (
            <span className="ap__weather-chip ap__weather-chip--vis-high">👁 &gt; 10 km vis</span>
          )}
          {weather.temp_c >= 38 && (
            <span className="ap__weather-chip ap__weather-chip--heat">🌡 Extreme heat</span>
          )}
        </div>
      )}

      {(() => {
        let impactMessage
        if (weather.rain_1h >= 10) {
          impactMessage = 'Heavy rain — reducing speed by 30–40%, avoid underpasses'
        } else if (weather.rain_1h >= 2) {
          impactMessage = 'Light rain — slight grip reduction, moderate caution'
        } else if (weather.temp_c >= 42) {
          impactMessage = 'Extreme heat — limit outdoor exposure, check tyre pressure'
        } else if (weather.temp_c >= 38) {
          impactMessage = 'Hot conditions — stay hydrated'
        } else if (weather.wind_speed > 40) {
          impactMessage = 'Strong winds — high-profile vehicles may be affected'
        } else if (weather.label?.includes('Fog') || weather.label?.includes('Mist')) {
          impactMessage = 'Low visibility — extra following distance needed'
        } else {
          impactMessage = 'Clear route conditions — ideal for travel'
        }
        const bg =
          weather.level === 'severe' ? 'rgba(220,38,38,0.07)' :
          weather.level === 'moderate' ? 'rgba(234,88,12,0.07)' :
          'rgba(22,163,74,0.07)'
        const borderColor =
          weather.level === 'severe' ? 'rgba(220,38,38,0.22)' :
          weather.level === 'moderate' ? 'rgba(234,88,12,0.22)' :
          'rgba(22,163,74,0.22)'
        const color =
          weather.level === 'severe' ? '#991b1b' :
          weather.level === 'moderate' ? '#92400e' :
          '#15803d'
        return (
          <div className="ap__weather-impact" style={{ background: bg, borderColor, color }}>
            <span className="ap__weather-impact-icon">✈️</span>
            <span>{impactMessage}</span>
          </div>
        )
      })()}

      {weather.penalty > 0 ? (
        <p className="ap__section-note ap__section-note--warn">
          {weather.level === 'severe'   ? '⚠ Severe weather — consider delaying travel' :
           weather.level === 'moderate' ? 'Weather adds risk — drive or walk carefully' :
                                          'Minor weather impact on this corridor'}
        </p>
      ) : (
        <p className="ap__section-note ap__section-note--ok">Clear conditions — good travel weather</p>
      )}
    </motion.div>
  )
}

// ── Air quality ───────────────────────────────────────────────────────────────
function AQISection({ aqi }) {
  if (!aqi) return null
  return (
    <motion.div className="ap__section" variants={ITEM_VARIANTS} custom={2.5}>
      <div className="ap__section-title"><span>🌬</span> Air Quality</div>

      <div className="ap__aqi-row">
        <div className="ap__aqi-score">
          <span className="ap__aqi-num" style={{ color: aqi.color }}>{aqi.value}</span>
          <div className="ap__aqi-right">
            <span className="ap__aqi-badge"
              style={{ background: aqi.bg, color: aqi.color, borderColor: aqi.border }}>
              {aqi.label}
            </span>
            <span className="ap__aqi-sub">PM2.5 · {aqi.pm25} μg/m³</span>
          </div>
        </div>
      </div>

      <div className="ap__aqi-bar-wrap">
        <div className="ap__aqi-bar">
          <motion.div
            className="ap__aqi-bar-fill"
            style={{ background: aqi.color }}
            initial={{ width: 0 }}
            animate={{ width: `${Math.min(100, (aqi.value / 300) * 100)}%` }}
            transition={{ duration: 0.7, ease: 'easeOut', delay: 0.15 }}
          />
        </div>
        <div className="ap__aqi-bar-labels">
          <span>Good</span><span>Moderate</span><span>Unhealthy</span>
        </div>
      </div>

      <p className="ap__section-note" style={{
        color: aqi.penalty >= 14 ? '#c2410c' : aqi.penalty >= 8 ? '#d97706' : '#16a34a'
      }}>
        {aqi.message}
      </p>
    </motion.div>
  )
}

// ── Safety score + corridor profile ───────────────────────────────────────────
function SafetySection({ safety, traffic, weather, aqi, infra, corridor }) {
  const hour     = new Date().getHours()
  const tRisk    = computeTrafficRisk(traffic, corridor)
  const wRisk    = computeWeatherRisk(weather, aqi)
  const iRisk    = computeInfraRisk(infra)
  const nRisk    = computeNightRisk(hour, infra)
  const dynScore = aggregateSafetyScore(tRisk, wRisk, iRisk, nRisk)
  const scoreMeta = safetyScoreMeta(dynScore)

  const breakdown = [
    tRisk.score > 0 && { label: 'Traffic',       score: tRisk.score, max: 35, color: '#f97316' },
    wRisk.score > 0 && { label: 'Weather',        score: wRisk.score, max: 22, color: '#3b82f6' },
    iRisk.score > 0 && { label: 'Road structure', score: iRisk.score, max: 22, color: '#8b5cf6' },
    nRisk.score > 0 && { label: 'Night driving',  score: nRisk.score, max: 18, color: '#6366f1' },
  ].filter(Boolean)

  const ctMeta = corridor ? corridorTypeMeta(corridor.corridorType) : null

  return (
    <motion.div className="ap__section" variants={ITEM_VARIANTS} custom={3}>
      <div className="ap__section-title"><span>🛡</span> Route Safety</div>

      {/* Score */}
      <div className="ap__score-row">
        <div className="ap__score-bar-wrap">
          <div className="ap__score-bar-track">
            <motion.div
              className="ap__score-bar-fill"
              style={{ background: scoreMeta.color }}
              initial={{ width: 0 }}
              animate={{ width: `${dynScore}%` }}
              transition={{ duration: 0.65, ease: 'easeOut', delay: 0.2 }}
            />
          </div>
        </div>
        <div className="ap__score-val" style={{ color: scoreMeta.color }}>
          <span className="ap__score-num">{dynScore}</span>
          <span className="ap__score-label" style={{ background: scoreMeta.bg, color: scoreMeta.color }}>
            {scoreMeta.label}
          </span>
        </div>
      </div>
      <div className="ap__score-legend">
        <span style={{ color: '#dc2626', fontSize: '9px', fontWeight: 700 }}>15 Heavy risk</span>
        <span style={{ color: '#16a34a', fontSize: '9px', fontWeight: 700 }}>92 Low risk</span>
      </div>

      {/* Risk breakdown bars */}
      {breakdown.length > 0 && (
        <div className="ap__risk-breakdown">
          {breakdown.map(b => (
            <div key={b.label} className="ap__risk-row">
              <span className="ap__risk-label">{b.label}</span>
              <div className="ap__risk-bar-wrap">
                <motion.div
                  className="ap__risk-bar-fill"
                  style={{ background: b.color }}
                  initial={{ width: 0 }}
                  animate={{ width: `${Math.min(100, (b.score / b.max) * 100)}%` }}
                  transition={{ duration: 0.5, ease: 'easeOut', delay: 0.3 }}
                />
              </div>
              <span className="ap__risk-score" style={{ color: b.color }}>−{b.score}</span>
            </div>
          ))}
        </div>
      )}

      {/* Corridor type + characteristics */}
      {corridor && (
        <div className="ap__corridor">
          {ctMeta && (
            <div className="ap__corridor-header">
              <span className="ap__corridor-badge"
                style={{ color: ctMeta.color, background: ctMeta.bg, borderColor: ctMeta.border }}>
                {ctMeta.icon} {ctMeta.label}
              </span>
              <div className="ap__corridor-metrics">
                <span>⚡ {corridor.avgSpeed} km/h avg</span>
                {corridor.transfers > 0 && <span>🔄 {corridor.transfers} transfer{corridor.transfers > 1 ? 's' : ''}</span>}
                {corridor.walkRatio > 0.1 && <span>🚶 {Math.round(corridor.walkRatio * 100)}% walk</span>}
              </div>
            </div>
          )}
          {corridor.characteristics.length > 0 && (
            <div className="ap__char-chips">
              {corridor.characteristics.slice(0, 5).map(k => {
                const m = characteristicMeta(k)
                return (
                  <span key={k} className="ap__char-chip">
                    {m.icon} {m.text}
                  </span>
                )
              })}
            </div>
          )}
        </div>
      )}

      {safety?.suggestion && (
        <div className="ap__tip"><span>💡</span><p>{safety.suggestion}</p></div>
      )}
    </motion.div>
  )
}

// ── Live conditions — crowd, timing, dynamic insights ─────────────────────────
function LiveConditionsSection({ safety, traffic, weather, aqi, infra, corridor }) {
  if (!safety && !infra && !traffic) return null

  const hour      = new Date().getHours()
  const tRisk     = computeTrafficRisk(traffic, corridor)
  const wRisk     = computeWeatherRisk(weather, aqi)
  const iRisk     = computeInfraRisk(infra)
  const nRisk     = computeNightRisk(hour, infra)
  const crowd     = computeDynamicCrowd(infra, traffic, hour, corridor)
  const crowdInf  = crowdMeta(crowd)
  const advice    = bestTimeAdvice(traffic, corridor)
  const insights  = generateDynamicInsights(tRisk, wRisk, iRisk, nRisk, traffic, infra, corridor)

  // Status pill from ratio
  const ratio = tRisk.avgRatio ?? 0.88
  let statusText, statusClass
  if (ratio < 0.40) {
    statusText = 'Severe congestion on route'; statusClass = 'ap__time-status--danger'
  } else if (ratio < 0.65) {
    statusText = 'Heavy congestion detected'; statusClass = 'ap__time-status--warn'
  } else if (ratio < 0.85) {
    statusText = 'Moderate traffic — delays likely'; statusClass = 'ap__time-status--moderate'
  } else {
    statusText = 'Traffic flowing freely'; statusClass = 'ap__time-status--ok'
  }

  const isLateNight = hour >= 23 || hour < 4

  return (
    <motion.div className="ap__section" variants={ITEM_VARIANTS} custom={4}>
      <div className="ap__section-title"><span>📡</span> Live Conditions</div>

      <div className={`ap__time-status ${statusClass}`}>
        <span className="ap__time-status-dot" />
        <span className="ap__time-status-text">{statusText}</span>
        {tRisk.isEstimated && <span className="ap__est-tag">estimated</span>}
      </div>

      {/* OSM infra chips */}
      {infra && (
        <div className="ap__infra-row">
          {infra.signalCount > 0 && (
            <span className="ap__infra-chip">🚥 {infra.signalCount} signals</span>
          )}
          {infra.transitCount > 0 && (
            <span className="ap__infra-chip">🚌 {infra.transitCount} stops</span>
          )}
          {infra.isHighwayHeavy && (
            <span className="ap__infra-chip ap__infra-chip--warn">🛣 Highway</span>
          )}
          {infra.isCommercialZone && (
            <span className="ap__infra-chip">🏪 Commercial zone</span>
          )}
        </div>
      )}

      {/* Late-night highway warning */}
      {isLateNight && infra?.isHighwayHeavy && (
        <div className="ap__time-window ap__time-window--night">
          <span className="ap__time-window-icon">🌙</span>
          <div className="ap__time-window-body">
            <div className="ap__time-window-label">Late-night highway exposure</div>
            <div className="ap__time-window-areas">High-speed segments — elevated accident risk at night</div>
          </div>
        </div>
      )}

      {/* Crowd level */}
      <div className="ap__crowd-row">
        <span className="ap__crowd-label">Activity level</span>
        <span className="ap__crowd-badge"
          style={{ color: crowdInf.color, background: crowdInf.bg, borderColor: crowdInf.border }}>
          {crowdInf.icon} {crowdInf.label}
        </span>
      </div>

      {/* Best time advice */}
      <div className="ap__time-best">
        <span>✅</span>
        <span>{advice}</span>
      </div>

      {/* Dynamic insights */}
      {insights.length > 0 && (
        <div className="ap__insights">
          <div className="ap__insights-title">Route insights</div>
          {insights.map((line, i) => (
            <div key={i} className="ap__insight-item">
              <span className="ap__insight-dot" />
              <span>{line}</span>
            </div>
          ))}
        </div>
      )}
    </motion.div>
  )
}

// ── Area Mobility Score ───────────────────────────────────────────────────────
function MobilityScoreSection({ route, traffic, aqi, weather, infra, safety, corridor }) {
  const { score, confidence, factors, positives } = useMemo(
    () => computeMobilityScore(route, traffic, aqi, weather, infra, safety, corridor),
    [route, traffic, aqi, weather, infra, safety, corridor],
  )
  const meta = mobilityScoreMeta(score)

  return (
    <motion.div className="ap__section" variants={ITEM_VARIANTS} custom={0.2}>
      <div className="ap__section-title"><span>🏙</span> Area Mobility Score</div>

      <div className="ap__ms-row">
        <div className="ap__ms-ring-wrap">
          <svg className="ap__ms-ring" viewBox="0 0 56 56">
            <circle cx="28" cy="28" r="22" fill="none" stroke="var(--border)" strokeWidth="5" />
            <motion.circle
              cx="28" cy="28" r="22" fill="none"
              stroke={meta.color} strokeWidth="5"
              strokeLinecap="round"
              strokeDasharray={`${2 * Math.PI * 22}`}
              strokeDashoffset={`${2 * Math.PI * 22 * (1 - score / 100)}`}
              transform="rotate(-90 28 28)"
              initial={{ strokeDashoffset: `${2 * Math.PI * 22}` }}
              animate={{ strokeDashoffset: `${2 * Math.PI * 22 * (1 - score / 100)}` }}
              transition={{ duration: 0.8, ease: 'easeOut', delay: 0.1 }}
            />
          </svg>
          <div className="ap__ms-ring-inner">
            <span className="ap__ms-score" style={{ color: meta.color }}>{score}</span>
          </div>
        </div>
        <div className="ap__ms-right">
          <span className="ap__ms-label" style={{ color: meta.color, background: meta.bg, borderColor: meta.border }}>
            {meta.label}
          </span>
          <div className="ap__ms-confidence">Confidence: {confidence}</div>
          {positives.map((p, i) => (
            <div key={i} className="ap__ms-positive"><span>✓</span><span>{p}</span></div>
          ))}
        </div>
      </div>

       {factors.length > 0 && (
         <div className="ap__ms-factors">
           {factors.map(f => (
             <div key={f.key} className="ap__ms-factor">
               <span className="ap__ms-factor-icon">{f.icon}</span>
               <span className="ap__ms-factor-label">{f.label}</span>
               <span className="ap__ms-factor-penalty">−{f.penalty}</span>
             </div>
           ))}
         </div>
       )}
    </motion.div>
  )
}

// ── Zone peak profiles ────────────────────────────────────────────────────────
function ZonePeakSection({ safety }) {
  const profiles = useMemo(() => getRouteZoneProfiles(safety?.matched), [safety])
  if (!profiles.length) return null

  return (
    <motion.div className="ap__section" variants={ITEM_VARIANTS} custom={3.5}>
      <div className="ap__section-title"><span>⏱</span> Area-Specific Peak Alerts</div>
      <div className="ap__zone-peaks">
        {profiles.map(({ area, profile }, i) => (
          <div key={i} className={`ap__zone-peak${profile.isCurrentlyPeak ? ' ap__zone-peak--active' : ''}`}>
            <div className="ap__zone-peak-head">
              <span className="ap__zone-peak-name">{area.name}</span>
              <span className="ap__zone-peak-type">{profile.label}</span>
            </div>
            {profile.isCurrentlyPeak && (
              <div className="ap__zone-peak-now">● Peak active now</div>
            )}
            <div className="ap__zone-peak-text">{profile.avoidText}</div>
            {profile.monsoonNote && (
              <div className="ap__zone-peak-monsoon">🌧 {profile.monsoonNote}</div>
            )}
          </div>
        ))}
      </div>
    </motion.div>
  )
}

// ── First & Last Mile ─────────────────────────────────────────────────────────
function FirstLastMileSection({ src, dst }) {
  const { first, last } = useMemo(() => computeFirstLastMile(src, dst), [src, dst])
  if (!first && !last) return null

  return (
    <motion.div className="ap__section" variants={ITEM_VARIANTS} custom={5.5}>
      <div className="ap__section-title"><span>🚇</span> First &amp; Last Mile</div>
      <div className="ap__mile-cards">
        {[first, last].filter(Boolean).map((m, i) => (
          <div key={i} className="ap__mile-card">
            <div className="ap__mile-tag">{m.tag}</div>
            <div className="ap__mile-main">
              <span className="ap__mile-icon">{m.icon}</span>
              <div className="ap__mile-info">
                <div className="ap__mile-name">{m.name}</div>
                <div className="ap__mile-line">{m.line}</div>
              </div>
            </div>
            <div className="ap__mile-stats">
              <span className="ap__mile-stat">🚶 {m.walkMin} min · {m.distKm} km</span>
              <span className="ap__mile-access">{m.access}</span>
            </div>
            {m.note && <div className="ap__mile-note">{m.note}</div>}
          </div>
        ))}
      </div>
    </motion.div>
  )
}

// ── Live data loading skeleton ────────────────────────────────────────────────
function LiveLoadingSkeleton() {
  return (
    <motion.div className="ap__section ap__skeleton-section" variants={ITEM_VARIANTS} custom={0.5}>
      <div className="ap__skeleton-title" />
      <div className="ap__skeleton-row" />
      <div className="ap__skeleton-row ap__skeleton-row--short" />
      <div className="ap__skeleton-chips">
        <div className="ap__skeleton-chip" />
        <div className="ap__skeleton-chip ap__skeleton-chip--md" />
        <div className="ap__skeleton-chip ap__skeleton-chip--sm" />
      </div>
    </motion.div>
  )
}

// ── Empty state ───────────────────────────────────────────────────────────────
function EmptyState() {
  return (
    <div className="ap__empty">
      <div className="ap__empty-icon">🗺</div>
      <h3 className="ap__empty-title">Route Insights</h3>
      <p className="ap__empty-sub">
        Search a route to see live traffic, weather, air quality, safety analysis, and smart alerts.
      </p>
      <div className="ap__empty-pills">
        <div className="ap__empty-pill"><span>🚦</span> Live traffic</div>
        <div className="ap__empty-pill"><span>🌤</span> Weather</div>
        <div className="ap__empty-pill"><span>🌬</span> Air quality</div>
        <div className="ap__empty-pill"><span>🛡</span> Route safety</div>
      </div>
    </div>
  )
}

// ── Route overview ────────────────────────────────────────────────────────────
function OverviewSection({ route, lang }) {
  const steps = route.steps || []
  const from  = steps[0]?.from_name || ''
  const to    = steps[steps.length - 1]?.to_name || ''
  const fromD = lang === 'te' ? translateStopName(from) : from
  const toD   = lang === 'te' ? translateStopName(to)   : to

  return (
    <motion.div className="ap__overview" variants={ITEM_VARIANTS} custom={0}>
      <div className="ap__overview-route">
        <div className="ap__overview-stop">
          <span className="ap__overview-dot ap__overview-dot--from" />
          <span className="ap__overview-name">{fromD || 'Start'}</span>
        </div>
        <div className="ap__overview-line" />
        <div className="ap__overview-stop">
          <span className="ap__overview-dot ap__overview-dot--to" />
          <span className="ap__overview-name">{toD || 'End'}</span>
        </div>
      </div>
      <div className="ap__overview-stats">
        <div className="ap__overview-stat">
          <span className="ap__overview-stat-icon">⏱</span>
          <span className="ap__overview-stat-val">{fmtDuration(route.total_duration_sec, lang)}</span>
        </div>
        <div className="ap__overview-stat">
          <span className="ap__overview-stat-icon">💰</span>
          <span className="ap__overview-stat-val">{fmtCost(route.total_cost_inr)}</span>
        </div>
        {route.transfers > 0 && (
          <div className="ap__overview-stat">
            <span className="ap__overview-stat-icon">🔄</span>
            <span className="ap__overview-stat-val">{route.transfers} transfer{route.transfers > 1 ? 's' : ''}</span>
          </div>
        )}
      </div>
    </motion.div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export function AnalysisPanel({ selectedRoute, safety, traffic, weather, aqi, infra, corridor, liveLoading, alerts, src, dst }) {
  const { lang } = useLang()

  return (
    <aside className="ap" aria-label="Route analysis">
      <div className="ap__header">
        <h2 className="ap__header-title">Route Insights</h2>
        {selectedRoute && liveLoading && (
          <span className="ap__loading-chip">
            <span className="ap__loading-dot" />
            Updating…
          </span>
        )}
        {selectedRoute && !liveLoading && (traffic || weather || aqi) && (
          <span className="ap__live-chip">
            <span className="ap__live-dot" />
            Live
          </span>
        )}
      </div>

      <div className="ap__body">
        <AnimatePresence mode="wait">
          {!selectedRoute ? (
            <motion.div
              key="empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <EmptyState />
            </motion.div>
          ) : (
             <motion.div
               key={selectedRoute?.total_duration_sec + selectedRoute?.total_cost_inr}
               variants={PANEL_VARIANTS}
               initial="hidden"
               animate="visible"
               exit="exit"
               className="ap__sections"
             >
               <OverviewSection        route={selectedRoute} lang={lang} />
               <MobilityScoreSection  route={selectedRoute} traffic={traffic} aqi={aqi} weather={weather} infra={infra} safety={safety} corridor={corridor} />
               <SmartAlertsSection    alerts={alerts} />
               {liveLoading && !traffic && !weather && !aqi
                 ? <LiveLoadingSkeleton />
                 : <>
                     <WeatherSection        weather={weather} />
                     <TrafficSection        traffic={traffic} corridor={corridor} />
                     <AQISection            aqi={aqi} />
                   </>
               }
               <SafetySection         safety={safety} traffic={traffic} weather={weather} aqi={aqi} infra={infra} corridor={corridor} />
               <LiveConditionsSection safety={safety} traffic={traffic} weather={weather} aqi={aqi} infra={infra} corridor={corridor} />
               <ZonePeakSection       safety={safety} />
               <FirstLastMileSection  src={src} dst={dst} />
             </motion.div>
          )}
        </AnimatePresence>
      </div>
    </aside>
  )
}
