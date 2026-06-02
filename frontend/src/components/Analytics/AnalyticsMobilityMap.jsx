import { useEffect, useRef } from 'react'
import L from 'leaflet'
import { getFilterScore, scoreToHex } from '../../utils/areaScoring'
import 'leaflet/dist/leaflet.css'
import './AnalyticsMobilityMap.css'

const HYD_CENTER = [17.385, 78.4867]

function hexToRgb(hex) {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ]
}

/* Muted professional GIS color scale — no neon */
function canvasRgb(score) {
  if (score >= 75) return hexToRgb('#15803d')  // dark green
  if (score >= 60) return hexToRgb('#16a34a')  // green
  if (score >= 45) return hexToRgb('#a16207')  // muted amber
  if (score >= 30) return hexToRgb('#c2410c')  // burnt orange
  if (score >= 15) return hexToRgb('#b91c1c')  // dark red
  return hexToRgb('#7f1d1d')                   // very dark red
}

/* ── Canvas heatmap layer — placed between basemap and labels ─────────────
   Uses a custom 'heatmapPane' (z-350) so Leaflet's labels tile layer
   can be placed in 'labelsPane' (z-450) and always render on top.
   ────────────────────────────────────────────────────────────────────────── */
const CanvasHeatLayer = L.Layer.extend({
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
    if (this._canvas && this._canvas.parentNode)
      this._canvas.parentNode.removeChild(this._canvas)
    map.off('moveend zoomend resize viewreset', this._render, this)
  },

  setData: function (data) {
    this._data = data
    if (this._map) this._render()
  },

  _render: function () {
    const map = this._map
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
    /* Radius scales with zoom so density looks correct at every zoom level */
    const baseRadius = Math.max(45, Math.min(250, 28 * Math.pow(2, zoom - 10)))

    for (const pt of this._data) {
      const px = map.latLngToContainerPoint([pt.lat, pt.lon])
      const x = px.x
      const y = px.y

      if (
        x < -baseRadius * 1.5 ||
        x > size.x + baseRadius * 1.5 ||
        y < -baseRadius * 1.5 ||
        y > size.y + baseRadius * 1.5
      ) continue

      const [r, g, b] = pt.rgb
      const grad = ctx.createRadialGradient(x, y, 0, x, y, baseRadius)
      /* Max opacity 0.30 — roads and labels remain readable through heatmap */
      grad.addColorStop(0,    `rgba(${r},${g},${b},0.30)`)
      grad.addColorStop(0.30, `rgba(${r},${g},${b},0.20)`)
      grad.addColorStop(0.58, `rgba(${r},${g},${b},0.08)`)
      grad.addColorStop(0.82, `rgba(${r},${g},${b},0.02)`)
      grad.addColorStop(1,    `rgba(${r},${g},${b},0)`)

      ctx.beginPath()
      ctx.arc(x, y, baseRadius, 0, Math.PI * 2)
      ctx.fillStyle = grad
      ctx.fill()
    }
  },
})

const STROKE = {
  '#15803d': '#14532d', '#16a34a': '#15803d',
  '#a16207': '#854d0e', '#c2410c': '#9a3412',
  '#b91c1c': '#991b1b', '#7f1d1d': '#6b1414',
}
const dk = hex => STROKE[hex] || hex

export function AnalyticsMobilityMap({ areas, filter, selectedAreaId, onAreaClick, panToArea }) {
  const containerRef = useRef(null)
  const mapRef       = useRef(null)
  const heatRef      = useRef(null)
  const markersRef   = useRef({})

  /* Pan to area triggered by parent */
  useEffect(() => {
    if (!panToArea || !mapRef.current) return
    try { mapRef.current.setView([panToArea.lat, panToArea.lon], 13, { animate: true }) } catch {}
  }, [panToArea])

  /* Init map once — split basemap so labels render above heatmap */
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    if (mapRef.current) return
    if (container._leaflet_id) return  // guard double-init

    let map
    try {
      map = L.map(container, {
        center: HYD_CENTER, zoom: 11, zoomControl: true, scrollWheelZoom: true,
      })
    } catch { return }

    /* Custom pane stack:
       tilePane (200) → heatmapPane (350) → labelsPane (450) → markerPane (600) */
    map.createPane('heatmapPane')
    map.getPane('heatmapPane').style.zIndex = 350

    map.createPane('labelsPane')
    map.getPane('labelsPane').style.zIndex = 450
    map.getPane('labelsPane').style.pointerEvents = 'none'

    /* Base map — roads & geography, no text labels */
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
      subdomains: 'abcd', maxZoom: 19,
    }).addTo(map)

    /* Labels layer — sits above the heatmap canvas */
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png', {
      pane: 'labelsPane',
      subdomains: 'abcd', maxZoom: 19,
    }).addTo(map)

    mapRef.current = map
    return () => { try { map.remove() } catch {}; mapRef.current = null }
  }, []) // eslint-disable-line

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

  /* Draw / update heatmap whenever data changes */
  useEffect(() => {
    const map = mapRef.current
    if (!map || !areas.length) return

    if (heatRef.current) { try { heatRef.current.remove() } catch {}; heatRef.current = null }
    Object.values(markersRef.current).forEach(m => { try { m.remove() } catch {} })
    markersRef.current = {}

    const points = areas.map(area => {
      const score      = getFilterScore(area, filter)
      const colorScore = filter === 'gaps' ? 100 - score : score
      const color      = scoreToHex(colorScore)
      const dispScore  = filter === 'gaps' ? area.meta.gap : score
      const isSel      = area.id === selectedAreaId
      return { lat: area.lat, lon: area.lon, rgb: canvasRgb(colorScore), color, dispScore, isSel, area }
    })

    try {
      const heat = new CanvasHeatLayer(points)
      heat.addTo(map)
      heatRef.current = heat
    } catch {}

    /* Invisible circle markers — tooltip targets only, no visual */
    for (const pt of points) {
      const marker = L.circleMarker([pt.lat, pt.lon], {
        radius:      pt.isSel ? 12 : 8,
        color:       dk(pt.color),
        weight:      pt.isSel ? 2 : 1,
        opacity:     pt.isSel ? 0.8 : 0,
        fillColor:   pt.color,
        fillOpacity: pt.isSel ? 0.15 : 0,
        interactive: true,
      })

      marker.bindTooltip(
        `<div class="amm__tip-name">${pt.area.name}</div>
         <div class="amm__tip-score" style="color:${dk(pt.color)}">${pt.dispScore}<span> ${filter === 'gaps' ? 'gap' : '/100'}</span></div>
         <div class="amm__tip-type">${pt.area.areaType.replace(/_/g, ' ').toUpperCase()}</div>`,
        { sticky: true, className: 'amm__tooltip' }
      )

      marker.on('click', () => {
        onAreaClick?.(pt.area)
        map.setView([pt.lat, pt.lon], 13, { animate: true })
      })

      marker.addTo(map)
      markersRef.current[pt.area.id] = marker
    }
  }, [areas, filter, selectedAreaId]) // eslint-disable-line

  return (
    <div
      ref={containerRef}
      className="amm__map"
      role="application"
      aria-label="Hyderabad area mobility heatmap"
    />
  )
}
