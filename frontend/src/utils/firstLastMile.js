// First & Last Mile — computes nearest Metro/MMTS from route endpoints.
// Uses Haversine distance to all known Hyderabad Metro + MMTS stations.

function haversineKm(lat1, lon1, lat2, lon2) {
  const R    = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a    = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

// ── Hyderabad Metro stations (Blue, Red, Green lines) ─────────────────────────
const METRO = [
  // Blue Line (Miyapur ↔ LB Nagar)
  { name: 'Miyapur',              line: 'Blue Line',        lat: 17.4972, lon: 78.3490 },
  { name: 'Hafeezpet',           line: 'Blue Line',        lat: 17.4898, lon: 78.3617 },
  { name: 'BHEL',                line: 'Blue Line',        lat: 17.4874, lon: 78.3668 },
  { name: 'Kukatpally',          line: 'Blue Line',        lat: 17.4843, lon: 78.3949 },
  { name: 'KPHB Colony',         line: 'Blue Line',        lat: 17.4810, lon: 78.4050 },
  { name: 'Moosapet',            line: 'Blue Line',        lat: 17.4677, lon: 78.4028 },
  { name: 'Bharat Nagar',        line: 'Blue Line',        lat: 17.4562, lon: 78.4186 },
  { name: 'Erragadda',           line: 'Blue Line',        lat: 17.4531, lon: 78.4260 },
  { name: 'ESI',                 line: 'Blue Line',        lat: 17.4471, lon: 78.4360 },
  { name: 'SR Nagar',            line: 'Blue Line',        lat: 17.4409, lon: 78.4440 },
  { name: 'Ameerpet',            line: 'Blue + Red Line',  lat: 17.4374, lon: 78.4487 },
  { name: 'Punjagutta',          line: 'Blue Line',        lat: 17.4322, lon: 78.4453 },
  { name: 'Irrum Manzil',        line: 'Blue Line',        lat: 17.4257, lon: 78.4385 },
  { name: 'Khairatabad',         line: 'Blue Line',        lat: 17.4199, lon: 78.4465 },
  { name: 'Lakdi Ka Pul',        line: 'Blue Line',        lat: 17.4092, lon: 78.4598 },
  { name: 'Assembly',            line: 'Blue Line',        lat: 17.4042, lon: 78.4675 },
  { name: 'Nampally',            line: 'Blue Line',        lat: 17.3906, lon: 78.4718 },
  { name: 'Gandhi Bhavan',       line: 'Blue Line',        lat: 17.3856, lon: 78.4735 },
  { name: 'Osmania Medical',     line: 'Blue Line',        lat: 17.3792, lon: 78.4769 },
  { name: 'MGBS',                line: 'Blue Line',        lat: 17.3769, lon: 78.4793 },
  { name: 'Malakpet',            line: 'Blue Line',        lat: 17.3680, lon: 78.4970 },
  { name: 'New Market',          line: 'Blue Line',        lat: 17.3614, lon: 78.5069 },
  { name: 'Musarambagh',         line: 'Blue Line',        lat: 17.3550, lon: 78.5174 },
  { name: 'Dilsukhnagar',        line: 'Blue Line',        lat: 17.3680, lon: 78.5280 },
  { name: 'Chaitanyapuri',       line: 'Blue Line',        lat: 17.3561, lon: 78.5373 },
  { name: 'Victoria Memorial',   line: 'Blue Line',        lat: 17.3519, lon: 78.5483 },
  { name: 'LB Nagar',            line: 'Blue Line',        lat: 17.3467, lon: 78.5537 },
  // Red Line (Miyapur → Hitec City section)
  { name: 'Durgam Cheruvu',      line: 'Blue Line',        lat: 17.4410, lon: 78.3817 },
  { name: 'Hitec City',          line: 'Blue Line',        lat: 17.4428, lon: 78.3795 },
  { name: 'Raidurg',             line: 'Blue Line',        lat: 17.4348, lon: 78.3758 },
  { name: 'Madhapur',            line: 'Blue Line',        lat: 17.4414, lon: 78.3882 },
  { name: 'Peddamma Temple',     line: 'Blue Line',        lat: 17.4347, lon: 78.4067 },
  { name: 'Jubilee Hills Check Post', line: 'Blue Line',   lat: 17.4292, lon: 78.4147 },
  // Red Line (JBS ↔ MGBS)
  { name: 'JBS Parade Grounds',  line: 'Red Line',         lat: 17.4452, lon: 78.4976 },
  { name: 'Secunderabad West',   line: 'Red Line',         lat: 17.4399, lon: 78.4983 },
  { name: 'Begumpet',            line: 'Red Line',         lat: 17.4434, lon: 78.4685 },
  { name: 'Prakash Nagar',       line: 'Red Line',         lat: 17.4408, lon: 78.4608 },
  { name: 'Rasoolpura',          line: 'Red Line',         lat: 17.4391, lon: 78.4545 },
  { name: 'Paradise',            line: 'Red Line',         lat: 17.4374, lon: 78.4487 },
  // Green Line (Nagole ↔ Stadium)
  { name: 'Nagole',              line: 'Green Line',       lat: 17.3740, lon: 78.5533 },
  { name: 'Uppal',               line: 'Green Line',       lat: 17.4010, lon: 78.5592 },
  { name: 'Stadium',             line: 'Green Line',       lat: 17.4148, lon: 78.5126 },
]

// ── MMTS stations ─────────────────────────────────────────────────────────────
const MMTS = [
  { name: 'Lingampally',         line: 'MMTS',             lat: 17.4813, lon: 78.3298 },
  { name: 'Chandanagar',         line: 'MMTS',             lat: 17.4806, lon: 78.3451 },
  { name: 'Hafeezpet MMTS',     line: 'MMTS',             lat: 17.4871, lon: 78.3625 },
  { name: 'Kondapur MMTS',      line: 'MMTS',             lat: 17.4621, lon: 78.3684 },
  { name: 'Hitec City MMTS',    line: 'MMTS',             lat: 17.4387, lon: 78.3808 },
  { name: 'Borabanda',           line: 'MMTS',             lat: 17.4749, lon: 78.3778 },
  { name: 'Moosapet MMTS',      line: 'MMTS',             lat: 17.4671, lon: 78.4060 },
  { name: 'SR Nagar MMTS',      line: 'MMTS',             lat: 17.4520, lon: 78.4183 },
  { name: 'Begumpet',            line: 'MMTS Hyd Line',    lat: 17.4434, lon: 78.4685 },
  { name: 'Secunderabad',        line: 'MMTS Hyd Line',    lat: 17.4399, lon: 78.4983 },
  { name: 'Nampally',            line: 'MMTS Hyd Line',    lat: 17.3800, lon: 78.4700 },
  { name: 'Kachiguda',           line: 'MMTS Hyd Line',    lat: 17.3903, lon: 78.4928 },
  { name: 'Malakpet MMTS',      line: 'MMTS Hyd Line',    lat: 17.3680, lon: 78.4970 },
  { name: 'Umdanagar',           line: 'MMTS',             lat: 17.3582, lon: 78.5190 },
  { name: 'LB Nagar MMTS',      line: 'MMTS',             lat: 17.3467, lon: 78.5537 },
]

function nearest(lat, lon, stations, maxKm) {
  let best = null, minDist = Infinity
  for (const s of stations) {
    const d = haversineKm(lat, lon, s.lat, s.lon)
    if (d < minDist) { minDist = d; best = s }
  }
  if (!best || minDist > maxKm) return null
  return {
    ...best,
    distKm:  Math.round(minDist * 10) / 10,
    walkMin: Math.max(1, Math.round(minDist * 13)),
  }
}

function buildMile(lat, lon, tag) {
  const metro = nearest(lat, lon, METRO, 3.0)
  const mmts  = nearest(lat, lon, MMTS,  2.5)

  const chosen = !metro && !mmts ? null
    : !mmts  ? metro
    : !metro ? mmts
    : metro.distKm <= mmts.distKm ? metro : mmts

  if (!chosen) return null

  const isMetro    = METRO.some(m => m.name === chosen.name)
  const type       = isMetro ? 'metro' : 'mmts'
  const icon       = isMetro ? '🚇' : '🚂'
  const walkSafety = chosen.walkMin > 15 ? 'Long walk — consider auto' : chosen.walkMin > 8 ? 'Moderate walk' : 'Short walk'
  const access     = chosen.walkMin <= 5 ? 'Good access' : chosen.walkMin <= 12 ? 'Moderate access' : 'Difficult access'

  const h = new Date().getHours()
  const note = (h >= 22 || h < 6)
    ? 'Auto recommended after 10 PM'
    : chosen.walkMin <= 7 ? 'Comfortable walking distance' : null

  return { tag, type, icon, name: chosen.name, line: chosen.line, distKm: chosen.distKm, walkMin: chosen.walkMin, walkSafety, access, note }
}

export function computeFirstLastMile(src, dst) {
  if (!src?.lat || !dst?.lat) return { first: null, last: null }
  return {
    first: buildMile(src.lat, src.lon, '1st Mile'),
    last:  buildMile(dst.lat, dst.lon, 'Last Mile'),
  }
}
