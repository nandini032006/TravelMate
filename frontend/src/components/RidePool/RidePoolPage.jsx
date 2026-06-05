import { useState, useCallback, useEffect } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { LocationInput }    from '../SearchPanel/LocationInput'
import { RidePoolCard }     from './RidePoolCard'
import { RidePoolMap }      from './RidePoolMap'
import { RidePoolInsights } from './RidePoolInsights'
import { OfferRideModal }   from './OfferRideModal'
import { generatePoolMatches } from '../../services/rideMatching'
import { getWallet } from '../../utils/wallet'
import { useLang } from '../../contexts/LanguageContext'
import './RidePool.css'

const VERIF_ORDER = { verified: 0, partial: 1, unverified: 2 }

function sortMatches(list) {
  return [...list].sort((a, b) => {
    const vd = (VERIF_ORDER[a.driver.verification] ?? 2) - (VERIF_ORDER[b.driver.verification] ?? 2)
    if (vd !== 0) return vd
    return b.overlapPct - a.overlapPct
  })
}

function getOffered() {
  try { return JSON.parse(localStorage.getItem('travelmate_offered_rides') || '[]') }
  catch { return [] }
}

function OfferedCard({ ride, t }) {
  const schedule = ride.recurring === 'weekdays' ? 'Mon–Fri'
                 : ride.recurring === 'weekly'   ? (ride.recurDays || []).join(', ')
                 : 'One-time'
  return (
    <div className="rp__offered-card">
      <div className="rp__offered-header">
        <span className="rp__offered-route">
          {ride.from?.name?.split(',')[0] ?? t.from} → {ride.to?.name?.split(',')[0] ?? t.to}
        </span>
        <span className="rp__offered-status">{t.active}</span>
      </div>
      <div className="rp__offered-meta">
        <span>{ride.vehType === 'bike' ? '🏍' : '🚗'} {ride.vehModel || t.vehicle}</span>
        <span>🕒 {ride.time}</span>
        <span>🔁 {schedule}</span>
        {ride.vehType === 'car' && <span>👥 {ride.seats} {ride.seats !== 1 ? t.seats : t.seat}</span>}
      </div>
      <div className="rp__offered-fare">{ride.ppm ?? 4} {t.ptsPerKm}</div>
    </div>
  )
}

function WalletWidget({ wallet, t }) {
  if (!wallet) return null
  return (
    <div className="rp__wallet">
      <div className="rp__wallet-top">
        <span className="rp__wallet-label">🏅 {t.communityPoints}</span>
        <span className="rp__wallet-bal">{wallet.balance} {t.pts}</span>
      </div>
      <div className="rp__wallet-stats">
        <span className="rp__wallet-stat rp__wallet-stat--earn">+{wallet.earnedToday} {t.earnedToday}</span>
        <span className="rp__wallet-divider">·</span>
        <span className="rp__wallet-stat rp__wallet-stat--spend">{wallet.spentToday} {t.spentToday}</span>
      </div>
    </div>
  )
}

const todayStr = new Date().toISOString().slice(0, 10)
const nowTime  = () => {
  const d = new Date()
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
}

