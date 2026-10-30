// ── UCT Agent MULTI-CHART phrases (Charts operator P1, 2026-10-27) ──────────────────────────────
//
// Whole sentences that name SEVERAL charts at once, read deterministically (no model call) on the
// legacy instant path — the same registry ops the model would plan, through the same planner, policy,
// runtime, receipts and Undo. Anything it cannot read with certainty returns null (→ the fast path, then
// the model, exactly as before). Pure: it reads the live board through `host`, never writes.
//
//   positional symbols   "NVDA on the left and AMD on the right", "put SPY top, QQQ bottom, both weekly",
//                        "TSLA on the second chart, AAPL on the third" → chart.setSymbol per named chart
//                        (each chart the member NAMED — applied as ONE change, one Undo)
//   chart grid           "create four charts for SPY, QQQ, NVDA and TSLA and make them all daily", "put SPY, QQQ,
//                        NVDA and TSLA in a 2x2 grid" (live test 2026-10-28) → chartGrid.set, APPLIED: the
//                        board's charts reused top-left first, the rest added, the charts' area re-tiled evenly —
//                        one change, one Undo. Only the tickers, a count that matches them, one timeframe and a
//                        layout word may be said; anything else ("…with RSI") is the model's.
//   side by side         "show NVDA and AMD side by side" — OWNER 2026-10-27: reuse suitable charts, create
//                        new ones only when needed or asked ("…in new charts"):
//                          0 or 1 chart, or    → chartGrid.set as columns (the one chart is reused; the
//                          "new charts"          second is added beside it) — applied (live test 2026-10-28)
//                          2 charts            → both reused (a chart already on one of them keeps it) — applied
//                          3+ charts           → already showing both: said; else the charts are PROPOSED
//                                                (named on the card), never picked silently
//   copy a look          "make the left chart look like the right one", "copy the look of the AMD chart to this
//                        chart", "match the bottom chart to the top one" → chartSetup.copyLook (proposed)
//
// Returns null | { kind: 'ops', ops, mode, note? } | { kind: 'steps', steps: [{ ops, mode, needs? }] }
//              | { kind: 'say', text }

import { matchPosition } from './fastPath'
import { ordinalChart, selectedChart } from './deixis'
import { plainSymbolWord, SHORT_FIXES } from './nl/lexicon'

// ── tickers as typed (capitals, or $-prefixed) — never a lowercase word ──
const NOT_TICKERS = new Set(['I', 'A', 'UCT', 'ETF', 'ADR', 'RS', 'RSI', 'MACD', 'EMA', 'SMA', 'ATR', 'VWAP', 'ET', 'AM', 'PM', 'OK', 'US', 'NYSE', 'HLC', 'OHLC', 'MA', 'D', 'W', 'M', 'AND', 'VS'])
const TICKER_RE = /(?:^|[\s,;(])(\$[A-Za-z][A-Za-z0-9.]{0,9}|[A-Z][A-Z0-9.]{0,9})(?=$|[\s,;.!?)])/g
export function tickersIn(raw) {
  const out = []
  for (const m of String(raw || '').matchAll(TICKER_RE)) {
    const t = m[1].replace(/^\$/, '').replace(/\.$/, '').toUpperCase()
    if (!m[1].startsWith('$') && NOT_TICKERS.has(t)) continue
    if (!out.includes(t)) out.push(t)
  }
  return out
}

// ── a timeframe said once for the whole request ("both weekly", "on the daily") ──
const TF = [[/\b(?:1|one)[\s-]?min(?:ute)?s?\b/, '1'], [/\b(?:5|five)[\s-]?min(?:ute)?s?\b/, '5'], [/\b(?:15|fifteen)[\s-]?min(?:ute)?s?\b/, '15'],
  [/\b(?:30|thirty)[\s-]?min(?:ute)?s?\b/, '30'], [/\b(?:hourly|1[\s-]?h(?:ou)?r|one hour|60[\s-]?min(?:ute)?s?)\b/, '60'], [/\bdaily\b/, 'D'], [/\bweekly\b/, 'W'], [/\bmonthly\b/, 'M']]
function timeframeIn(lower) {
  const hits = TF.filter(([re]) => re.test(lower)).map(([, code]) => code)
  return hits.length === 1 ? hits[0] : (hits.length ? false : null)        // false = two timeframes: not this module's
}

