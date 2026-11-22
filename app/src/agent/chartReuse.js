// ── D18 item 3 (owner, 2026-11-14): REUSE A DISPLAYED CHART — the plan-level screen ────────────────────────────────────────────
//
// useAgent.execute runs this on EVERY path (instant, model, a resumed question) before planning, beside the indicator
// duplicates screen (duplicates.js). The creations of a plan — widget.addCharts lists, widget.add + chart.setSymbol aliases —
// whose symbol a chart on the board already shows (on the timeframe asked, or none asked) and carries no copy intent
// (copyIntent.readCopyIntent) are dropped: that chart IS the one asked for. An op aimed at a dropped alias ("…, each with a
// 50 SMA") is re-aimed at that chart. chartGrid.set does the same inside planChartGrid (env.keepTickers). Then:
//   - a SET-level "N more charts for A, B…" with a displayed symbol and no copy intent attached → ASK (D18 item 2):
//     "use your NVDA chart" / "open a second NVDA chart" — nothing written before the pick
//   - a symbol displayed only on ANOTHER timeframe than asked → a new chart, said: "NVDA is already on your board on Daily —
//     I added a Weekly NVDA chart."
// The FINAL BOARD rail (chartRail.duplicatesIn) refuses anything this screen misses. Pure: reads `host`, never writes.
import { readCopyIntent, setMoreSymbols } from './copyIntent'
import { displayedAs, createdTickers } from './chartRail'
import { tfLabel } from './capabilities/chart'

const up = (s) => String(s || '').trim().toUpperCase()
const listOf = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`)
export const REUSE_NOTE = (syms) => `${listOf(syms)} ${syms.length === 1 ? 'is' : 'are'} already on your board — I used that chart${syms.length === 1 ? '' : 's'}. Say “add another ${syms[0]} chart” if you want a second one.`
export const TF_NOTE = (sym, shownTf, tf) => `${sym} is already on your board on ${tfLabel(shownTf)} — I added a ${tfLabel(tf)} ${sym} chart.`

/** → { ops, reused: [SYM], notes: [text], ask: { symbols } | null } */
export function screenChartReuse(opsIn, host, words, { copyResolved = false } = {}) {
  const ops = Array.isArray(opsIn) ? opsIn : []
  const created = createdTickers(ops)
  if (!created.length) return { ops, reused: [], notes: [], ask: null }
  const syms = [...new Set(created.map(c => c.symbol))]
  const shown = Object.fromEntries(created.map(c => [c.symbol, displayedAs(host, c.symbol, c.tf).length]))
  const copies = readCopyIntent(words, syms, shown)
  // D18 item 2: "add 2 more charts for NVDA and AAPL" with NVDA shown — asked, never guessed
  if (!copyResolved) {
    const sm = setMoreSymbols(words, syms)
    const hit = (sm || []).filter(S => shown[S] && !copies[S])
    if (hit.length) return { ops, reused: [], notes: [], ask: { symbols: hit } }
  }
  // how many NEW charts of each symbol this request may still create: displayed → its copies only
  const budget = new Map(syms.map(S => [S, (shown[S] ? 0 : Infinity) + (copies[S] || 0)]))
  const take = (S) => { const n = budget.get(S); if (n > 0) { budget.set(S, n - 1); return true } return false }
  const reused = new Set()
  const notes = []
  const aliasTo = new Map()                                   // dropped alias → the displayed chart's ref
  const tfOfAlias = new Map(ops.filter(o => o?.action === 'chart.setTimeframe').map(o => [String(o.target), o.args?.timeframe || null]))
  const out = []
  for (const o of ops) {
    if (o?.action === 'widget.addCharts' && Array.isArray(o.args?.symbols)) {
      const keepSyms = o.args.symbols.filter(s0 => { const S = up(s0); if (take(S)) return true; reused.add(S); return false })
      if (keepSyms.length) out.push(keepSyms.length === o.args.symbols.length ? o : { ...o, args: { ...o.args, symbols: keepSyms } })
      continue
    }
    if (o?.action === 'chart.setSymbol' && ops.some(a => a?.action === 'widget.add' && String(a.args?.as) === String(o.target))) {
      const S = up(o.args?.symbol)
      if (!take(S)) { reused.add(S); const c = displayedAs(host, S, tfOfAlias.get(String(o.target)))[0]; if (c) aliasTo.set(String(o.target), c.ref) }
    }
    out.push(o)
  }
  // a dropped alias: its widget.add and setSymbol go; every other op aimed at it is re-aimed at the chart already there
  const final = out.filter(o => !(aliasTo.has(String(o?.args?.as)) && o.action === 'widget.add') && !(aliasTo.has(String(o?.target)) && (o.action === 'chart.setSymbol' || o.action === 'chart.setTimeframe')))
    .map(o => (aliasTo.has(String(o?.target)) ? { ...o, target: aliasTo.get(String(o.target)) } : o))
  // D18 (b): displayed only on another timeframe → a new chart, and the receipt says so
  for (const c of created) {
    if (!c.tf || shown[c.symbol]) continue
    const other = displayedAs(host, c.symbol, null)[0]
    if (other) notes.push(TF_NOTE(c.symbol, other.tf, c.tf))
  }
  return { ops: final, reused: [...reused], notes: [...new Set(notes)], ask: null }
}
