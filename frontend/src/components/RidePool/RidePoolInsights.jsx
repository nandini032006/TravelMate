import { AnimatePresence, motion } from 'framer-motion'
import { overlapMeta, comfortMeta } from '../../utils/poolScoring'
import { useLang } from '../../contexts/LanguageContext'
import './RidePool.css'

function recs(matches, sel, t) {
  const best = matches[0]
  if (!best) return []
  const list = []

  if (best.overlapPct >= 80)
    list.push({ icon: '🔀', text: t.recStrongOverlap || 'Strong commuter overlap — high fuel savings for the whole group.' })
  else if (best.overlapPct >= 65)
    list.push({ icon: '✅', text: t.recGoodMatch || 'Good route match. Pooling this corridor is worthwhile for everyone.' })
  else
    list.push({ icon: '📍', text: t.recPartialOverlap || 'Partial overlap — still a fair fuel-share for this distance.' })

  if (best.detourMin <= 4)
    list.push({ icon: '⚡', text: t.recMinimalDetour || 'Minimal detour on top match — nearly a direct shared route.' })
  else if (best.detourMin <= 8)
    list.push({ icon: '🕐', text: `${t.recBestOption || 'Best option adds only'} ${best.detourMin} min — ${best.pointsEarned} ${t.pts} ${t.fuelShare}.` })

  if (best.demandLevel === 'high')
    list.push({ icon: '📊', text: t.recPeakDemand || 'Peak demand — many riders available on this corridor.' })
  else if (best.demandLevel === 'moderate')
    list.push({ icon: '📊', text: t.recModerateDemand || 'Moderate demand — good community pooling window.' })

  const h = new Date().getHours()
  if (h >= 22 || h < 5)
    list.push({ icon: '🌙', text: t.recLateNight || 'Late-night pooling — share your trip details with a trusted contact.' })
  else if ((h >= 7 && h < 10) || (h >= 17 && h < 20))
    list.push({ icon: '🚦', text: t.recPeakHour || 'Peak hour — high community activity. Verified riders prioritised.' })

  if (sel?.driver?.verification === 'verified')
    list.push({ icon: '🟢', text: t.recVerified || 'Selected driver is fully verified — phone, email, and Govt ID confirmed.' })

  if (best.firstMile || best.lastMile)
    list.push({ icon: '🚇', text: t.recMetro || 'Metro/MMTS connects both ends — combine RidePool + transit for fastest door-to-door.' })

  return list.slice(0, 4)
}

function SafetyBar({ safety, t }) {
  const s = safety.score
  const color = s >= 80 ? '#16a34a' : s >= 65 ? '#d97706' : '#dc2626'
  const label = s >= 80 ? t.lowRisk : s >= 65 ? t.moderateRisk : t.elevatedRisk
  return (
    <div className="rpi__safety-box">
      <div className="rpi__safety-header">
        <span className="rpi__safety-num" style={{ color }}>{s}</span>
        <div>
          <div className="rpi__safety-label" style={{ color }}>{label}</div>
          <div className="rpi__safety-sub">{t.safetyScore}</div>
        </div>
      </div>
      <div className="rpi__safety-bar-track">
        <div className="rpi__safety-bar-fill" style={{ width: `${s}%`, background: color }} />
      </div>
    </div>
  )
}

function FareReasons({ match, t }) {
  if (!match.fareReasons?.length && match.surgeMultiplier <= 1) return null
  return (
    <div className="rpi__fare-reasons">
      {match.surgeMultiplier > 1 && (
        <span className="rpi__surge-chip">{match.surgeMultiplier}× {t.surge} active</span>
      )}
      {match.fareReasons.map((r, i) => (
        <span key={i} className="rpi__fare-reason">{r}</span>
      ))}
    </div>
  )
}

