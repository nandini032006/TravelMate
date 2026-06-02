/**
 * TravelMate RidePool simulation engine.
 *
 * Generates context-aware matches without a backend.
 * Architecture is backend-ready: replace generatePoolMatches() with
 *   fetch('/api/rides?from=…&to=…') and the UI stays unchanged.
 *
 * Key principles:
 *  - Seed changes each minute → different results each search
 *  - Rider positions generated along the real corridor, not random scatter
 *  - Overlap % from Haversine geometry, not zone heuristics
 *  - Pricing built from time + traffic + weather, not a fixed formula
 *  - Safety score changes with hour, weather, and risk-corridor proximity
 */

import { classifyZone, PICKUP_LANDMARKS, getDemandLabel } from '../data/mockRideDemand'
import { haversineKm, pointToSegmentKm, computeGeometricOverlap, estimateRouteDistKm } from '../utils/routeGeometry'
import { computeDynamicFares } from '../utils/dynamicPricing'
import { generateDriverProfile, getZoneTransit } from '../data/mockRiders'

// ── Seeded PRNG (deterministic within one minute, fresh each minute) ──────────
function sr(seed) { const x = Math.sin(seed + 1) * 10000; return x - Math.floor(x) }
function pick(arr, seed) { return arr[Math.floor(sr(seed) * arr.length)] }

// ── Risk corridors — proximity to these penalises safety score ────────────────
const RISK_CORRIDORS = [
  { name: 'PVNR Expressway',  lat: 17.382, lon: 78.493, radius: 3.0, nightOnly: true,  penalty: 15, reason: 'Overspeeding corridor after 10 PM'     },
  { name: 'ORR',              lat: 17.460, lon: 78.370, radius: 5.0, nightOnly: true,  penalty: 12, reason: 'High-speed highway, limited lighting'    },
  { name: 'Madhapur signal',  lat: 17.440, lon: 78.392, radius: 1.5, peakOnly: true,   penalty:  8, reason: 'Severe congestion 8–10 PM'              },
  { name: 'Old City core',    lat: 17.360, lon: 78.472, radius: 2.0, always: true,     penalty:  7, reason: 'Dense traffic, narrow lanes'             },
  { name: 'LB Nagar flyover', lat: 17.348, lon: 78.551, radius: 2.0, nightOnly: true,  penalty: 10, reason: 'Accident-prone stretch after 11 PM'      },
]

function dynamicSafetyScore(userFrom, userTo, hour, weather, traffic) {
  let score = 87
  const isNight     = hour >= 21 || hour < 6
  const isLateNight = hour >= 23 || hour < 5
  const isPeak      = (hour >= 8 && hour < 11) || (hour >= 17 && hour < 21)

  if (isLateNight)             score -= 18
  else if (isNight)            score -= 8
  if (weather === 'rain')      score -= 10
  if (weather === 'storm')     score -= 20
  if (traffic === 'heavy')     score -= 5

  for (const rc of RISK_CORRIDORS) {
    const d = pointToSegmentKm(rc.lat, rc.lon, userFrom.lat, userFrom.lon, userTo.lat, userTo.lon)
    if (d < rc.radius) {
      if      (rc.nightOnly && (isNight || isLateNight)) score -= rc.penalty
      else if (rc.peakOnly  && isPeak)                   score -= rc.penalty
      else if (rc.always)                                score -= rc.penalty
    }
  }

  const finalScore = Math.max(22, Math.min(90, Math.round(score)))
  const hasAlert   = finalScore < 65 || isLateNight

  let alertText = null
  if (isLateNight)       alertText = '⚠ Late-night ride — share your trip with a trusted contact'
  else if (finalScore < 60) alertText = '⚠ Route passes through elevated-risk corridor'

  return { score: finalScore, hasAlert, alertText, isNight, isLateNight }
}

// ── Traffic level from time + day ─────────────────────────────────────────────
function trafficLevel(hour, dow) {
  const wd = dow > 0 && dow < 6  // weekday
  if (wd && ((hour >= 8 && hour < 11) || (hour >= 17 && hour < 21))) return 'heavy'
  if (wd && ((hour >= 7 && hour < 8)  || (hour >= 11 && hour < 14))) return 'moderate'
  return 'light'
}

