import { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { getAllAreaScores } from '../../utils/areaScoring'
import { useLang } from '../../contexts/LanguageContext'
import './AnalyticsPage.css'

const HYD_CENTER = [17.385, 78.4867]

/* ── Label helpers ───────────────────────────────────────────────────────── */

function trafficLabel(s, t) {
  if (s >= 70) return t.light
  if (s >= 45) return t.moderate
  return t.heavy
}

function crowdLabel(s, t) {
  if (s < 35) return t.veryHigh
  if (s < 55) return t.high
  if (s < 75) return t.moderate
  return t.low
}

function delayLabel(s, t) {
  if (s < 35) return t.high
  if (s < 55) return t.moderate
  return t.low
}

function ridePoolLabel(s, t) {
  if (s > 60) return t.available
  if (s > 35) return t.limited
  return t.minimal
}

function metroActivityLabel(pct, t) {
  if (pct > 55) return t.high
  if (pct > 30) return t.moderate
  return t.low
}

function mobilityTier(s, t) {
  if (s >= 70) return { label: t.wellServed,    cls: 'tier--green' }
  if (s >= 50) return { label: t.adequate,       cls: 'tier--amber' }
  if (s >= 35) return { label: t.underserved,    cls: 'tier--orange' }
  return              { label: t.transitDesert, cls: 'tier--red'   }
}

/* ── Professional GIS color scale ───────────────────────────────────────── */

function hexToRgb(hex) {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ]
}

function mobilityRgb(score) {
  if (score >= 75) return hexToRgb('#15803d')
  if (score >= 60) return hexToRgb('#22c55e')
  if (score >= 50) return hexToRgb('#84cc16')
  if (score >= 40) return hexToRgb('#eab308')
  if (score >= 30) return hexToRgb('#f97316')
  if (score >= 18) return hexToRgb('#dc2626')
  return hexToRgb('#7f1d1d')
}

function dotColor(score) {
  if (score >= 65) return '#15803d'
  if (score >= 45) return '#a16207'
  return '#b91c1c'
}

/* ══════════════════════════════════════════════════════════════════════════
   CANVAS CITY HEATMAP — Three-pass continuous density surface
   ══════════════════════════════════════════════════════════════════════════ */

const CanvasCityHeat = L.Layer.extend({
  initialize: function (data) { this._data = data },

  onAdd: function (map) {
    this._canvas = document.createElement('canvas')
    this._canvas.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;'
    const pane = map.getPane('heatmapPane') || map.getPanes().overlayPane
    pane.appendChild(this._canvas)
    map.on('moveend zoomend resize viewreset', this._render, this)
    this._render()
  },

  onRemove: function (map) {
    if (this._canvas && this._canvas.parentNode) this._canvas.parentNode.removeChild(this._canvas)
    map.off('moveend zoomend resize viewreset', this._render, this)
  },

  setData: function (data) { this._data = data; if (this._map) this._render() },

  _render: function () {
    const map = this._map, canvas = this._canvas
    if (!map || !canvas) return
    const size = map.getSize()
    if (size.x <= 0 || size.y <= 0) return
    canvas.width = size.x; canvas.height = size.y
    try { L.DomUtil.setPosition(canvas, map.containerPointToLayerPoint([0, 0])) } catch { return }
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, size.x, size.y)
    const zoom = map.getZoom()
    const bgR  = Math.max(180, Math.min(640, 90  * Math.pow(2, zoom - 10)))
    const dtR  = Math.max(80,  Math.min(300, 42  * Math.pow(2, zoom - 10)))
    const nbR  = Math.max(42,  Math.min(160, 22  * Math.pow(2, zoom - 10)))
    const pts  = []
    for (const pt of this._data) {
      try { const px = map.latLngToContainerPoint([pt.lat, pt.lon]); pts.push({ x: px.x, y: px.y, rgb: pt.rgb }) } catch {}
    }
    for (const { x, y, rgb: [r, g, b] } of pts) {
      if (x < -bgR*1.5 || x > size.x+bgR*1.5 || y < -bgR*1.5 || y > size.y+bgR*1.5) continue
      const g1 = ctx.createRadialGradient(x,y,0,x,y,bgR)
      g1.addColorStop(0,`rgba(${r},${g},${b},0.11)`); g1.addColorStop(0.3,`rgba(${r},${g},${b},0.07)`)
      g1.addColorStop(0.6,`rgba(${r},${g},${b},0.03)`); g1.addColorStop(1,`rgba(${r},${g},${b},0)`)
      ctx.beginPath(); ctx.arc(x,y,bgR,0,Math.PI*2); ctx.fillStyle=g1; ctx.fill()
    }
    for (const { x, y, rgb: [r, g, b] } of pts) {
      if (x < -dtR*1.5 || x > size.x+dtR*1.5 || y < -dtR*1.5 || y > size.y+dtR*1.5) continue
      const g2 = ctx.createRadialGradient(x,y,0,x,y,dtR)
      g2.addColorStop(0,`rgba(${r},${g},${b},0.20)`); g2.addColorStop(0.3,`rgba(${r},${g},${b},0.13)`)
      g2.addColorStop(0.6,`rgba(${r},${g},${b},0.05)`); g2.addColorStop(0.85,`rgba(${r},${g},${b},0.01)`)
      g2.addColorStop(1,`rgba(${r},${g},${b},0)`)
      ctx.beginPath(); ctx.arc(x,y,dtR,0,Math.PI*2); ctx.fillStyle=g2; ctx.fill()
    }
    for (const { x, y, rgb: [r, g, b] } of pts) {
      if (x < -nbR*2 || x > size.x+nbR*2 || y < -nbR*2 || y > size.y+nbR*2) continue
      const g3 = ctx.createRadialGradient(x,y,0,x,y,nbR)
      g3.addColorStop(0,`rgba(${r},${g},${b},0.28)`); g3.addColorStop(0.25,`rgba(${r},${g},${b},0.18)`)
      g3.addColorStop(0.55,`rgba(${r},${g},${b},0.07)`); g3.addColorStop(0.8,`rgba(${r},${g},${b},0.02)`)
      g3.addColorStop(1,`rgba(${r},${g},${b},0)`)
      ctx.beginPath(); ctx.arc(x,y,nbR,0,Math.PI*2); ctx.fillStyle=g3; ctx.fill()
    }
  },
})

