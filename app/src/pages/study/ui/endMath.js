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

/** The medal a run's share earns: a perfect run is Legendary, then gold at 6 of 8, silver at 4, bronze at 1. */
function medalOf(right, total) {
  if (total > 0 && right === total) return { key: 'legend', name: 'Legendary' }
  const r = total ? right / total : 0
  if (r >= 0.75) return { key: 'gold', name: 'Gold' }
  if (r >= 0.5) return { key: 'silver', name: 'Silver' }
  if (right >= 1) return { key: 'bronze', name: 'Bronze' }
  return { key: 'none', name: 'No medal' }
}

/** The run's medal and the next one: how many more right answers it takes and the medal THOSE answers light. On a
 *  short run that can skip a tier (at 2 of 3, one more makes 3 of 3, which is Legendary, never Gold; at 0 of 2, one
 *  more is already Silver), so the next medal is counted, never assumed to be the tier above. */
export function tierOf(right, total) {
  const now = medalOf(right, total)
  if (now.key === 'legend') return { ...now, next: null }
  let more = 1
  while (right + more < total && medalOf(right + more, total).key === now.key) more += 1
  return { ...now, next: { name: medalOf(right + more, total).name, more } }
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
