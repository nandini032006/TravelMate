import { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import { motion }           from 'framer-motion'
import L                    from 'leaflet'
import { MapLayerControl }  from '../MapView/MapLayerControl'
import { fetchOsrmRoute, sampleWaypoints } from '../../utils/osrm'
import { getMeta }          from '../../utils/modeColors'
import { fmtDuration, fmtDist, fmtCost } from '../../utils/formatters'
import { computeCrowdScore, crowdMeta, fmtETA } from '../../utils/routeComparison'
import { useLang }          from '../../contexts/LanguageContext'
import { translateStopName, translateStopNameBilingual } from '../../translations/stationNames'
import {
  analyzeRouteSafety,
  safetyScoreMeta,
  computeLiveAdjustedScore,
} from '../../utils/routeSafety'
import { analyzeRouteCorridor, corridorTypeMeta, characteristicMeta } from '../../utils/routeAnalysis'
import { RouteStep } from './RouteStep'
import './RouteCard.css'

const TILE_URLS = {
  standard: {
    url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
    options: { subdomains: 'abcd', maxZoom: 19, attribution: '&copy; OSM &copy; CARTO' },
  },
  satellite: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    options: { maxZoom: 18, attribution: 'Tiles &copy; Esri' },
  },
  transit: {
    url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
    options: { subdomains: 'abcd', maxZoom: 19, attribution: '&copy; OSM &copy; CARTO' },
  },
}

const MODE_ICONS = { bus: '🚌', metro: '🚇', mmts: '🚆', walk: '🚶', auto: '🛺' }

const SVC_COLORS = {
  high:   { bg: 'rgba(34,197,94,0.12)',   color: '#22c55e', label: '🔥 Very Frequent' },
  medium: { bg: 'rgba(245,158,11,0.12)',  color: '#f59e0b', label: '🕐 Moderate' },
  low:    { bg: 'rgba(239,68,68,0.12)',   color: '#ef4444', label: '⚠ Low Frequency' },
}

const TAG_STYLES = {
  fastest:          { bg: 'rgba(59,130,246,0.15)',  color: '#3b82f6', label: '⚡ Fastest'       },
  cheapest:         { bg: 'rgba(34,197,94,0.15)',   color: '#22c55e', label: '💰 Cheapest'      },
  safest:           { bg: 'rgba(16,185,129,0.15)',  color: '#059669', label: '🛡 Safest'         },
  least_walking:    { bg: 'rgba(168,85,247,0.15)',  color: '#7c3aed', label: '🚶 Min Walking'   },
  least_crowded:    { bg: 'rgba(14,165,233,0.15)',  color: '#0284c7', label: '😌 Least Crowded' },
  eco_friendly:     { bg: 'rgba(22,163,74,0.15)',   color: '#16a34a', label: '🌿 Eco-Friendly'  },
  most_reliable:    { bg: 'rgba(245,158,11,0.15)',  color: '#b45309', label: '🎯 Most Reliable' },
  fewest_transfers: { bg: 'rgba(124,58,237,0.15)',  color: '#6d28d9', label: '🔄 Direct Route'  },
}

function getJourneyEndpoints(route) {
  const steps = route.steps || []
  return {
    from: steps[0]?.from_name              || '',
    to:   steps[steps.length - 1]?.to_name || '',
  }
}

function getBusLines(route) {
  return (route.steps || [])
    .filter(s => s.mode === 'bus' && s.line_name)
    .map(s => s.line_name)
}

function getKeyStops(route) {
  const transit = (route.steps || []).filter(s => s.mode !== 'walk' && s.mode !== 'auto')
  if (!transit.length) return []
  const stops  = [transit[0].from_name, ...transit.map(s => s.to_name)]
  const unique = [...new Set(stops)]
  if (unique.length <= 4) return unique
  return [unique[0], unique[1], '…', unique[unique.length - 2], unique[unique.length - 1]]
}

function buildRouteCoords(route) {
  const coords = []
  for (const step of route.steps || []) {
    if (step.from_coord?.lat && step.from_coord?.lon)
      coords.push([step.from_coord.lat, step.from_coord.lon])
    if (step.polyline?.length) {
      for (const pt of step.polyline)
        if (pt?.lat && pt?.lon) coords.push([pt.lat, pt.lon])
    }
    if (step.to_coord?.lat && step.to_coord?.lon)
      coords.push([step.to_coord.lat, step.to_coord.lon])
  }
  return coords
}

