import { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { getAllAreaScores } from '../../utils/areaScoring'
import './AnalyticsPage.css'

const HYD_CENTER = [17.385, 78.4867]

/* ── Label helpers ───────────────────────────────────────────────────────── */

function trafficLabel(s) {
  if (s >= 70) return 'Light'
  if (s >= 45) return 'Moderate'
  return 'Heavy'
}

function crowdLabel(s) {
  if (s < 35) return 'Very High'
  if (s < 55) return 'High'
  if (s < 75) return 'Moderate'
  return 'Low'
}

function delayLabel(s) {
  if (s < 35) return 'High'
  if (s < 55) return 'Moderate'
  return 'Low'
}

function ridePoolLabel(s) {
  if (s > 60) return 'Available'
  if (s > 35) return 'Limited'
  return 'Minimal'
}

function metroActivityLabel(pct) {
  if (pct > 55) return 'High'
  if (pct > 30) return 'Moderate'
  return 'Low'
}

function mobilityTier(s) {
  if (s >= 70) return { label: 'Well-served',    cls: 'tier--green' }
  if (s >= 50) return { label: 'Adequate',       cls: 'tier--amber' }
  if (s >= 35) return { label: 'Underserved',    cls: 'tier--orange' }
  return              { label: 'Transit Desert', cls: 'tier--red'   }
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

   Pass 1 (City scale, very large radius):
     Fills gaps between areas completely.
     Creates the seamless city-wide background.
     Very low opacity — basemap shows through.

   Pass 2 (District scale, medium radius):
     Adds area-level differentiation.
     Moderate opacity.

   Pass 3 (Neighborhood, smaller radius):
     Precise local scoring.
     Higher center opacity.

   Labels tile layer lives in 'labelsPane' (z-450) — always readable.
   ══════════════════════════════════════════════════════════════════════════ */

const CanvasCityHeat = L.Layer.extend({
  initialize: function (data) {
    this._data = data
  },

  onAdd: function (map) {
    this._canvas = document.createElement('canvas')
    this._canvas.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;'
    const pane = map.getPane('heatmapPane') || map.getPanes().overlayPane
    pane.appendChild(this._canvas)
    map.on('moveend zoomend resize viewreset', this._render, this)
    this._render()
  },

  onRemove: function (map) {
    if (this._canvas && this._canvas.parentNode) {
      this._canvas.parentNode.removeChild(this._canvas)
    }
    map.off('moveend zoomend resize viewreset', this._render, this)
  },

  setData: function (data) {
    this._data = data
    if (this._map) this._render()
  },

  _render: function () {
    const map    = this._map
    const canvas = this._canvas
    if (!map || !canvas) return

    const size = map.getSize()
    if (size.x <= 0 || size.y <= 0) return

    canvas.width  = size.x
    canvas.height = size.y

    try {
      const topLeft = map.containerPointToLayerPoint([0, 0])
      L.DomUtil.setPosition(canvas, topLeft)
    } catch { return }

    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, size.x, size.y)

    const zoom = map.getZoom()

    /* Pass 1 — city-wide background (fills all gaps) */
    const bgR = Math.max(180, Math.min(640, 90 * Math.pow(2, zoom - 10)))

    /* Pass 2 — district level */
    const dtR = Math.max(80, Math.min(300, 42 * Math.pow(2, zoom - 10)))

    /* Pass 3 — neighborhood precision */
    const nbR = Math.max(42, Math.min(160, 22 * Math.pow(2, zoom - 10)))

    /* Pre-compute pixel positions */
    const pts = []
    for (const pt of this._data) {
      try {
        const px = map.latLngToContainerPoint([pt.lat, pt.lon])
        pts.push({ x: px.x, y: px.y, rgb: pt.rgb })
      } catch { /* skip invalid coords */ }
    }

    /* ── Pass 1: seamless city background ── */
    for (const { x, y, rgb: [r, g, b] } of pts) {
      if (x < -bgR * 1.5 || x > size.x + bgR * 1.5 ||
          y < -bgR * 1.5 || y > size.y + bgR * 1.5) continue
      const g1 = ctx.createRadialGradient(x, y, 0, x, y, bgR)
      g1.addColorStop(0,    `rgba(${r},${g},${b},0.11)`)
      g1.addColorStop(0.30, `rgba(${r},${g},${b},0.07)`)
      g1.addColorStop(0.60, `rgba(${r},${g},${b},0.03)`)
      g1.addColorStop(1,    `rgba(${r},${g},${b},0)`)
      ctx.beginPath()
      ctx.arc(x, y, bgR, 0, Math.PI * 2)
      ctx.fillStyle = g1
      ctx.fill()
    }

    /* ── Pass 2: district differentiation ── */
    for (const { x, y, rgb: [r, g, b] } of pts) {
      if (x < -dtR * 1.5 || x > size.x + dtR * 1.5 ||
          y < -dtR * 1.5 || y > size.y + dtR * 1.5) continue
      const g2 = ctx.createRadialGradient(x, y, 0, x, y, dtR)
      g2.addColorStop(0,    `rgba(${r},${g},${b},0.20)`)
      g2.addColorStop(0.30, `rgba(${r},${g},${b},0.13)`)
      g2.addColorStop(0.60, `rgba(${r},${g},${b},0.05)`)
      g2.addColorStop(0.85, `rgba(${r},${g},${b},0.01)`)
      g2.addColorStop(1,    `rgba(${r},${g},${b},0)`)
      ctx.beginPath()
      ctx.arc(x, y, dtR, 0, Math.PI * 2)
      ctx.fillStyle = g2
      ctx.fill()
    }

    /* ── Pass 3: neighborhood precision ── */
    for (const { x, y, rgb: [r, g, b] } of pts) {
      if (x < -nbR * 2 || x > size.x + nbR * 2 ||
          y < -nbR * 2 || y > size.y + nbR * 2) continue
      const g3 = ctx.createRadialGradient(x, y, 0, x, y, nbR)
      g3.addColorStop(0,    `rgba(${r},${g},${b},0.28)`)
      g3.addColorStop(0.25, `rgba(${r},${g},${b},0.18)`)
      g3.addColorStop(0.55, `rgba(${r},${g},${b},0.07)`)
      g3.addColorStop(0.80, `rgba(${r},${g},${b},0.02)`)
      g3.addColorStop(1,    `rgba(${r},${g},${b},0)`)
      ctx.beginPath()
      ctx.arc(x, y, nbR, 0, Math.PI * 2)
      ctx.fillStyle = g3
      ctx.fill()
    }
  },
})

/* ── Explore Map (left panel — zoomed-in area view) ─────────────────────── */

function ExploreMap({ area, onDotClick }) {
  const containerRef = useRef(null)
  const mapRef       = useRef(null)
  const circleRef    = useRef(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    if (mapRef.current) return
    if (container._leaflet_id) return  // guard against double-init

    let map
    try {
      map = L.map(container, {
        center: HYD_CENTER, zoom: 11,
        zoomControl: true, scrollWheelZoom: true,
      })
    } catch { return }

    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
      subdomains: 'abcd', maxZoom: 18,
    }).addTo(map)

    mapRef.current = map
    return () => {
      try { map.remove() } catch {}
      mapRef.current = null
    }
  }, [])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const ro = new ResizeObserver(() =>
      requestAnimationFrame(() => { try { mapRef.current?.invalidateSize() } catch {} })
    )
    ro.observe(container)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (circleRef.current) { try { circleRef.current.remove() } catch {}; circleRef.current = null }

    if (!area) {
      try { map.setView(HYD_CENTER, 11, { animate: true }) } catch {}
      return
    }

    const s     = area.scores.mobility
    const color = dotColor(s)
    let circle
    try {
      circle = L.circle([area.lat, area.lon], {
        radius: 600, color, weight: 2.5, opacity: 0.9,
        fillColor: color, fillOpacity: 0.15,
      }).addTo(map)
      circle.on('click', () => onDotClick?.(area))
      circleRef.current = circle
      map.setView([area.lat, area.lon], 13, { animate: true, duration: 0.6 })
    } catch {}
  }, [area]) // eslint-disable-line

  return <div ref={containerRef} className="aa__explore-map" />
}

