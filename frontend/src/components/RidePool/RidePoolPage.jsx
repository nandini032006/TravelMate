import { useState, useCallback, useEffect } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { LocationInput }    from '../SearchPanel/LocationInput'
import { RidePoolCard }     from './RidePoolCard'
import { RidePoolMap }      from './RidePoolMap'
import { RidePoolInsights } from './RidePoolInsights'
import { OfferRideModal }   from './OfferRideModal'
import { generatePoolMatches } from '../../services/rideMatching'
import { getWallet } from '../../utils/wallet'
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

function OfferedCard({ ride }) {
  const schedule = ride.recurring === 'weekdays' ? 'Mon–Fri'
                 : ride.recurring === 'weekly'   ? (ride.recurDays || []).join(', ')
                 : 'One-time'
  return (
    <div className="rp__offered-card">
      <div className="rp__offered-header">
        <span className="rp__offered-route">
          {ride.from?.name?.split(',')[0] ?? 'From'} → {ride.to?.name?.split(',')[0] ?? 'To'}
        </span>
        <span className="rp__offered-status">● Active</span>
      </div>
      <div className="rp__offered-meta">
        <span>{ride.vehType === 'bike' ? '🏍' : '🚗'} {ride.vehModel || 'Vehicle'}</span>
        <span>🕒 {ride.time}</span>
        <span>🔁 {schedule}</span>
        {ride.vehType === 'car' && <span>👥 {ride.seats} seat{ride.seats !== 1 ? 's' : ''}</span>}
      </div>
      <div className="rp__offered-fare">{ride.ppm ?? 4} pts/km earned</div>
    </div>
  )
}

