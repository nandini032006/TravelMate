import { useState } from 'react'
import { motion } from 'framer-motion'
import { overlapMeta, comfortMeta } from '../../utils/poolScoring'
import { verificationMeta } from '../../data/mockRiders'
import { RideChatModal } from './RideChatModal'
import { spendPoints } from '../../utils/wallet'

function getSaved()      { try { return JSON.parse(localStorage.getItem('travelmate_saved_rides') || '[]') } catch { return [] } }
function toggleSaved(id) {
  const l = getSaved(), idx = l.indexOf(id)
  idx === -1 ? l.push(id) : l.splice(idx, 1)
  localStorage.setItem('travelmate_saved_rides', JSON.stringify(l))
  return idx === -1
}

function MiniStars({ rating }) {
  const full = Math.floor(rating)
  return (
    <span className="rpc__stars-mini">
      {'★'.repeat(full)}{rating % 1 >= 0.5 ? '½' : ''}
      <span className="rpc__rating-mini"> {rating.toFixed(1)}</span>
    </span>
  )
}

export function RidePoolCard({ match, selected, index = 0, onSelect, onJoin }) {
  const [chat,      setChat]      = useState(false)
  const [requested, setRequested] = useState(false)
  const [saved,     setSaved]     = useState(() => getSaved().includes(match.id))
  const [joinErr,   setJoinErr]   = useState(null)

  const oMeta    = overlapMeta(match.overlapPct)
  const cMeta    = comfortMeta(match.comfortScore)
  const vMeta    = verificationMeta(match.driver.verification)
  const d        = match.driver
  const seatsLeft = match.maxOccupancy - match.occupancy
  const vehIcon  = d.vehicle.type === 'bike' ? '🏍' : '🚗'
  const pts      = match.pointsEarned   // points cost = points earned value (1 pt = 1 ₹)
  const ptsLabel = `${pts} pts`
  const fuelShare = `≈ ₹${match.poolFare} fuel share`

  function handleJoin(e) {
    e.stopPropagation()
    const result = spendPoints(pts, `Pool ride: ${match.pickup} → ${d.name.split(' ')[0]}'s route`)
    if (!result.ok) {
      setJoinErr(result.reason)
      setTimeout(() => setJoinErr(null), 2500)
      return
    }
    setRequested(true)
    onJoin?.()
  }

  return (
    <>
      <motion.div
        className={`rpc${selected ? ' rpc--sel' : ''}`}
        onClick={() => onSelect(match)}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.18, delay: index * 0.04 }}
        layout
      >
        {/* Avatar + verify dot */}
        <div className="rpc__av-col">
          <div className="rpc__av" style={{ background: d.avatarColor }}>{d.initials}</div>
          <div className="rpc__vdot" style={{ background: vMeta.color }} title={vMeta.label} />
        </div>

        {/* Main info */}
        <div className="rpc__info">
          <div className="rpc__row1">
            <span className="rpc__dname">
              {d.name.split(' ')[0]} {d.name.split(' ')[1]?.[0]}.
            </span>
            <span className="rpc__veh-chip">{vehIcon} {d.vehicle.model}</span>
            {d.vehicle.isAC    && <span className="rpc__ftag">❄</span>}
            {d.vehicle.luggage && <span className="rpc__ftag">🧳</span>}
          </div>

          <div className="rpc__row2">
            <MiniStars rating={d.rating} />
            <span className="rpc__dsep">·</span>
            <span className="rpc__pickup-mini" title={match.pickup}>📍 {match.pickup}</span>
            {match.pickupDevKm > 0 && (
              <span className="rpc__devkm">({match.pickupDevKm}km)</span>
            )}
          </div>

          <div className="rpc__row3">
            <span className="rpc__eta-mini">{match.etaMin}m ETA</span>
            <span className="rpc__dsep">·</span>
            <span className="rpc__detour-mini">+{match.detourMin}m</span>
            <span className="rpc__dsep">·</span>
            <span className="rpc__comfort-ico" style={{ color: cMeta.color }}>{cMeta.icon}</span>
            <span className="rpc__dsep">·</span>
            <div className="rpc__seats-row">
              {Array.from({ length: match.maxOccupancy }, (_, i) => (
                <span key={i} className={`rpc__sdot${i < match.occupancy ? ' rpc__sdot--taken' : ''}`} />
              ))}
              <span className="rpc__seats-left">{seatsLeft} left</span>
            </div>
          </div>
        </div>

        {/* Right: match % + points cost + actions */}
        <div className="rpc__right-col">
          <div className="rpc__match" style={{ color: oMeta.color }}>
            <span className="rpc__match-num">{match.overlapPct}%</span>
            <span className="rpc__match-lbl">match</span>
          </div>
          <div className="rpc__price-blk">
            <span className="rpc__price">{ptsLabel}</span>
            <span className="rpc__price-save">{fuelShare}</span>
          </div>
          <div className="rpc__btns">
            {joinErr ? (
              <span className="rpc__join-err">{joinErr}</span>
            ) : requested ? (
              <span className="rpc__joined">✓ Reserved</span>
            ) : (
              <button className="rpc__btn-join" onClick={handleJoin}>
                Reserve
              </button>
            )}
            <button className="rpc__btn-ico" title="Chat" onClick={e => { e.stopPropagation(); setChat(true) }}>💬</button>
            <button
              className={`rpc__btn-ico${saved ? ' rpc__btn-ico--saved' : ''}`}
              title={saved ? 'Saved' : 'Save'}
              onClick={e => { e.stopPropagation(); setSaved(toggleSaved(match.id)) }}
            >🔖</button>
          </div>
        </div>

        {/* Selected expansion strip */}
        {selected && (
          <div className="rpc__sel-strip">
            <span className="rpc__pts">🏅 +{match.pointsEarned} pts · {match.pointsPerKm} pts/km</span>
            {match.co2SavedKg > 0 && <span className="rpc__eco">🌿 {match.co2SavedKg}kg CO₂</span>}
            {match.surgeMultiplier > 1 && <span className="rpc__surge-sm">{match.surgeMultiplier}× surge</span>}
            <span className="rpc__vnum">{d.vehicle.number}</span>
          </div>
        )}
      </motion.div>

      {chat && <RideChatModal match={match} onClose={() => setChat(false)} />}
    </>
  )
}
