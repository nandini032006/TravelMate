import { useState, useMemo, useEffect, lazy, Suspense } from 'react'
import { APP_VERSION, APP_RELEASE, BUG_URL, FEATURE_URL } from './version'
import { LanguageProvider }  from './contexts/LanguageContext'
import { SearchPanel }       from './components/SearchPanel/SearchPanel'
import { RouteResults }      from './components/RouteResults/RouteResults'

import { Navbar }            from './components/Navbar/Navbar'
import { useRouting }        from './hooks/useRouting'
import { useKeyboard }       from './hooks/useKeyboard'
import { useOnlineStatus }   from './hooks/useOnlineStatus'
import { useLiveConditions } from './hooks/useLiveConditions'
import { reverseGeocode }    from './services/nominatim'
import { init as initTransitData } from './services/transitData'
import { analyzeRouteSafety } from './utils/routeSafety'
import { buildComparison }   from './utils/routeComparison'
import { generateStrategies } from './utils/commuterIntelligence'
import { fmtDuration, fmtDist } from './utils/formatters'
import { getMeta } from './utils/modeColors'
import { useLang } from './contexts/LanguageContext'
import './App.css'

const RidePoolPage  = lazy(() => import('./components/RidePool/RidePoolPage').then(m => ({ default: m.RidePoolPage })))
const AnalyticsPage = lazy(() => import('./components/Analytics/AnalyticsPage').then(m => ({ default: m.AnalyticsPage })))
const MapView       = lazy(() => import('./components/MapView/MapView').then(m => ({ default: m.MapView })))

initTransitData()

function _parseUrlLoc(param) {
  const val = new URLSearchParams(window.location.search).get(param)
  if (!val) return null
  const parts = val.split(',')
  if (parts.length < 2) return null
  const lat = parseFloat(parts[0])
  const lon = parseFloat(parts[1])
  const name = parts.slice(2).join(',') || `${lat.toFixed(4)}, ${lon.toFixed(4)}`
  if (isNaN(lat) || isNaN(lon)) return null
  return { lat, lon, name }
}

function BetaStatusBar() {
  return (
    <div className="beta-status-bar" role="contentinfo" aria-label="Beta release information">
      <span className="beta-status-bar__left">
        <span className="beta-status-bar__pill">Beta</span>
        {APP_RELEASE} · v{APP_VERSION}
      </span>
      <span className="beta-status-bar__links">
        <a href={BUG_URL} target="_blank" rel="noopener noreferrer" className="beta-status-bar__link" aria-label="Report a bug">🐞 Report Issue</a>
        <span className="beta-status-bar__sep" aria-hidden="true">·</span>
        <a href={FEATURE_URL} target="_blank" rel="noopener noreferrer" className="beta-status-bar__link" aria-label="Suggest a feature">💡 Suggest Feature</a>
      </span>
    </div>
  )
}

function OfflineBanner() {
  return (
    <div className="offline-banner" role="status" aria-live="polite">
      <span aria-hidden="true">📶</span>
      {' '}Offline — route planning works; map search may be limited.
    </div>
  )
}

