/**
 * OpenWeatherMap Air Pollution API integration.
 * Uses the same VITE_WEATHER_KEY as weather.js.
 * Endpoint: /data/2.5/air_pollution
 *
 * The API returns an OpenWeather 1-5 index plus raw pollutant components.
 * We convert pm2_5 → standard US AQI (0-500) for familiar display.
 */

const KEY = import.meta.env.VITE_WEATHER_KEY

const _cache = new Map()
const TTL    = 30 * 60 * 1000  // 30 min — AQI changes slowly

// ── PM2.5 → standard US AQI conversion ───────────────────────────────────────

function _pm25ToAqi(pm25) {
  // Linear interpolation between AQI breakpoints (EPA standard)
  const bp = [
    [0,     12,    0,   50 ],
    [12.1,  35.4,  51,  100],
    [35.5,  55.4,  101, 150],
    [55.5,  150.4, 151, 200],
    [150.5, 250.4, 201, 300],
    [250.5, 350.4, 301, 400],
    [350.5, 500.4, 401, 500],
  ]
  for (const [lo, hi, alo, ahi] of bp) {
    if (pm25 <= hi) {
      return Math.round(((ahi - alo) / (hi - lo)) * (pm25 - lo) + alo)
    }
  }
  return 500
}

// ── Metadata by AQI value ─────────────────────────────────────────────────────

export function aqiMeta(value) {
  if (value <= 50)  return {
    label: 'Good', color: '#16a34a', bg: '#dcfce7', border: '#86efac', penalty: 0,
    message: 'Air quality is good — safe for outdoor commute',
  }
  if (value <= 100) return {
    label: 'Moderate', color: '#ca8a04', bg: '#fef9c3', border: '#fde047', penalty: 3,
    message: 'Moderate air quality — acceptable for most commuters',
  }
  if (value <= 150) return {
    label: 'Sensitive', color: '#ea580c', bg: '#ffedd5', border: '#fed7aa', penalty: 8,
    message: 'Unhealthy for sensitive groups — limit prolonged outdoor exposure',
  }
  if (value <= 200) return {
    label: 'Unhealthy', color: '#dc2626', bg: '#fee2e2', border: '#fca5a5', penalty: 14,
    message: 'Air quality unhealthy — avoid prolonged outdoor travel',
  }
  if (value <= 300) return {
    label: 'Very Poor', color: '#9333ea', bg: '#faf5ff', border: '#d8b4fe', penalty: 20,
    message: 'Very poor air — wear a mask and reduce outdoor time',
  }
  return {
    label: 'Severe', color: '#7f1d1d', bg: '#fef2f2', border: '#fecaca', penalty: 25,
    message: 'Hazardous air quality — avoid all non-essential outdoor travel',
  }
}

// ── Fetch ─────────────────────────────────────────────────────────────────────

export async function fetchAQI(lat, lon) {
  if (!KEY) return null

  const cacheKey = `${lat.toFixed(2)},${lon.toFixed(2)}`
  const hit = _cache.get(cacheKey)
  if (hit && Date.now() - hit.ts < TTL) return hit.data

  const ctrl    = new AbortController()
  const timeout = setTimeout(() => ctrl.abort(), 5000)

  try {
    const url = `https://api.openweathermap.org/data/2.5/air_pollution?lat=${lat}&lon=${lon}&appid=${KEY}`
    const res = await fetch(url, { signal: ctrl.signal })
    clearTimeout(timeout)
    if (!res.ok) return null

    const json = await res.json()
    const item = json.list?.[0]
    if (!item) return null

    const pm25  = item.components?.pm2_5 ?? 0
    const pm10  = item.components?.pm10  ?? 0
    const value = _pm25ToAqi(pm25)
    const meta  = aqiMeta(value)

    const data = {
      ...meta,
      value,
      pm25:    Math.round(pm25 * 10) / 10,
      pm10:    Math.round(pm10 * 10) / 10,
      owIndex: item.main?.aqi ?? 1,  // OpenWeather 1-5 scale (kept for reference)
    }
    _cache.set(cacheKey, { data, ts: Date.now() })
    return data
  } catch {
    clearTimeout(timeout)
    return null
  }
}