// ── position words ──
const POS_RE = /\b(top[- ]left|top[- ]right|bottom[- ]left|bottom[- ]right|upper[- ]left|upper[- ]right|lower[- ]left|lower[- ]right|left|right|top|bottom|upper|lower)\b/i
const normPos = (w) => w.toLowerCase().replace(' ', '-').replace('upper', 'top').replace('lower', 'bottom')

/** The ONE chart a short phrase names: a position, an ordinal, "this (chart|one)", or a symbol one chart shows. */
export function chartFromPhrase(phrase, charts, host, { other = null } = {}) {
  const p = String(phrase || '').trim()
  if (!p) return null
  if (/^(?:this|this chart|this one|it|the selected chart|my selected chart)$/i.test(p.replace(/^the\s+/i, '').trim()) || /^this (chart|one)$/i.test(p)) {
    const sel = selectedChart(host)
    return sel && charts.some(c => c.ref === sel) ? sel : null
  }
  if (/^(?:the\s+)?other(?:\s+(?:chart|one))?$/i.test(p) && other && charts.length === 2) return charts.find(c => c.ref !== other)?.ref || null
  const ord = ordinalChart(p, charts)
  if (ord?.ref) return ord.ref
  const pos = POS_RE.exec(p)
  if (pos) {
    const hit = matchPosition(charts, normPos(pos[1]))
    return hit.length === 1 ? hit[0].ref : null
  }
  const syms = tickersIn(p)
  if (syms.length === 1) {
    const hit = charts.filter(c => String(c.symbol || '').toUpperCase() === syms[0])
    return hit.length === 1 ? hit[0].ref : null
  }
  return null
}

// ⛔ Two charts in ONE link colour group always show the same symbol (a symbol change goes through the group,
// exactly as a search pick does): different symbols on them can never both land. Said, never attempted.
const LINKED = 'Those charts are linked to the same colour group, so they always show the same symbol. Unlink one of them first (set its link colour to not linked), then ask again — nothing has changed.'
function linkedTogether(refs, charts) {
  const groups = refs.map(r => charts.find(c => c.ref === r)?.group).filter(g => typeof g === 'string' && g && !g.startsWith('N'))
  return groups.length !== new Set(groups).size
}
const setSymbol = (ref, symbol) => ({ action: 'chart.setSymbol', target: ref, args: { symbol } })
const setTf = (ref, timeframe) => ({ action: 'chart.setTimeframe', target: ref, args: { timeframe } })
const chartGrid = (symbols, timeframe, layout, newCharts) => ({ action: 'chartGrid.set', target: 'board', args: { symbols, timeframe: timeframe || null, layout: layout || null, new_charts: newCharts ? true : null } })

// ── N charts for these tickers ──
const COUNT_WORDS = { two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9 }
const CHARTS_FOR = /\bcharts (?:for|of|showing|on)\b/i
const COUNT_RE = /\b(two|three|four|five|six|seven|eight|nine|[2-9])\s+(?:new\s+)?(?:(?:daily|weekly|monthly|hourly|intraday)\s+)?(?:separate\s+)?charts?\b/i
const GRID_LAYOUT = [[/\b(?:side[\s-]by[\s-]side|next to each other|in (?:a )?row)\b/i, 'columns'], [/\b(?:stacked|on top of each other|in (?:a )?column)\b/i, 'rows'],
  [/\b(?:grid|2\s*x\s*2|2\s*by\s*2|3\s*x\s*3|quad)\b/i, 'grid']]