function WalletWidget({ wallet }) {
  if (!wallet) return null
  return (
    <div className="rp__wallet">
      <div className="rp__wallet-top">
        <span className="rp__wallet-label">🏅 Community Points</span>
        <span className="rp__wallet-bal">{wallet.balance} pts</span>
      </div>
      <div className="rp__wallet-stats">
        <span className="rp__wallet-stat rp__wallet-stat--earn">+{wallet.earnedToday} earned today</span>
        <span className="rp__wallet-divider">·</span>
        <span className="rp__wallet-stat rp__wallet-stat--spend">{wallet.spentToday} spent today</span>
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

  const refreshWallet = useCallback(() => setWallet(getWallet()), [])

  // Keep wallet fresh on focus (points may have changed from another card)
  useEffect(() => {
    const onFocus = () => setWallet(getWallet())
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])

  // Hide map when locations change so user sees fresh "View Route on Map" button
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
      {/* ── Left sidebar ── */}
      <aside className="rp__sidebar">

        {/* Wallet widget */}
        <WalletWidget wallet={wallet} />

        {/* Mode toggle */}
        <div className="rp__mode-toggle">
          <button className={`rp__mode-btn${mode === 'taker' ? ' rp__mode-btn--active' : ''}`}
            onClick={() => setMode('taker')}>🚗 Ride Taker</button>
          <button className={`rp__mode-btn${mode === 'giver' ? ' rp__mode-btn--active' : ''}`}
            onClick={() => setMode('giver')}>🚘 Ride Giver</button>
        </div>

        {mode === 'taker' ? (
          <>
            <div className="rp__search">
              <div className="rp__search-inputs">
                <LocationInput label="From" value={src} onChange={setSrc} placeholder="Pickup location…" icon="📍" />
                <LocationInput label="To"   value={dst} onChange={setDst} placeholder="Drop location…"   icon="🏁" />
              </div>

              {/* Date / Time / Passengers */}
              <div className="rp__filter-row">
                <div className="rp__filter-field">
                  <label className="rp__filter-label">Date</label>
                  <input type="date" className="rp__filter-input" value={date} min={todayStr}
                    onChange={e => setDate(e.target.value)} />
                </div>
                <div className="rp__filter-field">
                  <label className="rp__filter-label">Time</label>
                  <input type="time" className="rp__filter-input" value={time}
                    onChange={e => setTime(e.target.value)} />
                </div>
                <div className="rp__filter-field rp__filter-field--sm">
                  <label className="rp__filter-label">Pax</label>
                  <select className="rp__filter-input" value={passengers}
                    onChange={e => setPassengers(Number(e.target.value))}>
                    {[1,2,3,4].map(n => <option key={n} value={n}>{n}</option>)}
                  </select>
                </div>
              </div>

              {/* Vehicle preference */}
              <div className="rp__veh-pref">
                {[['any','✦ Any'],['car','🚗 Car'],['bike','🏍 Bike']].map(([v,l]) => (
                  <button key={v}
                    className={`rp__veh-btn${vehPref === v ? ' rp__veh-btn--active' : ''}`}
                    onClick={() => setVehPref(v)}>{l}</button>
                ))}
              </div>

              <button className="rp__search-btn" onClick={handleSearch} disabled={!src || !dst || loading}>
                {loading
                  ? <><span className="rp__loading-spinner" style={{ width:15, height:15, borderWidth:2 }} /> Matching…</>
                  : <>🔍 Find Pool Rides</>}
              </button>

              {src && dst && !showMap && (
                <button className="rp__view-map-btn" onClick={() => setShowMap(true)}>
                  🗺️ View Route on Map
                </button>
              )}
              {src && dst && showMap && (
                <button className="rp__view-map-btn rp__view-map-btn--active" onClick={() => setShowMap(false)}>
                  ✕ Hide Map
                </button>
              )}
            </div>

            {/* Results */}
            <div className="rp__cards">
              {loading ? (
                <div className="rp__loading">
                  <div className="rp__loading-spinner" />
                  <span>Finding riders on this corridor…</span>
                </div>
              ) : !searched ? (
                <div className="rp__empty">
                  <div className="rp__empty-icon">🚗</div>
                  <div className="rp__empty-title">Find Pool Rides</div>
                  <p className="rp__empty-sub">Enter pickup and drop to find community pool rides. Pay with points — no cash needed.</p>
                </div>
              ) : matches.length === 0 ? (
                <div className="rp__empty">
                  <div className="rp__empty-icon">😔</div>
                  <div className="rp__empty-title">No matches found</div>
                  <p className="rp__empty-sub">No pool rides on this corridor right now. Try peak hours (8–10 AM, 6–8 PM).</p>
                </div>
              ) : (
                <>
                  <div className="rp__sim-notice">
                    <span className="rp__sim-badge">Simulation Preview</span>
                    <span>Rider data is locally generated — no real users or backend</span>
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
          /* ── Giver panel ── */
          <div className="rp__giver-panel">
            <div className="rp__giver-header">
              <div className="rp__giver-title">Your Offered Rides</div>
              <p className="rp__giver-sub">Share your daily commute and earn points on every trip.</p>
            </div>

            <div className="rp__offered-list">
              {offered.length === 0 ? (
                <div className="rp__empty" style={{ padding: '32px 16px' }}>
                  <div className="rp__empty-icon" style={{ fontSize: 36 }}>🚘</div>
                  <div className="rp__empty-title">No rides offered yet</div>
                  <p className="rp__empty-sub">Tap "Offer a Ride" below to publish your commute and find riders going your way.</p>
                </div>
              ) : (
                offered.map(r => <OfferedCard key={r.id} ride={r} />)
              )}
            </div>

            <div className="rp__giver-footer">
              <button className="rp__offer-fab" onClick={() => setShowOffer(true)}>
                <span className="rp__offer-fab-icon">+</span> Offer a Ride
              </button>
            </div>
          </div>
        )}
      </aside>

      {/* ── Map — only shown after user clicks "View Route on Map" ── */}
      {showMap && <RidePoolMap from={src} to={dst} selectedMatch={selected} />}

      {/* ── Insights ── */}
      <RidePoolInsights matches={matches} selectedMatch={selected} wallet={wallet} />

      {/* ── Offer modal ── */}
      {showOffer && <OfferRideModal onClose={onOfferClose} />}
    </div>
  )
}
