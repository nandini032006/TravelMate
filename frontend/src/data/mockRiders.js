// Dynamic driver profile generator.
// Large name pools + time-seeded PRNG → different drivers every minute.

const FIRST_M = [
  'Arjun','Sai','Rahul','Kiran','Praveen','Suresh','Vijay','Ravi','Mohit','Srinivas',
  'Naveen','Anil','Deepak','Shankar','Venkat','Ramesh','Harish','Ganesh','Rohit','Amit',
  'Varun','Nikhil','Tarun','Ajay','Vinay','Sunil','Manoj','Srikanth','Pavan','Krishna',
  'Sandeep','Rajan','Rakesh','Pranav','Ashish','Vamsi','Karthik','Charan','Balaji','Hari',
  'Lokesh','Satish','Naresh','Girish','Vivek','Umesh','Nitin','Hemanth','Akash','Dinesh',
]
const FIRST_F = [
  'Priya','Kavya','Divya','Anjali','Swathi','Pooja','Sneha','Lakshmi','Manasa','Preeti',
  'Sindhu','Asha','Nandini','Mythili','Ramya','Geetha','Keerthi','Revathi','Suma','Hema',
  'Sravani','Padma','Rekha','Usha','Latha','Meena','Vani','Sujatha','Radha','Sirisha',
  'Bhavana','Deepthi','Soumya','Mounika','Tejaswi','Shruthi','Pavani','Aparna','Haritha','Jyothi',
  'Nivetha','Madhuri','Soundarya','Reshma','Fatima','Zara','Aisha','Noor','Sameera','Razia',
]
const LAST = [
  'Reddy','Kumar','Sharma','Rao','Naidu','Varma','Choudary','Goud','Patel','Singh',
  'Agarwal','Verma','Sinha','Yadav','Gupta','Pandey','Joshi','Nair','Iyer','Pillai',
  'Hegde','Kaur','Bhat','Shukla','Tiwari','Mishra','Dubey','Tripathi','Mehta','Shah',
  'Malhotra','Kapoor','Bose','Das','Sen','Roy','Ghosh','Mukherjee','Chatterjee','Khan',
  'Shaikh','Siddiqui','Ansari','Qureshi','Hussain','Begum','Rao','Raju','Babu','Murthy',
]
const CARS = [
  'Maruti Swift','Honda City','Hyundai i20','Tata Nexon','Kia Seltos',
  'Maruti Ertiga','Honda Amaze','Hyundai Creta','MG Hector','Mahindra XUV300',
  'Maruti Dzire','Toyota Glanza','Volkswagen Polo','Skoda Rapid','Toyota Innova',
  'Maruti Baleno','Hyundai Venue','Kia Sonet','Tata Tiago','Renault Kwid',
]
const BIKES = [
  'Honda Activa 6G','Bajaj Pulsar 150','TVS Jupiter','Royal Enfield Bullet 350',
  'Yamaha FZ S','Hero Splendor+','Bajaj Dominar 400','Honda CB Shine',
  'TVS Apache RTR 160','Hero HF Deluxe','Suzuki Access 125','Yamaha Ray ZR',
  'Honda CB Unicorn','Bajaj Avenger 220','TVS Ntorq 125','Hero Glamour',
]
const COLORS = [
  '#7c3aed','#2563eb','#059669','#d97706','#dc2626',
  '#0891b2','#16a34a','#9333ea','#0284c7','#b45309',
  '#0f766e','#6d28d9','#c026d3','#0369a1','#15803d',
]

function sr(seed) { const x = Math.sin(seed + 1) * 10000; return x - Math.floor(x) }
function pick(arr, seed) { return arr[Math.floor(sr(seed) * arr.length)] }

