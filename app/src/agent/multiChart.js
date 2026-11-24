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
//   side by side         "show NVDA and AMD side by side" — ⛔ OWNER RULING 2026-11-23 (replaces the 10-27 "reuse suitable
//                        charts"): the existing chart is PRESERVED and the comparison chart ADDED beside it; never a
//                        silent replace; asked when ambiguous (no room, replace / swap words, no chart on either ticker).
//                        0 charts or "new charts" → added, as before. (sidePlan / sideBySideScreen below)
//   copy a look          "make the left chart look like the right one", "copy the look of the AMD chart to this
//                        chart", "match the bottom chart to the top one" → chartSetup.copyLook (proposed)
//
// Returns null | { kind: 'ops', ops, mode, note? } | { kind: 'steps', steps: [{ ops, mode, needs? }] }
//              | { kind: 'say', text }

import { matchPosition } from './fastPath'
import { ordinalChart, selectedChart } from './deixis'
import { plainSymbolWord, SHORT_FIXES } from './nl/lexicon'
import { isReservedWord } from './nl/tickers'
import { getTargetKind } from './capabilities'
import { planChartGrid } from './chartGrid'
import { sideBySideWords, SIDE_REPLACE } from './sideBySideWords'

export { sideBySideWords, SIDE_REPLACE }