// everything else such a sentence may say — any other word means it is not ONLY a grid of these tickers
const GRID_FILLER = /\b(?:please|can|could|would|you|i|want|need|like|to|create|make|open|add|show|set|setup|up|give|me|put|load|pull|bring|build|chart|charts|display|lay|out|new|separate|for|of|with|on|showing|and|them|all|each|every|one|a|an|the|in|into|as|be|is|are|my|grid|2x2|2|x|by|side|stacked|top|other|row|column|quad|equal|equally|sized|size|evenly|layout|arrangement|arranged|time ?frames?|daily|weekly|monthly|hourly|intraday|minutes?|min|hour|hr|1h|4h|1|5|15|30|60|two|three|four|five|six|seven|eight|nine|both|too|also|just|now)\b/gi
// ⭐ live acceptance 2026-10-29: "open daily charts for aapl msft nvda, each with a 50sma" — the tickers of a grid may be
// typed in lowercase. Only the words a grid sentence leaves once its own words are taken out, each at most four letters
// (a longer word is more often a company name — "apple" — and stays the model's) and passing the shared N4 rule: not a
// word UCT knows, nor one edit from one, nor a short typo ("teh"), nor a pronoun. Whether each exists is decided by the
// ticker search (chartGrid.set prepare), which refuses the whole grid by name otherwise.
const LOWER_TICKER = /^[a-z][a-z0-9]{0,3}$/
export function gridTickers(raw, host) {
  const marked = tickersIn(raw)
  let rest = String(raw || '')
  for (const s of marked) rest = rest.replace(new RegExp(`\\$?\\b${escapeRe(s)}\\b`, 'gi'), ' ')
  const lower = rest.replace(/[,;!?&()]|\.(?=\s|$)/g, ' ').replace(GRID_FILLER, ' ').split(/\s+/)
    .filter(w => /[a-z]/.test(w) && LOWER_TICKER.test(w) && !SHORT_FIXES[w.toLowerCase()] && plainSymbolWord(w, host, raw)).map(w => w.toUpperCase())
  if (!lower.length) return marked
  // the member's order: each ticker where it was first typed
  const at = (s) => String(raw).search(new RegExp(`(?:^|[^A-Za-z0-9$])\\$?${escapeRe(s)}(?![A-Za-z0-9])`, 'i'))
  return [...new Set([...marked, ...lower])].sort((a, b) => at(a) - at(b))
}
function gridRequest(raw, lower, charts, host) {
  const syms = gridTickers(raw, host)
  if (syms.length < 2) return null
  const layoutHit = GRID_LAYOUT.find(([re]) => re.test(raw))
  const count = COUNT_RE.exec(raw)
  // ⭐ acceptance 2026-10-29: "open daily charts for AAPL MSFT NVDA" — charts (plural) for the named tickers, no count
  if (!count && !layoutHit && !CHARTS_FOR.test(raw)) return null
  if (count && (COUNT_WORDS[count[1].toLowerCase()] || Number(count[1])) !== syms.length) return null
  const tf = timeframeIn(lower)
  if (tf === false) return null
  let rest = raw
  for (const s of syms) rest = rest.replace(new RegExp(`\\$?\\b${escapeRe(s)}\\b`, 'gi'), ' ')
  rest = rest.replace(/[,;.!?&()]/g, ' ').replace(GRID_FILLER, ' ').trim()
  if (rest) return null
  const fresh = wantsNew(raw, syms.length, charts.length)
  // least disruptive: NEW charts (no layout asked for) that fit in the empty space go there — nothing re-tiled
  if (fresh && !layoutHit && fitsEmpty(host, syms.length)) {
    return { kind: 'ops', ops: [{ action: 'widget.addCharts', target: 'workspace', args: { symbols: syms, timeframe: tf || null, chart_type: null, exact: null } }], mode: 'apply' }
  }
  return { kind: 'ops', ops: [chartGrid(syms, tf, layoutHit ? layoutHit[1] : null, fresh)], mode: 'apply' }
}
// OWNER 2026-10-27 (+ live test 2026-10-28): reuse the board's charts when there are no more of them than tickers
// ("four charts for …" on a one-chart board: that chart becomes the first of the four); NEW charts when the member
// asks for new ones, or when the board already has more charts than tickers (their tickers are never overwritten).
// ⭐ acceptance 2026-10-29: "open daily charts for AAPL MSFT NVDA" on a one-chart board keeps that chart and adds three
const ASKS_NEW = /\b(?:new|add|another|more|additional|extra|open)\b/i
const wantsNew = (text, n, onBoard) => ASKS_NEW.test(String(text || '')) || n < onBoard
// n new charts land in EMPTY space as the product places them (nothing resized or moved)
function fitsEmpty(host, n) {
  let s = null
  try { s = host?.widgets?.snapshot?.() || null } catch { s = null }
  return !!s && s.count + n <= s.max && s.fitsSequence?.(Array(n).fill('chart')) === true
}
const readingOrder = (a, b) => ((a.cell?.y ?? 0) - (b.cell?.y ?? 0)) || ((a.cell?.x ?? 0) - (b.cell?.x ?? 0))

/**
 * Live test 2026-10-28 — the MODEL's plan for "N charts for these tickers" (charts added — widget.add with an
 * `as`, or widget.addCharts with literal tickers — each given its ticker, maybe a timeframe, maybe re-arranged)
 * cannot run on a full board, and may not mix a change to an existing chart with an add. Exactly that shape,
 * and nothing else, becomes ONE chartGrid.set on the same tickers in the same order (the board's charts
 * reused unless the member's own words ask for new ones) — unless it only ADDS charts that fit in the empty
 * space as they are (then nothing needs re-tiling and it runs as planned). Anything else is left exactly as planned.
 */
