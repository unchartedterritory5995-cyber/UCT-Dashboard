// The end screen's counting (EndLooks.jsx): every number on it is counted from the run itself.

export function verdictWord(right, total) {
  const r = total ? right / total : 0
  if (total > 0 && right === total) return 'Legendary'
  if (r >= 0.75) return 'Sharp eyes'
  if (r >= 0.5) return 'Getting there'
  return 'Tough run'
}

export function bestStreak(results) {
  let best = 0, run = 0
  for (const r of results) { run = r ? run + 1 : 0; if (run > best) best = run }
  return best
}

/** Tiers by the share named: a perfect run is Legendary, then gold at 6 of 8, silver at 4, bronze at 1. */
export function tierOf(right, total) {
  if (total > 0 && right === total) return { key: 'legend', name: 'Legendary', next: null }
  const r = total ? right / total : 0
  const need = (share) => Math.max(0, Math.ceil(share * total) - right)
  if (r >= 0.75) return { key: 'gold', name: 'Gold', next: { name: 'Legendary', more: total - right } }
  if (r >= 0.5) return { key: 'silver', name: 'Silver', next: { name: 'Gold', more: need(0.75) } }
  if (right >= 1) return { key: 'bronze', name: 'Bronze', next: { name: 'Silver', more: need(0.5) } }
  return { key: 'none', name: 'No medal', next: { name: 'Bronze', more: 1 } }
}

/** Every setup in the run with how many of its charts were named, worst first. */
export function bySetup(log) {
  const m = new Map()
  for (const r of log) {
    const x = m.get(r.name) || { name: r.name, n: 0, ok: 0 }
    x.n += 1; if (r.ok) x.ok += 1
    m.set(r.name, x)
  }
  return [...m.values()].sort((p, q) => (p.ok / p.n) - (q.ok / q.n) || q.n - p.n || p.name.localeCompare(q.name))
}
