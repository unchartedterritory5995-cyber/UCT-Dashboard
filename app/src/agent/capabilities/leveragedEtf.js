// ── LEVERAGED / INVERSE ETFs: "show me the 3x bull ETF of NVDA", "switch this chart to the inverse ETF" ─────────────────────
//
// The chart widget's Leverage / Inverse control (pages/charts/widgets/LeverageInverseControl.jsx) switches a chart between a
// stock and its single-stock leveraged / inverse funds: its pick goes to ChartWidget's symbol change (onSelect → the pane's
// changeSymbol → handleSymbolChange → the link group's ticker). The Agent reaches the SAME two things, never a second copy:
//
//   • the family: the control's OWN data source — GET /api/single-stock-etfs/{sym} under its one key and fetcher
//     (hooks/singleStockEtfsKey.js), the very rows its STOCK / {f}X ↑ / {f}X ↓ pill and its ▾ family panel show. No new
//     symbol endpoint, no list of funds kept here.
//   • the write: leveragedEtf.switch is chart.setSymbol's own apply (a symbol change through the chart kind, exactly what a
//     search pick / the control's pick does, with chart.setSymbol's exact Undo). leveragedEtf.addChart opens a NEW chart born
//     unlinked on the fund (the workspace kind's create, as widget.addCharts does) — ⛔ an ADD never replaces a chart.
//
// Which fund: the member's words choose by direction (bull / long / up · bear / short / inverse / down) and leverage (2x, 3x,
// double, triple). One fund fits → it. Several fit and the words do not choose (2x vs 3x, bull vs bear) → asked, the real funds
// as the choices — and so when the words name both and two or more funds still match (AUDIT #1600: never the control's ★
// default). None fits → refused, naming what the family has. Never a guess.
// Targeting is the chart kind's (named / clicked / "Which chart?"), never its own. No market values are said.

import { registerCapability, registerContextProvider, registerWarmup, getCapability } from '../capabilities'
import { singleStockEtfsKey, singleStockEtfsFetcher } from '../../hooks/singleStockEtfsKey'
import { tickersIn } from '../multiChart'
import { isReservedWord } from '../nl/tickers'

export const LEVERAGED_SWITCH = 'leveragedEtf.switch'
export const LEVERAGED_ADD = 'leveragedEtf.addChart'
const DIRECTIONS = ['bull', 'bear']

// ── the family, from the control's own key + fetcher (one module cache: a symbol asked once per session) ──
const families = new Map()          // SYM → family | null (no family)
const inflight = new Map()
/** The family of a symbol (its underlying's leveraged / inverse funds), or null. Never throws. */
export async function familyFor(sym) {
  const s = String(sym || '').trim().toUpperCase()
  const key = singleStockEtfsKey(s)
  if (!key) return null
  if (families.has(s)) return families.get(s)
  if (!inflight.has(s)) {
    inflight.set(s, singleStockEtfsFetcher(key).then((f) => {
      const fam = f && ((f.long && f.long.length) || (f.short && f.short.length)) ? f : null
      families.set(s, fam)
      return fam
    }).catch(() => undefined).finally(() => inflight.delete(s)))
  }
  return inflight.get(s)
}
/** The family when it is already known (no request). `undefined` = not asked yet. */
export const peekFamily = (sym) => { const s = String(sym || '').trim().toUpperCase(); return families.has(s) ? families.get(s) : undefined }
export function _resetLeveragedEtfCache() { families.clear(); inflight.clear() }