const GRID_SHAPE = new Set(['widget.add', 'widget.addCharts', 'chart.setSymbol', 'chart.setTimeframe', 'widget.arrange'])
// ⭐ acceptance 2026-10-29 ("open daily charts for AAPL MSFT NVDA, each with a 50sma"): the plan may also change the NEW
// charts (an op aimed at an `as`) — those ride along as `then`, each with the ticker its chart was given, to run once the
// grid has made the charts (useAgent: one more step, the same execute)
export function screenChartGrid(input, text, host) {
  if (!Array.isArray(input) || !input.length) return { ops: input, corrected: false }
  const aliasesIn = new Set(input.filter(o => o?.action === 'widget.add' && o.args?.as).map(o => String(o.args.as)))
  const extra = input.filter(o => !GRID_SHAPE.has(o?.action) && aliasesIn.has(String(o?.target)))
  const ops = extra.length ? input.filter(o => !extra.includes(o)) : input
  if (!ops.every(o => GRID_SHAPE.has(o?.action))) return { ops: input, corrected: false }
  const r = screenGridShape(ops, text, host)
  if (!extra.length) return r
  if (!r.corrected) return { ops: input, corrected: false }
  const symbolOf = new Map(ops.filter(o => o.action === 'chart.setSymbol').map(o => [String(o.target), String(o.args?.symbol || '').trim().toUpperCase()]))
  const then = extra.map(o => ({ symbol: symbolOf.get(String(o.target)), op: o }))
  return then.every(t => t.symbol) ? { ...r, then } : { ops: input, corrected: false }
}
function screenGridShape(ops, text, host) {
  const adds = ops.filter(o => o.action === 'widget.add')
  if (adds.some(o => o.args?.type !== 'chart' || !o.args?.as)) return { ops, corrected: false }
  const lists = ops.filter(o => o.action === 'widget.addCharts')
  if (lists.some(o => !Array.isArray(o.args?.symbols) || o.args?.chart_type)) return { ops, corrected: false }
  if (!adds.length && !lists.length) return { ops, corrected: false }
  const symbols = []
  const tfs = new Set()
  for (const o of ops) {
    if (o.action === 'chart.setSymbol') symbols.push(String(o.args?.symbol || '').trim().toUpperCase())
    if (o.action === 'widget.addCharts') { symbols.push(...o.args.symbols.map(s => String(s || '').trim().toUpperCase())); if (o.args.timeframe) tfs.add(o.args.timeframe) }
    if (o.action === 'chart.setTimeframe') tfs.add(o.args?.timeframe)
  }
  // every new chart has its ticker; one timeframe at most; at least two charts
  const aliases = new Set(adds.map(o => String(o.args.as)))
  const named = new Set(ops.filter(o => o.action === 'chart.setSymbol').map(o => String(o.target)))
  if ([...aliases].some(a => !named.has(a))) return { ops, corrected: false }
  if (symbols.some(s => !s) || tfs.size > 1) return { ops, corrected: false }
  // a ticker typed twice is ONE chart (widget.addCharts' own rule: the first keeps its place)
  const uniq = [...new Set(symbols)]
  if (uniq.length < 2) return { ops, corrected: false }
  symbols.splice(0, symbols.length, ...uniq)
  // a ticker the model put on an EXISTING chart: only the board's first charts in reading order, listed first
  // (exactly the charts the grid reuses) — else the plan is not this shape
  let charts = []
  try { charts = (host?.charts?.list?.() || []).slice().sort(readingOrder) } catch { charts = [] }
  const existing = ops.filter(o => o.action === 'chart.setSymbol' && !aliases.has(String(o.target))).map(o => String(o.target))
  if (existing.length && (existing.some((r, i) => charts[i]?.ref !== r) || ops.findIndex(o => o.action === 'chart.setSymbol' && aliases.has(String(o.target))) < ops.findLastIndex(o => o.action === 'chart.setSymbol' && !aliases.has(String(o.target))))) return { ops, corrected: false }
  // least disruptive: NEW charts that fit in the empty space are added there as planned (nothing re-tiled)
  if (!existing.length && fitsEmpty(host, symbols.length)) return { ops, corrected: false }
  const fresh = !existing.length && wantsNew(text, symbols.length, charts.length)
  const layout = ops.find(o => o.action === 'widget.arrange')?.args?.pattern
  const target = ops.find(o => o.action === 'widget.arrange')?.target || 'board'
  return { ops: [{ ...chartGrid(symbols, [...tfs][0] || null, ['grid', 'columns', 'rows'].includes(layout) ? layout : null, fresh), target }], corrected: true }
}

