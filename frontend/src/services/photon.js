/**
 * photon.js — Direct Photon API calls for place/POI autocomplete.
 *
 * Photon is a free, no-key-required geocoding API backed by OpenStreetMap.
 * We call it directly from the frontend to avoid an unnecessary backend round-trip.
 *
 * Docs: https://photon.komoot.io
 */

const PHOTON_URL = 'https://photon.komoot.io/api/'

// Hyderabad bounding box — keeps results geographically relevant
const HYD_BBOX = '78.20,17.20,78.70,17.65'

export async function searchPhoton(query, limit = 8) {
  if (!query || query.trim().length < 2) return []

  const params = new URLSearchParams({
    q:     query.trim(),
    limit: String(limit),
    bbox:  HYD_BBOX,
    lang:  'en',
  })

  try {
    const res = await fetch(`${PHOTON_URL}?${params}`, {
      headers: { 'Accept': 'application/json' },
    })
    if (!res.ok) return []

    const data = await res.json()
    return (data.features || [])
      .map(f => {
        const props        = f.properties || {}
        const [lon, lat]   = f.geometry?.coordinates || []
        if (!lat || !lon) return null

        const name  = props.name || props.street || props.city || ''
        const city  = props.city || ''
        const label = [name, city].filter(Boolean).join(', ')
                   || `${parseFloat(lat).toFixed(4)},${parseFloat(lon).toFixed(4)}`

        return {
          label,
          lat:  parseFloat(lat),
          lon:  parseFloat(lon),
          type: props.osm_value || 'place',
        }
      })
      .filter(Boolean)
  } catch {
    return []
  }
}