// ── Hyderabad corridor–aware ride density ─────────────────────────────────────
function rideDensity(fromZone, toZone, hour, dow) {
  const isWeekend  = dow === 0 || dow === 6
  const isLate     = hour >= 23 || hour < 5
  const isMid      = hour >= 11 && hour < 17
  const residentials = ['WEST_RES', 'NORTH', 'EAST', 'CENTRAL', 'SOUTH', 'OLD_CITY']

  const itMorning = !isWeekend && hour >= 7 && hour < 11
    && residentials.includes(fromZone) && toZone === 'WEST_IT'
  const itEvening = !isWeekend && hour >= 17 && hour < 21
    && fromZone === 'WEST_IT' && residentials.includes(toZone)
  const airport   = fromZone === 'AIRPORT' || toZone === 'AIRPORT'

  if (itMorning || itEvening)           return 5
  if (itMorning && isWeekend)           return 3
  if (airport && (hour >= 21 || hour < 7)) return 4
  if (airport)                          return 2
  if (isLate)                           return 2
  if (isMid)                            return 3
  return 4
}

// ── Corridor label ────────────────────────────────────────────────────────────
const CORRIDOR_LABELS = {
  'WEST_RES→WEST_IT': 'IT Commute Corridor',
  'NORTH→WEST_IT':    'North–IT Express',
  'EAST→WEST_IT':     'Cross-City IT Route',
  'CENTRAL→WEST_IT':  'Central IT Link',
  'WEST_IT→WEST_RES': 'IT Homeward Corridor',
  'WEST_IT→NORTH':    'IT–North Return',
  'WEST_IT→EAST':     'IT–East Commute',
  'WEST_IT→CENTRAL':  'IT–Central Link',
  'CENTRAL→AIRPORT':  'Airport Express Route',
  'WEST_RES→AIRPORT': 'Western Airport Corridor',
  'OLD_CITY→WEST_IT': 'Old City–IT Connector',
  'SOUTH→WEST_IT':    'South–IT Link',
  'EAST→CENTRAL':     'East–Central Commute',
}
function corridorLabel(fz, tz) { return CORRIDOR_LABELS[`${fz}→${tz}`] || 'Urban Commute Route' }

// ── Corridor-aligned rider position generator ─────────────────────────────────
// Riders travel ALONG the same corridor, not random scatter.
// Each rider is projected onto the user's route vector, then offset perpendicularly.
function corridorRider(userFrom, userTo, seed, perpSpreadDeg) {
  // Pick a start fraction (0–35%) and end fraction (65–100%) so rider covers middle corridor
  const startFrac = sr(seed + 1) * 0.35
  const endFrac   = 0.65 + sr(seed + 2) * 0.35

  const basFromLat = userFrom.lat + (userTo.lat - userFrom.lat) * startFrac
  const basFromLon = userFrom.lon + (userTo.lon - userFrom.lon) * startFrac
  const basToLat   = userFrom.lat + (userTo.lat - userFrom.lat) * endFrac
  const basToLon   = userFrom.lon + (userTo.lon - userFrom.lon) * endFrac

  // Perpendicular unit vector
  const routeLat = userTo.lat - userFrom.lat
  const routeLon = userTo.lon - userFrom.lon
  const mag      = Math.sqrt(routeLat ** 2 + routeLon ** 2) || 1
  const perpLat  = -routeLon / mag
  const perpLon  =  routeLat / mag

  const side   = sr(seed + 3) > 0.5 ? 1 : -1
  const offset = sr(seed + 4) * perpSpreadDeg * side

  return {
    riderFrom: { lat: basFromLat + perpLat * offset, lon: basFromLon + perpLon * offset },
    riderTo:   { lat: basToLat   + perpLat * offset, lon: basToLon   + perpLon * offset },
  }
}

// ── Comfort score ─────────────────────────────────────────────────────────────
function comfortScore(occupancy, maxOcc, detourMin, overlapPct, traffic, hour, vehType) {
  let s = 100
  s -= (occupancy / maxOcc) * 22
  s -= detourMin * 1.8
  s -= (100 - overlapPct) * 0.22
  if (traffic === 'heavy')    s -= 12
  else if (traffic === 'moderate') s -= 5
  if (hour >= 22 || hour < 6) s -= 8
  if (vehType === 'bike' && occupancy > 1) s -= 15
  return Math.max(18, Math.min(100, Math.round(s)))
}

// ── ETA estimate ──────────────────────────────────────────────────────────────
function etaMin(distKm, traffic, detour) {
  const spd = traffic === 'heavy' ? 17 : traffic === 'moderate' ? 24 : 33
  return Math.round(distKm / spd * 60) + detour
}

