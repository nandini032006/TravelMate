import { getMeta } from '../../utils/modeColors'
import { fmtDuration, fmtDist, fmtCost } from '../../utils/formatters'
import { useLang } from '../../contexts/LanguageContext'
import { buildTeInstruction } from '../../utils/teInstruction'
import { translateStopName } from '../../translations/stationNames'
import './RouteStep.css'

const MODE_ICONS = { bus: '🚌', metro: '🚇', mmts: '🚆', walk: '🚶', auto: '🛺' }

export function RouteStep({ step, isLast }) {
  const meta = getMeta(step.mode)
  const { t, lang } = useLang()
  const modeLabel = t[step.mode] || meta.label
  const stopCount = (step.stop_sequence?.length ?? 1) - 1

  const instruction = lang === 'te'
    ? buildTeInstruction(step, t)
    : step.instruction

  const stopList = lang === 'te'
    ? (step.stop_sequence || []).map(translateStopName)
    : (step.stop_sequence || [])

  const isTransit = step.mode !== 'walk' && step.mode !== 'auto'
  const icon = MODE_ICONS[step.mode] || meta.icon

  return (
    <div className={`rs${isLast ? ' rs--last' : ''}`}>
      {/* Timeline spine */}
      <div className="rs__spine">
        <div className="rs__dot" style={{ background: meta.color }} />
        {!isLast && <div className="rs__line" style={{ background: meta.color + '55' }} />}
      </div>

      {/* Step content */}
      <div className="rs__body">
        {/* Mode pill */}
        <div className="rs__pill" style={{ background: meta.bg, color: meta.color }}>
          <span className="rs__pill-icon">{icon}</span>
          <span className="rs__pill-label">{modeLabel}</span>
          {step.line_name && isTransit && (
            <span className="rs__pill-line">{step.line_name}</span>
          )}
        </div>

        {/* Instruction text */}
        <p className="rs__instruction">{instruction}</p>

        {/* Meta row */}
        <div className="rs__meta">
          <span>{fmtDuration(step.duration_sec, lang)}</span>
          <span className="rs__meta-dot">·</span>
          <span>{fmtDist(step.distance_m, lang)}</span>
          {step.cost_inr > 0 && (
            <>
              <span className="rs__meta-dot">·</span>
              <span className="rs__meta-cost">{fmtCost(step.cost_inr)}</span>
            </>
          )}
        </div>

        {/* Stop list (expandable) */}
        {stopList.length > 2 && (
          <details className="rs__stops">
            <summary className="rs__stops-summary">
              {stopCount} {stopCount === 1 ? (t.stop || 'stop') : (t.stops || 'stops')}
            </summary>
            <ol className="rs__stop-list">
              {stopList.map((s, i) => <li key={i}>{s}</li>)}
            </ol>
          </details>
        )}
      </div>
    </div>
  )
}
