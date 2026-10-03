// UCT Terminal — the PUBLISHED suggestion ranking (V6c), personalised by server-side
// command counts (V17). Pure; railed in ranking.test.js.
//
// Order of classes (grammar.js RANKING_ORDER, which HELP prints):
//   0 exact alias · 1 exact function code · 2 exact ticker · 3 prefix · 4 close spelling
// and inside a class: personal frecency (descending), then alphabetical. Frecency never
// lifts a row across a class boundary — an exact match always outranks a habit.
import { FUNCTIONS, editDistance } from './functions'
import { RANKING_ORDER } from './grammar'

export const CLASS = Object.freeze(Object.fromEntries(
  RANKING_ORDER.filter((r) => r.key !== 'frecency').map((r, i) => [r.key, i])))

/** Half-life of a command's weight, in days. */
export const FRECENCY_HALF_LIFE_DAYS = 14

/** `stat` = `{ n, last }` (count, last-used epoch seconds) from /api/terminal/commands/stats. */
export function frecency(stat, nowSec = Date.now() / 1000) {
  if (!stat || !(stat.n > 0)) return 0
  const ageDays = Math.max(0, (nowSec - (Number(stat.last) || 0)) / 86400)
  return stat.n * 0.5 ** (ageDays / FRECENCY_HALF_LIFE_DAYS)
}

function classify(t, value) {
  if (value === t) return 'exact'
  if (value.startsWith(t)) return 'prefix'
  if (t.length >= 2 && value.length >= 2 && editDistance(t, value) <= (t.length >= 4 ? 2 : 1)) return 'fuzzy'
  return null
}

/**
 * Rank completions for one token. `tickers` = rows from the ticker search
 * (`[{value,label}]`), `aliases` = `{NAME: expansion}`, `stats` = `{KEY: {n,last}}`.
 * Returns `[{kind, value, label, rank}]`, where `rank` names the class it won.
 */
export function rankCandidates(token, { aliases = {}, tickers = [], stats = {}, nowSec, limit = 10, codes = true } = {}) {
  const t = String(token || '').toUpperCase().replace(/^\$/, '')
  if (!t) return []
  const rows = []
  const add = (kind, value, label, exactClass) => {
    const c = classify(t, value)
    if (!c) return
    const cls = c === 'exact' ? exactClass : c
    rows.push({ kind, value, label, rank: cls, _c: CLASS[cls], _f: frecency(stats[value], nowSec) })
  }
  for (const [name, expansion] of Object.entries(aliases)) add('alias', name, `→ ${expansion}`, 'alias')
  if (codes) for (const f of FUNCTIONS) add('function', f.code, f.label, 'verb')
  for (const r of tickers) {
    const v = String(r.value || '').toUpperCase()
    if (!v) continue
    // A ticker the search returned on a NAME match ranks as close spelling, never above one.
    if (!classify(t, v)) { rows.push({ kind: 'ticker', value: v, label: r.label || '', rank: 'fuzzy', _c: CLASS.fuzzy, _f: 0 }); continue }
    add('ticker', v, r.label || '', 'symbol')
  }
  rows.sort((a, b) => a._c - b._c || b._f - a._f || (a.value < b.value ? -1 : a.value > b.value ? 1 : 0))
  const seen = new Set()
  const out = []
  for (const r of rows) {
    const k = `${r.kind}:${r.value}`
    if (seen.has(k)) continue
    seen.add(k)
    out.push({ kind: r.kind, value: r.value, label: r.label, rank: r.rank, replaceLast: true })
    if (out.length >= limit) break
  }
  return out
}