// ── which fund the words choose ──
const fmtFactor = (f) => { const n = Number(f); return Number.isFinite(n) && n > 0 ? String(n) : '?' }
const rowsOf = (fam) => [...(fam?.long || []).map(r => ({ ...r, side: 'bull' })), ...(fam?.short || []).map(r => ({ ...r, side: 'bear' }))]
export const fundLabel = (r, fam) => `${r.ticker} — ${fmtFactor(r.factor)}X ${r.side} ${fam?.underlying || ''} ETF${r.name ? ` (${r.name})` : ''}`.replace(/\s+/g, ' ').replace(' ETF (', ' ETF (')
const shortLabel = (r) => `${r.ticker} (${fmtFactor(r.factor)}X ${r.side})`
const listOf = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} or ${xs[xs.length - 1]}`)

/** The funds of a family the args describe → { pick } | { none, has } | { several } . */
export function chooseFund(fam, { leverage = null, direction = null } = {}) {
  const all = rowsOf(fam)
  if (!all.length) return { none: true, has: [] }
  let hit = all
  if (direction) hit = hit.filter(r => r.side === direction)
  if (leverage != null) hit = hit.filter(r => Math.abs(Number(r.factor) - Number(leverage)) < 1e-9)
  if (!hit.length) return { none: true, has: all }
  if (hit.length === 1) return { pick: hit[0] }
  // ⛔ AUDIT #1600: several still fit — even when the words named BOTH direction and leverage (two 2x bull funds) — asked,
  // the real matching funds as the choices. Never the control's ★ most-liquid default: the member picks.
  return { several: hit }
}
const what = ({ leverage, direction }) => `${leverage != null ? `${fmtFactor(leverage)}X ` : ''}${direction || 'leveraged or inverse'}`.trim()
function noneText(fam, args, u) {
  const name = fam?.underlying || u
  if (!fam) return `UCT has no leveraged or inverse ETF of ${name}.`
  const has = rowsOf(fam)
  return `${name} has no ${what(args)} ETF — UCT has ${listOf(has.map(shortLabel))}.`
}
const severalText = (rows, fam) => `Which ${fam?.underlying || ''} ETF — ${listOf(rows.map(shortLabel))}? Say the one you want (for example “the ${fmtFactor(rows[0].factor)}x ${rows[0].side}”, or its ticker).`.replace(/\s+/g, ' ')

// ── the member's words → args ──
const ETF_WORD = /\b(?:etfs?|funds?)\b/i
const KIND_WORD = /\b(?:leveraged|levered|inverse|bull(?:ish)?|bear(?:ish)?)\b/i
const LEV_RE = /\b(\d(?:\.\d{1,2})?)\s?x\b|\b(\d(?:\.\d{1,2})?)\s?(?:times|-times)\b|\b(double|triple|2-?fold|3-?fold)\b/i
const BULL_RE = /\b(?:bull(?:ish)?|long|upside|up)\b/i
const BEAR_RE = /\b(?:bear(?:ish)?|short|inverse|downside|down)\b/i
const ADD_RE = /^(?:please\s+)?(?:add|open|create|put up|pull up)\s+(?:a|an|another|one more|a new|new)\b|\b(?:in|on|as) a new chart\b|\bnew chart\b|\bnext to (?:it|this|that)\b|\bbeside (?:it|this|that)\b/i
const SWITCH_RE = /^(?:please\s+)?(?:can you\s+)?(?:show(?: me)?|switch|change|flip|swap|go|take|put|make|turn|load|chart|pull up|bring up|give me|i want)\b/i
const NOT_TICKER = new Set(['ETF', 'ETFS', 'FUND', 'X', 'BULL', 'BEAR', 'LONG', 'SHORT', 'INVERSE', 'LEVERAGED', 'THE', 'OF', 'FOR'])
const FILLER = new Set(['the', 'this', 'that', 'it', 'its', 'my', 'a', 'an', 'one', 'chart', 'stock', 'same'])

/** The ETF request the words make, or null (not one). Exported for the tests. */
export function readLeveragedRequest(raw) {
  const t = String(raw || '').trim().replace(/[.!?]+$/, '')
  if (!t || !(ETF_WORD.test(t) ? KIND_WORD.test(t) || LEV_RE.test(t) : KIND_WORD.test(t) && /\b(?:version|one|side)\b/i.test(t))) return null
  // a question about the funds, a holdings / constituents list, a screen: never this
  if (/\b(?:holdings?|constituents?|what is|what's|explain|screen|scan|list all|which stocks)\b/i.test(t)) return null
  const lm = LEV_RE.exec(t)
  const leverage = !lm ? null : lm[1] || lm[2] ? Number(lm[1] || lm[2]) : /double|2/i.test(lm[3]) ? 2 : 3
  const bull = BULL_RE.test(t), bear = BEAR_RE.test(t)
  const direction = bull && !bear ? 'bull' : bear && !bull ? 'bear' : null
  const add = ADD_RE.test(t)
  if (!add && !SWITCH_RE.test(t)) return null
  // the underlying: a ticker typed in capitals / with $, or the word after "of / for / on" ("the 3x bull etf of nvda")
  const typed = tickersIn(t).filter(s => !NOT_TICKER.has(s))
  const after = /\b(?:of|for|on|tracking)\s+\$?([a-z][a-z.]{0,5})\b(?!\s+(?:chart|one))/i.exec(t)?.[1]
  const word = after && !FILLER.has(after.toLowerCase()) && !isReservedWord(after.toUpperCase()) && !/^(?:etfs?|funds?|bull|bear)$/i.test(after) ? after.toUpperCase() : null
  const syms = [...new Set([...typed, ...(word ? [word] : [])])]
  if (syms.length > 1) return null                       // two stocks named: not one ETF switch (the model reads it)
  return { leverage, direction, underlying: syms[0] || null, add }
}

// ── host the warm / prepare reads (the board's charts) — set by the context provider each turn ──
let hostRef = null
const boardSymbols = (host) => { try { return (host?.charts?.list?.() || []).map(c => c.symbol).filter(Boolean) } catch { return [] } }
function warmBoard(host) {
  if (host) hostRef = host
  for (const s of boardSymbols(hostRef)) familyFor(s)
}

const onCharts = (ctx) => ctx.surface === 'charts'
const ARGS = {
  type: 'object',
  properties: {
    underlying: { type: ['string', 'null'] },
    leverage: { type: ['number', 'null'] },
    direction: { type: ['string', 'null'], enum: [...DIRECTIONS, null] },
    ticker: { type: ['string', 'null'] },
  },
  required: ['underlying', 'leverage', 'direction', 'ticker'], additionalProperties: false,
}
const HINT = 'underlying = the stock whose leveraged / inverse ETF is meant (uppercase), or null for the chart\'s own stock. '
  + 'leverage = the factor the member said (2 for "2x" / "double", 3 for "3x" / "triple"), else null. '
  + 'direction = bull (long, up) or bear (short, inverse, down), else null. ticker = null (UCT picks the fund from its own list; '
  + 'several that fit are asked). Never type a fund ticker you were not given.'

// the fund the plan resolved: the ticker the member picked (one of the family's own), or the one the words choose
function resolve(args, fam) {
  if (args.ticker) {
    const t = String(args.ticker).trim().toUpperCase()
    const row = rowsOf(fam).find(r => r.ticker === t) || (fam?.underlying === t ? { ticker: t, side: 'stock', factor: 1 } : null)
    return row ? { pick: row } : { none: true, has: rowsOf(fam) }
  }
  return chooseFund(fam, args)
}
function argsAsk(args, host) {
  if (args.ticker || !args.underlying) return null
  const fam = peekFamily(args.underlying)
  if (fam === undefined) return null                      // not read yet: the plan reads it (prepare) and decides in check
  if (!fam) return { refuse: `I didn't change anything: ${noneText(null, args, String(args.underlying).toUpperCase())}` }
  const r = chooseFund(fam, args)
  if (r.pick) return { args: { ...args, ticker: r.pick.ticker } }
  if (r.none) return { refuse: `I didn't change anything: ${noneText(fam, args)}` }
  void host
  return { ask: { arg: 'ticker', text: `Which ${fam.underlying} ETF?`, choices: r.several.map(x => ({ ref: x.ticker, label: fundLabel(x, fam) })) } }
}