/* ── Explore Map (area-level zoomed-in view) ─────────────────────────────── */

function ExploreMap({ area, onDotClick }) {
  const containerRef = useRef(null)
  const mapRef       = useRef(null)
  const circleRef    = useRef(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container || mapRef.current || container._leaflet_id) return
    let map
    try {
      map = L.map(container, { center: HYD_CENTER, zoom: 11, zoomControl: true, scrollWheelZoom: true })
    } catch { return }
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; OSM &copy; CARTO', subdomains: 'abcd', maxZoom: 18,
    }).addTo(map)
    mapRef.current = map
    return () => { try { map.remove() } catch {}; mapRef.current = null }
  }, [])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const ro = new ResizeObserver(() => requestAnimationFrame(() => { try { mapRef.current?.invalidateSize() } catch {} }))
    ro.observe(container)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (circleRef.current) { try { circleRef.current.remove() } catch {}; circleRef.current = null }
    if (!area) { try { map.setView(HYD_CENTER, 11, { animate: true }) } catch {}; return }
    const color = dotColor(area.scores.mobility)
    try {
      const circle = L.circle([area.lat, area.lon], {
        radius: 600, color, weight: 2.5, opacity: 0.9, fillColor: color, fillOpacity: 0.15,
      }).addTo(map)
      circle.on('click', () => onDotClick?.(area))
      circleRef.current = circle
      map.setView([area.lat, area.lon], 13, { animate: true, duration: 0.6 })
    } catch {}
  }, [area]) // eslint-disable-line

  return <div ref={containerRef} className="aa__explore-map" />
}

/* ── City Intelligence Map (full GIS heatmap) ───────────────────────────── */

