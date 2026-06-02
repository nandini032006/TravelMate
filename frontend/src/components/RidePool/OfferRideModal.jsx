import { useState } from 'react'
import { LocationInput } from '../SearchPanel/LocationInput'

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function saveToStorage(ride) {
  try {
    const list = JSON.parse(localStorage.getItem('travelmate_offered_rides') || '[]')
    list.unshift({ ...ride, id: `offer_${Date.now()}`, status: 'active', createdAt: new Date().toISOString() })
    localStorage.setItem('travelmate_offered_rides', JSON.stringify(list.slice(0, 20)))
  } catch {}
}

export function OfferRideModal({ onClose }) {
  const [from, setFrom]     = useState(null)
  const [to,   setTo]       = useState(null)
  const [date, setDate]     = useState(new Date().toISOString().slice(0, 10))
  const [time, setTime]     = useState('08:30')
  const [recurring, setRec] = useState('none')
  const [recurDays, setDays] = useState(['Mon','Tue','Wed','Thu','Fri'])
  const [vehType, setVehType] = useState('car')
  const [vehModel, setVehModel] = useState('')
  const [vehNum,   setVehNum]   = useState('')
  const [seats, setSeats]   = useState(3)
  const [ppm,   setPpm]     = useState(4)
  const [gender, setGender] = useState('any')
  const [isAC,  setIsAC]   = useState(false)
  const [music, setMusic]   = useState('any')
  const [luggage, setLuggage] = useState(false)
  const [stops,   setStops]   = useState(false)
  const [done,    setDone]    = useState(false)

  function toggleDay(d) {
    setDays(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d])
  }

  function publish() {
    if (!from || !to) return
    saveToStorage({ from, to, date, time, recurring, recurDays: recurDays, vehType, vehModel, vehNum, seats, ppm, gender, isAC, music, luggage, stops })
    setDone(true)
    setTimeout(onClose, 1800)
  }

  return (
    <div className="offer-modal" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="offer-modal__panel">
        <div className="offer-modal__header">
          <span className="offer-modal__header-icon">🚘</span>
          <span className="offer-modal__header-title">Offer a Ride</span>
          <button className="offer-modal__close" onClick={onClose}>✕</button>
        </div>

        {done ? (
          <div className="offer-modal__success">
            <div className="offer-modal__success-icon">✅</div>
            <div className="offer-modal__success-title">Ride Published!</div>
            <p className="offer-modal__success-sub">Riders on this route will be matched. You'll receive requests shortly.</p>
          </div>
        ) : (
          <div className="offer-modal__body">

            {/* Route */}
            <div className="offer-modal__section">
              <div className="offer-modal__section-title">📍 Route</div>
              <LocationInput label="From" value={from} onChange={setFrom} placeholder="Your starting point" icon="📍" />
              <div style={{ marginTop: 8 }}>
                <LocationInput label="To" value={to} onChange={setTo} placeholder="Your destination" icon="🏁" />
              </div>
              <label className="offer-modal__check">
                <input type="checkbox" checked={stops} onChange={e => setStops(e.target.checked)} />
                Allow intermediate stops
              </label>
            </div>

            {/* Schedule */}
            <div className="offer-modal__section">
              <div className="offer-modal__section-title">🗓 Schedule</div>
              <div className="offer-modal__row">
                <div className="offer-modal__field">
                  <label className="offer-modal__label">Date</label>
                  <input type="date" className="offer-modal__input" value={date}
                    min={new Date().toISOString().slice(0,10)}
                    onChange={e => setDate(e.target.value)} />
                </div>
                <div className="offer-modal__field">
                  <label className="offer-modal__label">Departure</label>
                  <input type="time" className="offer-modal__input" value={time}
                    onChange={e => setTime(e.target.value)} />
                </div>
              </div>
              <div className="offer-modal__label" style={{ marginBottom: 6 }}>Recurring</div>
              <div className="offer-modal__toggle-group">
                {[['none','One-time'],['weekdays','Mon–Fri'],['weekly','Custom days']].map(([v,l]) => (
                  <button key={v}
                    className={`offer-modal__toggle-btn${recurring === v ? ' offer-modal__toggle-btn--active' : ''}`}
                    onClick={() => setRec(v)}>{l}</button>
                ))}
              </div>
              {recurring === 'weekly' && (
                <div className="offer-modal__days">
                  {DAYS.map(d => (
                    <button key={d}
                      className={`offer-modal__day-btn${recurDays.includes(d) ? ' offer-modal__day-btn--active' : ''}`}
                      onClick={() => toggleDay(d)}>{d}</button>
                  ))}
                </div>
              )}
            </div>

            {/* Vehicle */}
            <div className="offer-modal__section">
              <div className="offer-modal__section-title">🚗 Vehicle</div>
              <div className="offer-modal__toggle-group" style={{ marginBottom: 10 }}>
                {[['car','🚗 Car'],['bike','🏍 Bike']].map(([v,l]) => (
                  <button key={v}
                    className={`offer-modal__toggle-btn${vehType === v ? ' offer-modal__toggle-btn--active' : ''}`}
                    onClick={() => setVehType(v)}>{l}</button>
                ))}
              </div>
              <div className="offer-modal__row">
                <div className="offer-modal__field">
                  <label className="offer-modal__label">Model</label>
                  <input className="offer-modal__input" value={vehModel}
                    onChange={e => setVehModel(e.target.value)}
                    placeholder={vehType === 'car' ? 'e.g. Swift, i20' : 'e.g. Activa, Pulsar'} />
                </div>
                <div className="offer-modal__field">
                  <label className="offer-modal__label">Number</label>
                  <input className="offer-modal__input" value={vehNum}
                    onChange={e => setVehNum(e.target.value)}
                    placeholder="TS 09 AB 1234" />
                </div>
              </div>
            </div>

            {/* Preferences */}
            <div className="offer-modal__section">
              <div className="offer-modal__section-title">⚙ Preferences</div>
              {vehType === 'car' && (
                <div className="offer-modal__field" style={{ marginBottom: 10 }}>
                  <label className="offer-modal__label">Available Seats</label>
                  <div className="offer-modal__seats">
                    {[1,2,3,4].map(n => (
                      <button key={n}
                        className={`offer-modal__seat-btn${seats === n ? ' offer-modal__seat-btn--active' : ''}`}
                        onClick={() => setSeats(n)}>{n}</button>
                    ))}
                  </div>
                </div>
              )}
              <div className="offer-modal__field" style={{ marginBottom: 12 }}>
                <label className="offer-modal__label">
                  Price per km — <span className="offer-modal__slider-val">₹{ppm} pts/km</span>
                </label>
                <input type="range" min={0} max={6} step={0.5} value={ppm}
                  className="offer-modal__slider"
                  onChange={e => setPpm(Number(e.target.value))} />
                <div className="offer-modal__slider-labels"><span>Free</span><span>₹3</span><span>₹6</span></div>
              </div>
              <div className="offer-modal__row" style={{ marginBottom: 10 }}>
                <div className="offer-modal__field">
                  <label className="offer-modal__label">Gender pref.</label>
                  <div className="offer-modal__toggle-group">
                    {[['any','Any'],['male','Male'],['female','Female']].map(([v,l]) => (
                      <button key={v}
                        className={`offer-modal__toggle-btn${gender === v ? ' offer-modal__toggle-btn--active' : ''}`}
                        onClick={() => setGender(v)}>{l}</button>
                    ))}
                  </div>
                </div>
                <div className="offer-modal__field">
                  <label className="offer-modal__label">Music</label>
                  <div className="offer-modal__toggle-group">
                    {[['quiet','🔇'],['any','Any'],['music','🎵']].map(([v,l]) => (
                      <button key={v}
                        className={`offer-modal__toggle-btn${music === v ? ' offer-modal__toggle-btn--active' : ''}`}
                        onClick={() => setMusic(v)}>{l}</button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="offer-modal__checks">
                {vehType === 'car' && (
                  <label className="offer-modal__check">
                    <input type="checkbox" checked={isAC} onChange={e => setIsAC(e.target.checked)} />
                    ❄ Air conditioned
                  </label>
                )}
                <label className="offer-modal__check">
                  <input type="checkbox" checked={luggage} onChange={e => setLuggage(e.target.checked)} />
                  🧳 Luggage allowed
                </label>
              </div>
            </div>

            <div className="offer-modal__footer">
              <p className="offer-modal__footer-note">🔒 Phone numbers are never shared. Vehicle details are required to publish.</p>
              <button className="offer-modal__publish-btn" onClick={publish} disabled={!from || !to}>
                🚘 Publish Ride
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
