import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import { getMetroShapes, getMmtsShapes } from '../../services/transitData'
import { getMeta } from '../../utils/modeColors'
import { useLang } from '../../contexts/LanguageContext'
import { translateStopName } from '../../translations/stationNames'
import { MapLayerControl } from './MapLayerControl'
import 'leaflet/dist/leaflet.css'
import './MapView.css'

delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl:       'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl:     'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
})

const HYD_CENTER = [17.385, 78.4867]
const HYD_ZOOM   = 12

function _isTransit(mode) { return mode !== 'walk' && mode !== 'auto' }

export function MapView({ src, dst, selectedRoute, hoveredRoute, onMapClick, riskZones = [], traffic = null, aqi = null, fullscreen = false }) {
  const containerRef  = useRef(null)
  const mapRef        = useRef(null)
  const layersRef     = useRef({ src: null, dst: null, route: null, hoverRoute: null, metro: null, mmts: null, riskZones: null })
  const onMapClickRef = useRef(onMapClick)
  const prevSrcRef    = useRef(null)
  const prevDstRef    = useRef(null)
  const [mapLayers, setMapLayers] = useState({ metro: true, mmts: false })
  useEffect(() => { onMapClickRef.current = onMapClick }, [onMapClick])
  const { t, lang } = useLang()

  // ── Init map once ────────────────────────────────────────────────────────
  useEffect(() => {
    if (mapRef.current) return
    const map = L.map(containerRef.current, { center: HYD_CENTER, zoom: HYD_ZOOM })
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
      subdomains: 'abcd',
      maxZoom: 19,
    }).addTo(map)
    map.on('click', (e) => onMapClickRef.current?.(e.latlng.lat, e.latlng.lng))
    mapRef.current = map

    // Load metro shapes (on by default)
    layersRef.current.metro = _buildMetroGroup()
    layersRef.current.metro?.addTo(map)

    // Build MMTS group (off by default — added when toggled on)
    layersRef.current.mmts = _buildMmtsGroup()

    return () => { map.remove(); mapRef.current = null }
  }, []) // eslint-disable-line

  // ── Invalidate size when fullscreen toggles ──────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const timers = [150, 350, 600].map(delay =>
      setTimeout(() => { try { map.invalidateSize({ animate: false }) } catch {} }, delay)
    )
    return () => timers.forEach(clearTimeout)
  }, [fullscreen])

  // ── Metro layer visibility ────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    const grp = layersRef.current.metro
    if (!map || !grp) return
    if (mapLayers.metro) grp.addTo(map)
    else grp.remove()
  }, [mapLayers.metro])

  // ── MMTS layer visibility ─────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    const grp = layersRef.current.mmts
    if (!map || !grp) return
    if (mapLayers.mmts) grp.addTo(map)
    else grp.remove()
  }, [mapLayers.mmts])

  // ── Source marker ────────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    layersRef.current.src?.remove()
    if (src?.lat) {
      const name  = lang === 'te' ? translateStopName(src.name) : src.name
      const label = `${t.mapFrom}: ${name}`
      layersRef.current.src = _endpointMarker(src.lat, src.lon, '#22C55E', label).addTo(map)
      if (src !== prevSrcRef.current) {
        map.setView([src.lat, src.lon], Math.max(map.getZoom(), 14))
        prevSrcRef.current = src
      }
    }
  }, [src, lang, t])

  // ── Destination marker ───────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    layersRef.current.dst?.remove()
    if (dst?.lat) {
      const name  = lang === 'te' ? translateStopName(dst.name) : dst.name
      const label = `${t.mapTo}: ${name}`
      layersRef.current.dst = _endpointMarker(dst.lat, dst.lon, '#EF4444', label).addTo(map)
      if (dst !== prevDstRef.current) prevDstRef.current = dst
    }
  }, [dst, lang, t])

  // ── Route polylines ──────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    layersRef.current.route?.remove()
    layersRef.current.route = null
    if (!selectedRoute) return

    const group = L.layerGroup()
    const steps = selectedRoute.steps

    // Congestion tint derived from live traffic ratio
    const tRatio = traffic?.avgRatio ?? null
    const congestionColor   = tRatio == null ? null
      : tRatio < 0.40 ? '#ef4444'
      : tRatio < 0.60 ? '#f97316'
      : tRatio < 0.80 ? '#f59e0b'
      : null
    const congestionOpacity = tRatio == null ? 0
      : tRatio < 0.40 ? 0.32
      : tRatio < 0.60 ? 0.24
      : tRatio < 0.80 ? 0.14
      : 0

    for (const step of steps) {
      const meta   = getMeta(step.mode)
      const coords = _stepCoords(step)
      if (coords.length < 2) continue

      const isTransitStep = _isTransit(step.mode)
      let lineStyle
      if (step.mode === 'walk') {
        lineStyle = { color: meta.color, weight: 3, dashArray: '8 6', opacity: 0.8, lineCap: 'round' }
      } else if (step.mode === 'auto') {
        lineStyle = { color: meta.color, weight: 4, dashArray: '3 5', opacity: 0.85, lineCap: 'round' }
      } else if (step.mode === 'metro') {
        lineStyle = { color: meta.color, weight: 7, opacity: 0.95, lineCap: 'round', lineJoin: 'round' }
      } else {
        lineStyle = { color: meta.color, weight: 5, opacity: 0.9, lineCap: 'round', lineJoin: 'round' }
      }

      // Congestion gradient underlayer on road segments (not metro/mmts fixed guideways)
      if (congestionColor && congestionOpacity > 0 && step.mode !== 'metro' && step.mode !== 'mmts') {
        L.polyline(coords, {
          color:       congestionColor,
          weight:      lineStyle.weight + 6,
          opacity:     congestionOpacity,
          lineCap:     'round',
          lineJoin:    'round',
          interactive: false,
        }).addTo(group)
      }

      // Glow underlayer for transit lines
      if (isTransitStep) {
        L.polyline(coords, {
          color:       meta.color,
          weight:      lineStyle.weight + 8,
          opacity:     0,
          fillOpacity: 0,
          lineCap:     'round',
          lineJoin:    'round',
          className:   'tm-route-glow',
          interactive: false,
        }).addTo(group)
      }

      const modeLabel = t[step.mode] || meta.label
      const fromName  = lang === 'te' ? translateStopName(step.from_name) : step.from_name
      const toName    = lang === 'te' ? translateStopName(step.to_name)   : step.to_name
      const tooltip   = step.line_name
        ? `${modeLabel} · ${step.line_name}`
        : `${modeLabel}: ${fromName} → ${toName}`

      L.polyline(coords, lineStyle).bindTooltip(tooltip, { sticky: true }).addTo(group)

      if (step.mode === 'walk' || step.mode === 'auto') {
        _smallDot(coords[0], fromName, meta.color).addTo(group)
        _smallDot(coords[coords.length - 1], toName, meta.color).addTo(group)
      } else {
        _stopCircle(coords[0], fromName, meta.color).addTo(group)
        _stopCircle(coords[coords.length - 1], toName, meta.color).addTo(group)
      }
    }

    // Transfer markers
    let hadTransit = false
    for (const step of steps) {
      if (!_isTransit(step.mode)) continue
      if (hadTransit && step.from_coord?.lat) {
        const name    = lang === 'te' ? translateStopName(step.from_name) : step.from_name
        const tooltip = `${t.mapTransfer}: ${name} → ${step.line_name || ''}`
        _transferMarker([step.from_coord.lat, step.from_coord.lon], tooltip).addTo(group)
      }
      hadTransit = true
    }

    group.addTo(map)
    layersRef.current.route = group

    const allCoords = steps.flatMap(s => _stepCoords(s))
    if (allCoords.length > 1) {
      map.fitBounds(L.latLngBounds(allCoords), { padding: [60, 60], maxZoom: 16 })
    }
  }, [selectedRoute, traffic, lang, t])

  // ── Risk zone circles ────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    layersRef.current.riskZones?.remove()
    layersRef.current.riskZones = null
    if (!riskZones.length) return

    const RADII = { very_high: 1200, high: 900, moderate_high: 700 }

    const group = L.layerGroup()
    for (const zone of riskZones) {
      const color  = _riskColor(zone.riskLevel)
      const radius = RADII[zone.riskLevel] || 700

      // Outer glow ring for active zones
      if (zone.isActive) {
        L.circle([zone.lat, zone.lon], {
          radius:      radius * 1.35,
          color,
          weight:      0,
          fillColor:   color,
          fillOpacity: 0.06,
          interactive: false,
        }).addTo(group)
      }

      // Main zone circle
      L.circle([zone.lat, zone.lon], {
        radius,
        color,
        weight:      zone.isActive ? 2.5 : 1.5,
        opacity:     zone.isActive ? 0.9 : 0.5,
        fillColor:   color,
        fillOpacity: zone.isActive ? 0.22 : 0.08,
      }).bindTooltip(
        `<div style="font-size:12px;font-weight:700">${zone.name}</div>
         <div style="font-size:10px;color:#64748b">${zone.area}</div>
         ${zone.isActive ? `<div style="font-size:10px;color:${color};font-weight:700;margin-top:2px">⚡ Active now</div>` : ''}`,
        { sticky: true, className: 'tm-risk-tooltip' }
      ).addTo(group)

      if (zone.isActive) {
        L.marker([zone.lat, zone.lon], { icon: _riskPulseIcon(color) }).addTo(group)
      }
    }

    group.addTo(map)
    layersRef.current.riskZones = group
  }, [riskZones])

  // ── Hover route preview ──────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    layersRef.current.hoverRoute?.remove()
    layersRef.current.hoverRoute = null
    if (!hoveredRoute) return

    const group = L.layerGroup()
    for (const step of hoveredRoute.steps || []) {
      if (!_isTransit(step.mode)) continue
      const meta   = getMeta(step.mode)
      const coords = _stepCoords(step)
      if (coords.length < 2) continue
      L.polyline(coords, {
        color:     meta.color,
        weight:    5,
        opacity:   0.45,
        dashArray: '10 6',
        lineCap:   'round',
        lineJoin:  'round',
      }).addTo(group)
    }
    group.addTo(map)
    layersRef.current.hoverRoute = group
  }, [hoveredRoute])

  const aqiBadge = aqi?.value != null ? _aqiBadgeMeta(aqi.value) : null

  return (
    <div className={`map-view${fullscreen ? ' map-view--fullscreen' : ''}`}>
      <div
        ref={containerRef}
        className="map-view__container"
        role="application"
        aria-label="Interactive map of Hyderabad transit routes. Use Search to plan a journey."
        tabIndex={0}
      />
      <MapLayerControl layers={mapLayers} onChange={setMapLayers} />
      {aqiBadge && (
        <div className="map-aqi-badge" style={{ background: aqiBadge.bg, borderColor: aqiBadge.color }} aria-label={`Air quality: AQI ${aqi.value}`}>
          <span className="map-aqi-badge__icon">🌬</span>
          <span className="map-aqi-badge__val" style={{ color: aqiBadge.color }}>AQI {aqi.value}</span>
          <span className="map-aqi-badge__label" style={{ color: aqiBadge.color }}>{aqiBadge.label}</span>
        </div>
      )}
    </div>
  )
}

