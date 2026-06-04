import { useState, useCallback } from 'react'
import { findRoutes } from '../utils/router'

const CACHE_TTL = 30 * 60 * 1000   // 30 minutes
const CACHE_VER = 'v5'              // bump when scoring logic changes to auto-invalidate old cache

// Purge all sessionStorage entries from any prior cache version on module load
;(function _purgeOldCache() {
  try {
    const prefix = 'tm_r_'
    const currentPrefix = `tm_r_${CACHE_VER}_`
    const toDelete = []
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i)
      if (k && k.startsWith(prefix) && !k.startsWith(currentPrefix)) toDelete.push(k)
    }
    toDelete.forEach(k => sessionStorage.removeItem(k))
  } catch {}
})()

function _cacheKey(src, dst) {
  return `tm_r_${CACHE_VER}_${src.lat.toFixed(4)},${src.lon.toFixed(4)}|${dst.lat.toFixed(4)},${dst.lon.toFixed(4)}`
}

function _getCache(key) {
  try {
    const raw = sessionStorage.getItem(key)
    if (!raw) return null
    const { data, ts } = JSON.parse(raw)
    if (Date.now() - ts > CACHE_TTL) { sessionStorage.removeItem(key); return null }
    return data
  } catch { return null }
}

function _setCache(key, data) {
  try { sessionStorage.setItem(key, JSON.stringify({ data, ts: Date.now() })) } catch {}
}

export function useRouting() {
  const [routes, setRoutes]   = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState(null)

  const planRoute = useCallback(async (src, dst) => {
    if (!src?.lat || !dst?.lat) return
    setLoading(true)
    setError(null)
    setRoutes(null)

    // Check cache first
    const key    = _cacheKey(src, dst)
    const cached = _getCache(key)
    if (cached) {
      console.log('[TM-DEBUG useRouting.js] CACHE HIT — returning sessionStorage result. Hard-refresh to bypass.')
      cached?.rtc?.all?.forEach((r, i) => {
        const name = r.steps?.find(s => s.mode !== 'walk' && s.mode !== 'auto')?.line_name ?? '?'
        console.log(`  cached rtc.all[${i}] "${name}" score=${r.commuter_score}`)
      })
      setRoutes(cached)
      setLoading(false)
      return
    }

    try {
      await new Promise(r => setTimeout(r, 0))
      const results = findRoutes(src.lat, src.lon, src.name, dst.lat, dst.lon, dst.name)
      console.log('[TM-DEBUG useRouting.js] CACHE MISS — fresh findRoutes() result:')
      results?.rtc?.all?.forEach((r, i) => {
        const name = r.steps?.find(s => s.mode !== 'walk' && s.mode !== 'auto')?.line_name ?? '?'
        console.log(`  fresh rtc.all[${i}] "${name}" score=${r.commuter_score}`)
      })
      const hasAny  = results && Object.values(results).some(m => m.all?.length > 0)
      if (!hasAny) {
        setError('No routes found between these locations. Try locations closer to Hyderabad transit stops.')
      } else {
        _setCache(key, results)
        setRoutes(results)
      }
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  const clearRoutes = useCallback(() => {
    setRoutes(null)
    setError(null)
  }, [])

  return { routes, loading, error, planRoute, clearRoutes }
}
