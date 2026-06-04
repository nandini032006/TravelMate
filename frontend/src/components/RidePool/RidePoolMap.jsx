import { useEffect, useRef, useState, useCallback } from 'react'
import L from 'leaflet'
import { MapLayerControl } from '../MapView/MapLayerControl'
import { fetchOsrmRoute } from '../../utils/osrm'
import './RidePool.css'

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

const HYD_CENTER = [17.385, 78.4867]
const HYD_ZOOM   = 12

function toLatLonPair(pt) { return [pt.lat, pt.lon] }
function fallback(a, b)   { return [[a.lat, a.lon], [b.lat, b.lon]] }

function vehicleIcon(type) {
  const emoji = type === 'bike' ? '🏍' : '🚗'
  return L.divIcon({
    className: '',
    html: `<div class="rp__veh-marker">${emoji}</div>`,
    iconAnchor: [14, 14],
    iconSize:   [28, 28],
  })
}

function pulseMarker(lat, lon, color) {
  return L.marker([lat, lon], {
    icon: L.divIcon({
      className: '',
      html: `<div class="rp__pulse-wrap">
        <div class="rp__pulse-ring" style="background:${color}"></div>
        <div class="rp__pulse-dot"  style="background:${color}"></div>
      </div>`,
      iconAnchor: [10, 10],
      iconSize:   [20, 20],
    }),
    zIndexOffset: 500,
  })
}

function circleMarker(lat, lon, color, label, sz = 13) {
  return L.marker([lat, lon], {
    icon: L.divIcon({
      className: '',
      html: `<div style="width:${sz}px;height:${sz}px;background:${color};border:2.5px solid #fff;border-radius:50%;box-shadow:0 1px 5px rgba(0,0,0,.28)" title="${label}"></div>`,
      iconAnchor: [sz / 2, sz / 2],
      iconSize:   [sz, sz],
    }),
  })
}

function pickupLabel(lat, lon, text) {
  return L.marker([lat, lon], {
    icon: L.divIcon({
      className: '',
      html: `<div class="rp__pickup-marker">📍 ${text}</div>`,
      iconAnchor: [0, 16],
    }),
  })
}