// ── side by side ──
const SIDE = /\b(side[\s-]by[\s-]side|next to each other|beside each other|alongside each other)\b/i
const NEW_CHARTS = /\b(?:in|on|as|with)\s+(?:two\s+|2\s+)?new\s+charts?\b|\bnew charts?\b/i
function sideBySide(raw, lower, charts, host) {
  if (!SIDE.test(raw)) return null
  const syms = tickersIn(raw.replace(SIDE, ' '))
  if (syms.length !== 2) return null
  const tf = timeframeIn(lower)
  if (tf === false) return null
  const [a, b] = syms
  // ⭐ live test 2026-10-28 — applied, never a card: NEW charts (asked for, or no chart here) that fit in the empty
  // space go there; otherwise ONE grid change: the one chart is reused (it keeps a ticker it already shows) and the
  // other is added beside it — the two side by side, one Undo
  const fresh = NEW_CHARTS.test(lower) || charts.length === 0
  if (fresh && fitsEmpty(host, 2)) return { kind: 'ops', ops: [{ action: 'widget.addCharts', target: 'workspace', args: { symbols: [a, b], timeframe: tf || null, chart_type: null, exact: null } }], mode: 'apply' }
  if (fresh || charts.length === 1) {
    const has = charts.length === 1 ? String(charts[0].symbol || '').toUpperCase() : null
    const order = !fresh && has === b ? [b, a] : [a, b]
    return { kind: 'ops', ops: [chartGrid(order, tf, 'columns', fresh && charts.length > 0)], mode: 'apply' }
  }
  const showing = (s) => charts.filter(c => String(c.symbol || '').toUpperCase() === s)
  if (charts.length === 2) {
    // a chart already on one of them keeps it; the other chart takes the other symbol
    let [c1, c2] = charts
    if (showing(b).some(c => c.ref === c1.ref) || showing(a).some(c => c.ref === c2.ref)) [c1, c2] = [c2, c1]
    if (linkedTogether([c1.ref, c2.ref], charts)) return { kind: 'say', text: LINKED }
    const ops = [setSymbol(c1.ref, a), setSymbol(c2.ref, b), ...(tf ? [setTf(c1.ref, tf), setTf(c2.ref, tf)] : [])]
    return { kind: 'ops', ops, mode: 'apply' }
  }
  const sa = showing(a), sb = showing(b)
  if (sa.length && sb.length && !tf) return { kind: 'say', text: `${a} is already on ${sa[0].label} and ${b} on ${sb[0].label} — nothing to change.` }
  // several charts: keep one already on a symbol; fill the other from the first remaining chart in reading
  // order — PROPOSED, so the member sees exactly which charts (never a silent pick)
  const keepA = sa[0] || null, keepB = sb.find(c => c.ref !== keepA?.ref) || null
  const free = charts.filter(c => c.ref !== keepA?.ref && c.ref !== keepB?.ref)
  const ca = keepA || free.shift()
  const cb = keepB || free.shift()
  if (!ca || !cb) return null
  if (linkedTogether([ca.ref, cb.ref], charts)) return { kind: 'say', text: LINKED }
  const ops = [...(keepA ? [] : [setSymbol(ca.ref, a)]), ...(keepB ? [] : [setSymbol(cb.ref, b)]), ...(tf ? [setTf(ca.ref, tf), setTf(cb.ref, tf)] : [])]
  return ops.length ? { kind: 'ops', ops, mode: 'propose', note: `With ${charts.length} charts here I picked ${ca.label} for ${a} and ${cb.label} for ${b} — check it first; nothing has changed yet.` } : null
}