// ── Layer builders ───────────────────────────────────────────────────────────

function _buildMetroGroup() {
  try {
    const shapes = getMetroShapes()
    const group  = L.layerGroup()
    for (const shape of shapes) {
      if (shape.points.length < 2) continue
      L.polyline(shape.points.map(p => [p.lat, p.lon]), {
        color: shape.color, weight: 4, opacity: 0.3,
      }).bindTooltip(shape.line_name, { sticky: true }).addTo(group)
    }
    return group
  } catch { return null }
}

function _buildMmtsGroup() {
  try {
    const shapes = getMmtsShapes()
    const group  = L.layerGroup()
    for (const shape of shapes) {
      if (shape.points.length < 2) continue
      L.polyline(shape.points.map(p => [p.lat, p.lon]), {
        color: shape.color, weight: 3, opacity: 0.5, dashArray: '6 4',
      }).bindTooltip(`MMTS: ${shape.line_name}`, { sticky: true }).addTo(group)
    }
    return group
  } catch { return null }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function _stepCoords(step) {
  if (step.polyline?.length >= 2) {
    return step.polyline
      .filter(p => p.lat !== 0 && p.lon !== 0)
      .map(p => [p.lat, p.lon])
  }
  const fc = step.from_coord
  const tc = step.to_coord
  if (fc?.lat && tc?.lat && (fc.lat !== 0) && (tc.lat !== 0)) {
    return [[fc.lat, fc.lon], [tc.lat, tc.lon]]
  }
  return []
}

function _endpointMarker(lat, lon, color, tooltip) {
  const icon = L.divIcon({
    className: '',
    html: `<div style="width:18px;height:18px;border-radius:50%;
      background:${color};border:3px solid #fff;
      box-shadow:0 2px 8px rgba(0,0,0,.45)"></div>`,
    iconSize: [18, 18], iconAnchor: [9, 9],
  })
  return L.marker([lat, lon], { icon })
    .bindTooltip(tooltip, { permanent: true, direction: 'top', className: 'tm-endpoint-label' })
}

function _stopCircle(latlng, name, color) {
  const icon = L.divIcon({
    className: '',
    html: `<div style="width:11px;height:11px;border-radius:50%;
      background:#fff;border:2.5px solid ${color};
      box-shadow:0 1px 4px rgba(0,0,0,.3)"></div>`,
    iconSize: [11, 11], iconAnchor: [5, 5],
  })
  return L.marker(latlng, { icon }).bindTooltip(name, { direction: 'top' })
}

function _smallDot(latlng, name, color) {
  const icon = L.divIcon({
    className: '',
    html: `<div style="width:8px;height:8px;border-radius:50%;
      background:${color};opacity:0.7"></div>`,
    iconSize: [8, 8], iconAnchor: [4, 4],
  })
  return L.marker(latlng, { icon }).bindTooltip(name, { direction: 'top' })
}

function _transferMarker(latlng, tooltip) {
  const icon = L.divIcon({
    className: '',
    html: `<div style="width:22px;height:22px;border-radius:50%;
      background:#fff;border:3px solid #F59E0B;
      box-shadow:0 2px 8px rgba(0,0,0,.4);
      display:flex;align-items:center;justify-content:center;
      font-size:11px;line-height:1">⇄</div>`,
    iconSize: [22, 22], iconAnchor: [11, 11],
  })
  return L.marker(latlng, { icon }).bindTooltip(tooltip, { direction: 'top' })
}

function _riskColor(level) {
  switch (level) {
    case 'very_high':    return '#ef4444'
    case 'high':         return '#f97316'
    case 'moderate_high':return '#f59e0b'
    default:             return '#22c55e'
  }
}

function _riskPulseIcon(color) {
  return L.divIcon({
    className: '',
    html: `<div class="rz-pulse-wrap">
      <div class="rz-pulse-ring" style="background:${color}22;border:2px solid ${color}66"></div>
      <div class="rz-pulse-dot" style="background:${color}"></div>
    </div>`,
    iconSize:   [24, 24],
    iconAnchor: [12, 12],
  })
}

function _aqiBadgeMeta(value) {
  if (value <= 50)  return { label: 'Good',      color: '#16a34a', bg: 'rgba(22,163,74,0.12)'  }
  if (value <= 100) return { label: 'Moderate',  color: '#d97706', bg: 'rgba(217,119,6,0.12)'  }
  if (value <= 150) return { label: 'Unhealthy', color: '#ea580c', bg: 'rgba(234,88,12,0.12)'  }
  if (value <= 200) return { label: 'Very Unhealthy', color: '#dc2626', bg: 'rgba(220,38,38,0.12)' }
  return                   { label: 'Hazardous', color: '#7c3aed', bg: 'rgba(124,58,237,0.12)' }
}