function PointsTable({ match, t }) {
  const rows = [
    { mode: t.poolRide,  icon: '🚗', pts: match.poolFare,  rupee: match.poolFare,  highlight: true },
    { mode: t.soloRide,  icon: '🚕', pts: match.soloFare,  rupee: match.soloFare,  save: match.savings },
    { mode: t.cabOla,    icon: '🚖', pts: match.cabFare,   rupee: match.cabFare,   save: match.savingsVsCab  },
    { mode: t.autoLabel, icon: '🛺', pts: match.autoFare,  rupee: match.autoFare,  save: match.savingsVsAuto },
  ]
  return (
    <div className="rpi__fare-table">
      {rows.map((r, i) => (
        <div key={i} className={`rpi__fare-row${r.highlight ? ' rpi__fare-row--hl' : ''}`}>
          <span className="rpi__fare-mode">{r.icon} {r.mode}</span>
          <div className="rpi__fare-pts-col">
            <span className="rpi__fare-price">{r.pts} {t.pts}</span>
            <span className="rpi__fare-rupee">≈ ₹{r.rupee}</span>
          </div>
          {r.save > 0 ? (
            <span className="rpi__fare-save">-{r.save} {t.pts}</span>
          ) : r.highlight ? (
            <span className="rpi__fare-best">{t.best}</span>
          ) : null}
        </div>
      ))}
    </div>
  )
}

function MileCards({ first, last, t }) {
  if (!first && !last) return null
  return (
    <div className="rpi__mile-wrap">
      {[first && { tag: t.firstMile, ...first }, last && { tag: t.lastMile, ...last }]
        .filter(Boolean).map((m, i) => (
        <div key={i} className="rpi__mile-card">
          <span className="rpi__mile-tag">{m.tag}</span>
          <span className="rpi__mile-icon">{m.icon}</span>
          <div className="rpi__mile-info">
            <span className="rpi__mile-label">{m.label}</span>
            <span className="rpi__mile-sub">{m.line} · ~{m.walkMin} min walk</span>
          </div>
        </div>
      ))}
    </div>
  )
}

