import { useEffect, useRef } from 'react'
import L from 'leaflet'
import './RidePool.css'

const HYD_CENTER = [17.385, 78.4867]
const HYD_ZOOM   = 12

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
      iconAnchor: [sz/2, sz/2],
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
  const layersRef    = useRef({ user: null, rider: null, shared: null, markers: [] })
  const animRef      = useRef(null)
  const vehicleRef   = useRef(null)

  useEffect(() => {
    if (mapRef.current) return
    const map = L.map(containerRef.current, { center: HYD_CENTER, zoom: HYD_ZOOM })
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      attribution: '© OpenStreetMap contributors © CARTO',
      subdomains: 'abcd', maxZoom: 18,
    }).addTo(map)
    mapRef.current = map
    return () => { map.remove(); mapRef.current = null }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    // Stop previous animation
    if (animRef.current)  { clearInterval(animRef.current);  animRef.current  = null }
    if (vehicleRef.current) { vehicleRef.current.remove();   vehicleRef.current = null }

    // Clear previous layers
    const lr = layersRef.current
    if (lr.user)   { lr.user.remove();   lr.user   = null }
    if (lr.rider)  { lr.rider.remove();  lr.rider  = null }
    if (lr.shared) { lr.shared.remove(); lr.shared = null }
    lr.markers.forEach(m => m.remove())
    lr.markers = []

    if (!from?.lat || !to?.lat) return

    const fromPt = [from.lat, from.lon]
    const toPt   = [to.lat,   to.lon]

    // User route — solid blue
    lr.user = L.polyline([fromPt, toPt], { color: '#3b82f6', weight: 5, opacity: 0.75 }).addTo(map)

    // Endpoint markers
    lr.markers.push(pulseMarker(from.lat, from.lon, '#16a34a').addTo(map))
    lr.markers.push(circleMarker(to.lat, to.lon, '#dc2626', 'Drop', 14).addTo(map))

    if (selectedMatch) {
      const { riderFrom, riderTo, pickup, driver } = selectedMatch

      // Rider route — dashed orange
      lr.rider = L.polyline(
        [[riderFrom.lat, riderFrom.lon], [riderTo.lat, riderTo.lon]],
        { color: '#f97316', weight: 3, opacity: 0.55, dashArray: '7 5' }
      ).addTo(map)

      // Shared corridor — fat green dashed
      lr.shared = L.polyline([fromPt, toPt], {
        color: '#22c55e', weight: 7, opacity: 0.4, dashArray: '14 5',
      }).addTo(map)

      // Pickup label
      lr.markers.push(pickupLabel(from.lat + 0.0018, from.lon + 0.0015, pickup).addTo(map))

      // Rider origin (small orange dot)
      lr.markers.push(circleMarker(riderFrom.lat, riderFrom.lon, '#f97316', 'Rider', 10).addTo(map))

      // Vehicle icon — animated from riderFrom toward from (pickup)
      const vIcon  = vehicleIcon(driver.vehicle.type)
      const vMark  = L.marker([riderFrom.lat, riderFrom.lon], { icon: vIcon, zIndexOffset: 2000 }).addTo(map)
      vehicleRef.current = vMark

      let step = 0
      const STEPS  = 200
      const sLat   = riderFrom.lat, sLon = riderFrom.lon
      const eLat   = from.lat,      eLon = from.lon

      animRef.current = setInterval(() => {
        step = (step + 1) % STEPS
        const t    = step / STEPS
        const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t
        vMark.setLatLng([sLat + (eLat - sLat) * ease, sLon + (eLon - sLon) * ease])
      }, 100)
    }

    const pts = [fromPt, toPt]
    if (selectedMatch) {
      pts.push([selectedMatch.riderFrom.lat, selectedMatch.riderFrom.lon])
      pts.push([selectedMatch.riderTo.lat,   selectedMatch.riderTo.lon])
    }
    map.fitBounds(L.latLngBounds(pts).pad(0.18), { animate: true, duration: 0.5 })

    return () => {
      if (animRef.current)    { clearInterval(animRef.current);  animRef.current  = null }
      if (vehicleRef.current) { vehicleRef.current.remove();     vehicleRef.current = null }
    }
  }, [from, to, selectedMatch])

  return (
    <div className="rp__map-wrap">
      <div ref={containerRef} className="rp__map" />
    </div>
  )
}
