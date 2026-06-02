import { useState, useRef, useEffect, useMemo } from 'react'
import { LocationInput }    from './LocationInput'
import { useGeolocation }   from '../../hooks/useGeolocation'
import { useRecentLocations } from '../../hooks/useRecentLocations'
import { useLang }          from '../../contexts/LanguageContext'
import { getQuickChips }    from '../../services/areaService'
import './SearchPanel.css'

export function SearchPanel({ onSearch, loading, onFocusChange, initialSrc, initialDst, onChipSelect }) {
  const [src, setSrc] = useState(initialSrc || null)
  const [dst, setDst] = useState(initialDst || null)
  const [copied, setCopied]   = useState(false)
  const { locate, loading: geoLoading } = useGeolocation()
  const { recents, addRecent } = useRecentLocations()
  const { t } = useLang()
  const blurTimer      = useRef(null)
  const didAutoSearch  = useRef(false)
  const QUICK_CHIPS    = useMemo(() => getQuickChips(8), [])

  useEffect(() => {
    if (initialSrc && initialDst && !didAutoSearch.current) {
      didAutoSearch.current = true
      onSearch(initialSrc, initialDst)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function handleFocusChange(focused) {
    if (blurTimer.current) clearTimeout(blurTimer.current)
    if (focused) {
      onFocusChange?.(true)
    } else {
      blurTimer.current = setTimeout(() => onFocusChange?.(false), 350)
    }
  }

  function handleSwap() {
    setSrc(dst)
    setDst(src)
  }

  function handleSubmit(e) {
    e.preventDefault()
    if (src && dst) {
      addRecent(src)
      addRecent(dst)
      onSearch(src, dst)
    }
  }

  function handleGPS() {
    locate((loc) => setSrc(loc))
  }

  function handleShare() {
    if (!src || !dst) return
    const base   = window.location.origin + window.location.pathname
    const params = new URLSearchParams({
      from: `${src.lat},${src.lon},${src.name}`,
      to:   `${dst.lat},${dst.lon},${dst.name}`,
    })
    navigator.clipboard?.writeText(`${base}?${params}`).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 2500)
  }

  function handleChip(chip) {
    const loc = { lat: chip.lat, lon: chip.lon, name: chip.name }
    setDst(loc)
    onChipSelect?.(loc)
  }

  const canSearch = src && dst && !loading

  return (
    <form className="sp" onSubmit={handleSubmit} role="search" aria-label="Plan your journey">
      <div className="sp__inputs">
        {/* From row */}
        <div className="sp__input-wrap">
          <LocationInput
            label={t.from}
            value={src}
            onChange={setSrc}
            placeholder={t.fromPlaceholder}
            icon="🟢"
            onFocusChange={handleFocusChange}
            recents={recents}
          />
          <button
            type="button"
            className="sp__gps"
            onClick={handleGPS}
            disabled={geoLoading}
            title={t.useMyLocation}
            aria-label={t.useMyLocation}
          >
            {geoLoading ? '…' : '📍'}
          </button>
        </div>

        {/* Swap button */}
        <div className="sp__swap-row">
          <div className="sp__connector" aria-hidden="true" />
          <button
            type="button"
            className="sp__swap"
            onClick={handleSwap}
            title={t.swap}
            aria-label={t.swap}
          >
            ⇅
          </button>
        </div>

        {/* To row */}
        <LocationInput
          label={t.to}
          value={dst}
          onChange={setDst}
          placeholder={t.toPlaceholder}
          icon="🔴"
          onFocusChange={handleFocusChange}
          recents={recents}
        />
      </div>

      {/* Quick destination chips */}
      <div className="sp__chips" aria-label="Quick destinations">
        {QUICK_CHIPS.map(chip => (
          <button
            key={chip.label}
            type="button"
            className={`sp__chip${dst?.name === chip.name ? ' sp__chip--active' : ''}`}
            onClick={() => handleChip(chip)}
            title={`Set destination to ${chip.label}`}
          >
            <span className="sp__chip-icon">{chip.icon}</span>
            {chip.label}
          </button>
        ))}
      </div>

      {/* Actions */}
      <div className="sp__actions">
        <button
          type="submit"
          className="sp__submit"
          disabled={!canSearch}
        >
          {loading
            ? <><span className="sp__spinner" aria-hidden="true" />{t.findingRoutes}</>
            : t.findRoutes}
        </button>

        {src && dst && (
          <button
            type="button"
            className={`sp__share${copied ? ' sp__share--copied' : ''}`}
            onClick={handleShare}
            title="Copy shareable link"
            aria-label="Copy shareable link"
          >
            {copied ? t.copied : t.shareRoute}
          </button>
        )}
      </div>
    </form>
  )
}