export function RidePoolInsights({ matches, selectedMatch, wallet }) {
  const { t } = useLang()
  const best       = matches?.[0]
  const avgSave    = matches?.length ? Math.round(matches.reduce((s,m) => s + m.savings,    0) / matches.length) : 0
  const avgOverlap = matches?.length ? Math.round(matches.reduce((s,m) => s + m.overlapPct, 0) / matches.length) : 0
  const oMeta      = best ? overlapMeta(best.overlapPct) : null
  const display    = selectedMatch || best
  const recList    = recs(matches || [], selectedMatch, t)

  return (
    <aside className="rpi" aria-label="RidePool insights">
      <div className="rpi__header">
        <h2 className="rpi__header-title">{t.poolInsights}</h2>
        {best && (
          <span className="rpi__demand-badge"
            style={{ background: best.demandMeta.bg, color: best.demandMeta.color, borderColor: best.demandMeta.color + '44' }}>
            {best.demandMeta.icon} {best.demandMeta.label}
          </span>
        )}
      </div>

      <div className="rpi__body">
        <AnimatePresence mode="wait">
          {!best ? (
            <motion.div key="empty" className="rpi__empty"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <div className="rpi__empty-icon">🏅</div>
              <h3 className="rpi__empty-title">{t.pointsEconomy}</h3>
              <p className="rpi__empty-sub">{t.pointsEconomySub}</p>
              {wallet && (
                <div className="rpi__wallet-hint">
                  <span className="rpi__wallet-hint-bal">{wallet.balance} {t.pts}</span>
                  <span className="rpi__wallet-hint-label">{t.availableInWallet}</span>
                </div>
              )}
            </motion.div>
          ) : (
            <motion.div key="data"
              initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}
              transition={{ duration: 0.25 }}>

              {display?.safety?.hasAlert && (
                <div className="rpi__alert-banner">{display.safety.alertText}</div>
              )}

              <div className="rpi__section">
                <div className="rpi__section-title"><span>🏆</span> {t.bestPoolOption}</div>
                <div className="rpi__best">
                  <div className="rpi__best-row">
                    <span className="rpi__best-fare">{best.poolFare} {t.pts}</span>
                    <span className="rpi__best-save">{t.saveLabel} {best.savings} {t.pts}</span>
                  </div>
                  <span className="rpi__best-rupee">≈ ₹{best.poolFare} {t.fuelShareLabel} · ₹{best.savings} {t.savedVsSolo}</span>
                  <span className="rpi__best-label">
                    {best.overlapPct}% {t.avgOverlap} · {best.detourMin} min detour · {best.driver.name.split(' ')[0]}
                  </span>
                  {best.co2SavedKg > 0 && (
                    <div className="rpi__eco-row">
                      <span className="rpi__eco-chip">🌿 {best.co2SavedKg} kg CO₂ {t.fuelSaved}</span>
                      <span className="rpi__eco-chip">⛽ {best.fuelSavedL}L {t.fuelSaved}</span>
                    </div>
                  )}
                </div>
              </div>

              {display && (
                <div className="rpi__section">
                  <div className="rpi__section-title"><span>🏅</span> {t.pointsCostComparison}</div>
                  <FareReasons match={display} t={t} />
                  <PointsTable match={display} t={t} />
                </div>
              )}

              {display?.safety && (
                <div className="rpi__section">
                  <div className="rpi__section-title"><span>🛡</span> {t.routeSafetyLabel}</div>
                  <SafetyBar safety={display.safety} t={t} />
                  {display.safety.isNight && !display.safety.isLateNight && (
                    <div className="rpi__night-note">{t.nightRoute}</div>
                  )}
                </div>
              )}

              {display && (display.firstMile || display.lastMile) && (
                <div className="rpi__section">
                  <div className="rpi__section-title"><span>🚇</span> {t.firstLastMile}</div>
                  <MileCards first={display.firstMile} last={display.lastMile} t={t} />
                </div>
              )}

              <div className="rpi__section">
                <div className="rpi__section-title"><span>📊</span> {t.poolSummary}</div>
                <div className="rpi__stats-row">
                  <div className="rpi__stat-pill"><span className="rpi__stat-val">{avgSave} {t.pts}</span><span className="rpi__stat-key">{t.avgSave}</span></div>
                  <div className="rpi__stat-pill"><span className="rpi__stat-val">{avgOverlap}%</span><span className="rpi__stat-key">{t.avgOverlap}</span></div>
                  <div className="rpi__stat-pill"><span className="rpi__stat-val">{matches.length}</span><span className="rpi__stat-key">{t.matches}</span></div>
                </div>
              </div>

              <div className="rpi__section">
                <div className="rpi__section-title"><span>🔀</span> {t.overlapEfficiency}</div>
                <div className="rpi__overlap-bar-wrap">
                  <div className="rpi__overlap-bar-track">
                    <div className="rpi__overlap-bar-fill" style={{ width: `${avgOverlap}%`, background: oMeta?.color }} />
                  </div>
                  <div className="rpi__overlap-labels">
                    <span>{t.low}</span>
                    <span style={{ color: oMeta?.color, fontWeight: 700 }}>{avgOverlap}% avg</span>
                    <span>{t.excellent}</span>
                  </div>
                </div>
                {oMeta && (
                  <span className="rpi__overlap-chip"
                    style={{ color: oMeta.color, background: oMeta.bg, borderColor: oMeta.border }}>
                    {oMeta.label}
                  </span>
                )}
              </div>

              <div className="rpi__section">
                <div className="rpi__section-title"><span>🌱</span> {t.communityImpact}</div>
                <div className="rpi__community-row">
                  <div className="rpi__community-chip">
                    <span className="rpi__community-val">{matches.reduce((s,m) => s + (m.co2SavedKg || 0), 0).toFixed(1)} kg</span>
                    <span className="rpi__community-key">{t.co2IfAllPooled}</span>
                  </div>
                  <div className="rpi__community-chip">
                    <span className="rpi__community-val">{matches.reduce((s,m) => s + (m.fuelSavedL || 0), 0).toFixed(1)} L</span>
                    <span className="rpi__community-key">{t.fuelSaved}</span>
                  </div>
                  <div className="rpi__community-chip">
                    <span className="rpi__community-val">{matches.length}</span>
                    <span className="rpi__community-key">{t.ridersMatched}</span>
                  </div>
                </div>
              </div>

              {recList.length > 0 && (
                <div className="rpi__section">
                  <div className="rpi__section-title"><span>💡</span> {t.smartRecommendations}</div>
                  <div className="rpi__recs">
                    {recList.map((r, i) => (
                      <div key={i} className="rpi__rec">
                        <span className="rpi__rec-icon">{r.icon}</span>
                        <span>{r.text}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </aside>
  )
}
