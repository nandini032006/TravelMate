import { useState, useCallback } from 'react'

const KEY = 'tm_recent_locations'
const MAX = 5

function load() {
  try { return JSON.parse(localStorage.getItem(KEY)) || [] } catch { return [] }
}

function persist(items) {
  try { localStorage.setItem(KEY, JSON.stringify(items)) } catch {}
}

export function useRecentLocations() {
  const [recents, setRecents] = useState(load)

  const addRecent = useCallback((loc) => {
    if (!loc?.name || !loc?.lat) return
    setRecents(prev => {
      const filtered = prev.filter(r => r.name !== loc.name)
      const next = [{ name: loc.name, lat: loc.lat, lon: loc.lon }, ...filtered].slice(0, MAX)
      persist(next)
      return next
    })
  }, [])

  return { recents, addRecent }
}