async function prepare(ops) {
  const want = new Set()
  for (const o of ops) {
    if (o.args?.underlying) want.add(String(o.args.underlying).trim().toUpperCase())
    else {
      // the chart's own stock (switch): the target chart as the board shows it now
      try { const s = hostRef?.charts?.read?.(o.target)?.symbol; if (s) want.add(String(s).toUpperCase()) } catch { /* none */ }
    }
  }
  const out = new Map()
  for (const s of want) { const f = await familyFor(s); out.set(s, f === undefined ? undefined : f) }
  return { etfFamilies: out }
}
const famOf = (env, s) => { const k = String(s || '').toUpperCase(); const f = env?.etfFamilies?.get(k); return f !== undefined ? f : peekFamily(k) }

let registered = false
export function registerLeveragedEtfCapabilities() {
  if (registered) return
  registered = true

  registerWarmup((host) => warmBoard(host))
  // no context entry of its own (the model learns the funds only through the capability) — it keeps the families of the
  // board's charts warm, so a pick can be asked with the real funds as choices
  registerContextProvider({ key: 'leveragedEtf', build: (host) => { warmBoard(host); return undefined } })

  const setSymbol = () => getCapability('chart.setSymbol')

  registerCapability({
    name: LEVERAGED_SWITCH,
    target: 'chart',
    surfaces: ['charts'],
    available: onCharts,

    summary: 'Switch ONE chart to a stock\'s leveraged or inverse single-stock ETF (or back to the stock), as the chart\'s Leverage / Inverse control does — the funds come from UCT\'s own list. Undo puts the previous symbol back.',
    hints: `target = the chart to switch. ${HINT} To open the fund on a NEW chart, use ${LEVERAGED_ADD}.`,
    args: ARGS,
    fast: ({ raw }) => {
      const r = readLeveragedRequest(raw)
      if (!r || r.add) return null
      if (r.underlying) familyFor(r.underlying)
      return { underlying: r.underlying, leverage: r.leverage, direction: r.direction, ticker: null, __explicit: true }
    },
    resolveArgs: (args, host) => argsAsk(args, host),
    prepare,
    check(st, args, env) {
      const u = args.underlying || st.symbol
      if (!u) return 'That chart has no symbol yet — say which stock’s leveraged or inverse ETF you want.'
      const fam = famOf(env, u)
      if (fam === undefined) return 'UCT couldn’t read its leveraged / inverse ETF list just now, so nothing changed — try again in a moment.'
      const r = resolve(args, fam)
      if (r.none) return noneText(fam, args, String(u).toUpperCase())
      if (r.several) return severalText(r.several, fam)
      return setSymbol().check(st, { symbol: r.pick.ticker }, { ...env, trusted: true })
    },
    apply(st, args, env) {
      const fam = famOf(env, args.underlying || st.symbol)
      const r = fam ? resolve(args, fam) : null
      return r?.pick ? setSymbol().apply(st, { symbol: r.pick.ticker }) : st
    },
    describe(b, a, args, env) {
      if (b.symbol === a.symbol) return null
      const fam = famOf(env, args.underlying || b.symbol)
      const row = rowsOf(fam).find(r => r.ticker === a.symbol)
      const n = env?.target?.linkedCount || 0
      const linked = n > 0 ? ` (and ${n} linked widget${n === 1 ? '' : 's'})` : ''
      return row ? `Switched the chart from ${b.symbol} to ${fundLabel(row, fam)}${linked}` : `Switched the chart from ${b.symbol} to ${a.symbol}${linked}`
    },
    noop: (b, a) => `Already showing ${a.symbol}`,
  })

  registerCapability({
    name: LEVERAGED_ADD,
    target: 'workspace',
    surfaces: ['charts'],
    available: onCharts,

    summary: 'Open a NEW chart on a stock\'s leveraged or inverse single-stock ETF (from UCT\'s own list), placed in empty space and not linked. No existing chart changes; Undo closes the new chart.',
    hints: `target = the ref of the workspace entry. ${HINT} underlying is required here (the stock the member named).`,
    args: ARGS,
    fast: ({ raw }) => {
      const r = readLeveragedRequest(raw)
      if (!r || !r.add || !r.underlying) return null
      familyFor(r.underlying)
      return { underlying: r.underlying, leverage: r.leverage, direction: r.direction, ticker: null, __explicit: true }
    },
    resolveArgs: (args, host) => argsAsk(args, host),
    prepare,
    check(st, args, env) {
      if (!args.underlying) return 'Which stock’s leveraged or inverse ETF should the new chart show?'
      const u = String(args.underlying).toUpperCase()
      const fam = famOf(env, u)
      if (fam === undefined) return 'UCT couldn’t read its leveraged / inverse ETF list just now, so nothing changed — try again in a moment.'
      const r = resolve(args, fam)
      if (r.none) return noneText(fam, args, u)
      if (r.several) return severalText(r.several, fam)
      // the room a new chart needs: widget.add's own check, as a new chart from the + Add widget menu
      return getCapability('widget.add').check(st, { type: 'chart', as: null }, env)
    },
    apply(st, args, env) {
      const fam = famOf(env, args.underlying)
      const r = fam ? resolve(args, fam) : null
      if (!r?.pick) return st
      // ⛔ an ADD: a NEW chart, born unlinked on the fund (workspaceKind.commit's `init`), never an existing chart re-aimed
      return { ...st, creates: [...st.creates, { type: 'chart', alias: null, flags: { unlink: true, init: { symbol: r.pick.ticker, tf: null }, complete: true } }] }
    },
    describe(b, a, args, env) {
      const made = a.creates.slice(b.creates.length).filter(c => c.flags?.init?.symbol)
      if (!made.length) return null
      const fam = famOf(env, args.underlying)
      const row = rowsOf(fam).find(r => r.ticker === made[0].flags.init.symbol)
      return `Opened a new chart of ${row ? fundLabel(row, fam) : made[0].flags.init.symbol} (not linked — nothing existing changed)`
    },
  })
}