function CityMap({ areas, selectedArea, onAreaSelect, t }) {
  const containerRef = useRef(null)
  const mapRef       = useRef(null)
  const heatRef      = useRef(null)
  const dotsRef      = useRef({})
  const highlightRef = useRef(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container || mapRef.current || container._leaflet_id) return
    let map
    try {
      map = L.map(container, { center: HYD_CENTER, zoom: 10, zoomControl: true, scrollWheelZoom: true })
    } catch { return }
    map.createPane('heatmapPane'); map.getPane('heatmapPane').style.zIndex = 350
    map.createPane('labelsPane');  map.getPane('labelsPane').style.zIndex  = 450
    map.getPane('labelsPane').style.pointerEvents = 'none'
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; OpenStreetMap &copy; CARTO', subdomains: 'abcd', maxZoom: 19,
    }).addTo(map)
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png', {
      pane: 'labelsPane', subdomains: 'abcd', maxZoom: 19,
    }).addTo(map)
    mapRef.current = map
    return () => { try { map.remove() } catch {}; mapRef.current = null }
  }, [])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const ro = new ResizeObserver(() => requestAnimationFrame(() => { try { mapRef.current?.invalidateSize() } catch {} }))
    ro.observe(container)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !areas.length) return
    if (heatRef.current) { try { heatRef.current.remove() } catch {}; heatRef.current = null }
    Object.values(dotsRef.current).forEach(d => { try { d.remove() } catch {} })
    dotsRef.current = {}
    try {
      const heat = new CanvasCityHeat(areas.map(a => ({ lat: a.lat, lon: a.lon, rgb: mobilityRgb(a.scores.mobility) })))
      heat.addTo(map); heatRef.current = heat
    } catch {}
    for (const area of areas) {
      const s = area.scores.mobility, color = dotColor(s)
      try {
        const dot = L.circleMarker([area.lat, area.lon], { radius: 9, color, weight: 1, opacity: 0, fillColor: color, fillOpacity: 0, interactive: true })
        dot.bindTooltip(
          `<div class="aa__tip-name">${area.name}</div><div class="aa__tip-score" style="color:${color}">${s}<span>/100</span></div><div class="aa__tip-type">${mobilityTier(s, t).label}</div>`,
          { sticky: true, className: 'aa__tooltip' }
        )
        dot.on('click', () => onAreaSelect?.(area))
        dot.addTo(map); dotsRef.current[area.id] = dot
      } catch {}
    }
  }, [areas, onAreaSelect, t]) // eslint-disable-line

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (highlightRef.current) { try { highlightRef.current.remove() } catch {}; highlightRef.current = null }
    if (!selectedArea) return
    const s = selectedArea.scores.mobility, color = dotColor(s)
    try {
      const ring = L.circle([selectedArea.lat, selectedArea.lon], {
        radius: 700, color, weight: 2.5, opacity: 0.95, fillColor: color, fillOpacity: 0.12,
      }).addTo(map)
      highlightRef.current = ring
      map.setView([selectedArea.lat, selectedArea.lon], 13, { animate: true, duration: 0.7 })
    } catch {}
  }, [selectedArea])

  return <div ref={containerRef} className="aa__ov-map-canvas" role="application" aria-label="Hyderabad transit intelligence heatmap" />
}

/* ═══════════════════════════════════════════════════════════════════════════
   ANALYTICS PAGE
   ═══════════════════════════════════════════════════════════════════════════ */

