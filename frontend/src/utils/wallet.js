// Points wallet — 1 Point = 1 Rupee (Manaprayanam fuel-sharing economy)
const KEY = 'travelmate_wallet'

const SEED_HISTORY = [
  { type: 'credit', amount: 24, label: 'Pool ride as giver: Miyapur → HITEC City', ts: Date.now() - 3_600_000 },
  { type: 'credit', amount: 12, label: 'Eco bonus: 2-wheeler pool saved CO₂', ts: Date.now() - 7_200_000 },
  { type: 'credit', amount: 300, label: 'Welcome bonus — TravelMate Community', ts: Date.now() - 86_400_000 },
]

const DEFAULT = {
  balance: 480,
  earnedToday: 36,
  spentToday: 0,
  totalSavedRs: 1240,
  history: SEED_HISTORY,
}

export function getWallet() {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? { ...DEFAULT, ...JSON.parse(raw) } : { ...DEFAULT }
  } catch {
    return { ...DEFAULT }
  }
}

function save(w) {
  try { localStorage.setItem(KEY, JSON.stringify(w)) } catch {}
}

export function spendPoints(amount, label) {
  const w = getWallet()
  if (w.balance < amount) return { ok: false, reason: 'Insufficient points' }
  const next = {
    ...w,
    balance: w.balance - amount,
    spentToday: (w.spentToday ?? 0) + amount,
    history: [
      { type: 'debit', amount, label, ts: Date.now() },
      ...(w.history ?? []),
    ].slice(0, 60),
  }
  save(next)
  return { ok: true, wallet: next }
}

export function earnPoints(amount, label) {
  const w = getWallet()
  const next = {
    ...w,
    balance: w.balance + amount,
    earnedToday: (w.earnedToday ?? 0) + amount,
    totalSavedRs: (w.totalSavedRs ?? 0) + amount,
    history: [
      { type: 'credit', amount, label, ts: Date.now() },
      ...(w.history ?? []),
    ].slice(0, 60),
  }
  save(next)
  return { ok: true, wallet: next }
}

export function resetWallet() { save({ ...DEFAULT }) }
