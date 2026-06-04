import { useState, useRef, useCallback } from 'react'
import { searchPhoton } from '../services/photon'
import { searchStops } from '../services/transitData'

export function useAutocomplete() {
  const [suggestions, setSuggestions] = useState([])
  const [loading, setLoading]         = useState(false)
  const debounceRef = useRef(null)

  const search = useCallback((query) => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!query || query.length < 2) {
      setSuggestions([])
      return
    }
    setLoading(true)
    debounceRef.current = setTimeout(async () => {
      try {
        const [stopResults, photonResults] = await Promise.all([
          Promise.resolve(searchStops(query, 8)),
          searchPhoton(query),
        ])

        const seenCoords   = new Set()
        const seenNames    = new Set()
        const seenPrefixes = new Set()   // first 9 chars — catches "Lingampalli" vs "Lingampally"
        const merged       = []

        function _namePrefix(label) {
          const n = label.toLowerCase().trim()
          return n.slice(0, Math.min(n.length, 9))
        }

        // Transit stops take priority
        for (const item of stopResults) {
          seenCoords.add(`${item.lat.toFixed(4)},${item.lon.toFixed(4)}`)
          seenNames.add(item.label.toLowerCase().trim())
          seenPrefixes.add(_namePrefix(item.label))
          merged.push(item)
          if (merged.length >= 8) break
        }

        // Photon results fill remaining slots — skip if name, prefix, or coords already seen
        for (const item of photonResults) {
          if (merged.length >= 8) break
          const coordKey  = `${item.lat.toFixed(4)},${item.lon.toFixed(4)}`
          const nameKey   = item.label.toLowerCase().trim()
          const prefixKey = _namePrefix(item.label)
          if (seenCoords.has(coordKey) || seenNames.has(nameKey) || seenPrefixes.has(prefixKey)) continue
          seenCoords.add(coordKey)
          seenNames.add(nameKey)
          seenPrefixes.add(prefixKey)
          merged.push({ ...item, modes: [] })
        }

        setSuggestions(merged)
      } catch {
        setSuggestions([])
      } finally {
        setLoading(false)
      }
    }, 250)
  }, [])

  const clear = useCallback(() => {
    setSuggestions([])
    if (debounceRef.current) clearTimeout(debounceRef.current)
  }, [])

  return { suggestions, loading, search, clear }
}
