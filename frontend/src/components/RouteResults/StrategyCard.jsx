import { motion } from 'framer-motion'
import { getMeta } from '../../utils/modeColors'
import { fmtDuration, fmtDist, fmtCost } from '../../utils/formatters'
import { RouteStep } from './RouteStep'
import './StrategyCard.css'

const TAG_STYLES = {
  fastest:         { bg: 'rgba(59,130,246,0.15)',  color: '#3b82f6', label: '⚡ Fastest' },
  cheapest:        { bg: 'rgba(34,197,94,0.15)',   color: '#22c55e', label: '💰 Cheapest' },
  least_walking:   { bg: 'rgba(168,85,247,0.15)',  color: '#7c3aed', label: '🚶 Min Walk' },
}

function RoutePreview({ route }) {
  if (!route) return null
  const primary = route.primary_mode || 'bus'
  const meta = getMeta(primary)
  const tags = route.tags || []
  const firstTransit = (route.steps || []).find(s => s.mode !== 'walk' && s.mode !== 'auto')

  return (
    <div className="sc__preview">
      <div className="sc__preview-header">
        <div className="sc__preview-mode" style={{ color: meta.color }}>
          <span>{meta.icon || primary}</span>
          <span>{meta.label || primary}</span>
          {firstTransit?.line_name && (
            <span className="sc__preview-line" style={{ background: meta.bg, color: meta.color }}>
              {firstTransit.line_name}
            </span>
          )}
        </div>
        {tags.map(tag => TAG_STYLES[tag] && (
          <span key={tag} className="sc__preview-tag" style={{ background: TAG_STYLES[tag].bg, color: TAG_STYLES[tag].color }}>
            {TAG_STYLES[tag].label}
          </span>
        ))}
      </div>

      <div className="sc__preview-stats">
        <span className="sc__stat">⏱ {fmtDuration(route.total_duration_sec, 'en')}</span>
        <span className="sc__stat-div" />
        <span className="sc__stat">💰 {fmtCost(route.total_cost_inr)}</span>
        <span className="sc__stat-div" />
        <span className="sc__stat">🚶 {fmtDist(route.walking_distance_m, 'en')}</span>
        <span className="sc__stat-div" />
        <span className="sc__stat">🔄 {route.transfers ?? 0}</span>
      </div>

      <div className="sc__preview-stops">
        <span className="sc__stop-name">{route.steps?.[0]?.from_name || ''}</span>
        <span className="sc__arrow">→</span>
        <span className="sc__stop-name">{route.steps?.[route.steps.length - 1]?.to_name || ''}</span>
      </div>
    </div>
  )
}

export function StrategyCard({ strategy, selected, dimmed, index, onSelect, onHover, onViewDetails }) {
  if (!strategy || (!strategy.routes?.length && !strategy.fallback)) return null

  const canSelect = strategy.bestRoute && !!onSelect
  const themeColor = strategy.id === 'least_waiting' ? '#8b5cf6'
    : strategy.id === 'fastest_arrival' ? '#3b82f6'
    : strategy.id === 'metro_preferred' ? '#3b82f6'
    : strategy.id === 'mmts_preferred' ? '#d97706'
    : strategy.id === 'bus_preferred' ? '#f97316'
    : '#059669'

  return (
    <motion.div
      className={`sc${selected ? ' sc--selected' : ''}`}
      style={{ '--sc-accent': themeColor }}
      onClick={() => canSelect && onSelect(strategy.bestRoute)}
      onMouseEnter={() => onHover?.(strategy.bestRoute)}
      onMouseLeave={() => onHover?.(null)}
      initial={{ opacity: 0, y: 10 }}
      animate={{
        opacity: dimmed ? 0.45 : 1,
        y: 0,
        scale: selected ? 1.005 : 1,
      }}
      transition={{ duration: 0.22, delay: index * 0.04 }}
    >
      <div className="sc__header">
        <span className="sc__icon">{strategy.icon}</span>
        <div className="sc__header-text">
          <span className="sc__name">{strategy.name}</span>
          <span className="sc__desc">{strategy.shortDesc}</span>
        </div>
        {strategy.strategyScore != null && (
          <div className="sc__score" style={{ color: themeColor }}>
            <span className="sc__score-num">{strategy.strategyScore}</span>
          </div>
        )}
      </div>

      {strategy.fallback ? (
        <div className="sc__fallback">
          <span className="sc__fallback-icon">ℹ️</span>
          <div className="sc__fallback-text">
            <span className="sc__fallback-msg">{strategy.fallback.message}</span>
            {strategy.fallback.alternative && (
              <span className="sc__fallback-alt">{strategy.fallback.alternative}</span>
            )}
          </div>
        </div>
      ) : strategy.routes?.length > 0 ? (
        <div className="sc__routes">
          {strategy.routes.map((route, i) => (
            <RoutePreview key={i} route={route} />
          ))}
        </div>
      ) : null}
    </motion.div>
  )
}