// ── tickers as typed (capitals, or $-prefixed) — never a lowercase word ──
const NOT_TICKERS = new Set(['I', 'A', 'UCT', 'ETF', 'ADR', 'RS', 'RSI', 'MACD', 'EMA', 'SMA', 'ATR', 'VWAP', 'ET', 'AM', 'PM', 'OK', 'US', 'NYSE', 'HLC', 'OHLC', 'MA', 'D', 'W', 'M', 'AND', 'VS'])
const TICKER_RE = /(?:^|[\s,;(])(\$[A-Za-z][A-Za-z0-9.]{0,9}|[A-Z][A-Z0-9.]{0,9})(?=$|[\s,;.!?)])/g
export function tickersIn(raw) {
  const out = []
  for (const m of String(raw || '').matchAll(TICKER_RE)) {
    const t = m[1].replace(/^\$/, '').replace(/\.$/, '').toUpperCase()
    if (!m[1].startsWith('$') && (NOT_TICKERS.has(t) || isReservedWord(t))) continue
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
const LINKED = 'Those charts are linked to the same color group, so they always show the same symbol. Unlink one of them first (set its link color to not linked), then ask again — nothing has changed.'
function linkedTogether(refs, charts) {
  const groups = refs.map(r => charts.find(c => c.ref === r)?.group).filter(g => typeof g === 'string' && g && !g.startsWith('N'))
  return groups.length !== new Set(groups).size
}
const setSymbol = (ref, symbol) => ({ action: 'chart.setSymbol', target: ref, args: { symbol } })
const setTf = (ref, timeframe) => ({ action: 'chart.setTimeframe', target: ref, args: { timeframe } })
const chartGrid = (symbols, timeframe, layout, newCharts, watchlist = false) => ({ action: 'chartGrid.set', target: 'board', args: { symbols, timeframe: timeframe || null, layout: layout || null, new_charts: newCharts ? true : null, watchlist: watchlist ? true : null, replace: null } })

// ── N charts for these tickers ──
const COUNT_WORDS = { two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9 }
const CHARTS_FOR = /\bcharts (?:for|of|showing|on)\b/i
const COUNT_RE = /\b(two|three|four|five|six|seven|eight|nine|[2-9])\s+(?:new\s+)?(?:(?:daily|weekly|monthly|hourly|intraday)\s+)?(?:separate\s+)?charts?\b/i
// (the first hit decides: a shape stated outright comes first, so "side by side in a 2x2 grid" is the grid. A bare "grid" comes
// last: "stacked on the grid" and "in my grid" name the board, not a shape)
const GRID_LAYOUT = [[/\b(?:2\s*x\s*2|2\s*by\s*2|3\s*x\s*3|quad|(?:in|as)\s+an?\s+(?:[a-z0-9]+\s+)?grid)\b/i, 'grid'],
  [/\b(?:side[\s-]by[\s-]side|next to each other|in (?:a )?row)\b/i, 'columns'], [/\b(?:stacked|on top of each other|in (?:a )?column)\b/i, 'rows'],
  [/\bgrid\b/i, 'grid']]
// hotfix 2026-11-03 (live: "Put SPY, QQQ, NVDA, and TSLA on four charts, all the same size."): equal sizing asked in words —
// the charts are re-tiled evenly (chartGrid.set), never dropped into whatever empty space happens to be there
export const EQUAL_SIZE_WORDS = /\b(?:same|equal|even|identical) (?:size|sizes|sized|width|height)\b|\bequal(?:ly)?[\s-]?sized?\b|\bevenly\b|\bequally\b/i
// everything else such a sentence may say — any other word means it is not ONLY a grid of these tickers
const GRID_FILLER = /\b(?:please|can|could|would|you|i|want|need|like|to|create|make|open|add|show|set|setup|up|give|me|put|load|pull|bring|build|chart|charts|display|lay|out|new|separate|for|of|with|on|showing|and|them|all|each|every|one|a|an|the|in|into|as|be|is|are|my|grid|2x2|2|x|by|side|stacked|top|other|row|column|quad|panels?|cells?|boxes|windows|quadrants|equal|equally|sized|size|sizes|same|identical|evenly|layout|arrangement|arranged|time ?frames?|daily|weekly|monthly|hourly|intraday|minutes?|min|hour|hr|1h|4h|1|5|15|30|60|two|three|four|five|six|seven|eight|nine|both|too|also|just|now)\b/gi
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
// ⭐ PHASE 3 (workspace composition): "make me a momentum workspace with four daily charts for NVDA, AMD, AVGO and MU, and a
// watchlist" — the lead-in names the board ("a … workspace / board / setup with"), and "a watchlist" asks for a Watchlist
// rail beside the charts (chartGrid.set `watchlist`). Only "a watchlist" / "a watchlist widget" — a NAMED list ("my
// Momentum watchlist") is not this (it is the model's: open that list).
const WORKSPACE_LEAD = /^(?:please\s+)?(?:make|build|set up|setup|create|give|lay out)\s+(?:me\s+)?(?:a|an|my)\s+(?:[a-z]+\s+){0,3}?(?:workspace|board|setup|layout)\s+(?:with|that has|of)\s+/i
const WATCH_RAIL = /(?:,\s*|\s+)(?:and\s+|with\s+|plus\s+)?(?:a|one)\s+watch ?list(?:\s+widget)?(?:\s+(?:on the right|beside them|next to them|on the side))?(?=$|[\s,.;!?])/i
/** ⭐ PHASE 3 acceptance: "make me a workspace with …" — the member describes a WHOLE board, not charts to add to this one. */
export const isWorkspaceRequest = (text) => WORKSPACE_LEAD.test(String(text || '').trim())
export const asksForWatchlistRail = (text) => WATCH_RAIL.test(String(text || ''))
function gridRequest(raw0, lower0, charts, host) {
  // W2 (CG-2): '2×2' typed with the multiplication sign
  raw0 = String(raw0).replace(/×/g, 'x'); lower0 = String(lower0).replace(/×/g, 'x')
  const lead = WORKSPACE_LEAD.exec(raw0)
  const rail = WATCH_RAIL.test(raw0)
  const raw = raw0.replace(WORKSPACE_LEAD, 'open ').replace(WATCH_RAIL, ' ').replace(/\s+/g, ' ').trim()
  const lower = raw.toLowerCase()
  if ((lead || rail) && !CHARTS_FOR.test(raw) && !COUNT_RE.test(raw)) return null
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
  // ⭐ LIVE TRAIN 4 (production 993ef96a2a: "Put SPY, QQQ, NVDA, and TSLA on four charts, all the same size." on a board of 6
  // charts ADDED four — 10 charts): more charts on the board than tickers, and the member's words neither ask for new
  // ones nor build a whole workspace — never guessed, never a silent removal: ONE question, replace the charts (the ones
  // showing a named ticker kept; the removal approval-gated) or add these beside them
  // ⛔ ADD NEVER REPLACES (hotfix 2026-11-13, AUDIT: "add AAPL and MSFT" / "add two charts for …" on a SPY + NVDA board re-symbolled
  // both charts): an ADD (add / include, no replace word) never reuses or re-symbols a chart already there — the tickers go on NEW
  // charts. A grid SHAPE or a COUNT said with it ("add a 2x2 of …", "add four charts for …") on a board that has charts could mean
  // the whole grid (GRID-REUSE, 11-04) or more charts:
  // ASKED (replace them — shown first — or add beside them); more than the board holds: asked (replace, or nothing).
  if (!lead && ADD_VERB.test(raw) && !REPLACE_INTENT.test(raw)) {
    // (D18 item 3: a ticker a chart already shows is reused — by the plan-level screen in useAgent.execute and planChartGrid)
    const onBoard = gridChartCount(host, charts.length)
    const layout = layoutHit ? layoutHit[1] : null
    if (onBoard > 0) {
      const q = addQuestion(syms, tf, layout, rail, onBoard, { shape: (GRID_SHAPE_WORDS.test(raw) || !!count) && !ASKS_NEW.test(raw), full: !roomFor(host, syms.length + (rail ? 1 : 0)), shown: shownOf(host, syms, tf) })
      if (q) return q
    }
    if (!layout && !rail && !EQUAL_SIZE_WORDS.test(raw) && fitsEmpty(host, syms.length)) {
      return { kind: 'ops', ops: [{ action: 'widget.addCharts', target: 'workspace', args: { symbols: syms, timeframe: tf || null, chart_type: null, exact: null } }], mode: 'apply' }
    }
    return { kind: 'ops', ops: [chartGrid(syms, tf, layout, onBoard > 0, rail)], mode: 'apply' }
  }
  // ⛔ SIDE BY SIDE PRESERVES (owner ruling 11-23): "show NVDA, AMD and TSLA side by side" with no count or grid shape said — the
  // existing charts are kept and the tickers they don't show are added beside them (or asked), exactly as for two tickers
  if (!lead && !rail && !count && !ANY_COUNT.test(raw) && !EQUAL_SIZE_WORDS.test(raw) && !GRID_SHAPE_WORDS.test(raw) && layoutHit?.[1] === 'columns' && SIDE.test(raw) && !REPLACE_INTENT.test(raw) && charts.length > 0 && !wantsNew(raw, 0, 0)) {
    return sidePlan(syms, tf, charts, host, raw)
  }
  if (!lead && !explicitGridIntent(raw)) {
    const q = gridQuestion(syms, tf, layoutHit ? layoutHit[1] : null, rail, gridChartCount(host, charts.length), shownOf(host, syms, tf))
    if (q) return q
  }
  const fresh = wantsNew(raw, syms.length, charts.length)
  // least disruptive: NEW charts (no layout asked for) that fit in the empty space go there — nothing re-tiled
  if (fresh && !layoutHit && !rail && !EQUAL_SIZE_WORDS.test(raw) && fitsEmpty(host, syms.length)) {
    return { kind: 'ops', ops: [{ action: 'widget.addCharts', target: 'workspace', args: { symbols: syms, timeframe: tf || null, chart_type: null, exact: null } }], mode: 'apply' }
  }
  // a workspace "with" the charts reuses the board's charts (they are its charts now); "open" / "new" adds beside them
  return { kind: 'ops', ops: [chartGrid(syms, tf, layoutHit ? layoutHit[1] : null, lead ? false : fresh, rail)], mode: 'apply' }
}
// OWNER 2026-10-27 (+ live test 2026-10-28): reuse the board's charts when there are no more of them than tickers
// ("four charts for …" on a one-chart board: that chart becomes the first of the four); NEW charts when the member
// asks for new ones, or when the board already has more charts than tickers (their tickers are never overwritten).
// ⭐ acceptance 2026-10-29: "open daily charts for AAPL MSFT NVDA" on a one-chart board keeps that chart and adds three
const ASKS_NEW = /\b(?:new|another|more|additional|extra|open)\b/i
// GRID-REUSE (owner ruling: a COUNT of charts with their tickers is THE grid, never an extra chart — live 11-04: "add a
// 2x2 of SPY QQQ IWM DIA" on a one-chart board made FIVE charts): the bare verb "add" is not a request for MORE charts
// when the words give a count ("… on four charts") or a grid shape ("a 2x2", "side by side") — the board's charts are
// reused, top-left first, and re-tiled. Only words that SAY more ("new", "more", "another", "extra"…) add beside them.
// A bare "add" with neither ("add charts for AAPL and MSFT") still adds, as before.
const ADD_WORD = /\badd\b/i
const asksNew = (text) => {
  const t = String(text || '')
  return ASKS_NEW.test(t) || (ADD_WORD.test(t) && !COUNT_RE.test(t) && !GRID_LAYOUT.some(([re]) => re.test(t)))
}
// review t4 M1: an explicit intent for the board's charts — new / add / more, or replace — is never asked about
const REPLACE_INTENT = /\b(?:replace|instead of (?:my|the|these|those)|swap out|get rid of)\b/i
const explicitGridIntent = (text) => asksNew(text) || REPLACE_INTENT.test(String(text || ''))
// review t4 L2: the charts on the GRID — the set Replace acts on (a detached / floating chart or an extra chart tab never counts)
export function gridChartCount(host, fallback = 0) {
  try {
    const b = getTargetKind('board')?.list?.(host)?.[0]
    if (b?.charts) { const away = new Set((b.detached || []).map(String)); return [...b.charts.keys()].filter(id => !away.has(String(id))).length }
  } catch { /* the board is not readable */ }
  return fallback
}
/** LIVE TRAIN 4: more charts on the grid than tickers, nothing said about new / replace → ONE question (never a guess,
 *  never a silent removal): replace the charts (approval-gated; those showing a named ticker kept) or add these beside them. */
// ⛔ D18 (AUDIT condition on "Add N more charts" = an explicit copy): the add choice SAYS the duplicates before the member picks —
// every requested ticker a chart on the board already shows (on the timeframe asked, or none asked) is named: "Add 4 new charts
// (a second NVDA and TSLA)". No duplicate → the plain label.
export function shownOf(host, syms, tf = null) {
  let charts = []
  try { charts = host?.charts?.list?.() || [] } catch { charts = [] }
  const on = new Set(charts.filter(c => !tf || String(c.tf || '') === String(tf)).map(c => String(c.symbol || '').toUpperCase()).filter(Boolean))
  return (syms || []).map(x => String(x || '').toUpperCase()).filter(x => on.has(x))
}
const andWords = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`)
export const addLabel = (k, shown = []) => (shown.length ? `Add ${k} new chart${k === 1 ? '' : 's'} (a second ${andWords(shown)})` : `Add ${k} more chart${k === 1 ? '' : 's'}`)
export function gridQuestion(syms, tf, layout, rail, onBoard, shown = []) {
  const k = (syms || []).length
  if (k < 2 || !(k < onBoard)) return null
  const grid = (fresh) => chartGrid(syms, tf, layout, fresh, rail)
  return {
    kind: 'ask',
    text: `You have ${onBoard} charts here. Replace them with these ${k} (${syms.join(', ')}), or add ${k} more beside them?`,
    choices: [{ ref: 'grid:replace', label: `Replace my ${onBoard} charts with these ${k}` }, { ref: 'grid:add', label: addLabel(k, shown) }],
    options: { replace: [{ ...grid(false), args: { ...grid(false).args, replace: 'charts' } }], add: [grid(true)] },
  }
}
/** review t4 M1: the SAME question for a plan from ANY path (the model, NL-1, a rewritten grid shape): one chartGrid.set
 *  that does not replace, on a grid holding more charts than its tickers, with no explicit new / add / replace in the words. */
export function gridChoiceFor(ops, text, host) {
  // ⛔ SIDE BY SIDE PRESERVES (owner ruling 11-23): a side-by-side plan that would replace a chart, and could not become the add
  // (no room, replace / swap words, the chart unclear, more than the tickers planned) is ASKED — nothing changed
  const side = sideBySideScreen(ops, text, host)
  if (side?.ask) return side.ask
  if (!Array.isArray(ops) || ops.length !== 1 || ops[0]?.action !== 'chartGrid.set') return null
  const a = ops[0].args || {}
  if (a.replace === true || a.replace === 'charts') return null
  if (explicitGridIntent(text) || isWorkspaceRequest(text)) return null
  const syms0 = (a.symbols || []).map(s => String(s || '').toUpperCase())
  return gridQuestion(syms0, a.timeframe || null, a.layout || null, a.watchlist === true, gridChartCount(host, 0), shownOf(host, syms0, a.timeframe || null))
}
const wantsNew = (text, n, onBoard) => asksNew(text) || n < onBoard
// ⛔ ADD NEVER REPLACES (hotfix 2026-11-13): the verbs that ask for MORE charts, and a grid shape said in words
export const ADD_VERB = /\b(?:add|adds|added|adding|include|includes|included|including)\b/i
// a count of charts said with any one word before "charts" ("four equal charts"): the GRID-REUSE ruling's, never side-by-side's
const ANY_COUNT = /\b(?:two|three|four|five|six|seven|eight|nine|[2-9])\s+(?:[a-z-]+\s+)?charts?\b/i
const GRID_SHAPE_WORDS = /\b[1-4]\s*(?:x|by|-by-)\s*[1-4]\b|\bquad\b/i
// the board's room for n more widgets (unknown → assumed, the grid's own check still refuses past the cap)
function roomFor(host, n) {
  let s = null
  try { s = host?.widgets?.snapshot?.() || null } catch { s = null }
  return !s || typeof s.max !== 'number' || s.count + n <= s.max
}
/** ADD on a board with charts: a grid SHAPE asked with it → replace (shown first) or add beside; no room → replace or nothing. */
export function addQuestion(syms, tf, layout, rail, onBoard, { shape = false, full = false, shown = [] } = {}) {
  const k = (syms || []).length
  if (k < 1 || (!shape && !full)) return null
  const grid = (fresh) => chartGrid(syms, tf, layout, fresh, rail)
  const replace = [{ ...grid(false), args: { ...grid(false).args, replace: 'charts' } }]
  const mine = `${onBoard} chart${onBoard === 1 ? '' : 's'}`
  if (full) {
    return { kind: 'ask', text: `There isn't room for ${k} more chart${k === 1 ? '' : 's'} beside your ${mine}. Replace your ${mine} with these ${k} (${syms.join(', ')})? Nothing has changed yet.`,
      choices: [{ ref: 'grid:replace', label: `Replace my ${mine} with these ${k}` }], options: { replace } }
  }
  return {
    kind: 'ask',
    text: `You have ${mine} here. Add these ${k} (${syms.join(', ')}) beside them, or replace your ${mine} with these ${k}? Nothing has changed yet.`,
    choices: [{ ref: 'grid:add', label: addLabel(k, shown) }, { ref: 'grid:replace', label: `Replace my ${mine} with these ${k}` }],
    options: { replace, add: [grid(true)] },
  }
}
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
// ⭐ PHASE 3 acceptance: "…, a watchlist" — ONE plain Watchlist add in such a plan is the grid's Watchlist rail
const isRailAdd = (o) => o?.action === 'widget.add' && o.args?.type === 'watchlist' && !o.args?.as
// ⭐ acceptance 2026-10-29 ("open daily charts for AAPL MSFT NVDA, each with a 50sma"): the plan may also change the NEW
// charts (an op aimed at an `as`) — those ride along as `then`, each with the ticker its chart was given, to run once the
// grid has made the charts (useAgent: one more step, the same execute)
export function screenChartGrid(input, text, host) {
  if (!Array.isArray(input) || !input.length) return { ops: input, corrected: false }
  // ⛔ SIDE BY SIDE PRESERVES (owner ruling 11-23): a side-by-side plan that re-symbols an existing chart becomes the add beside it
  const side = sideBySideScreen(input, text, host)
  if (side?.ops) return { ops: side.ops, corrected: true }
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
function screenGridShape(ops0, text, host) {
  const rails = ops0.filter(isRailAdd)
  if (rails.length > 1) return { ops: ops0, corrected: false }
  const ops = rails.length ? ops0.filter(o => !isRailAdd(o)) : ops0
  const r = screenGridOnly(ops, text, host, rails.length === 1)
  return r.corrected ? r : { ops: ops0, corrected: false }
}
function screenGridOnly(ops, text, host, rail) {
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
  // least disruptive: NEW charts that fit in the empty space are added there as planned (nothing re-tiled) — unless the
  // plan (widget.arrange) or the member's words (equal sizes) ask for re-tiling: that plan would otherwise mix adds with a
  // change to the EXISTING board and be refused ("Adding widgets and changing existing ones…", hotfix 2026-11-03)
  const retile = ops.some(o => o.action === 'widget.arrange') || EQUAL_SIZE_WORDS.test(String(text || ''))
  if (!existing.length && !retile && fitsEmpty(host, symbols.length)) return { ops, corrected: false }
  const fresh = !existing.length && wantsNew(text, symbols.length, charts.length)
  const layout = ops.find(o => o.action === 'widget.arrange')?.args?.pattern
  const target = ops.find(o => o.action === 'widget.arrange')?.target || 'board'
  return { ops: [{ ...chartGrid(symbols, [...tfs][0] || null, ['grid', 'columns', 'rows'].includes(layout) ? layout : null, fresh, rail), target }], corrected: true }
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
  if (fresh) return { kind: 'ops', ops: [chartGrid([a, b], tf, 'columns', charts.length > 0)], mode: 'apply' }
  return sidePlan([a, b], tf, charts, host, raw)
}

// ⛔ SIDE BY SIDE PRESERVES (OWNER RULING 2026-11-23): "For 'side by side,' preserve the existing chart and add the comparison chart
// beside it by default. Never silently replace an existing chart. If the request or layout makes the intended behavior
// ambiguous, clarify." (Before: one chart showing neither ticker was re-symbolled, two charts were both re-symbolled, three or
// more were re-symbolled on a card — the replace the ruling forbids.) Now, for the tickers asked side by side on a board that has
// charts, ONE reading for every path (this reader, a gridRequest "side by side", and the model's plan — sideBySideScreen):
//   a ticker a chart shows + room   → the others are ADDED beside it (chartGrid.set new_charts: the board's own grid writer —
//                                     every existing chart keeps its symbol, timeframe, link, indicators, panes and drawings;
//                                     the charts' area is re-tiled; one change, one Undo)
//   no room for them                → ASKED, nothing changed (replace instead, when a chart can take them; else Cancel)
//   replace / swap words too        → ASKED, nothing changed (add beside, or replace)
//   no chart shows any of them      → ASKED, nothing changed (the chart they go beside is unclear: add beside, or replace)
// The replace choice is the member's explicit pick (its label says "replacing", which the chart rail reads as replace words).
const symOf = (c) => String(c?.symbol || '').toUpperCase()
const plural = (xs) => (new Set(xs).size === 1 ? '' : 's')
const chartsWord = (charts, shown) => (shown.length ? `${andWords(shown)} chart${plural(shown)}` : `chart${charts.length === 1 ? '' : 's'}`)
/** Would a grid that ADDS these tickers beside every chart (chartGrid.set new_charts) fit the board? Unknown → true (its own check). */
export function gridAddFits(host, symbols, timeframe, layout) {
  try {
    const b = getTargetKind('board')?.list?.(host)?.[0]
    if (!b?.grid || !Array.isArray(b.raw)) return true
    return planChartGrid({ board: b.raw, charts: b.charts || new Map(), symbols, timeframe: timeframe || null, layout: layout || null, newCharts: true,
      cols: b.grid.cols, rows: b.grid.rows, minOf: b.minOf, maxWidgets: b.maxWidgets ?? 16, detached: b.detached || [] }).ok === true
  } catch { return true }
}
const sideLayout = (charts) => (charts.length === 1 ? 'columns' : null)
/** The tickers asked side by side, on a board with charts → ops | steps | ask | say (the ruling above). */
function sidePlan(syms, tf, charts, host, raw) {
  const showing = (s) => charts.filter(c => symOf(c) === s)
  const shown = syms.filter(s => showing(s).length)
  const missing = syms.filter(s => !showing(s).length)
  const swap = SIDE_REPLACE.test(raw)
  // the timeframe asked for them all ("…, both weekly") is set on the charts already showing them
  const tfOps = tf ? shown.map(s => showing(s)[0]).filter(c => c.tf !== tf).map(c => setTf(c.ref, tf)) : []
  // every ticker is already on a chart: nothing to add
  if (!missing.length && !swap) {
    if (tfOps.length) return { kind: 'ops', ops: tfOps, mode: 'apply' }
    return { kind: 'say', text: `${andWords(shown.map(s => `${s} is already on ${showing(s)[0].label}`))} — nothing to change.` }
  }
  // (the words said side by side: a line of charts — the grid's own writer makes it an even grid when a line can't hold them)
  const layout = 'columns'
  const room = missing.length > 0 && gridAddFits(host, missing, tf, layout)
  const add = missing.length ? [chartGrid(missing, tf, layout, true)] : null
  if (shown.length && room && !swap) {
    if (!tfOps.length) return { kind: 'ops', ops: add, mode: 'apply' }
    const first = showing(shown[0])[0]
    return { kind: 'steps', steps: [{ ops: tfOps, mode: 'apply' }, { ops: add, mode: 'apply', needs: { ref: first.ref, symbol: symOf(first) } }] }
  }
  return sideQuestion({ syms, shown, missing, charts, room, add, swap, replace: sideReplace(syms, tf, charts, host, room, layout) })
}
/** The member's explicit replace choice: the tickers not shown go on the other charts (reading order); else a reusing grid. */
function sideReplace(syms, tf, charts, host, room, layout = sideLayout(charts)) {
  const showing = (s) => charts.filter(c => symOf(c) === s)
  const keep = new Map(syms.filter(s => showing(s).length).map(s => [s, showing(s)[0]]))
  const kept = [...keep.values()]
  const free = charts.filter(c => !kept.some(k => k.ref === c.ref)).sort(readingOrder)
  const missing = syms.filter(s => !keep.has(s))
  if (missing.length && missing.length <= free.length) {
    const picks = missing.map((s, i) => [free[i], s])
    const touched = [...kept, ...picks.map(p => p[0])]
    if (linkedTogether(touched.map(c => c.ref), charts)) return null
    const ops = [...picks.map(([c, s]) => setSymbol(c.ref, s)), ...(tf ? touched.filter(c => c.tf !== tf).map(c => setTf(c.ref, tf)) : [])]
    return { ops, tickers: missing, replaced: picks.map(([c]) => symOf(c) || c.label) }
  }
  // fewer charts than tickers: the board's charts reused top-left first (a ticker a chart shows first, so it keeps it), the rest added
  if (missing.length && (room || gridAddFits(host, syms.slice(charts.length), tf, layout))) {
    const order = [...syms].sort((x, y) => (keep.has(y) ? 1 : 0) - (keep.has(x) ? 1 : 0))
    const reused = charts.slice().sort(readingOrder).slice(0, syms.length).filter(c => !syms.includes(symOf(c)))
    if (reused.length) return { ops: [chartGrid(order, tf, layout, false)], tickers: syms, replaced: reused.map(c => symOf(c) || c.label) }
  }
  // the ONE chart, no room beside it: the comparison ticker shown on it instead
  if (charts.length === 1 && missing.length === 1) return { ops: [setSymbol(charts[0].ref, missing[0])], tickers: missing, replaced: [symOf(charts[0]) || charts[0].label] }
  return null
}
const replacedWord = (r) => `the ${andWords([...new Set(r.replaced)])} chart${plural(r.replaced)}`
const replaceLabel = (r) => `Put ${andWords(r.tickers)} on your board, replacing ${replacedWord(r)}`
function sideQuestion({ syms, shown, missing, charts, room, add, swap, replace }) {
  const mine = chartsWord(charts, shown)
  const choices = []
  const options = {}
  if (room && add) { choices.push({ ref: 'grid:add', label: `Add ${andWords(missing)} beside your ${mine}` }); options.add = add }
  if (replace) { choices.push({ ref: 'grid:replace', label: replaceLabel(replace) }); options.replace = replace.ops }
  const instead = replace ? ` Replace ${replacedWord(replace)} instead?` : ' Close or shrink a widget to make room, then ask again.'
  const text = !room && missing.length ? `There isn't room beside your ${mine} for ${andWords(missing)} — a chart can't get smaller than it is allowed to.${instead} Nothing has changed yet.`
    : swap ? `Do you want ${andWords(missing.length ? missing : syms)} added beside your ${mine}${replace ? `, or put in place of ${replacedWord(replace)}` : ''}? Nothing has changed yet.`
      : `None of your charts shows ${andWords(syms)}. Add ${missing.length === 1 ? 'it' : 'them'} beside your ${mine}${replace ? `, or replace ${replacedWord(replace)}` : ''}? Nothing has changed yet.`
  return { kind: 'ask', text, choices, options }
}

// ── ⛔ the SAME ruling for any PLAN (the model's, NL-1's, routing v2's): side-by-side words + a plan that re-symbols an existing chart ──
// The words ask for a chart side by side with / next to / beside / alongside another (never "the one next to …", which NAMES a
// chart, nor "next to them", the ADD rail's own), with no replace word, and the plan gives an existing chart another ticker
// (chart.setSymbol, or a chartGrid.set that reuses it) that no position word in the request addresses → the plan BECOMES the add
// above when it is only that, the chart it goes beside is clear and there is room; otherwise it is ASKED (add beside, or the plan
// as planned — named as replacing), nothing changed. → null | { ops } | { ask }
const DEIXIS_WORDS = /\b(?:this|that)\s+(?:one|chart)\b|\b(?:it|this)\s*[.!?]?$/i
const SIDE_PLAN = new Set(['chart.setSymbol', 'chart.setTimeframe', 'widget.add', 'widget.addCharts', 'widget.arrange', 'chartGrid.set'])
export function sideBySideScreen(ops, text, host) {
  const t = String(text || '')
  if (!Array.isArray(ops) || !ops.length || !sideBySideWords(t) || isWorkspaceRequest(t)) return null
  let charts = []
  try { charts = host?.charts?.list?.() || [] } catch { charts = [] }
  if (!charts.length) return null
  const byRef = new Map(charts.map(c => [String(c.ref), c]))
  const aliases = new Set(ops.filter(o => o?.action === 'widget.add' && o.args?.as).map(o => String(o.args.as)))
  const addressed = (c) => { for (const m of t.matchAll(new RegExp(POS_RE.source, 'gi'))) if (matchPosition([c], normPos(m[1])).length) return true; return false }
  // what the plan would take off an existing chart
  const resym = ops.filter(o => o?.action === 'chart.setSymbol' && byRef.has(String(o.target)) && !aliases.has(String(o.target))
    && String(o.args?.symbol || '').trim().toUpperCase() !== symOf(byRef.get(String(o.target))))
  const grids = ops.filter(o => o?.action === 'chartGrid.set' && o.args?.new_charts !== true && !o.args?.replace)
  const ordered = charts.slice().sort(readingOrder)
  const gridReplaced = [...new Set(grids.flatMap(o => {
    const want = (o.args?.symbols || []).map(s => String(s || '').toUpperCase())
    return ordered.slice(0, want.length).filter(c => !want.includes(symOf(c))).map(symOf)
  }))]
  if (!resym.length && !gridReplaced.length) return null
  if (resym.length && !gridReplaced.length && resym.every(o => addressed(byRef.get(String(o.target))))) return null   // the words address it
  const onBoard = new Set(charts.map(symOf))
  const named = tickersIn(t)
  const planned = [...resym.map(o => String(o.args.symbol).trim().toUpperCase()), ...grids.flatMap(o => (o.args?.symbols || []).map(s => String(s || '').toUpperCase()))]
  const missing = [...new Set([...named, ...planned].filter(s => s && !onBoard.has(s)))]
  if (!missing.length) return null                                                  // nothing new to show: the rails decide
  const shown = named.filter(s => onBoard.has(s))
  let selected = null
  try { selected = host?.charts?.selected?.() || null } catch { selected = null }
  const deixis = DEIXIS_WORDS.test(t) && (byRef.has(String(selected)) || charts.length === 1)
  const anchorClear = shown.length > 0 || deixis
  // a timeframe the plan gives the chart it re-symbols (or a new one) is the new chart's; any other change → not only an add
  const tfs = new Set()
  let other = false
  for (const o of ops) {
    if (!SIDE_PLAN.has(o?.action)) { other = true; continue }
    if (o.action === 'chart.setTimeframe') {
      if (resym.some(r => String(r.target) === String(o.target)) || aliases.has(String(o.target))) tfs.add(o.args?.timeframe)
      else other = true
    }
    if (o.action === 'widget.add' && o.args?.type !== 'chart') other = true
  }
  if (tfs.size > 1) other = true
  const tf = tfs.size === 1 ? [...tfs][0] || null : null
  const layout = sideLayout(charts)
  const add = [chartGrid(missing, tf, layout, true)]
  const room = gridAddFits(host, missing, tf, layout)
  const swap = SIDE_REPLACE.test(t)
  if (room && anchorClear && !swap && !other) return { ops: add }
  const replaced = [...new Set([...resym.map(o => symOf(byRef.get(String(o.target)))), ...gridReplaced].filter(Boolean))]
  const replace = { ops, tickers: [...new Set(planned)], replaced: replaced.length ? replaced : ['existing'] }
  const q = sideQuestion({ syms: missing, shown, missing, charts, room, add: other ? null : add, swap, replace })
  if (other && room) {
    // the plan does more than show the tickers: the add choice says it adds the chart only
    q.choices.unshift({ ref: 'grid:add', label: `Add ${andWords(missing)} beside your ${chartsWord(charts, shown)} (the chart only)` })
    q.options.add = add
    q.text = `That would replace ${replacedWord(replace)}. Add ${andWords(missing)} beside ${shown.length || deixis ? 'it' : 'your charts'} instead (the chart only — then ask for the rest on it), or replace? Nothing has changed yet.`
  }
  return { ask: q }
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

// ── ⭐ PHASE 3: keep one chart, re-symbol the others ──
// "keep the NVDA chart but replace the others with aapl msft and amzn": the kept chart is named (symbol, position or
// order); the others, in reading order, take the tickers in the member's order — exactly as many tickers as other charts
// (fewer or more is said, never a guess). chart.setSymbol on each, ONE change and one Undo.
const KEEP_RE = /^(?:please\s+)?(?:keep|leave)\s+(.+?)(?:\s+as is|\s+alone)?\s*,?\s+(?:but|and)\s+(?:replace|swap|change|switch|set)\s+(?:the\s+|all\s+the\s+)?(?:others|other charts|other ones|rest(?: of them| of the charts)?)\s+(?:with|to|for)\s+(.+)$/i
function keepOthers(raw, charts, host) {
  if (charts.length < 2) return null
  const m = KEEP_RE.exec(raw.trim().replace(/[.!?]+$/, ''))
  if (!m) return null
  const keep = chartFromPhrase(m[1], charts, host)
  if (!keep) return { kind: 'say', text: `I can't tell which chart “${m[1]}” is — name it by its ticker or position. Nothing has changed.` }
  const others = charts.filter(c => c.ref !== keep).sort(readingOrder)
  const syms = gridTickers(m[2], host)
  const rest = m[2].replace(/[,;&]|\band\b/gi, ' ').split(/\s+/).filter(Boolean)
  if (!syms.length || rest.length !== syms.length) return null                    // not only tickers → the model
  if (syms.length !== others.length) {
    return { kind: 'say', text: `There ${others.length === 1 ? 'is 1 other chart' : `are ${others.length} other charts`} here, and you named ${syms.length} ticker${syms.length === 1 ? '' : 's'} — name one for each. Nothing has changed.` }
  }
  if (linkedTogether(others.map(c => c.ref), charts)) return { kind: 'say', text: LINKED }
  return { kind: 'ops', ops: others.map((c, i) => setSymbol(c.ref, syms[i])), mode: 'apply' }
}

// ── ⭐ PHASE 3: one timeframe across charts ──
// "make all my charts match the top left's timeframe", "sync the timeframes to the NVDA chart", "put everything on the
// weekly like the top left" → chart.setTimeframe on each OTHER chart, to the timeframe that chart shows now (read from the
// live board; one change, one Undo). "make these two charts use the same timeframe" names no winner: it is asked, with
// the charts' own timeframes, never picked.
const TF_SYNC = [
  /^(?:please\s+)?(?:make|set|put|switch|change|have)\s+(?:all\s+(?:of\s+)?)?(?:my\s+|the\s+)?(?:other\s+)?(?:charts?|ones|everything|them all|all of them|the rest|the others)\s+(?:to\s+)?(?:match|use|on|to|the same as)\s+(.+?)(?:'s|’s)?\s+(?:timeframe|time frame|tf)$/i,
  /^(?:please\s+)?(?:sync|match|line up|align)\s+(?:all\s+(?:of\s+)?)?(?:my\s+|the\s+)?(?:charts?'?|chart)?\s*(?:timeframes?|time frames?|tfs?)\s+(?:to|with)\s+(.+?)$/i,
]
const SAME_TF = /^(?:please\s+)?(?:make|set|put|have|give)\s+(.+?)\s+(?:use\s+|on\s+|to\s+|have\s+)?the same (?:timeframe|time frame|tf)$/i
function syncTimeframes(raw, charts, host) {
  if (charts.length < 2) return null
  const t = raw.trim().replace(/[.!?]+$/, '')
  for (const re of TF_SYNC) {
    const m = re.exec(t)
    if (!m) continue
    const from = chartFromPhrase(m[1].replace(/\s+(?:chart|one)$/i, '') + ' chart', charts, host) || chartFromPhrase(m[1], charts, host)
    if (!from) return { kind: 'say', text: `I can't tell which chart “${m[1]}” is — name it by its ticker or position. Nothing has changed.` }
    const tf = charts.find(c => c.ref === from)?.tf
    if (!tf) return null
    const others = charts.filter(c => c.ref !== from && c.tf !== tf)
    if (!others.length) return { kind: 'say', text: 'Every chart is already on that timeframe.' }
    return { kind: 'ops', ops: others.map(c => setTf(c.ref, tf)), mode: 'apply' }
  }
  const s = SAME_TF.exec(t)
  if (s) {
    const tfs = [...new Set(charts.map(c => c.tf).filter(Boolean))]
    if (tfs.length === 1) return { kind: 'say', text: 'They are already on the same timeframe.' }
    return { kind: 'say', text: `Which timeframe should they share — ${charts.map(c => `${c.label || c.symbol} is on ${tfName(c.tf)}`).join(', ')}? Say “make them all weekly”, or “match the top left chart's timeframe”. Nothing has changed.` }
  }
  return null
}
const tfName = (tf) => ({ D: 'Daily', W: 'Weekly', M: 'Monthly', 60: '1 hour', 1: '1 minute', 5: '5 minutes', 15: '15 minutes', 30: '30 minutes' }[tf] || tf)

export function multiChartPlan(text, { host } = {}) {
  const raw = String(text || '').trim()
  if (!raw || raw.length > 200) return null
  let charts = []
  try { charts = host?.charts?.list?.() || [] } catch { charts = [] }
  const lower = raw.toLowerCase()
  return copyLook(raw, charts, host) || syncTimeframes(raw, charts, host) || keepOthers(raw, charts, host) || sideBySide(raw, lower, charts, host) || positional(raw, charts) || gridRequest(raw, lower, charts, host)
}
