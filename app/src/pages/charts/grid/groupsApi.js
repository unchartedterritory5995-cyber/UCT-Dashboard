// Thin fetch helpers for the /api/groups endpoints. Never throw into render —
// return safe empty shapes so a cold backend degrades to an empty picker / a
// solo seed rather than a crash.

export async function fetchGroups() {
  try {
    const r = await fetch('/api/groups')
    if (!r.ok) return []
    const j = await r.json()
    return Array.isArray(j.groups) ? j.groups : []
  } catch { return [] }
}

export async function fetchGroupTop(id, { n = 9, by = 'today' } = {}) {
  try {
    const r = await fetch(`/api/groups/${encodeURIComponent(id)}/top?n=${n}&by=${by}`)
    if (!r.ok) return { syms: [], rows: [], etf: null, total: 0, by, ranked_as_of: 'unknown' }
    return await r.json()
  } catch { return { syms: [], rows: [], etf: null, total: 0, by, ranked_as_of: 'unknown' } }
}

export async function fetchPeers(sym, { n = 8 } = {}) {
  const seed = (sym || '').toUpperCase()
  try {
    const r = await fetch(`/api/groups/peers?sym=${encodeURIComponent(seed)}&n=${n}`)
    if (!r.ok) return { seed, group_id: null, peers: [], source: 'none' }
    return await r.json()
  } catch { return { seed, group_id: null, peers: [], source: 'none' } }
}

// Pin the group's ETF as cell 0 (deduped), bounded to the grid size. ETFs chart
// via Massive on demand, so they're not cap_universe-filtered. Shared by every
// group-fill site (picker, refresh, prev/next) so the pin can't drift.
export function pinEtf(syms, etf, n) {
  const list = Array.isArray(syms) ? syms : []
  const filled = etf ? [etf, ...list.filter(s => s !== etf)] : list
  return filled.slice(0, Math.max(1, n | 0))
}
