/**
 * Route corridor analyzer — derives metrics from step geometry and OSM infra.
 * All output computed from actual route data. No hardcoded locations.
 */

export function analyzeRouteCorridor(route, infra) {
  if (!route?.steps?.length) return null

  const steps     = route.steps
  const motorized = steps.filter(s => s.mode !== 'walk' && s.distance_m > 0 && s.duration_sec > 0)
  const walkSteps = steps.filter(s => s.mode === 'walk')

  const segSpeeds = motorized.map(s => (s.distance_m / s.duration_sec) * 3.6)
  const avgSpeed  = segSpeeds.length
    ? segSpeeds.reduce((a, b) => a + b, 0) / segSpeeds.length : 20
  const maxSpeed  = segSpeeds.length ? Math.max(...segSpeeds) : 20

  const hasMetro = steps.some(s => s.mode === 'metro')
  const hasMmts  = steps.some(s => s.mode === 'mmts')
  const hasBus   = steps.some(s => s.mode === 'bus')
  const hasAuto  = steps.some(s => s.mode === 'auto')

  // Count mode transitions excluding walk
  const transitModes = steps.map(s => s.mode).filter(m => m !== 'walk')
  let transfers = 0
  for (let i = 1; i < transitModes.length; i++) {
    if (transitModes[i] !== transitModes[i - 1]) transfers++
  }

  const totalWalkM = walkSteps.reduce((sum, s) => sum + (s.distance_m || 0), 0)
  const totalDistM = route.total_distance_m
    || steps.reduce((sum, s) => sum + (s.distance_m || 0), 0)
  const walkRatio = totalDistM > 0 ? totalWalkM / totalDistM : 0

  const distByMode = {}
  for (const step of steps)
    distByMode[step.mode] = (distByMode[step.mode] || 0) + (step.distance_m || 0)

  const isHighway    = !!(infra?.isHighwayHeavy) || maxSpeed > 65
  const isDense      = (infra?.signalDensity ?? 0) > 5 || (infra?.transitDensity ?? 0) > 5
  const isCommercial = !!(infra?.isCommercialZone)

  let corridorType
  if (hasMetro)                   corridorType = 'metro_corridor'
  else if (hasMmts)               corridorType = 'rail_corridor'
  else if (isHighway && !isDense) corridorType = 'highway'
  else if (isDense && isCommercial) corridorType = 'urban_commercial'
  else if (isDense)               corridorType = 'urban_dense'
  else if (hasBus)                corridorType = 'transit_corridor'
  else                            corridorType = 'urban_mixed'

  const characteristics = []
  if ((infra?.signalDensity ?? 0) > 6)    characteristics.push('high_junction_density')
  if (isHighway)                            characteristics.push('highway_segments')
  if (maxSpeed > 55)                        characteristics.push('high_speed_sections')
  if (transfers >= 2)                       characteristics.push('multi_modal')
  if ((infra?.transitDensity ?? 0) > 5)   characteristics.push('dense_transit')
  if (isCommercial)                         characteristics.push('commercial_zone')
  if (walkRatio > 0.15)                     characteristics.push('walk_exposure')

  return {
    corridorType,
    avgSpeed:    Math.round(avgSpeed),
    maxSpeed:    Math.round(maxSpeed),
    hasMetro, hasMmts, hasBus, hasAuto,
    transfers,
    walkRatio,
    totalDistKm: totalDistM / 1000,
    characteristics,
    distByMode,
    isHighway,
    isDense,
    isCommercial,
    segmentCount: steps.length,
  }
}

export function corridorTypeMeta(type) {
  switch (type) {
    case 'metro_corridor':   return { label: 'Metro Corridor',    icon: '🚇', color: '#7c3aed', bg: 'rgba(124,58,237,0.08)', border: 'rgba(124,58,237,0.22)' }
    case 'rail_corridor':    return { label: 'Rail Corridor',     icon: '🚂', color: '#059669', bg: 'rgba(5,150,105,0.08)',  border: 'rgba(5,150,105,0.22)'  }
    case 'highway':          return { label: 'Highway Corridor',  icon: '🛣',  color: '#dc2626', bg: 'rgba(220,38,38,0.08)',  border: 'rgba(220,38,38,0.22)'  }
    case 'urban_commercial': return { label: 'Commercial Corridor', icon: '🏪', color: '#d97706', bg: 'rgba(217,119,6,0.08)', border: 'rgba(217,119,6,0.22)'  }
    case 'urban_dense':      return { label: 'Dense Urban',       icon: '🏙',  color: '#ea580c', bg: 'rgba(234,88,12,0.08)',  border: 'rgba(234,88,12,0.22)'  }
    case 'transit_corridor': return { label: 'Transit Corridor',  icon: '🚌', color: '#2563eb', bg: 'rgba(37,99,235,0.08)',  border: 'rgba(37,99,235,0.22)'  }
    default:                 return { label: 'Urban Mixed',       icon: '🏘',  color: '#64748b', bg: 'rgba(100,116,139,0.08)', border: 'rgba(100,116,139,0.22)' }
  }
}

export function characteristicMeta(key) {
  const map = {
    high_junction_density: { icon: '🚥', text: 'Dense junctions' },
    highway_segments:      { icon: '🛣',  text: 'Highway sections' },
    high_speed_sections:   { icon: '⚡', text: 'High-speed segments' },
    multi_modal:           { icon: '🔄', text: 'Multi-modal route' },
    dense_transit:         { icon: '🚌', text: 'Dense transit stops' },
    commercial_zone:       { icon: '🏪', text: 'Commercial activity' },
    walk_exposure:         { icon: '🚶', text: 'Walking exposure' },
  }
  return map[key] || { icon: '•', text: key }
}
