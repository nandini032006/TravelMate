const NOMINATIM_URL = 'https://nominatim.openstreetmap.org'

export async function reverseGeocode(lat, lon) {
  const params = new URLSearchParams({
    lat:            String(lat),
    lon:            String(lon),
    format:         'json',
    zoom:           '18',
    addressdetails: '0',
  })

  try {
    const res = await fetch(`${NOMINATIM_URL}/reverse?${params}`, {
      headers: {
        'Accept':          'application/json',
        'Accept-Language': 'en',
      },
    })
    if (!res.ok) return `${lat.toFixed(5)},${lon.toFixed(5)}`
    const data = await res.json()
    return data.display_name || `${lat.toFixed(5)},${lon.toFixed(5)}`
  } catch {
    return `${lat.toFixed(5)},${lon.toFixed(5)}`
  }
}