export function generateDriverProfile(seed, vehicleTypePref = 'any') {
  const isMale     = sr(seed + 100) > 0.36
  const firstName  = pick(isMale ? FIRST_M : FIRST_F, seed + 1)
  const lastName   = pick(LAST, seed + 2)
  const name       = `${firstName} ${lastName}`
  const initials   = `${firstName[0]}${lastName[0]}`
  const avatarColor = pick(COLORS, seed + 3)

  // Rating: realistic spread 3.5–5.0 (skewed toward 4.0–4.8)
  const raw    = sr(seed + 4)
  const rating = Math.min(5.0, Math.round((3.5 + raw * raw * 1.5) * 10) / 10)
  const trips  = Math.floor(12 + sr(seed + 5) * 588)

  // Response time: 1–12 mins, shorter for more active drivers
  const responseMins = Math.max(1, Math.round(1 + sr(seed + 20) * 11))
  // Cancellation rate: 0–18%, lower for high-rated drivers
  const cancelRate = Math.max(0, Math.round((1 - (rating - 3.5) / 1.5) * 18 * sr(seed + 21)))

  const verR = sr(seed + 6)
  const verification = verR > 0.60 ? 'verified' : verR > 0.28 ? 'partial' : 'unverified'
  const verTypes = []
  if (sr(seed + 7)  > 0.08) verTypes.push('phone')
  if (sr(seed + 8)  > 0.48) verTypes.push('company_email')
  if (sr(seed + 9)  > 0.68) verTypes.push('college_email')
  if (sr(seed + 10) > 0.82) verTypes.push('govt_id')

  const actualType = vehicleTypePref !== 'any'
    ? vehicleTypePref
    : (sr(seed + 11) > 0.30 ? 'car' : 'bike')

  const model = actualType === 'car' ? pick(CARS, seed + 12) : pick(BIKES, seed + 12)
  const p1    = String.fromCharCode(65 + Math.floor(sr(seed + 15) * 26))
  const p2    = String.fromCharCode(65 + Math.floor(sr(seed + 16) * 26))
  const pNum  = Math.floor(1000 + sr(seed + 13) * 9000)
  const num   = `TS ${Math.floor(7 + sr(seed + 14) * 3).toString().padStart(2,'0')} ${p1}${p2} ${pNum}`
  const isAC  = actualType === 'car' && sr(seed + 17) > 0.28
  const musicPref = (['quiet','any','music'])[Math.floor(sr(seed + 18) * 3)]
  const luggage   = sr(seed + 19) > 0.36

  return {
    name, initials, avatarColor,
    rating, trips,
    responseMins, cancelRate,
    verification, verTypes,
    gender: isMale ? 'male' : 'female',
    vehicle: { type: actualType, model, number: num, isAC, luggage, musicPref },
  }
}

export function verificationMeta(level) {
  if (level === 'verified') return { icon: '🟢', label: 'Verified',   color: '#16a34a', bg: 'rgba(22,163,74,0.08)',   border: 'rgba(22,163,74,0.22)'  }
  if (level === 'partial')  return { icon: '🟡', label: 'Partial',    color: '#d97706', bg: 'rgba(217,119,6,0.08)',   border: 'rgba(217,119,6,0.22)'  }
  return                           { icon: '🔴', label: 'Unverified', color: '#dc2626', bg: 'rgba(220,38,38,0.08)',   border: 'rgba(220,38,38,0.22)'  }
}

const ZONE_TRANSIT = {
  WEST_IT:  { type: 'metro', label: 'Raidurg Metro',      line: 'Blue Line',           walkMin: 8,  icon: '🚇' },
  WEST_RES: { type: 'metro', label: 'Miyapur Metro',       line: 'Blue Line',           walkMin: 5,  icon: '🚇' },
  CENTRAL:  { type: 'metro', label: 'Ameerpet Metro',      line: 'Blue + Red Line',     walkMin: 10, icon: '🚇' },
  EAST:     { type: 'metro', label: 'LB Nagar Metro',      line: 'Blue Line',           walkMin: 7,  icon: '🚇' },
  SOUTH:    { type: 'bus',   label: 'Mehdipatnam Bus Hub', line: 'TSRTC Route 5',       walkMin: 12, icon: '🚌' },
  NORTH:    { type: 'bus',   label: 'Kompally Bus Stop',   line: 'TSRTC Route 5C',      walkMin: 6,  icon: '🚌' },
  AIRPORT:  { type: 'bus',   label: 'Airport Express',     line: 'TSRTC AC Shuttle',    walkMin: 3,  icon: '🚌' },
  OLD_CITY: { type: 'mmts',  label: 'Nampally Station',   line: 'MMTS Hyderabad Line', walkMin: 8,  icon: '🚂' },
}
export function getZoneTransit(zoneId) { return ZONE_TRANSIT[zoneId] || null }
