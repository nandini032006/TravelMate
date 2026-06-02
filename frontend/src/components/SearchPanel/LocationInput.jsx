import { useState, useRef, useEffect, useId } from 'react'
import ReactDOM from 'react-dom'
import { useAutocomplete } from '../../hooks/useAutocomplete'
import { useLang } from '../../contexts/LanguageContext'
import { translateStopName, translateType, teQueryToEn, isTeluguText } from '../../translations/stationNames'
import './LocationInput.css'

function _localiseSuggestion(s, lang, t) {
  if (lang !== 'te') return s
  const translated = translateStopName(s.label)
  const typeLabel  = translateType(s.type, t)
  return { ...s, label: translated, type: typeLabel }
}

const MODE_ICONS = { metro: '🚇', mmts: '🚆', bus: '🚌' }

export function LocationInput({ label, value, onChange, placeholder, icon, onFocusChange, recents = [] }) {
  const [query, setQuery]           = useState(value?.name || '')
  const [open, setOpen]             = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const [dropdownStyle, setDropdownStyle] = useState({})
  const { suggestions, loading, search, clear } = useAutocomplete()
  const { t, lang } = useLang()
  const containerRef = useRef(null)
  const rowRef       = useRef(null)
  const listboxId    = useId()

  useEffect(() => {
    setQuery(value?.name || '')
  }, [value])

  // Close on outside click
  useEffect(() => {
    function handleClick(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false)
        clear()
        setActiveIndex(-1)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [clear])

  // Reposition dropdown when viewport resizes (keyboard open/close)
  useEffect(() => {
    function handleViewportResize() {
      if (open) updateDropdownPosition()
    }
    window.visualViewport?.addEventListener('resize', handleViewportResize)
    return () => window.visualViewport?.removeEventListener('resize', handleViewportResize)
  }, [open])

  // Reset active index whenever the visible items change
  useEffect(() => { setActiveIndex(-1) }, [suggestions, open])

  function updateDropdownPosition() {
    if (rowRef.current) {
      const rect = rowRef.current.getBoundingClientRect()
      setDropdownStyle({
        position: 'fixed',
        top:   rect.bottom + 4,
        left:  rect.left,
        width: rect.width,
        zIndex: 99999,
      })
    }
  }

  function handleInput(e) {
    const q = e.target.value
    setQuery(q)
    updateDropdownPosition()
    setOpen(true)
    const searchQ = lang === 'te' && isTeluguText(q) ? teQueryToEn(q) : q
    search(searchQ)
    if (!q) onChange(null)
  }

  function handleFocus() {
    onFocusChange?.(true)
    updateDropdownPosition()
    setOpen(true)
    if (query.length >= 2) {
      const searchQ = lang === 'te' && isTeluguText(query) ? teQueryToEn(query) : query
      search(searchQ)
    }
  }

  function handleBlur() {
    onFocusChange?.(false)
  }

  function handleSelect(suggestion) {
    const englishLabel = suggestion._originalLabel || suggestion.label
    setQuery(lang === 'te' ? translateStopName(englishLabel) : englishLabel)
    setOpen(false)
    setActiveIndex(-1)
    clear()
    onChange({ lat: suggestion.lat, lon: suggestion.lon, name: englishLabel })
  }

  const displaySuggestions = suggestions.map(s => ({
    ...s,
    _originalLabel: s.label,
    ...(lang === 'te' ? _localiseSuggestion(s, lang, t) : {}),
  }))

  const trimmedQuery = query.trim()
  const showRecents     = open && !trimmedQuery && recents.length > 0
  const showSuggestions = open && !!trimmedQuery && (displaySuggestions.length > 0 || loading)

  // Flat list of selectable items — used for keyboard navigation
  const navItems = showRecents
    ? recents.map(r => ({ lat: r.lat, lon: r.lon, label: r.name, _originalLabel: r.name }))
    : showSuggestions ? displaySuggestions : []

  function handleKeyDown(e) {
    if (!open || navItems.length === 0) {
      if (e.key === 'Escape') { setOpen(false); clear() }
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex(i => (i + 1) % navItems.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex(i => (i <= 0 ? navItems.length - 1 : i - 1))
    } else if (e.key === 'Enter') {
      if (activeIndex >= 0) {
        e.preventDefault()
        handleSelect(navItems[activeIndex])
      }
    } else if (e.key === 'Escape') {
      setOpen(false)
      clear()
      setActiveIndex(-1)
    }
  }

  const dropdown = (showRecents || showSuggestions) && (
    <ul
      id={listboxId}
      role="listbox"
      aria-label={label}
      className="location-input__dropdown"
      style={dropdownStyle}
    >
      {showRecents && (
        <>
          <li className="location-input__dropdown-header" role="presentation">
            {t.recentPlaces}
          </li>
          {recents.map((r, i) => (
            <li
              key={i}
              id={`${listboxId}-opt-${i}`}
              role="option"
              aria-selected={activeIndex === i}
              className={`location-input__dropdown-item${activeIndex === i ? ' --active' : ''}`}
              onMouseDown={(e) => { e.preventDefault(); handleSelect({ ...r, _originalLabel: r.name }) }}
              onTouchEnd={(e)  => { e.preventDefault(); handleSelect({ ...r, _originalLabel: r.name }) }}
            >
              <span className="location-input__dropdown-pin" aria-hidden="true">🕐</span>
              <span className="location-input__dropdown-label">
                {lang === 'te' ? translateStopName(r.name) : r.name}
              </span>
            </li>
          ))}
        </>
      )}

      {showSuggestions && (
        <>
          {loading && (
            <li role="presentation" className="location-input__dropdown-item --loading">
              {t.searching}
            </li>
          )}
          {displaySuggestions.map((s, i) => (
            <li
              key={i}
              id={`${listboxId}-opt-${i}`}
              role="option"
              aria-selected={activeIndex === i}
              className={`location-input__dropdown-item${activeIndex === i ? ' --active' : ''}`}
              onMouseDown={(e) => { e.preventDefault(); handleSelect(s) }}
              onTouchEnd={(e)  => { e.preventDefault(); handleSelect(s) }}
            >
              <span className="location-input__dropdown-pin" aria-hidden="true">📍</span>
              <span className="location-input__dropdown-label">{s.label}</span>
              {s.modes?.length > 0 && (
                <span className="location-input__dropdown-modes" aria-hidden="true">
                  {s.modes.map(m => (
                    <span key={m} className="location-input__mode-icon">{MODE_ICONS[m]}</span>
                  ))}
                </span>
              )}
            </li>
          ))}
        </>
      )}
    </ul>
  )

  return (
    <div className="location-input" ref={containerRef}>
      <label className="location-input__label" htmlFor={`${listboxId}-input`}>
        {label}
      </label>
      <div className="location-input__row" ref={rowRef}>
        <span className="location-input__icon" aria-hidden="true">{icon}</span>
        <input
          id={`${listboxId}-input`}
          className="location-input__field"
          type="text"
          placeholder={placeholder}
          value={query}
          onChange={handleInput}
          onFocus={handleFocus}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          autoComplete="off"
          role="combobox"
          aria-expanded={open && navItems.length > 0}
          aria-autocomplete="list"
          aria-controls={listboxId}
          aria-activedescendant={activeIndex >= 0 ? `${listboxId}-opt-${activeIndex}` : undefined}
        />
        {query && (
          <button
            className="location-input__clear"
            onClick={() => { setQuery(''); onChange(null); clear(); setOpen(false); setActiveIndex(-1) }}
            aria-label={`Clear ${label}`}
            type="button"
          >✕</button>
        )}
      </div>
      {ReactDOM.createPortal(dropdown, document.body)}
    </div>
  )
}
