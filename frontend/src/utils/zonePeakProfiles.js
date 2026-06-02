// Zone-specific peak timing profiles for Hyderabad corridors.
// Zone type is derived from area name + reasons text — nothing hardcoded per location name.

const PROFILES = {
  IT_CORRIDOR: {
    label: 'IT Corridor',
    avoidText: 'Avoid 8:00–10:30 AM and 6:00–9:00 PM on weekdays (peak IT commute)',
    weekdayAlert: 'Severe IT rush 8–10:30 AM and 6–9 PM — buses and roads packed',
    weekendAlert: 'Light traffic — IT offices closed, corridor significantly clearer',
    nightRisk: 'low',
    peakWindows: [{ start: 8, end: 10.5 }, { start: 18, end: 21 }],
  },
  MARKET: {
    label: 'Market Zone',
    avoidText: 'Peak congestion 10 AM–2 PM and 4–7:30 PM; weekend days most crowded',
    weekdayAlert: 'Heavy market foot traffic and delivery vehicles 10 AM–2 PM',
    weekendAlert: 'Extreme crowd all day — avoid if possible, use transit over auto',
    nightRisk: 'low',
    peakWindows: [{ start: 10, end: 14 }, { start: 16, end: 19.5 }],
  },
  NIGHTLIFE: {
    label: 'Nightlife Area',
    avoidText: 'Elevated risk after 10 PM; Friday–Saturday nights highest drunk-driving risk',
    weekdayAlert: 'Moderate evening activity from 8 PM — stay alert at junctions',
    weekendAlert: 'High nightlife risk 10 PM–2 AM on Fri–Sat — exercise caution, avoid walking',
    nightRisk: 'very_high',
    peakWindows: [{ start: 22, end: 26 }],
  },
  HIGHWAY: {
    label: 'Highway / Expressway',
    avoidText: 'Overspeeding risk increases sharply after 11 PM — limited enforcement',
    weekdayAlert: 'Morning rush 7–9:30 AM; night overspeeding risk after 11 PM',
    weekendAlert: 'Late-night overspeeding risk higher on weekends — stay within speed limit',
    nightRisk: 'very_high',
    peakWindows: [{ start: 7, end: 9.5 }, { start: 23, end: 26 }],
  },
  TRANSPORT_HUB: {
    label: 'Transit Hub',
    avoidText: 'Extremely crowded 7–10 AM and 5–8:30 PM; allow extra boarding time',
    weekdayAlert: 'Station approach severely congested during commute hours',
    weekendAlert: 'Moderate weekend foot traffic — less crowded than weekdays',
    nightRisk: 'moderate',
    peakWindows: [{ start: 7, end: 10 }, { start: 17, end: 20.5 }],
  },
  FLOOD_ZONE: {
    label: 'Flood-Prone Area',
    avoidText: 'Waterlogging risk Jun–Oct — always check underpass conditions before travel',
    weekdayAlert: 'Waterlogging possible during heavy monsoon rain — avoid underpasses',
    weekendAlert: 'Waterlogging possible during heavy monsoon rain — avoid underpasses',
    nightRisk: 'moderate',
    peakWindows: [],
    monsoonNote: 'Check local water levels before travel Jun–Oct',
  },
  RESIDENTIAL: {
    label: 'Residential Corridor',
    avoidText: 'Busy 8–9 AM (school traffic) and 4:30–7 PM (evening return)',
    weekdayAlert: 'School drop-off congestion 8–9 AM; residential rush 4:30–7 PM',
    weekendAlert: 'Light weekend traffic — significantly smoother than weekdays',
    nightRisk: 'low',
    peakWindows: [{ start: 8, end: 9 }, { start: 16.5, end: 19 }],
  },
}

function deriveZoneType(area) {
  const text = [area.name, ...(area.reasons || [])].join(' ').toLowerCase()
  if (/it traffic|hitech|hitec city|gachibowli|madhapur|nanakramguda|cyber city|it corridor/.test(text)) return 'IT_CORRIDOR'
  if (/overspe.*\d{2,}|orr\b|pvnr|expressway|nh-\d|outskirt.*highway|high.?speed.*\d/.test(text))       return 'HIGHWAY'
  if (/drunk|bac\s*\d|nightlife|jubilee hills|banjara hills/.test(text))                               return 'NIGHTLIFE'
  if (/market|bazaar|shopping|charminar|koti|abids|laad/.test(text))                                   return 'MARKET'
  if (/bus stand|railway station|station approach|mgbs|secunderabad jn|kachiguda/.test(text))          return 'TRANSPORT_HUB'
  if (/flood|waterlog|waist.?deep|inundati|submerge/.test(text))                                       return 'FLOOD_ZONE'
  return 'RESIDENTIAL'
}

export function getZonePeakProfile(area) {
  const type    = deriveZoneType(area)
  const profile = PROFILES[type]
  const now     = new Date()
  const h       = now.getHours() + now.getMinutes() / 60
  const isWknd  = now.getDay() === 0 || now.getDay() === 6
  const isNight = h >= 22 || h < 5

  const isCurrentlyPeak = profile.peakWindows.some(({ start, end }) => {
    if (end > 24) return h >= start || h < (end - 24)
    return h >= start && h < end
  })

  return {
    zoneType:        type,
    label:           profile.label,
    avoidText:       profile.avoidText,
    currentAlert:    isWknd ? profile.weekendAlert : profile.weekdayAlert,
    nightRisk:       profile.nightRisk,
    monsoonNote:     profile.monsoonNote ?? null,
    isCurrentlyPeak,
    isHighNightRisk: isNight && (profile.nightRisk === 'very_high' || profile.nightRisk === 'high'),
  }
}

export function getRouteZoneProfiles(safetyMatched) {
  if (!safetyMatched?.length) return []
  return safetyMatched
    .map(area => ({ area, profile: getZonePeakProfile(area) }))
    .filter(({ profile }) => profile.isCurrentlyPeak || profile.isHighNightRisk || profile.nightRisk === 'very_high')
    .slice(0, 3)
}
