import { useState, useEffect } from 'react'
import { analyzeTraffic }           from '../services/liveTraffic'
import { fetchWeather }             from '../services/weather'
import { fetchAQI }                 from '../services/aqi'
import { fetchRouteInfrastructure } from '../services/overpass'

export function useLiveConditions(route) {
  const [traffic, setTraffic] = useState(null)
  const [weather, setWeather] = useState(null)
  const [aqi,     setAqi]     = useState(null)
  const [infra,   setInfra]   = useState(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!route?.steps?.length) {
      setTraffic(null); setWeather(null); setAqi(null); setInfra(null)
      setLoading(false)
      return
    }

    let cancelled = false
    setLoading(true)
    setTraffic(null); setWeather(null); setAqi(null); setInfra(null)

    const steps  = route.steps
    const midIdx = Math.floor(steps.length / 2)
    const mid    = steps[midIdx]
    const lat    = mid?.from_coord?.lat ?? steps[0]?.from_coord?.lat
    const lon    = mid?.from_coord?.lon ?? steps[0]?.from_coord?.lon

    Promise.allSettled([
      analyzeTraffic(route),
      lat && lon ? fetchWeather(lat, lon) : Promise.resolve(null),
      lat && lon ? fetchAQI(lat, lon)     : Promise.resolve(null),
      fetchRouteInfrastructure(route),
    ]).then(([tRes, wRes, aqiRes, infraRes]) => {
      if (cancelled) return
      setTraffic(tRes.status    === 'fulfilled' ? tRes.value    : null)
      setWeather(wRes.status    === 'fulfilled' ? wRes.value    : null)
      setAqi(aqiRes.status      === 'fulfilled' ? aqiRes.value  : null)
      setInfra(infraRes.status  === 'fulfilled' ? infraRes.value : null)
      setLoading(false)
    })

    return () => { cancelled = true }
  }, [route])

  return { traffic, weather, aqi, infra, loading }
}