// ── Main export ───────────────────────────────────────────────────────────────
export function generatePoolMatches(from, to, vehicleTypePref = 'any') {
  if (!from?.lat || !to?.lat) return []

  const now     = new Date()
  const hour    = now.getHours()
  const minute  = now.getMinutes()
  const dow     = now.getDay()

  const fromZone = classifyZone(from.lat, from.lon)
  const toZone   = classifyZone(to.lat,   to.lon)
  const traf     = trafficLevel(hour, dow)
  const distKm   = estimateRouteDistKm(from, to)
  const count    = rideDensity(fromZone, toZone, hour, dow)
  const safety   = dynamicSafetyScore(from, to, hour, 'clear', traf)
  const firstMile = getZoneTransit(fromZone)
  const lastMile  = getZoneTransit(toZone)

  // Seed changes each minute — fresh results every minute, stable during re-renders
  const seed0 = (
    Math.round(from.lat * 10000) * 31 ^
    Math.round(from.lon * 10000) * 17 ^
    Math.round(to.lat   * 10000) * 13 ^
    hour * 60 + minute
  )

  const pickups = PICKUP_LANDMARKS[fromZone] || PICKUP_LANDMARKS['CENTRAL']

  // Best matches use tighter corridor (lower perpendicular spread)
  // Lower-ranked matches are from neighbouring parallel routes
  const spreads = [0.003, 0.006, 0.010, 0.015, 0.020]

  const matches = Array.from({ length: count }, (_, i) => {
    const s = (seed0 + i * 137 + i * i * 31) >>> 0  // stable uint32

    const { riderFrom, riderTo } = corridorRider(from, to, s, spreads[i] ?? 0.020)

    // Real geometric overlap — no fake percentages
    const overlap = computeGeometricOverlap(from, to, riderFrom, riderTo)

    // Pickup deviation: extra km rider goes to reach user
    const pickupDevKm = haversineKm(riderFrom.lat, riderFrom.lon, from.lat, from.lon)
    const dropDevKm   = haversineKm(to.lat, to.lon, riderTo.lat, riderTo.lon)
    // Detour: pickup + drop deviation at pickup speeds (~20 km/h urban)
    const detour = Math.min(18, Math.round((pickupDevKm + dropDevKm) / 20 * 60))

    const driver  = generateDriverProfile(s + 400, vehicleTypePref)
    const maxOcc  = driver.vehicle.type === 'bike' ? 2 : 4
    const occ     = Math.min(maxOcc - 1, Math.max(1, Math.floor(sr(s + 7) * (maxOcc - 1)) + 1))

    const fares   = computeDynamicFares(distKm, overlap, hour, dow, traf, 'clear')
    const eta     = etaMin(distKm, traf, detour)
    const comfort = comfortScore(occ, maxOcc, detour, overlap, traf, hour, driver.vehicle.type)
    const pickup  = pick(pickups, s + 91)

    const demandLevel = count >= 5 ? 'high' : count >= 4 ? 'moderate' : 'low'

    // Carbon & fuel savings vs solo car (per shared rider)
    const totalOcc    = occ + 1  // include the new rider
    const shareFactor = Math.round((1 - 1 / totalOcc) * 10) / 10
    const co2SavedKg  = Math.round(distKm * 0.21  * shareFactor * 10) / 10
    const fuelSavedL  = Math.round(distKm * 0.085 * shareFactor * 10) / 10

    return {
      id:            `rp_${seed0}_${i}`,
      rank:          i + 1,
      overlapPct:    overlap,
      occupancy:     occ,
      maxOccupancy:  maxOcc,
      distKm:        Math.round(distKm * 10) / 10,
      ...fares,
      etaMin:        eta,
      detourMin:     detour,
      pickupDevKm:   Math.round(pickupDevKm * 10) / 10,
      dropDevKm:     Math.round(dropDevKm * 10) / 10,
      comfortScore:  comfort,
      trafficLevel:  traf,
      pickup,
      corridorLabel: corridorLabel(fromZone, toZone),
      demandLevel,
      demandMeta:    getDemandLabel(demandLevel),
      co2SavedKg,
      fuelSavedL,
      fromZone, toZone, riderFrom, riderTo,
      driver,
      safety,
      firstMile,
      lastMile,
    }
  })

  // Sort by real overlap % descending
  return matches.sort((a, b) => b.overlapPct - a.overlapPct)
}
