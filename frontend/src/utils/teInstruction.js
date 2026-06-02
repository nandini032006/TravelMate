/**
 * Builds a Telugu route step instruction from the step data object.
 * Used only when lang === 'te'. Falls back to the original English
 * instruction string for any unrecognised pattern.
 *
 * The backend always returns instructions in English; this module
 * reconstructs them in Telugu using already-available step fields.
 */

import { translateStopName } from '../translations/stationNames'

/**
 * @param {object} step  – RouteStep data from the API
 * @param {object} t     – current translation object (te.js)
 * @returns {string}     – Telugu instruction text
 */
export function buildTeInstruction(step, t) {
  const from = translateStopName(step.from_name)
  const to   = translateStopName(step.to_name)

  switch (step.mode) {
    case 'walk': {
      const dist = _fmtDistTe(step.distance_m)
      return `${to} వరకు ${dist} నడవండి`
    }

    case 'auto': {
      const dist = _fmtDistTe(step.distance_m)
      const cost = Math.round(step.cost_inr)
      return `${to} వరకు ఆటో తీసుకోండి (${dist}) ≈ ₹${cost}`
    }

    case 'metro':
    case 'mmts':
    case 'bus': {
      const modeLabel = t[step.mode] || step.mode
      const nStops    = Math.max((step.stop_sequence?.length ?? 2) - 1, 1)
      const stopsWord = nStops === 1 ? t.stop : t.stops
      const line      = step.line_name ? ` ${step.line_name}` : ''
      return `${from} వద్ద ${modeLabel}${line} ఎక్కండి → ${to} వద్ద దిగండి (${nStops} ${stopsWord})`
    }

    default:
      return step.instruction
  }
}

function _fmtDistTe(m) {
  if (!m) return ''
  if (m < 1000) return `${Math.round(m)}మీ`
  return `${(m / 1000).toFixed(1)}కి.మీ`
}
