import { useState, useCallback } from 'react'
import { reverseGeocode } from '../services/nominatim'

export function useGeolocation() {
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState(null)

  const locate = useCallback(async (onSuccess) => {
    if (!navigator.geolocation) {
      setError('Geolocation not supported by your browser')
      return
    }
    setLoading(true)
    setError(null)
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude: lat, longitude: lon } = pos.coords
        try {
          const name = await reverseGeocode(lat, lon)
          onSuccess({ lat, lon, name })
        } catch {
          onSuccess({ lat, lon, name: `${lat.toFixed(5)},${lon.toFixed(5)}` })
        } finally {
          setLoading(false)
        }
      },
      (err) => {
        setError(err.message)
        setLoading(false)
      },
      { timeout: 8000, maximumAge: 30000 }
    )
  }, [])

  return { locate, loading, error }
}