export function RidePoolMap({ from, to, selectedMatch }) {
  const containerRef = useRef(null)
  const mapRef       = useRef(null)
  const layersRef    = useRef({ user: null, rider: null, shared: null, markers: [], baseTile: null })
  const animRef      = useRef(null)
  const vehicleRef   = useRef(null)

  const [baseTile, setBaseTile] = useState(() => {
    try { return sessionStorage.getItem('tm_maptile') || 'standard' } catch { return 'standard' }
  })
  const [userGeom,  setUserGeom]  = useState(null)
  const [riderGeom, setRiderGeom] = useState(null)

  const handleBaseTileChange = useCallback((key) => {
    setBaseTile(key)
    try { sessionStorage.setItem('tm_maptile', key) } catch {}
  }, [])

  // ── Map init ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (mapRef.current) return
    const map = L.map(containerRef.current, { center: HYD_CENTER, zoom: HYD_ZOOM })
    mapRef.current = map
    const raf = requestAnimationFrame(() => map.invalidateSize())
    return () => { cancelAnimationFrame(raf); map.remove(); mapRef.current = null }
  }, [])

  // ── Tile swap ───────────────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current; if (!map) return
    const old = layersRef.current.baseTile; if (old) old.remove()
    const cfg = TILE_URLS[baseTile] || TILE_URLS.standard
    const layer = L.tileLayer(cfg.url, cfg.options); layer.addTo(map)
    layersRef.current.baseTile = layer
  }, [baseTile])

  // ── Fetch road geometry for user route ──────────────────────────────────────
  useEffect(() => {
    setUserGeom(null)
    if (!from?.lat || !to?.lat) return
    let cancelled = false
    fetchOsrmRoute([toLatLonPair(from), toLatLonPair(to)])
      .then(pts => { if (!cancelled) setUserGeom(pts || fallback(from, to)) })
    return () => { cancelled = true }
  }, [from?.lat, from?.lon, to?.lat, to?.lon])

  // ── Fetch road geometry for selected rider's route ──────────────────────────
  useEffect(() => {
    setRiderGeom(null)
    const rf = selectedMatch?.riderFrom, rt = selectedMatch?.riderTo
    if (!rf?.lat || !rt?.lat) return
    let cancelled = false
    fetchOsrmRoute([toLatLonPair(rf), toLatLonPair(rt)])
      .then(pts => { if (!cancelled) setRiderGeom(pts || fallback(rf, rt)) })
    return () => { cancelled = true }
  }, [
    selectedMatch?.riderFrom?.lat, selectedMatch?.riderFrom?.lon,
    selectedMatch?.riderTo?.lat,   selectedMatch?.riderTo?.lon,
  ])

  // ── Draw routes ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current; if (!map) return

    if (animRef.current)    { clearInterval(animRef.current);  animRef.current    = null }
    if (vehicleRef.current) { vehicleRef.current.remove();     vehicleRef.current = null }

    const lr = layersRef.current
    if (lr.user)   { lr.user.remove();   lr.user   = null }
    if (lr.rider)  { lr.rider.remove();  lr.rider  = null }
    if (lr.shared) { lr.shared.remove(); lr.shared = null }
    lr.markers.forEach(m => m.remove())
    lr.markers = []

    if (!from?.lat || !to?.lat) return

    const fromPt  = [from.lat, from.lon]
    const toPt    = [to.lat,   to.lon]
    const userPts = userGeom || [fromPt, toPt]

    // User route — solid blue road-following line
    lr.user = L.polyline(userPts, {
      color: '#3b82f6', weight: 5, opacity: 0.85,
    }).addTo(map)

    // Pickup (green pulse) and drop (red circle) markers
    lr.markers.push(pulseMarker(from.lat, from.lon, '#16a34a').addTo(map))
    lr.markers.push(circleMarker(to.lat, to.lon, '#dc2626', 'Drop', 14).addTo(map))

    if (selectedMatch) {
      const { riderFrom, riderTo, pickup, driver } = selectedMatch
      const riderPts = riderGeom || [[riderFrom.lat, riderFrom.lon], [riderTo.lat, riderTo.lon]]

      // Shared corridor highlight underneath the user route
      lr.shared = L.polyline(userPts, {
        color: '#22c55e', weight: 9, opacity: 0.28, lineCap: 'round',
      }).addTo(map)

      // Rider route — dashed orange
      lr.rider = L.polyline(riderPts, {
        color: '#f97316', weight: 3, opacity: 0.6, dashArray: '8 6',
      }).addTo(map)

      // Re-add user route on top so it renders above shared corridor
      lr.user.remove()
      lr.user = L.polyline(userPts, { color: '#3b82f6', weight: 5, opacity: 0.85 }).addTo(map)

      // Pickup label and rider origin dot
      lr.markers.push(pickupLabel(from.lat + 0.0018, from.lon + 0.0015, pickup).addTo(map))
      lr.markers.push(circleMarker(riderFrom.lat, riderFrom.lon, '#f97316', 'Rider', 10).addTo(map))

      // Animated vehicle icon from rider origin toward user pickup
      const vMark = L.marker([riderFrom.lat, riderFrom.lon], {
        icon: vehicleIcon(driver.vehicle.type), zIndexOffset: 2000,
      }).addTo(map)
      vehicleRef.current = vMark

      let step = 0
      const STEPS = 200
      const sLat = riderFrom.lat, sLon = riderFrom.lon
      const eLat = from.lat,      eLon = from.lon
      animRef.current = setInterval(() => {
        step = (step + 1) % STEPS
        const t    = step / STEPS
        const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t
        vMark.setLatLng([sLat + (eLat - sLat) * ease, sLon + (eLon - sLon) * ease])
      }, 100)
    }

    // Fit map to all route geometry
    const allPts = [...userPts]
    if (selectedMatch) {
      const { riderFrom, riderTo } = selectedMatch
      const riderPts = riderGeom || [[riderFrom.lat, riderFrom.lon], [riderTo.lat, riderTo.lon]]
      allPts.push(...riderPts)
    }
    map.fitBounds(L.latLngBounds(allPts).pad(0.15), { animate: true, duration: 0.5 })

    return () => {
      if (animRef.current)    { clearInterval(animRef.current);  animRef.current    = null }
      if (vehicleRef.current) { vehicleRef.current.remove();     vehicleRef.current = null }
    }
  }, [from, to, selectedMatch, userGeom, riderGeom])

  return (
    <div className="rp__map-wrap">
      <div ref={containerRef} className="rp__map" />
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