function PlannerPage() {
  const [src, setSrc]                     = useState(null)
  const [dst, setDst]                     = useState(null)
  const [selectedRoute, setSelectedRoute] = useState(null)
  const [hoveredRoute,  setHoveredRoute]  = useState(null)
  const [searchFocused, setSearchFocused] = useState(false)
  const [isMapOpen, setIsMapOpen] = useState(false)
  const [isMobile, setIsMobile] = useState(window.innerWidth < 860)

  const { isOpen: keyboardOpen } = useKeyboard()
  const online = useOnlineStatus()
  const searchActive = searchFocused || keyboardOpen
  const { routes, loading, error, planRoute } = useRouting()

  const initialSrc = useMemo(() => _parseUrlLoc('from'), [])
  const initialDst = useMemo(() => _parseUrlLoc('to'),   [])

  const { traffic, weather, aqi, infra, loading: liveLoading } = useLiveConditions(selectedRoute)

  const selectedSafety = useMemo(
    () => analyzeRouteSafety(selectedRoute),
    [selectedRoute]
  )

  const riskZones = selectedSafety?.matched ?? []

  const { strategies, comparison } = useMemo(() => {
    if (!routes) return { strategies: null, comparison: null }
    console.log('[TM-DEBUG App.jsx] routes.rtc.all entering generateStrategies():')
    routes?.rtc?.all?.forEach((r, i) => {
      const name = r.steps?.find(s => s.mode !== 'walk' && s.mode !== 'auto')?.line_name ?? '?'
      console.log(`  routes.rtc.all[${i}] "${name}" score=${r.commuter_score}`)
    })
    const comparison = buildComparison(routes, traffic)
    const strategies = generateStrategies(routes)
    console.log('[TM-DEBUG App.jsx] local_commuter strategy top routes:')
    strategies?.find(s => s.id === 'local_commuter')?.routes?.forEach((r, i) => {
      const name = r.steps?.find(s => s.mode !== 'walk' && s.mode !== 'auto')?.line_name ?? '?'
      console.log(`  local_commuter[${i}] "${name}" strategy_score=${r.strategy_score} commuter_score=${r.commuter_score}`)
    })
    return { strategies, comparison }
  }, [routes, traffic])

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 860px)')
    const handler = (e) => setIsMobile(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  useEffect(() => {
    if (isMapOpen && isMobile) {
      document.body.classList.add('body-map-open')
      document.body.style.overflow = 'hidden'
    } else {
      document.body.classList.remove('body-map-open')
      document.body.style.overflow = ''
    }
    return () => {
      document.body.classList.remove('body-map-open')
      document.body.style.overflow = ''
    }
  }, [isMapOpen, isMobile])

  useEffect(() => {
    if (!selectedRoute) return
    try {
      const history = JSON.parse(localStorage.getItem('travelmate_route_history') || '[]')
      const entry = {
        mode:      selectedRoute.primary_mode,
        duration:  selectedRoute.total_duration_sec,
        cost:      selectedRoute.total_cost_inr,
        from:      src?.name || '',
        to:        dst?.name || '',
        timestamp: Date.now(),
      }
      history.unshift(entry)
      localStorage.setItem('travelmate_route_history', JSON.stringify(history.slice(0, 100)))
    } catch { /* ignore storage errors */ }
  }, [selectedRoute])  // eslint-disable-line react-hooks/exhaustive-deps

  function handleSearch(srcLoc, dstLoc) {
    setSrc(srcLoc)
    setDst(dstLoc)
    setSelectedRoute(null)
    setIsMapOpen(false)
    planRoute(srcLoc, dstLoc)
  }

  function handleSelectRoute(route) {
    setSelectedRoute(route === selectedRoute ? null : route)
    setHoveredRoute(null)
  }

  function handleHoverRoute(route) {
    setHoveredRoute(route)
  }

  function handleViewDetails(route) {
    setSelectedRoute(route)
    setIsMapOpen(true)
  }

  function handleCloseDetails() {
    setIsMapOpen(false)
  }

  function handleChipSelect(loc) {
    setDst(loc)
    if (src) {
      setSelectedRoute(null)
      planRoute(src, loc)
    }
  }

  async function handleMapClick(lat, lon) {
    try {
      const name = await reverseGeocode(lat, lon)
      const loc  = { lat, lon, name }
      if (!src) setSrc(loc)
      else if (!dst) setDst(loc)
    } catch {
      const loc = { lat, lon, name: `${lat.toFixed(5)}, ${lon.toFixed(5)}` }
      if (!src) setSrc(loc)
      else if (!dst) setDst(loc)
    }
  }

  const showResults = (strategies && strategies.some(s => s.routes?.length > 0)) || loading || !!error

  const firstTransit = (selectedRoute?.steps || []).find(s => s.mode !== 'walk' && s.mode !== 'auto')
  const { t } = useLang()

  return (
    <>
      {!online && <OfflineBanner />}
      {isMapOpen && isMobile ? (
        // ── Mobile fullscreen map + bottom sheet ──
        <div className="pd-mobile">
          <header className="pd-mobile__header">
            <button className="pd-mobile__close" onClick={handleCloseDetails} aria-label="Close map">✕</button>
            <h1 className="pd-mobile__title">Route Details</h1>
          </header>
          <div className="pd-mobile__map">
            {selectedRoute && (
              <Suspense fallback={<div className="map-loading">Loading map…</div>}>
                <MapView
                  src={src} dst={dst}
                  selectedRoute={selectedRoute}
                  hoveredRoute={null}
                  onMapClick={handleMapClick}
                  riskZones={riskZones}
                  traffic={traffic}
                  aqi={aqi}
                  fullscreen={true}
                />
              </Suspense>
            )}
          </div>
          <div className="pd-mobile__sheet">
            <div className="pd-sheet__route-name">
              {src?.name && dst?.name ? `${fromLabel(src.name)} → ${toLabel(dst.name)}` : ''}
            </div>
            <div className="pd-sheet__quick">
              <span>⏱ {selectedRoute ? fmtDuration(selectedRoute.total_duration_sec, 'en') : ''}</span>
              <span>💰 ₹{selectedRoute ? Math.round(selectedRoute.total_cost_inr) : ''}</span>
              {firstTransit?.line_name && <span className="pd-sheet__line">{firstTransit.line_name}</span>}
            </div>
            <div className="pd-sheet__steps">
              {(selectedRoute?.steps || []).map((step, i) => {
                const meta = getMeta(step.mode)
                const isLast = i === (selectedRoute?.steps || []).length - 1
                return (
                  <div key={i} className="pd-sheet__step">
                    <div className="pd-sheet__step-line">
                      <div className="pd-sheet__step-dot" style={{ background: meta.color }} />
                      {!isLast && <div className="pd-sheet__step-connector" style={{ background: meta.color }} />}
                    </div>
                    <div className="pd-sheet__step-body">
                      <div className="pd-sheet__step-mode" style={{ color: meta.color }}>
                        {meta.icon || step.mode} {meta.label || step.mode}
                        {step.line_name ? ` · ${step.line_name}` : ''}
                      </div>
                      <div className="pd-sheet__step-dir">
                        {step.from_name} → {step.to_name}
                      </div>
                      {step.duration_sec > 0 && (
                        <div className="pd-sheet__step-meta">
                          {fmtDuration(step.duration_sec, 'en')}
                          {step.dist_m > 0 ? ` · ${fmtDist(step.dist_m, 'en')}` : ''}
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      ) : (
        // ── Desktop / mobile initial layout ──
        <div className={`planner${searchActive ? ' planner--search-active' : ''}`}>
          <aside className="planner__sidebar" aria-label="Route planner">
            <SearchPanel
              onSearch={handleSearch}
              loading={loading}
              onFocusChange={setSearchFocused}
              initialSrc={initialSrc}
              initialDst={initialDst}
              onChipSelect={handleChipSelect}
            />
            {isMapOpen && !isMobile ? (
              // Desktop back button when detail view is open
              <button className="planner__sidebar-back" onClick={handleCloseDetails}>
                ← Back to routes
              </button>
            ) : null}
          </aside>

          <main className={`planner__content${isMapOpen ? ' planner__content--detail' : ''}`} id="main-content">
            {!isMapOpen || isMobile ? (
              // Route cards or empty state
              showResults ? (
                <RouteResults
                  strategies={strategies}
                  rawRoutes={routes}
                  comparison={comparison}
                  loading={loading}
                  error={error}
                  selectedRoute={selectedRoute}
                  onSelectRoute={handleSelectRoute}
                  onHoverRoute={handleHoverRoute}
                  onViewDetails={handleViewDetails}
                  liveConditions={{ traffic, weather, aqi, loading: liveLoading }}
                />
              ) : src && dst && !loading && !error ? (
                <div className="planner__empty">
                  <span>🔍</span>
                  <p>No routes found. Try different locations.</p>
                </div>
              ) : null
            ) : (
              // Desktop detail view: steps (left) + map (right)
              <div className="planner__detail">
                <div className="planner__detail-steps">
                  <div className="pds__header">
                    <div className="pds__route-name">
                      {src?.name && dst?.name ? `${fromLabel(src.name)} → ${toLabel(dst.name)}` : ''}
                    </div>
                    <div className="pds__quick-stats">
                      <span>⏱ {selectedRoute ? fmtDuration(selectedRoute.total_duration_sec, 'en') : ''}</span>
                      <span>💰 ₹{selectedRoute ? Math.round(selectedRoute.total_cost_inr) : ''}</span>
                      {firstTransit?.line_name && <span className="pds__line">{firstTransit.line_name}</span>}
                    </div>
                  </div>
                  <div className="pds__steps-list">
                    {(selectedRoute?.steps || []).map((step, i) => {
                      const meta = getMeta(step.mode)
                      const isLast = i === (selectedRoute?.steps || []).length - 1
                      return (
                        <div key={i} className="pds__step">
                          <div className="pds__step-line">
                            <div className="pds__step-dot" style={{ background: meta.color }} />
                            {!isLast && <div className="pds__step-connector" style={{ background: meta.color }} />}
                          </div>
                          <div className="pds__step-body">
                            <div className="pds__step-mode" style={{ color: meta.color }}>
                              {meta.icon || step.mode} {meta.label || step.mode}
                              {step.line_name ? ` · ${step.line_name}` : ''}
                            </div>
                            <div className="pds__step-dir">
                              {step.from_name} → {step.to_name}
                            </div>
                            {step.duration_sec > 0 && (
                              <div className="pds__step-meta">
                                {fmtDuration(step.duration_sec, 'en')}
                                {step.dist_m > 0 ? ` · ${fmtDist(step.dist_m, 'en')}` : ''}
                              </div>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
                <div className="planner__detail-map">
                  <Suspense fallback={<div className="map-loading">Loading map…</div>}>
                    <MapView
                      src={src} dst={dst}
                      selectedRoute={selectedRoute}
                      hoveredRoute={null}
                      onMapClick={handleMapClick}
                      riskZones={riskZones}
                      traffic={traffic}
                      aqi={aqi}
                      fullscreen={false}
                    />
                  </Suspense>
                </div>
              </div>
            )}
          </main>
        </div>
      )}

      {isMapOpen && !isMobile && (
        <button className="map-fab map-fab--close" onClick={handleCloseDetails} aria-label="Close details">
          ✕ Close
        </button>
      )}
    </>
  )
}

function fromLabel(name) {
  const parts = name.split(',')
  return parts[0]
}
function toLabel(name) {
  const parts = name.split(',')
  return parts[0]
}

function TabBar({ view, setView }) {
  const tabs = [
    { id: 'transit',   label: 'Transit',   icon: '🚌' },
    { id: 'ridepool',  label: 'RidePool',  icon: '🚗', badge: 'BETA' },
    { id: 'analytics', label: 'Analytics', icon: '📊' },
  ]
  return (
    <div className="tab-bar" role="tablist">
      {tabs.map(t => (
        <button
          key={t.id}
          className={`tab-bar__tab${view === t.id ? ' tab-bar__tab--active' : ''}`}
          onClick={() => setView(t.id)}
          role="tab"
          aria-selected={view === t.id}
        >
          <span>{t.icon}</span>
          <span>{t.label}</span>
          {t.badge && <span className="tab-bar__badge">{t.badge}</span>}
        </button>
      ))}
    </div>
  )
}


export default function App() {
  const [view, setView] = useState('transit')
  return (
    <LanguageProvider>
      <div className="app-root">
        <Navbar />
        <TabBar view={view} setView={setView} />
        {view === 'transit'   && <PlannerPage />}
        <Suspense fallback={<div className="tab-loading" aria-live="polite">Loading…</div>}>
          {view === 'ridepool'  && <RidePoolPage />}
          {view === 'analytics' && <AnalyticsPage />}
        </Suspense>
        <BetaStatusBar />
      </div>
    </LanguageProvider>
  )
}
