import { useEffect, useState, useCallback } from 'react'
import { useLang } from '../../contexts/LanguageContext'
import { fetchWeather } from '../../services/weather'
import { getWallet } from '../../utils/wallet'
import './Navbar.css'

const HYD_LAT = 17.385
const HYD_LON = 78.4867

export function Navbar() {
  const { lang, toggleLang } = useLang()
  const [weather, setWeather] = useState(null)
  const [time, setTime]       = useState(new Date())
  const [wallet, setWallet]   = useState(() => getWallet())

  useEffect(() => {
    fetchWeather(HYD_LAT, HYD_LON).then(w => { if (w) setWeather(w) })
  }, [])

  useEffect(() => {
    const id = setInterval(() => setTime(new Date()), 60000)
    return () => clearInterval(id)
  }, [])

  // Refresh wallet when window gains focus (e.g. after reserving a ride)
  const refreshWallet = useCallback(() => setWallet(getWallet()), [])
  useEffect(() => {
    window.addEventListener('focus', refreshWallet)
    // Also refresh on a short interval so wallet widget stays live across tabs
    const id = setInterval(refreshWallet, 8000)
    return () => { window.removeEventListener('focus', refreshWallet); clearInterval(id) }
  }, [refreshWallet])

  const hour   = time.getHours()
  const isPeak = (hour >= 8 && hour < 11) || (hour >= 17 && hour < 21)

  return (
    <header className="navbar" role="banner">
      {/* Brand */}
      <div className="navbar__brand">
        <div className="navbar__logo-wrap">
          <span className="navbar__logo-icon" aria-hidden="true">🗺</span>
        </div>
        <div className="navbar__brand-text">
          <span className="navbar__name">
            Travel<span className="navbar__name-accent">Mate</span>
          </span>
          <span className="navbar__beta-badge" aria-label="Beta version">Beta</span>
          <span className="navbar__city-badge">Hyderabad</span>
        </div>
      </div>

      {/* Status chips */}
      <div className="navbar__chips" aria-label="Live status">
        {isPeak && (
          <div className="navbar__chip navbar__chip--peak">
            <span className="navbar__chip-dot navbar__chip-dot--pulse" />
            Peak hours
          </div>
        )}
        {weather && (
          <div className="navbar__chip">
            <span>{weather.icon}</span>
            <span>{weather.temp_c}°C</span>
            {weather.level !== 'clear' && (
              <span className="navbar__chip-sub">{weather.label}</span>
            )}
          </div>
        )}
        <div className="navbar__chip navbar__chip--time">
          {time.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
        </div>
      </div>

      {/* Actions */}
      <div className="navbar__actions">
        {/* Community wallet chip */}
        <div className="navbar__wallet" title="Community points wallet — 1 pt = ₹1 fuel share">
          <span className="navbar__wallet-icon" aria-hidden="true">🏅</span>
          <span className="navbar__wallet-bal">{wallet.balance}</span>
          <span className="navbar__wallet-unit">pts</span>
        </div>

        <button
          className="navbar__lang"
          onClick={toggleLang}
          aria-label={lang === 'en' ? 'Switch to Telugu' : 'Switch to English'}
          title="Toggle language / భాష మార్చు"
        >
          <span aria-hidden="true">🌐</span>
          <span>{lang === 'en' ? 'తె' : 'EN'}</span>
        </button>
      </div>
    </header>
  )
}
