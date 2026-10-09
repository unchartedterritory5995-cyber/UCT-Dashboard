// UCT Terminal — the PUBLISHED suggestion ranking (V6c), personalised by server-side
// command counts (V17). Pure; railed in ranking.test.js.
//
// Order of classes (grammar.js RANKING_ORDER, which HELP prints):
//   0 exact alias · 1 exact function code · 2 exact ticker · 3 prefix · 4 close spelling
//   · 5 a plain word for what a function does (functions.js `keywords` and label words)
// and inside a class: personal frecency (descending), then a widely traded ticker (the app's
// popular list, in its order), then alphabetical. Frecency never
// lifts a row across a class boundary — an exact match always outranks a habit.
import { FUNCTIONS, editDistance, BY_CODE, CODE_ALIASES, codesForWords } from './functions'
import { RANKING_ORDER } from './grammar'
import { POPULAR_RESULTS } from '../../components/chart/symbolSearchModel'

export const CLASS = Object.freeze(Object.fromEntries(
  RANKING_ORDER.filter((r) => r.key !== 'frecency' && r.key !== 'popular').map((r, i) => [r.key, i])))

// Live audit 2026-10-05: alphabetical alone put NVA, NVC, NVD, NVG, NVO, NVR ahead of NVDA for
// "NV" (and TSLA, AAPL, MSFT, AMZN fell out of "TS", "AA", "MS", "AM"). Among equally good
// ticker matches the name members actually trade comes first.
const POPULAR_RANK = new Map(POPULAR_RESULTS.map((r, i) => [r.ticker, i]))
const NOT_POPULAR = POPULAR_RANK.size

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

/** What a recently viewed ticker adds to its frecency: the newest gets RECENT_TICKER_WEIGHT,
 *  the oldest a little over half of it. Tickers never reach the server's command counts
 *  (telemetry stores codes only), so this is how TICKER ranking learns from use: from the
 *  board's own channel history, in the browser. Like frecency it only breaks ties INSIDE a
 *  class, so an exact match still outranks a habit. */
export const RECENT_TICKER_WEIGHT = 3
export function recentWeights(recent = []) {
  const list = (Array.isArray(recent) ? recent : []).map((s) => String(s || '').toUpperCase()).filter(Boolean)
  const out = new Map()
  list.forEach((s, i) => { if (!out.has(s)) out.set(s, RECENT_TICKER_WEIGHT * (1 - i / (2 * list.length))) })
  return out
}

/**
 * Rank completions for one token. `tickers` = rows from the ticker search
 * (`[{value,label}]`), `aliases` = `{NAME: expansion}`, `stats` = `{KEY: {n,last}}`.
 * Returns `[{kind, value, label, rank}]`, where `rank` names the class it won.
 */
export function rankCandidates(token, {
  aliases = {}, tickers = [], stats = {}, nowSec, limit = 10, codes: wantCodes = true, recent = [],
} = {}) {
  // A `$` token is a ticker by the member's own say-so: it never completes to a function code
  // or an alias (`$CF` + Tab used to become the CF *function*).
  const forced = String(token || '').startsWith('$')
  const codes = wantCodes && !forced
  if (forced) aliases = {}
  const t = String(token || '').toUpperCase().replace(/^\$/, '')
  if (!t) return []
  const rows = []
  const recentRank = recentWeights(recent)
  const add = (kind, value, label, exactClass) => {
    const c = classify(t, value)
    if (!c) return
    const cls = c === 'exact' ? exactClass : c
    const _p = kind === 'ticker' && POPULAR_RANK.has(value) ? POPULAR_RANK.get(value) : NOT_POPULAR
    const _f = frecency(stats[value], nowSec) + (kind === 'ticker' ? recentRank.get(value) || 0 : 0)
    rows.push({ kind, value, label, rank: cls, _c: CLASS[cls], _f, _p })
  }
  for (const [name, expansion] of Object.entries(aliases)) add('alias', name, `→ ${expansion}`, 'alias')
  if (codes) for (const f of FUNCTIONS) add('function', f.code, f.label, 'verb')
  // A registry alias typed in full (`MOVERS`, `WIIM`) is its code, exactly: offer the code.
  if (codes && Object.prototype.hasOwnProperty.call(CODE_ALIASES, t)) {
    const code = CODE_ALIASES[t]
    rows.push({ kind: 'function', value: code, label: BY_CODE[code].label, rank: 'verb', _c: CLASS.verb, _f: frecency(stats[code], nowSec), _p: NOT_POPULAR })
  }
  // A plain word ("breakout", "insider") names the function that does it, after every spelling
  // match, so a real ticker or code is never pushed down by a word. The row's value is the CODE,
  // so accepting it writes `BRKO`, never the word.
  if (codes && t.length >= 3) {
    for (const code of codesForWords(t)) {
      rows.push({ kind: 'function', value: code, label: BY_CODE[code].label, rank: 'word', _c: CLASS.word, _f: frecency(stats[code], nowSec), _p: NOT_POPULAR })
    }
  }
  for (const r of tickers) {
    const v = String(r.value || '').toUpperCase()
    if (!v) continue
    // A ticker the search returned on a NAME match ranks as close spelling, never above one.
    if (!classify(t, v)) { rows.push({ kind: 'ticker', value: v, label: r.label || '', rank: 'fuzzy', _c: CLASS.fuzzy, _f: 0, _p: NOT_POPULAR }); continue }
    add('ticker', v, r.label || '', 'symbol')
  }
  rows.sort((a, b) => a._c - b._c || b._f - a._f || a._p - b._p || (a.value < b.value ? -1 : a.value > b.value ? 1 : 0))
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