/* ── City Intelligence Map (right panel — full GIS heatmap) ─────────────── */

function CityMap({ areas, selectedArea, onAreaSelect }) {
  const containerRef  = useRef(null)
  const mapRef        = useRef(null)
  const heatRef       = useRef(null)
  const dotsRef       = useRef({})
  const highlightRef  = useRef(null)

  /* Init map — pane stack: base → heatmap → labels → markers */
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    if (mapRef.current) return
    if (container._leaflet_id) return  // guard against double-init

    let map
    try {
      map = L.map(container, {
        center: HYD_CENTER, zoom: 10,
        zoomControl: true, scrollWheelZoom: true,
        attributionControl: true,
      })
    } catch { return }

    map.createPane('heatmapPane')
    map.getPane('heatmapPane').style.zIndex = 350

    map.createPane('labelsPane')
    map.getPane('labelsPane').style.zIndex  = 450
    map.getPane('labelsPane').style.pointerEvents = 'none'

    /* Base geography — roads, water, terrain — no text */
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; OpenStreetMap &copy; CARTO',
      subdomains: 'abcd', maxZoom: 19,
    }).addTo(map)

    /* Labels float above heatmap */
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png', {
      pane: 'labelsPane',
      subdomains: 'abcd', maxZoom: 19,
    }).addTo(map)

    mapRef.current = map
    return () => {
      try { map.remove() } catch {}
      mapRef.current = null
    }
  }, [])

  /* Invalidate on container resize */
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const ro = new ResizeObserver(() =>
      requestAnimationFrame(() => { try { mapRef.current?.invalidateSize() } catch {} })
    )
    ro.observe(container)
    return () => ro.disconnect()
  }, [])

  /* Draw / update heatmap when data changes */
  useEffect(() => {
    const map = mapRef.current
    if (!map || !areas.length) return

    if (heatRef.current) { try { heatRef.current.remove() } catch {}; heatRef.current = null }
    Object.values(dotsRef.current).forEach(d => { try { d.remove() } catch {} })
    dotsRef.current = {}

    const heatPoints = areas.map(a => ({
      lat: a.lat, lon: a.lon, rgb: mobilityRgb(a.scores.mobility),
    }))

    try {
      const heat = new CanvasCityHeat(heatPoints)
      heat.addTo(map)
      heatRef.current = heat
    } catch {}

    /* Invisible hit-target markers — tooltip + click only */
    for (const area of areas) {
      const s     = area.scores.mobility
      const color = dotColor(s)
      try {
        const dot = L.circleMarker([area.lat, area.lon], {
          radius: 9, color, weight: 1,
          opacity: 0, fillColor: color, fillOpacity: 0, interactive: true,
        })
        dot.bindTooltip(
          `<div class="aa__tip-name">${area.name}</div>
           <div class="aa__tip-score" style="color:${color}">${s}<span>/100</span></div>
           <div class="aa__tip-type">${mobilityTier(s).label}</div>`,
          { sticky: true, className: 'aa__tooltip' }
        )
        dot.on('click', () => onAreaSelect?.(area))
        dot.addTo(map)
        dotsRef.current[area.id] = dot
      } catch {}
    }
  }, [areas, onAreaSelect])

  /* Pan and highlight when selectedArea changes */
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (highlightRef.current) { try { highlightRef.current.remove() } catch {}; highlightRef.current = null }

    if (!selectedArea) return

    const s     = selectedArea.scores.mobility
    const color = dotColor(s)
    try {
      const ring = L.circle([selectedArea.lat, selectedArea.lon], {
        radius: 700, color, weight: 2.5, opacity: 0.95,
        fillColor: color, fillOpacity: 0.12, dashArray: null,
      }).addTo(map)
      highlightRef.current = ring
      map.setView([selectedArea.lat, selectedArea.lon], 13, { animate: true, duration: 0.7 })
    } catch {}
  }, [selectedArea])

  return (
    <div
      ref={containerRef}
      className="aa__ov-map-canvas"
      role="application"
      aria-label="Hyderabad transit intelligence heatmap"
    />
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   ANALYTICS PAGE
   ═══════════════════════════════════════════════════════════════════════════ */

export function AnalyticsPage() {
  const [search, setSearch]             = useState('')
  const [showDrop, setShowDrop]         = useState(false)
  const [selectedArea, setSelectedArea] = useState(null)
  const [showSheet, setShowSheet]       = useState(false)

  const scoredAreas = useMemo(() => getAllAreaScores(), [])

  const searchResults = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q || q.length < 1) return []
    return scoredAreas
      .filter(a => a.name.toLowerCase().includes(q))
      .slice(0, 8)
  }, [search, scoredAreas])

  const handleSelect = useCallback((area) => {
    setSelectedArea(area)
    setSearch(area.name)
    setShowDrop(false)
    setShowSheet(false)
  }, [])

  const handleClear = useCallback(() => {
    setSearch('')
    setSelectedArea(null)
    setShowDrop(false)
    setShowSheet(false)
  }, [])

  /* Enter key: select first result and zoom */
  const handleSearchKeyDown = useCallback((e) => {
    if (e.key === 'Enter') {
      if (searchResults.length > 0) handleSelect(searchResults[0])
      setShowDrop(false)
    }
    if (e.key === 'Escape') {
      setShowDrop(false)
      handleClear()
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setShowDrop(true)
    }
  }, [searchResults, handleSelect, handleClear])

  /* City overview metrics */
  const cityMetrics = useMemo(() => {
    if (!scoredAreas.length) return null
    const n          = scoredAreas.length
    const avgTraffic = Math.round(scoredAreas.reduce((s, a) => s + a.scores.traffic, 0) / n)
    const metroGood  = scoredAreas.filter(a => a.scores.metro > 60).length
    const metroPct   = Math.round((metroGood / n) * 100)
    const deserts    = scoredAreas.filter(a => a.scores.mobility < 35).length
    const hotAreas   = [...scoredAreas]
      .sort((a, b) => a.scores.traffic - b.scores.traffic)
      .slice(0, 3)
      .map(a => a.name.split(' ')[0])
    const peakZones  = hotAreas.join(', ')
    return { avgTraffic, metroPct, peakZones, deserts }
  }, [scoredAreas])

  const areaInsights = useMemo(() => {
    if (!selectedArea) return null
    const s = selectedArea.scores
    return {
      transit:  s.mobility,
      crowd:    crowdLabel(s.traffic),
      delay:    delayLabel(s.traffic),
      ridePool: ridePoolLabel(s.mobility),
    }
  }, [selectedArea])

  return (
    <div className="aa">

      {/* ── LEFT: Explore Area ──────────────────────────────────────────── */}
      <div className="aa__explore">

        <div className="aa__search-wrap">
          <div className="aa__search-input-wrap">
            <span className="aa__search-icon">🔍</span>
            <input
              className="aa__search-input"
              type="text"
              placeholder="Search area… e.g. Gachibowli"
              value={search}
              onChange={e => { setSearch(e.target.value); setShowDrop(true) }}
              onFocus={() => setShowDrop(true)}
              onBlur={() => setTimeout(() => setShowDrop(false), 160)}
              onKeyDown={handleSearchKeyDown}
              autoComplete="off"
              aria-label="Search Hyderabad areas"
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

        {selectedArea ? (
          <ExploreMap area={selectedArea} onDotClick={() => setShowSheet(true)} />
        ) : (
          <div className="aa__explore-placeholder">
            <span className="aa__explore-placeholder-icon" aria-hidden="true">🗺️</span>
            <span className="aa__explore-placeholder-text">Search an area to explore</span>
            <span className="aa__explore-placeholder-sub">
              {scoredAreas.filter(a => a.scores.mobility < 35).length} transit deserts detected
            </span>
          </div>
        )}

        {/* Area insight cards */}
        <div className="aa__insights">
          <div className="aa__insight">
            <div className="aa__insight-icon aa__insight-icon--green" aria-hidden="true">🚇</div>
            <div className="aa__insight-body">
              <div className="aa__insight-label">Transit Access</div>
              <div className="aa__insight-value">
                {areaInsights ? `${areaInsights.transit}/100` : '—'}
              </div>
            </div>
          </div>
          <div className="aa__insight">
            <div className="aa__insight-icon aa__insight-icon--amber" aria-hidden="true">👥</div>
            <div className="aa__insight-body">
              <div className="aa__insight-label">Crowd Level</div>
              <div className="aa__insight-value">
                {areaInsights ? areaInsights.crowd : '—'}
              </div>
            </div>
          </div>
          <div className="aa__insight">
            <div className="aa__insight-icon aa__insight-icon--red" aria-hidden="true">⏱</div>
            <div className="aa__insight-body">
              <div className="aa__insight-label">Delay Risk</div>
              <div className="aa__insight-value">
                {areaInsights ? areaInsights.delay : '—'}
              </div>
            </div>
          </div>
          <div className="aa__insight">
            <div className="aa__insight-icon aa__insight-icon--blue" aria-hidden="true">🚗</div>
            <div className="aa__insight-body">
              <div className="aa__insight-label">RidePool</div>
              <div className="aa__insight-value">
                {areaInsights ? areaInsights.ridePool : '—'}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── RIGHT: Hyderabad Live Intelligence ──────────────────────────── */}
      <div className="aa__overview">

        <div className="aa__ov-header">
          <div className="aa__ov-header-top">
            <div>
              <h2 className="aa__ov-title">Hyderabad Live</h2>
              <div className="aa__ov-sub">{scoredAreas.length} zones · Transit coverage intelligence</div>
            </div>
          </div>

          {/* Gradient legend bar */}
          <div className="aa__ov-legend-bar">
            <span className="aa__ov-legend-label">Desert</span>
            <div className="aa__ov-legend-gradient" aria-hidden="true" />
            <span className="aa__ov-legend-label">Strong</span>
          </div>

          <div className="aa__ov-legend">
            <span className="aa__ov-legend-item">
              <span className="aa__ov-legend-dot" style={{ background: '#15803d' }} />
              Strong
            </span>
            <span className="aa__ov-legend-item">
              <span className="aa__ov-legend-dot" style={{ background: '#eab308' }} />
              Moderate
            </span>
            <span className="aa__ov-legend-item">
              <span className="aa__ov-legend-dot" style={{ background: '#f97316' }} />
              Weak
            </span>
            <span className="aa__ov-legend-item">
              <span className="aa__ov-legend-dot" style={{ background: '#7f1d1d' }} />
              Desert
            </span>
          </div>
        </div>

        {/* City GIS heatmap — full height, responds to selected area */}
        <div className="aa__ov-map">
          <CityMap
            areas={scoredAreas}
            selectedArea={selectedArea}
            onAreaSelect={handleSelect}
          />
        </div>

        <div className="aa__ov-cards">
          <div className="aa__ov-card">
            <div className="aa__ov-card-label">Traffic</div>
            <div className="aa__ov-card-value">
              {cityMetrics ? trafficLabel(cityMetrics.avgTraffic) : '—'}
            </div>
            <div className="aa__ov-card-sub">Avg across city zones</div>
          </div>
          <div className="aa__ov-card">
            <div className="aa__ov-card-label">Metro Activity</div>
            <div className="aa__ov-card-value">
              {cityMetrics ? metroActivityLabel(cityMetrics.metroPct) : '—'}
            </div>
            <div className="aa__ov-card-sub">
              {cityMetrics ? `${cityMetrics.metroPct}% zones connected` : ''}
            </div>
          </div>
          <div className="aa__ov-card aa__ov-card--alert">
            <div className="aa__ov-card-label">Transit Deserts</div>
            <div className="aa__ov-card-value">
              {cityMetrics ? cityMetrics.deserts : '—'}
            </div>
            <div className="aa__ov-card-sub">Zones needing intervention</div>
          </div>
          <div className="aa__ov-card">
            <div className="aa__ov-card-label">Peak Time</div>
            <div className="aa__ov-card-value">5 – 8 PM</div>
            <div className="aa__ov-card-sub">Evening rush hours</div>
          </div>
        </div>
      </div>

      {/* ── Bottom sheet (area detail) ────────────────────────────────── */}
      {showSheet && selectedArea && (
        <>
          <div className="aa__sheet-overlay" onClick={() => setShowSheet(false)} />
          <div className="aa__sheet" role="dialog" aria-modal="true" aria-label={selectedArea.name}>
            <div className="aa__sheet-handle" aria-hidden="true" />
            <div className="aa__sheet-header">
              <span className="aa__sheet-title">{selectedArea.name}</span>
              <button className="aa__sheet-close" onClick={() => setShowSheet(false)} aria-label="Close">✕</button>
            </div>
            <div className="aa__sheet-body">
              <div className="aa__sheet-row">
                <div className="aa__sheet-row-icon aa__insight-icon--green" aria-hidden="true">🚇</div>
                <div className="aa__sheet-row-body">
                  <div className="aa__sheet-row-label">Transit Access</div>
                  <div className="aa__sheet-row-value">{selectedArea.scores.mobility}/100</div>
                </div>
              </div>
              <div className="aa__sheet-row">
                <div className="aa__sheet-row-icon aa__insight-icon--amber" aria-hidden="true">⏰</div>
                <div className="aa__sheet-row-body">
                  <div className="aa__sheet-row-label">Peak Time</div>
                  <div className="aa__sheet-row-value">5 PM – 8 PM</div>
                </div>
              </div>
              <div className="aa__sheet-row">
                <div className="aa__sheet-row-icon aa__insight-icon--amber" aria-hidden="true">👥</div>
                <div className="aa__sheet-row-body">
                  <div className="aa__sheet-row-label">Crowd Level</div>
                  <div className="aa__sheet-row-value">{crowdLabel(selectedArea.scores.traffic)}</div>
                </div>
              </div>
              <div className="aa__sheet-row">
                <div className="aa__sheet-row-icon aa__insight-icon--red" aria-hidden="true">⏱</div>
                <div className="aa__sheet-row-body">
                  <div className="aa__sheet-row-label">Delay Risk</div>
                  <div className="aa__sheet-row-value">{delayLabel(selectedArea.scores.traffic)}</div>
                </div>
              </div>
              <div className="aa__sheet-row">
                <div className="aa__sheet-row-icon aa__insight-icon--blue" aria-hidden="true">🚗</div>
                <div className="aa__sheet-row-body">
                  <div className="aa__sheet-row-label">RidePool Availability</div>
                  <div className="aa__sheet-row-value">{ridePoolLabel(selectedArea.scores.mobility)}</div>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
