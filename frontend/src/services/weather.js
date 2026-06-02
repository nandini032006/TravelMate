/**
 * OpenWeather Current Weather integration.
 * Returns null gracefully when key is absent or request fails.
 * Set VITE_WEATHER_KEY in .env to enable live weather data.
 */

const KEY = import.meta.env.VITE_WEATHER_KEY

const _cache = new Map()
const TTL    = 15 * 60 * 1000   // 15 minutes

const CONDITION = {
  Thunderstorm: { label: 'Thunderstorm',    icon: '⛈',  penalty: 20, level: 'severe'   },
  Drizzle:      { label: 'Drizzle',         icon: '🌦',  penalty: 7,  level: 'minor'    },
  Rain:         { label: 'Rain',            icon: '🌧',  penalty: 12, level: 'moderate' },
  Snow:         { label: 'Snow',            icon: '❄️',  penalty: 15, level: 'moderate' },
  Fog:          { label: 'Low visibility',  icon: '🌫',  penalty: 14, level: 'moderate' },
  Mist:         { label: 'Mist',            icon: '🌫',  penalty: 8,  level: 'minor'    },
  Haze:         { label: 'Haze',            icon: '🌫',  penalty: 5,  level: 'minor'    },
  Clear:        { label: 'Clear',           icon: '☀️',  penalty: 0,  level: 'clear'    },
  Clouds:       { label: 'Cloudy',          icon: '☁️',  penalty: 0,  level: 'clear'    },
}

/**
 * Fetch current weather for a lat/lon.
 * Returns { label, icon, penalty, level, temp_c, description } or null.
 */
export async function fetchWeather(lat, lon) {
  if (!KEY) return null

  const key = `${lat.toFixed(2)},${lon.toFixed(2)}`
  const hit = _cache.get(key)
  if (hit && Date.now() - hit.ts < TTL) return hit.data

  const ctrl    = new AbortController()
  const timeout = setTimeout(() => ctrl.abort(), 5000)

  try {
    const url = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${KEY}&units=metric`
    const res = await fetch(url, { signal: ctrl.signal })
    clearTimeout(timeout)
    if (!res.ok) return null

    const json = await res.json()
    const main  = json.weather?.[0]?.main  || 'Clear'
    const desc  = json.weather?.[0]?.description || ''
    const temp  = Math.round(json.main?.temp ?? 28)
    const meta  = { ...(CONDITION[main] || CONDITION.Clear) }

    const rain_1h    = json.rain?.['1h'] ?? 0
    const feels_like = Math.round(json.main?.feels_like ?? temp)
    const humidity   = json.main?.humidity ?? null
    const wind_speed = Math.round((json.wind?.speed ?? 0) * 3.6) // m/s → km/h

    // Escalate for heavy rain
    if (main === 'Rain' && rain_1h > 5) {
      meta.label   = 'Heavy rain'
      meta.penalty = 18
    }
    // Extreme heat warning
    if (temp >= 42) meta.penalty = Math.max(meta.penalty, 8)

    const data = {
      ...meta,
      temp_c: temp,
      feels_like,
      humidity,
      rain_1h,
      wind_speed,
      description: desc,
      main,
    }
    _cache.set(key, { data, ts: Date.now() })
    return data
  } catch {
    clearTimeout(timeout)
    return null
  }
}