export function AnalyticsPage() {
  const [activeTab, setActiveTab]       = useState('live')
  const [search, setSearch]             = useState('')
  const [showDrop, setShowDrop]         = useState(false)
  const [selectedArea, setSelectedArea] = useState(null)
  const [liveTime, setLiveTime]         = useState(() => new Date())
  const { t } = useLang()

  useEffect(() => {
    const id = setInterval(() => setLiveTime(new Date()), 60000)
    return () => clearInterval(id)
  }, [])

  const scoredAreas = useMemo(() => getAllAreaScores(), [])

  const searchResults = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return []
    return scoredAreas.filter(a => a.name.toLowerCase().includes(q)).slice(0, 8)
  }, [search, scoredAreas])

  const handleSelect = useCallback((area) => {
    setSelectedArea(area); setSearch(area.name); setShowDrop(false)
  }, [])

  const handleClear = useCallback(() => {
    setSearch(''); setSelectedArea(null); setShowDrop(false)
  }, [])

  const handleSearchKeyDown = useCallback((e) => {
    if (e.key === 'Enter')    { if (searchResults.length > 0) handleSelect(searchResults[0]); setShowDrop(false) }
    if (e.key === 'Escape')   { setShowDrop(false); handleClear() }
    if (e.key === 'ArrowDown') { e.preventDefault(); setShowDrop(true) }
  }, [searchResults, handleSelect, handleClear])

  const cityMetrics = useMemo(() => {
    if (!scoredAreas.length) return null
    const n          = scoredAreas.length
    const avgTraffic = Math.round(scoredAreas.reduce((s, a) => s + a.scores.traffic, 0) / n)
    const metroGood  = scoredAreas.filter(a => a.scores.metro > 60).length
    const metroPct   = Math.round((metroGood / n) * 100)
    const deserts    = scoredAreas.filter(a => a.scores.mobility < 35).length
    return { avgTraffic, metroPct, deserts }
  }, [scoredAreas])

  return (
    <div className="aa">

      <nav className="aa__nav" aria-label="Analytics navigation">
        <div className="aa__nav-header">{t.analyticsNav}</div>
        <button
          className={`aa__nav-item${activeTab === 'live' ? ' aa__nav-item--active' : ''}`}
          onClick={() => setActiveTab('live')}
        >
          <span className="aa__nav-icon" aria-hidden="true">📊</span>
          <span>{t.hyderabadLive}</span>
        </button>
        <button
          className={`aa__nav-item${activeTab === 'area' ? ' aa__nav-item--active' : ''}`}
          onClick={() => setActiveTab('area')}
        >
          <span className="aa__nav-icon" aria-hidden="true">🔍</span>
          <span>{t.areaIntelligence}</span>
        </button>
      </nav>

      <div className="aa__content">

        {activeTab === 'live' && (
          <div className="aa__live">

            <div className="aa__live-header">
              <div>
                <h2 className="aa__live-title">{t.hyderabadLive}</h2>
                <div className="aa__live-sub">
                  {scoredAreas.length} {t.zonesTransitIntel} · {liveTime.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>
              <div className="aa__live-badge">
                <span className="aa__live-pulse" aria-hidden="true" />
                {t.live}
              </div>
            </div>

            <div className="aa__live-cards">
              <div className="aa__live-card">
                <div className="aa__live-card-top">
                  <span className="aa__live-card-icon" aria-hidden="true">🚦</span>
                  <span className="aa__live-card-label">{t.traffic}</span>
                </div>
                <div className="aa__live-card-value">{cityMetrics ? trafficLabel(cityMetrics.avgTraffic, t) : '—'}</div>
                <div className="aa__live-card-sub">{t.cityAverage}</div>
              </div>
              <div className="aa__live-card">
                <div className="aa__live-card-top">
                  <span className="aa__live-card-icon" aria-hidden="true">🚇</span>
                  <span className="aa__live-card-label">{t.metroActivity}</span>
                </div>
                <div className="aa__live-card-value">{cityMetrics ? metroActivityLabel(cityMetrics.metroPct, t) : '—'}</div>
                <div className="aa__live-card-sub">{cityMetrics ? `${cityMetrics.metroPct}% ${t.zones}` : ''}</div>
              </div>
              <div className="aa__live-card">
                <div className="aa__live-card-top">
                  <span className="aa__live-card-icon" aria-hidden="true">⏰</span>
                  <span className="aa__live-card-label">{t.peakTime}</span>
                </div>
                <div className="aa__live-card-value">5 – 8 PM</div>
                <div className="aa__live-card-sub">{t.eveningRush}</div>
              </div>
              <div className="aa__live-card aa__live-card--alert">
                <div className="aa__live-card-top">
                  <span className="aa__live-card-icon" aria-hidden="true">⚠️</span>
                  <span className="aa__live-card-label">{t.transitDeserts}</span>
                </div>
                <div className="aa__live-card-value">{cityMetrics ? cityMetrics.deserts : '—'}</div>
                <div className="aa__live-card-sub">{t.zonesNeedingCoverage}</div>
              </div>
            </div>

            <div className="aa__live-legend">
              <div className="aa__live-legend-bar-row">
                <span className="aa__ov-legend-label">{t.desert}</span>
                <div className="aa__ov-legend-gradient" aria-hidden="true" />
                <span className="aa__ov-legend-label">{t.strong}</span>
              </div>
              <div className="aa__live-legend-row">
                {[['#15803d',t.strong],['#eab308',t.moderate],['#f97316',t.weak],['#7f1d1d',t.desert]].map(([c, l]) => (
                  <span key={c} className="aa__ov-legend-item">
                    <span className="aa__ov-legend-dot" style={{ background: c }} />
                    {l}
                  </span>
                ))}
              </div>
            </div>

            <div className="aa__live-map">
              <CityMap areas={scoredAreas} selectedArea={selectedArea} onAreaSelect={handleSelect} t={t} />
            </div>

          </div>
        )}

        {activeTab === 'area' && (
          <div className="aa__area">

            <div className="aa__area-search-wrap">
              <div className="aa__search-input-wrap">
                <span className="aa__search-icon" aria-hidden="true">🔍</span>
                <input
                  className="aa__search-input"
                  type="text"
                  placeholder={t.searchArea}
                  value={search}
                  onChange={e => { setSearch(e.target.value); setShowDrop(true) }}
                  onFocus={() => setShowDrop(true)}
                  onBlur={() => setTimeout(() => setShowDrop(false), 160)}
                  onKeyDown={handleSearchKeyDown}
                  autoComplete="off"
                  aria-label={t.searchAreaLabel}
                  aria-autocomplete="list"
                  aria-haspopup="listbox"
                />
                {search && (
                  <button className="aa__search-clear" onClick={handleClear} aria-label="Clear search">✕</button>
                )}
              </div>
              {showDrop && searchResults.length > 0 && (
                <div className="aa__search-drop" role="listbox">
                  {searchResults.map(area => (
                    <div
                      key={area.id}
                      className={`aa__search-drop-item${selectedArea?.id === area.id ? ' aa__search-drop-item--sel' : ''}`}
                      onMouseDown={() => handleSelect(area)}
                      role="option"
                      aria-selected={selectedArea?.id === area.id}
                    >
                      <span className="aa__search-drop-icon" aria-hidden="true">📍</span>
                      <span className="aa__search-drop-name">{area.name}</span>
                      <span className="aa__search-drop-score" style={{ color: dotColor(area.scores.mobility) }}>
                        {area.scores.mobility}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {!selectedArea ? (
              <div className="aa__area-empty">
                <span className="aa__area-empty-icon" aria-hidden="true">🗺️</span>
                <span className="aa__area-empty-text">{t.searchAreaExplore}</span>
                <span className="aa__area-empty-sub">
                  {scoredAreas.filter(a => a.scores.mobility < 35).length} {t.transitDesertsDetected}
                </span>
              </div>
            ) : (
              <>
                <div className="aa__area-overview-card">
                  <div className="aa__area-overview-score">
                    <div
                      className="aa__area-score-circle"
                      style={{ border: `3px solid ${dotColor(selectedArea.scores.mobility)}` }}
                    >
                      <span className="aa__area-score-num" style={{ color: dotColor(selectedArea.scores.mobility) }}>
                        {selectedArea.scores.mobility}
                      </span>
                      <span className="aa__area-score-denom">/100</span>
                    </div>
                    <div className="aa__area-tier" style={{ color: dotColor(selectedArea.scores.mobility) }}>
                      {mobilityTier(selectedArea.scores.mobility, t).label}
                    </div>
                  </div>
                  <div className="aa__area-overview-info">
                    <div className="aa__area-overview-name">{selectedArea.name}</div>
                    <div className="aa__area-overview-metrics">
                      <div className="aa__area-metric"><span aria-hidden="true">👥</span><span>{t.crowd}</span><strong>{crowdLabel(selectedArea.scores.traffic, t)}</strong></div>
                      <div className="aa__area-metric"><span aria-hidden="true">⏱</span><span>{t.delayRisk}</span><strong>{delayLabel(selectedArea.scores.traffic, t)}</strong></div>
                      <div className="aa__area-metric"><span aria-hidden="true">🚗</span><span>{t.ridePool}</span><strong>{ridePoolLabel(selectedArea.scores.mobility, t)}</strong></div>
                      <div className="aa__area-metric"><span aria-hidden="true">🚇</span><span>{t.metro}</span><strong>{selectedArea.scores.metro}/100</strong></div>
                    </div>
                  </div>
                </div>

                <div className="aa__area-map-wrap">
                  <ExploreMap area={selectedArea} onDotClick={() => {}} />
                </div>

                <div className="aa__area-insight-grid">
                  {[
                    { icon: '🚇', cls: 'aa__insight-icon--green', label: t.transitAccess, value: `${selectedArea.scores.mobility}/100` },
                    { icon: '👥', cls: 'aa__insight-icon--amber', label: t.crowdLevel,    value: crowdLabel(selectedArea.scores.traffic, t) },
                    { icon: '⏱', cls: 'aa__insight-icon--red',   label: t.delayRisk,     value: delayLabel(selectedArea.scores.traffic, t) },
                    { icon: '🚗', cls: 'aa__insight-icon--blue',  label: t.ridePool,       value: ridePoolLabel(selectedArea.scores.mobility, t) },
                  ].map(({ icon, cls, label, value }) => (
                    <div key={label} className="aa__insight">
                      <div className={`aa__insight-icon ${cls}`} aria-hidden="true">{icon}</div>
                      <div className="aa__insight-body">
                        <div className="aa__insight-label">{label}</div>
                        <div className="aa__insight-value">{value}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

      </div>
    </div>
  )
}