export function RidePoolPage() {
  const [mode,       setMode]       = useState('taker')
  const [src,        setSrc]        = useState(null)
  const [dst,        setDst]        = useState(null)
  const [date,       setDate]       = useState(todayStr)
  const [time,       setTime]       = useState(nowTime)
  const [passengers, setPassengers] = useState(1)
  const [vehPref,    setVehPref]    = useState('any')
  const [matches,    setMatches]    = useState([])
  const [selected,   setSelected]   = useState(null)
  const [loading,    setLoading]    = useState(false)
  const [searched,   setSearched]   = useState(false)
  const [showOffer,  setShowOffer]  = useState(false)
  const [offered,    setOffered]    = useState(getOffered)
  const [wallet,     setWallet]     = useState(() => getWallet())
  const [showMap,    setShowMap]    = useState(false)
  const { t } = useLang()

  const refreshWallet = useCallback(() => setWallet(getWallet()), [])

  useEffect(() => {
    const onFocus = () => setWallet(getWallet())
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])

  useEffect(() => { setShowMap(false) }, [src, dst])

  const handleSearch = useCallback(() => {
    if (!src?.lat || !dst?.lat) return
    setLoading(true)
    setSelected(null)
    setMatches([])
    setTimeout(() => {
      const raw     = generatePoolMatches(src, dst, vehPref)
      const results = sortMatches(raw)
      setMatches(results)
      setSelected(results[0] || null)
      setSearched(true)
      setLoading(false)
    }, 850)
  }, [src, dst, vehPref])

  function handleSelect(match) { setSelected(s => s?.id === match.id ? null : match) }

  function onOfferClose() {
    setShowOffer(false)
    setOffered(getOffered())
  }

  return (
    <div className="rp">
      <aside className="rp__sidebar">
        <WalletWidget wallet={wallet} t={t} />

        <div className="rp__mode-toggle">
          <button className={`rp__mode-btn${mode === 'taker' ? ' rp__mode-btn--active' : ''}`}
            onClick={() => setMode('taker')}>{t.rideTakerLabel}</button>
          <button className={`rp__mode-btn${mode === 'giver' ? ' rp__mode-btn--active' : ''}`}
            onClick={() => setMode('giver')}>{t.rideGiverLabel}</button>
        </div>

        {mode === 'taker' ? (
          <>
            <div className="rp__search">
              <div className="rp__search-inputs">
                <LocationInput label={t.from} value={src} onChange={setSrc} placeholder={t.pickupLocation} icon="📍" />
                <LocationInput label={t.to}   value={dst} onChange={setDst} placeholder={t.dropLocation}   icon="🏁" />
              </div>

              <div className="rp__filter-row">
                <div className="rp__filter-field">
                  <label className="rp__filter-label">{t.date}</label>
                  <input type="date" className="rp__filter-input" value={date} min={todayStr}
                    onChange={e => setDate(e.target.value)} />
                </div>
                <div className="rp__filter-field">
                  <label className="rp__filter-label">{t.time}</label>
                  <input type="time" className="rp__filter-input" value={time}
                    onChange={e => setTime(e.target.value)} />
                </div>
                <div className="rp__filter-field rp__filter-field--sm">
                  <label className="rp__filter-label">{t.pax}</label>
                  <select className="rp__filter-input" value={passengers}
                    onChange={e => setPassengers(Number(e.target.value))}>
                    {[1,2,3,4].map(n => <option key={n} value={n}>{n}</option>)}
                  </select>
                </div>
              </div>

              <div className="rp__veh-pref">
                {[['any', t.any],['car', t.car],['bike', t.bike]].map(([v,l]) => (
                  <button key={v}
                    className={`rp__veh-btn${vehPref === v ? ' rp__veh-btn--active' : ''}`}
                    onClick={() => setVehPref(v)}>{l}</button>
                ))}
              </div>

              <button className="rp__search-btn" onClick={handleSearch} disabled={!src || !dst || loading}>
                {loading
                  ? <><span className="rp__loading-spinner" style={{ width:15, height:15, borderWidth:2 }} /> {t.matching}</>
                  : <>{t.findPoolRides}</>}
              </button>

              {src && dst && !showMap && (
                <button className="rp__view-map-btn" onClick={() => setShowMap(true)}>
                  {t.viewRouteOnMap}
                </button>
              )}
              {src && dst && showMap && (
                <button className="rp__view-map-btn rp__view-map-btn--active" onClick={() => setShowMap(false)}>
                  {t.hideMap}
                </button>
              )}
            </div>

            <div className="rp__cards">
              {loading ? (
                <div className="rp__loading">
                  <div className="rp__loading-spinner" />
                  <span>{t.findingRiders}</span>
                </div>
              ) : !searched ? (
                <div className="rp__empty">
                  <div className="rp__empty-icon">🚗</div>
                  <div className="rp__empty-title">{t.findPoolRidesTitle}</div>
                  <p className="rp__empty-sub">{t.findPoolRidesSub}</p>
                </div>
              ) : matches.length === 0 ? (
                <div className="rp__empty">
                  <div className="rp__empty-icon">😔</div>
                  <div className="rp__empty-title">{t.noMatches}</div>
                  <p className="rp__empty-sub">{t.noMatchesSub}</p>
                </div>
              ) : (
                <>
                  <div className="rp__sim-notice">
                    <span className="rp__sim-badge">{t.simPreview}</span>
                    <span>{t.simNotice}</span>
                  </div>
                  <AnimatePresence>
                    {matches.map((m, i) => (
                      <RidePoolCard
                        key={m.id}
                        match={m}
                        selected={selected?.id === m.id}
                        index={i}
                        onSelect={handleSelect}
                        onJoin={refreshWallet}
                      />
                    ))}
                  </AnimatePresence>
                </>
              )}
            </div>
          </>
        ) : (
          <div className="rp__giver-panel">
            <div className="rp__giver-header">
              <div className="rp__giver-title">{t.yourOfferedRides}</div>
              <p className="rp__giver-sub">{t.offeredRidesSub}</p>
            </div>

            <div className="rp__offered-list">
              {offered.length === 0 ? (
                <div className="rp__empty" style={{ padding: '32px 16px' }}>
                  <div className="rp__empty-icon" style={{ fontSize: 36 }}>🚘</div>
                  <div className="rp__empty-title">{t.noRidesOffered}</div>
                  <p className="rp__empty-sub">{t.noRidesOfferedSub}</p>
                </div>
              ) : (
                offered.map(r => <OfferedCard key={r.id} ride={r} t={t} />)
              )}
            </div>

            <div className="rp__giver-footer">
              <button className="rp__offer-fab" onClick={() => setShowOffer(true)}>
                <span className="rp__offer-fab-icon">+</span> {t.offerRide}
              </button>
            </div>
          </div>
        )}
      </aside>

      {showMap && <RidePoolMap from={src} to={dst} selectedMatch={selected} />}

      <RidePoolInsights matches={matches} selectedMatch={selected} wallet={wallet} />

      {showOffer && <OfferRideModal onClose={onOfferClose} />}
    </div>
  )
}
