// Hyderabad area zone classification and demand corridors.
// No individual named riders — all data is corridor-level.

const ZONE_BOUNDS = [
  { id: 'AIRPORT',  minLat: 0,     maxLat: 17.28, minLon: 0,    maxLon: 99,   label: 'Airport Zone',      type: 'airport'     },
  { id: 'SOUTH',    minLat: 17.28, maxLat: 17.38, minLon: 0,    maxLon: 78.46, label: 'South Hyderabad',  type: 'mixed'       },
  { id: 'OLD_CITY', minLat: 17.28, maxLat: 17.42, minLon: 78.46,maxLon: 99,   label: 'Old City',          type: 'commercial'  },
  { id: 'WEST_IT',  minLat: 17.40, maxLat: 17.47, minLon: 78.33,maxLon: 78.41,label: 'IT Corridor',       type: 'it'          },
  { id: 'WEST_RES', minLat: 17.42, maxLat: 17.54, minLon: 0,    maxLon: 78.41,label: 'West Residential',  type: 'residential' },
  { id: 'NORTH',    minLat: 17.54, maxLat: 99,    minLon: 0,    maxLon: 78.50,label: 'North Hyderabad',   type: 'residential' },
  { id: 'EAST',     minLat: 17.38, maxLat: 17.50, minLon: 78.50,maxLon: 99,   label: 'East Hyderabad',    type: 'residential' },
  { id: 'CENTRAL',  minLat: 0,     maxLat: 99,    minLon: 0,    maxLon: 99,   label: 'Central Hyderabad', type: 'mixed'       }, // fallback
]

export function classifyZone(lat, lon) {
  for (const z of ZONE_BOUNDS) {
    if (lat >= z.minLat && lat < z.maxLat && lon >= z.minLon && lon < z.maxLon)
      return z.id
  }
  return 'CENTRAL'
}

export function getZoneMeta(id) {
  return ZONE_BOUNDS.find(z => z.id === id) || ZONE_BOUNDS[ZONE_BOUNDS.length - 1]
}

export function getDemandLevel(fromZone, toZone, hour) {
  const isMorningPeak = hour >= 7  && hour < 11
  const isEveningPeak = hour >= 17 && hour < 21
  const isNight       = hour >= 22 || hour < 5
  const residentialZones = ['NORTH', 'WEST_RES', 'EAST', 'CENTRAL', 'SOUTH', 'OLD_CITY']

  const isItMorning = isMorningPeak && residentialZones.includes(fromZone) && toZone === 'WEST_IT'
  const isItEvening = isEveningPeak && fromZone === 'WEST_IT' && residentialZones.includes(toZone)
  const isAirport   = toZone === 'AIRPORT' || fromZone === 'AIRPORT'

  if (isItMorning || isItEvening) return 'high'
  if (isAirport) return 'moderate'
  if (isNight)   return 'low'
  if (isMorningPeak || isEveningPeak) return 'moderate'
  return 'low'
}

export function getCorridorLabel(fromZone, toZone) {
  const labels = {
    'WEST_RES→WEST_IT': 'IT Commute Corridor',
    'NORTH→WEST_IT':    'North–IT Express',
    'EAST→WEST_IT':     'Cross-City IT Route',
    'CENTRAL→WEST_IT':  'Central IT Link',
    'WEST_IT→WEST_RES': 'IT Homeward Corridor',
    'WEST_IT→NORTH':    'IT–North Return',
    'WEST_IT→EAST':     'IT–East Commute',
    'WEST_IT→CENTRAL':  'IT–Central Link',
  }
  return labels[`${fromZone}→${toZone}`] || 'Urban Commute Route'
}

export const PICKUP_LANDMARKS = {
  WEST_IT:  ['Raidurg Metro Station', 'Hitech City Skywalk', 'Cyber Towers Junction', 'DLF Cyber City Gate', 'Mindspace Junction', 'HITEC City Bus Bay'],
  WEST_RES: ['Miyapur Metro Gate B', 'KPHB Colony 6th Phase', 'Kukatpally JNTU Gate', 'Bachupally Junction', 'Nizampet Crossroads', 'KPHB MMTS Stop'],
  NORTH:    ['Kompally Bus Stop', 'Medchal Road Junction', 'Alwal X Roads', 'Suraram Colony Gate', 'Bowrampet Junction'],
  CENTRAL:  ['Ameerpet Metro Gate A', 'Punjagutta Junction', 'Khairatabad Flyover', 'Greenlands Junction', 'Somajiguda Circle', 'Begumpet Airport Road'],
  EAST:     ['Uppal Main Junction', 'LB Nagar Metro Station', 'ECIL X Roads', 'Malkajgiri Station', 'Habsiguda Bus Stop', 'Nagole Metro Station'],
  SOUTH:    ['Mehdipatnam Crossroads', 'Tolichowki Junction', 'Attapur Bus Stop', 'Masab Tank Junction', 'Nalgonda X Roads'],
  AIRPORT:  ['RGIA Terminal 1 Arrivals', 'RGIA Terminal 2 Gate', 'Shamshabad Junction', 'Airport Road Toll Plaza'],
  OLD_CITY: ['Secunderabad Station Gate 1', 'Paradise Circle', 'SD Road Junction', 'Patny Circle', 'Clock Tower Junction'],
}

export function getDemandLabel(level) {
  if (level === 'high')     return { label: 'High demand',     color: '#dc2626', bg: 'rgba(220,38,38,0.08)',   icon: '🔥' }
  if (level === 'moderate') return { label: 'Moderate demand', color: '#d97706', bg: 'rgba(217,119,6,0.08)',   icon: '📊' }
  return                           { label: 'Low demand',      color: '#64748b', bg: 'rgba(100,116,139,0.08)', icon: '🕓' }
}