/* ── Step coords helper ───────────────────────────────────────────────────── */

function stepPts(step) {
  const pts = []
  if (step.from_coord?.lat) pts.push([step.from_coord.lat, step.from_coord.lon])
  if (step.polyline?.length) {
    for (const p of step.polyline) if (p.lat && p.lon) pts.push([p.lat, p.lon])
  }
  if (step.to_coord?.lat) pts.push([step.to_coord.lat, step.to_coord.lon])
  // deduplicate consecutive identical points
  return pts.filter((p, i, a) => i === 0 || p[0] !== a[i-1][0] || p[1] !== a[i-1][1])
}

const STEP_COLORS = { bus: '#f97316', metro: '#3b82f6', mmts: '#d97706', walk: '#94a3b8', auto: '#6366f1' }

/* ── Inline route map ─────────────────────────────────────────────────────── */

function RouteMapView({ route, accentColor }) {
  const containerRef  = useRef(null)
  const mapRef        = useRef(null)
  const tileRef       = useRef(null)
  const routeLayerRef = useRef(null)

  const steps = route.steps || []

  const [baseTile,   setBaseTile]   = useState(() => {
    try { return sessionStorage.getItem('tm_maptile') || 'standard' } catch { return 'standard' }
  })
  // null per step = use stop-coord fallback; array = OSRM road geometry
  const [stepGeoms, setStepGeoms] = useState(() => steps.map(() => null))

  const handleBaseTileChange = useCallback((key) => {
    setBaseTile(key)
    try { sessionStorage.setItem('tm_maptile', key) } catch {}
  }, [])

  // ── Map init ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (mapRef.current || !containerRef.current) return
    const map = L.map(containerRef.current, {
      zoomControl: true, scrollWheelZoom: false, dragging: true, tap: false,
    })
    mapRef.current = map
    return () => { map.remove(); mapRef.current = null }
  }, [])

  // ── Tile swap ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current; if (!map) return
    if (tileRef.current) tileRef.current.remove()
    const cfg = TILE_URLS[baseTile] || TILE_URLS.standard
    tileRef.current = L.tileLayer(cfg.url, cfg.options).addTo(map)
  }, [baseTile])

  // ── Draw all steps (runs on mount and whenever OSRM geometry arrives) ──────
  useEffect(() => {
    const map = mapRef.current; if (!map) return
    if (routeLayerRef.current) routeLayerRef.current.remove()

    const group  = L.layerGroup()
    const allPts = []

    for (const [i, step] of steps.entries()) {
      const pts = stepGeoms[i] || stepPts(step)
      if (pts.length < 2) continue
      allPts.push(...pts)

      const isWalk  = step.mode === 'walk' || step.mode === 'auto'
      const color   = STEP_COLORS[step.mode] || accentColor
      L.polyline(pts, {
        color,
        weight:    isWalk ? 2.5 : 4.5,
        opacity:   isWalk ? 0.65 : 0.9,
        dashArray: isWalk ? '6 5' : null,
        lineCap:   'round',
        lineJoin:  'round',
      }).addTo(group)
    }

    if (allPts.length >= 2) {
      L.circleMarker(allPts[0], {
        radius: 8, weight: 2.5, color: '#fff', fillColor: '#16a34a', fillOpacity: 1,
      }).bindTooltip('Start').addTo(group)
      L.circleMarker(allPts[allPts.length - 1], {
        radius: 8, weight: 2.5, color: '#fff', fillColor: '#dc2626', fillOpacity: 1,
      }).bindTooltip('End').addTo(group)
    }

    // Transit stop dots
    for (const step of steps) {
      if (step.mode === 'walk' || step.mode === 'auto') continue
      if (step.from_coord?.lat) {
        L.circleMarker([step.from_coord.lat, step.from_coord.lon], {
          radius: 4, weight: 1.5,
          color: STEP_COLORS[step.mode] || accentColor, fillColor: '#fff', fillOpacity: 1,
        }).bindTooltip(step.from_name || '', { sticky: true }).addTo(group)
      }
    }

    group.addTo(map)
    routeLayerRef.current = group

    if (allPts.length > 1) {
      map.fitBounds(L.latLngBounds(allPts), { padding: [28, 28] })
    }
  }, [stepGeoms]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Fetch OSRM road geometry for bus/auto steps ────────────────────────────
  useEffect(() => {
    if (!steps.length) return
    let cancelled = false

    Promise.all(
      steps.map(async (step, i) => {
        if (step.mode === 'metro' || step.mode === 'mmts' || step.mode === 'walk') return { i, geom: null }
        const pts = stepPts(step)
        if (pts.length < 2) return { i, geom: null }
        const geom = await fetchOsrmRoute(sampleWaypoints(pts, 8))
        return { i, geom }
      })
    ).then(results => {
      if (cancelled) return
      if (!results.some(r => r.geom)) return
      setStepGeoms(prev => {
        const next = [...prev]
        for (const { i, geom } of results) if (geom) next[i] = geom
        return next
      })
    })

    return () => { cancelled = true }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={{ position: 'relative' }}>
      <div ref={containerRef} className="rc__inline-map" />
      <MapLayerControl
        layers={{}}
        onChange={() => {}}
        baseTile={baseTile}
        onBaseTileChange={handleBaseTileChange}
        showOverlays={false}
      />
    </div>
  )
}

/* ── Live conditions bar ─────────────────────────────────────────────────── */

function LiveBar({ liveConditions }) {
  if (!liveConditions) return null
  const { traffic, weather, aqi, loading } = liveConditions
  const hasData = traffic || weather || aqi

  if (loading && !hasData) {
    return (
      <div className="rc__live rc__live--loading">
        <span className="rc__live-dot" />
        <span className="rc__live-label">Live</span>
        <span className="rc__live-fetching">fetching…</span>
      </div>
    )
  }

  if (!hasData) return null

  return (
    <div className="rc__live">
      <span className="rc__live-dot" />
      <span className="rc__live-label">Live</span>
      {traffic && (
        <span className={`rc__live-chip rc__live-chip--${traffic.level}`}>
          {traffic.icon} {traffic.label}
          {traffic.delay_mins > 0 && ` +${traffic.delay_mins}m`}
        </span>
      )}
      {weather && weather.level !== 'clear' && (
        <span className="rc__live-chip">
          {weather.icon} {weather.label}
          {weather.temp_c != null && ` · ${weather.temp_c}°`}
        </span>
      )}
      {weather && weather.level === 'clear' && (
        <span className="rc__live-chip rc__live-chip--clear">
          {weather.icon} {weather.temp_c}°C
        </span>
      )}
      {aqi && (
        <span className="rc__live-chip" style={{ color: aqi.color, borderColor: aqi.color + '44', background: aqi.color + '15' }}>
          💨 AQI {aqi.value} · {aqi.label}
        </span>
      )}
    </div>
  )
}

/* ── Safety panel ─────────────────────────────────────────────────────────── */

function SafetyPanel({ route, safety, adjustedScore }) {
  const displayScore = adjustedScore !== null ? adjustedScore : (safety?.score ?? null)
  const scoreMeta    = displayScore !== null ? safetyScoreMeta(displayScore) : null
  const corridor     = useMemo(() => analyzeRouteCorridor(route, null), [route])
  const ctMeta       = corridor ? corridorTypeMeta(corridor.corridorType) : null

  if (!scoreMeta) return null

  return (
    <div className="rc__safety" style={{ borderColor: scoreMeta.border, background: scoreMeta.bg }}>
      <div className="rc__safety-header">
        <span className="rc__safety-title">🛡 Route Safety</span>
        <div className="rc__safety-score" style={{ color: scoreMeta.color }}>
          <span className="rc__safety-score-num">{displayScore}</span>
          <span className="rc__safety-score-sep">/100</span>
          <span className="rc__safety-score-label"
            style={{ background: scoreMeta.border, color: scoreMeta.color }}>
            {scoreMeta.label}
          </span>
        </div>
      </div>

      {ctMeta && (
        <div className="rc__corridor-row">
          <span className="rc__corridor-badge"
            style={{ color: ctMeta.color, background: ctMeta.bg, borderColor: ctMeta.border }}>
            {ctMeta.icon} {ctMeta.label}
          </span>
          {corridor.characteristics.length > 0 && (
            <div className="rc__char-chips">
              {corridor.characteristics.slice(0, 3).map(k => {
                const m = characteristicMeta(k)
                return <span key={k} className="rc__char-chip">{m.icon} {m.text}</span>
              })}
            </div>
          )}
        </div>
      )}

      {corridor && (corridor.avgSpeed > 0 || corridor.transfers > 0) && (
        <div className="rc__corridor-metrics">
          <span>⚡ {corridor.avgSpeed} km/h avg</span>
          {corridor.transfers > 0 && (
            <span>🔄 {corridor.transfers} transfer{corridor.transfers > 1 ? 's' : ''}</span>
          )}
        </div>
      )}

      {safety?.suggestion && (
        <div className="rc__safety-tip">
          <span aria-hidden="true">💡</span> {safety.suggestion}
        </div>
      )}
    </div>
  )
}

/* ── Main card ────────────────────────────────────────────────────────────── */

export function RouteCard({
  route, selected, dimmed, index = 0,
  accentColor,
  onSelect, onHover, onViewDetails, liveConditions,
}) {
  const [stepsOpen,  setStepsOpen]  = useState(false)
  const [safetyOpen, setSafetyOpen] = useState(false)
  const [showMap,    setShowMap]    = useState(false)
  const { t, lang } = useLang()

  const safety = useMemo(() => analyzeRouteSafety(route), [route])

  const primaryMode = route.primary_mode || 'bus'
  const meta        = getMeta(primaryMode)
  const modeIcon    = MODE_ICONS[primaryMode] || meta.icon
  const modeLabel   = t[primaryMode] || meta.label

  const { from, to } = getJourneyEndpoints(route)
  const fromDisplay  = lang === 'te' ? translateStopName(from) : from
  const toDisplay    = lang === 'te' ? translateStopName(to)   : to

  const busLines = primaryMode === 'bus' ? getBusLines(route) : []
  const keyStops = getKeyStops(route)

  const firstTransit = (route.steps || []).find(s => s.mode !== 'walk' && s.mode !== 'auto')
  const lineLabel    = primaryMode !== 'bus' ? (firstTransit?.line_name || '') : ''

  const busStep  = (route.steps || []).find(s => s.mode === 'bus')
  const svcLevel = busStep?.service_level || null
  const svcMeta  = svcLevel ? (SVC_COLORS[svcLevel] || SVC_COLORS.medium) : null
  const freqMins = busStep?.freq_mins || 0

  const tags          = route.tags || []
  const isRecommended = (route.commuter_score ?? 0) >= 75

  /* Use the passed accentColor when available, fall back to mode defaults */
  const borderColor = accentColor
    || (primaryMode === 'bus'   ? '#f97316'
       : primaryMode === 'metro' ? '#3b82f6'
       : primaryMode === 'mmts'  ? '#d97706'
       : meta.color)

  const crowdScore = useMemo(
    () => computeCrowdScore(route, liveConditions?.traffic),
    [route, liveConditions?.traffic],
  )
  const crowdM = crowdMeta(crowdScore)
  const eta    = fmtETA(route.total_duration_sec)

  const safetyScore   = safety?.score ?? null
  const adjustedScore = computeLiveAdjustedScore(
    safetyScore, liveConditions?.traffic, liveConditions?.weather,
  )
  const displayScore  = adjustedScore !== null ? adjustedScore : safetyScore
  const safetyMeta    = displayScore !== null ? safetyScoreMeta(displayScore) : null
  const hasActiveRisk = safety?.matched?.some(a => a.isActive)

  /* Whether this route has drawable coordinates */
  const hasCoords = buildRouteCoords(route).length >= 2

  function toggleCard(e) {
    e.stopPropagation()
    onSelect(route)
    setStepsOpen(v => !v)
  }

  function toggleSafety(e) {
    e.stopPropagation()
    setSafetyOpen(v => !v)
    if (!selected) onSelect(route)
  }

  function toggleMap(e) {
    e.stopPropagation()
    setShowMap(v => !v)
  }

  const cardLabel = `${modeLabel} route: ${fmtDuration(route.total_duration_sec, lang)}, ${fmtCost(route.total_cost_inr)}, ${route.transfers || 0} transfers`

  return (
    <motion.div
      className={`rc${selected ? ' rc--selected' : ''}`}
      style={{ '--rc-accent': borderColor }}
      onClick={toggleCard}
      onMouseEnter={() => onHover?.(route)}
      onMouseLeave={() => onHover?.(null)}
      role="article"
      aria-label={cardLabel}
      initial={{ opacity: 0, y: 8 }}
      animate={{
        opacity: dimmed ? 0.45 : 1,
        y: 0,
        scale: selected ? 1.005 : 1,
        filter: dimmed ? 'saturate(0.6)' : 'saturate(1)',
      }}
      transition={{ duration: 0.22, ease: [0.25, 0.46, 0.45, 0.94], delay: index * 0.04 }}
      whileHover={!selected ? { opacity: dimmed ? 0.75 : 1, scale: 1.005, filter: 'saturate(1)' } : {}}
    >
      {/* ── Badges ── */}
      {(isRecommended || tags.length > 0) && (
        <div className="rc__badges">
          {isRecommended && (
            <span className="rc__badge rc__badge--rec">★ {t.recommended || 'Recommended'}</span>
          )}
          {tags.map(tag => TAG_STYLES[tag] && (
            <span key={tag} className="rc__badge"
              style={{ background: TAG_STYLES[tag].bg, color: TAG_STYLES[tag].color }}>
              {TAG_STYLES[tag].label || t[tag] || tag}
            </span>
          ))}
        </div>
      )}

      {/* ── Mode header ── */}
      <div className="rc__mode-header">
        <span className="rc__mode-icon">{modeIcon}</span>
        <span className="rc__mode-label">{modeLabel}</span>
        {lineLabel && (
          <span className="rc__line-badge" style={{ background: meta.bg, color: meta.color }}>
            {lineLabel}
          </span>
        )}
      </div>

      {/* ── Bus lines ── */}
      {busLines.length > 0 && (
        <div className="rc__bus-lines">
          {busLines.map((line, i) => (
            <span key={i} className="rc__bus-chip">
              {line}
              {i < busLines.length - 1 && <span className="rc__bus-arrow">›</span>}
            </span>
          ))}
        </div>
      )}

      {/* ── Endpoints ── */}
      {fromDisplay && toDisplay && (
        <div className="rc__route">
          <span className="rc__origin">{fromDisplay}</span>
          <span className="rc__arrow">→</span>
          <span className="rc__dest">{toDisplay}</span>
        </div>
      )}

      {/* ── Stats row ── */}
      <div className="rc__stats">
        <div className="rc__stat">
          <span className="rc__stat-icon">⏱</span>
          <span className="rc__stat-val">{fmtDuration(route.total_duration_sec, lang)}</span>
        </div>
        <div className="rc__stat-div" />
        <div className="rc__stat">
          <span className="rc__stat-icon">💰</span>
          <span className="rc__stat-val">{fmtCost(route.total_cost_inr)}</span>
        </div>
        <div className="rc__stat-div" />
        <div className="rc__stat">
          <span className="rc__stat-icon">🚶</span>
          <span className="rc__stat-val">{fmtDist(route.walking_distance_m, lang)}</span>
        </div>
        <div className="rc__stat-div" />
        <div className="rc__stat">
          <span className="rc__stat-icon">🔄</span>
          <span className="rc__stat-val">{route.transfers ?? 0}</span>
        </div>
        {safetyMeta && (
          <>
            <div className="rc__stat-div" />
            <div className="rc__stat">
              <span className="rc__stat-icon">🛡</span>
              <span className="rc__stat-val" style={{ color: safetyMeta.color, fontWeight: 700 }}>
                {displayScore}
                {hasActiveRisk && <span className="rc__safety-pip" aria-label="active risk" />}
              </span>
            </div>
          </>
        )}
      </div>

      {/* ── ETA + crowd + delay row ── */}
      <div className="rc__meta-row">
        <span className="rc__eta">~{eta}</span>
        <span
          className="rc__crowd-chip"
          style={{ background: crowdM.bg, color: crowdM.color, borderColor: crowdM.border }}
        >
          {crowdM.icon} {crowdM.label}
        </span>
        {liveConditions?.traffic?.delay_mins > 0 && (
          <span className="rc__delay-chip">
            🚦 +{liveConditions.traffic.delay_mins}m delay
          </span>
        )}
        {liveConditions?.aqi?.value && (
          <span className="rc__aqi-chip" style={{ color: liveConditions.aqi.color }}>
            💨 AQI {liveConditions.aqi.value}
          </span>
        )}
      </div>

      {/* ── Live conditions (selected only) ── */}
      {selected && <LiveBar liveConditions={liveConditions} />}

      {/* ── Service badge ── */}
      {svcMeta && (
        <div className="rc__svc-badge" style={{ background: svcMeta.bg, color: svcMeta.color }}>
          {svcMeta.label}
          {freqMins > 0 && (
            <span className="rc__svc-freq">
              {' · '}{t.everyMins?.(freqMins) || `Every ${freqMins} min`}
            </span>
          )}
        </div>
      )}

      {/* ── Key stops ── */}
      {keyStops.length > 0 && (
        <div className="rc__stops">
          <span className="rc__stops-label">{t.stops || 'Stops'}:</span>
          <span className="rc__stops-list">
            {keyStops.map((s, i) => (
              <span key={i}>
                {s === '…'
                  ? <span className="rc__stops-ellipsis">•••</span>
                  : <span className="rc__stop-name">
                      {lang === 'te' ? translateStopName(s) : s}
                    </span>}
                {i < keyStops.length - 1 && <span className="rc__stops-dot"> · </span>}
              </span>
            ))}
          </span>
        </div>
      )}

      {/* ── Safety toggle ── */}
      {safety && (
        <button
          className={`rc__safety-toggle${safetyOpen ? ' rc__safety-toggle--open' : ''}${hasActiveRisk ? ' rc__safety-toggle--alert' : ''}`}
          style={{ color: safetyMeta?.color, borderColor: safetyMeta?.border }}
          onClick={toggleSafety}
          aria-expanded={safetyOpen}
          aria-label="Toggle route safety analysis"
        >
          <span>🛡 Safety Analysis</span>
          <span className="rc__safety-toggle-badge"
            style={{ background: safetyMeta?.bg, color: safetyMeta?.color, borderColor: safetyMeta?.border }}>
            {safetyMeta?.label}
            {hasActiveRisk && ' ⚡'}
          </span>
          <span className="rc__safety-toggle-chev">{safetyOpen ? '▲' : '▼'}</span>
        </button>
      )}

      {safetyOpen && safety && (
        <SafetyPanel route={route} safety={safety} adjustedScore={adjustedScore} />
      )}

      {/* ── Steps toggle ── */}
      <button
        className="rc__toggle"
        onClick={toggleCard}
        aria-expanded={stepsOpen}
        aria-label={stepsOpen ? 'Hide step-by-step directions' : 'Show step-by-step directions'}
      >
        {stepsOpen
          ? `▲ ${t.hideSteps || 'Hide details'}`
          : `▼ ${t.showSteps || 'Show route details'}`}
      </button>

      {stepsOpen && (
        <div className="rc__steps">
          {(route.steps || []).map((step, i) => (
            <RouteStep
              key={i}
              step={step}
              isLast={i === route.steps.length - 1}
            />
          ))}
        </div>
      )}

      {/* ── Show on Map button ── */}
      <button
        className={`rc__map-btn${showMap ? ' rc__map-btn--active' : ''}`}
        style={{ '--map-color': borderColor }}
        onClick={toggleMap}
        aria-expanded={showMap}
        aria-label={showMap ? 'Hide map' : 'Show route on map'}
      >
        <span className="rc__map-btn-icon">🗺</span>
        <span>{showMap ? 'Hide Map' : 'Show on Map'}</span>
        <span className="rc__map-btn-chev">{showMap ? '▲' : '▼'}</span>
      </button>

      {/* ── Inline route map ── */}
      {showMap && (
        <div className="rc__map-wrap" onClick={e => e.stopPropagation()}>
          {hasCoords
            ? <RouteMapView route={route} accentColor={borderColor} />
            : <div className="rc__map-nocoords">Map visualization not available for this route</div>
          }
        </div>
      )}
    </motion.div>
  )
}