// ── positional symbols ──
const LEAD_VERB = /^(?:please\s+)?(?:put|show|load|open|set|switch|change|make|chart|pull up|bring up)\s+/i
const CLAUSE_SPLIT = /\s*(?:,|;|\band\b|\bthen\b|&)\s*/i
// what may sit in a clause beside the ticker and the chart word — anything else ("add RSI to NVDA on the
// left") means the clause is not a plain "this symbol on that chart", and the whole sentence is not ours
const FILLER = /\b(?:on|onto|to|in|at|for|the|chart|charts|one|side|screen|please)\b/gi
const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
function positional(raw, charts) {
  if (charts.length < 2) return null
  const clauses = raw.trim().replace(/[.!]+$/, '').split(CLAUSE_SPLIT).map(s => s.trim()).filter(Boolean)
  if (clauses.length < 2 || clauses.length > 6) return null
  const picks = []
  let tf = null
  for (const c0 of clauses) {
    const c = c0.replace(LEAD_VERB, '')
    const syms = tickersIn(c)
    if (!syms.length) {
      // "both weekly" / "make them daily" — one timeframe for every named chart
      const t = timeframeIn(c.toLowerCase())
      if (t && /\b(both|all|them|each)\b/i.test(c) && tf == null) { tf = t; continue }
      return null
    }
    if (syms.length !== 1) return null
    // the chart this clause names: a position or an ordinal, said beside the ticker — and nothing else
    const rest = c.replace(new RegExp(`\\$?${escapeRe(syms[0])}`, 'i'), ' ')
    // ("AAPL on the second" — an ordinal at the end of a clause means the chart too)
    const said = /\b(?:first|second|third|fourth|fifth|sixth|last|middle|[1-6](?:st|nd|rd|th))\s*$/i.test(rest) && !ordinalChart(rest, charts) ? `${rest} chart` : rest
    const ord = ordinalChart(said, charts)
    const pos = ord ? null : POS_RE.exec(said)
    if (!ord && !pos) return null
    const residue = said.replace(ord ? ord.match[0] : pos[0], ' ').replace(FILLER, ' ').trim()
    if (residue) return null
    let ref = null
    if (ord) ref = ord.ref || null
    else { const hit = matchPosition(charts, normPos(pos[1])); ref = hit.length === 1 ? hit[0].ref : null }
    if (!ref) {
      const word = (ord ? ord.match[0] : pos[0]).trim()
      return { kind: 'say', text: `I can't tell which chart “${word}” is here — name the charts by position (left, top-right…) or order (first, second…). Nothing has changed.` }
    }
    picks.push({ ref, symbol: syms[0] })
  }
  if (picks.length < 2) return null
  if (new Set(picks.map(p => p.ref)).size !== picks.length) return { kind: 'say', text: 'Two of those name the same chart — say which chart each symbol goes on. Nothing has changed.' }
  if (linkedTogether(picks.map(p => p.ref), charts)) return { kind: 'say', text: LINKED }
  const ops = picks.map(p => setSymbol(p.ref, p.symbol))
  if (tf) for (const p of picks) ops.push(setTf(p.ref, tf))
  return { kind: 'ops', ops, mode: 'apply' }
}

// ── copy a chart's look ──
const LOOK_RES = [
  [/^(?:please\s+)?(?:make|set|style|change)\s+(.+?)\s+(?:look|appear)\s+(?:just\s+|exactly\s+)?like\s+(.+?)$/i, 1, 2],
  [/^(?:please\s+)?(?:copy|apply|give)\s+(?:the\s+)?(?:look|style|appearance|colou?rs and settings|settings)\s+(?:of|from)\s+(.+?)\s+(?:to|onto|on)\s+(.+?)$/i, 2, 1],
  [/^(?:please\s+)?match\s+(.+?)\s+to\s+(.+?)$/i, 1, 2],
]
function copyLook(raw, charts, host) {
  if (charts.length < 2) return null
  const t = raw.trim().replace(/[.!?]+$/, '')
  for (const [re, toI, fromI] of LOOK_RES) {
    const m = re.exec(t)
    if (!m) continue
    const to = chartFromPhrase(m[toI], charts, host)
    const from = chartFromPhrase(m[fromI], charts, host, { other: to })
    if (!to || !from) return null                       // unclear → the model (which may ask)
    if (to === from) return { kind: 'say', text: 'That names the same chart twice — which chart should change, and which should it look like?' }
    return { kind: 'ops', ops: [{ action: 'chartSetup.copyLook', target: to, args: { from } }], mode: 'propose' }
  }
  return null
}

export function multiChartPlan(text, { host } = {}) {
  const raw = String(text || '').trim()
  if (!raw || raw.length > 200) return null
  let charts = []
  try { charts = host?.charts?.list?.() || [] } catch { charts = [] }
  const lower = raw.toLowerCase()
  return copyLook(raw, charts, host) || sideBySide(raw, lower, charts, host) || positional(raw, charts) || gridRequest(raw, lower, charts, host)
}
