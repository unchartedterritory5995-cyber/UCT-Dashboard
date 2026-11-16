// ── ⛔ CHART RAIL (hotfix 2026-11-13, live: "Change my chart layout to a 2-by-2 grid, keeping SPY and NVDA" → asked →
// "Add AAPL and MSFT as the other two charts" → SPY became AAPL, NVDA became MSFT, still 2 panels) ──────────────────────
//
// A DETERMINISTIC check (code, never model instructions) on every PLANNED change, after planning and before anything is
// written or proposed (useAgent.execute, beside protectionRefusal). It reads what the plan would do to the charts already on
// screen — from the planner's own before/after states, per TARGET KIND (never per action name), so a new action on these
// kinds is covered without being listed here:
//
//   chart        a chart's symbol changes (and every chart linked to it in a colour group follows)        → 'symbol'
//   board        a chart widget is gone after the plan (widget.remove, a replacing grid, …); a chart the
//                grid reuses is given another ticker (chartGrid.set reuse)                                → 'remove' / 'symbol'
//   multiChart   a smaller grid drops filled cells; a group / saved grid refills every filled cell          → 'remove' / 'symbol'
//   layouts      another layout is opened: every chart on screen is replaced by that layout's                → 'switch'
//
// and refuses the WHOLE plan (nothing written, the reason said) when the member's words for this turn — the message, plus
// the request a pending question of the Agent's carried (useAgent railWordsRef) — say otherwise:
//
//   KEPT       a chart the member named as kept ("keeping SPY and NVDA", "leave the left one", "don't touch NVDA") is
//              never changed, removed or switched away in that turn — no exemption.
//   ADDITIVE   words that ask for MORE charts ("the other two", "new", "another", "extra", "as well"…) without a replace
//              word never change or remove an existing chart — unless the words address that chart by its position.
//   REMOVAL    a chart is never removed (the panel count never goes down) by a change applied at once unless the words ask
//              for it (remove / close / replace / only / fewer…); a proposal card that names the removal stays allowed.
//   COUNT      a grid shape asked for in words ("2-by-2", "3x3") never ends with fewer charts than it holds.
//
// Pure: reads the plan, the words and the live board through `host`; never writes.
import { tickersIn } from './multiChart'
import { matchPosition } from './fastPath'
import { ordinalChart } from './deixis'
import { excludedCharts, UNPLACED } from './spatialCheck'
import { widgetTabList } from '../pages/charts/widgetTabs'
import { sanitizeChartTabs } from '../pages/charts/chartTabs'

export const RAIL_MARK = 'chart-rail'
const up = (s) => String(s || '').trim().toUpperCase()

// ── what a plan does to the charts on screen, by target kind ─────────────────────────────────────────────────────────
const liveCharts = (host) => { try { return host?.charts?.list?.() || [] } catch { return [] } }
const linked = (g) => typeof g === 'string' && g && !g.startsWith('N')

const EFFECTS = {
  chart(p, host) {
    if (p.virtual || up(p.before?.symbol) === up(p.after?.symbol) || !p.after?.symbol) return []
    const all = liveCharts(host)
    const me = all.find(c => c.ref === p.ref) || p.snap || {}
    // a symbol change goes through the chart's link colour group: every chart in it follows
    const group = linked(me.group) ? all.filter(c => c.ref !== p.ref && c.group === me.group) : []
    // (a chart that follows through its link group is marked `linked`: one symbol change, not several)
    return [me, ...group].map((c, i) => ({ type: 'symbol', ref: c.ref, symbol: up(c.symbol || p.before.symbol), to: up(p.after.symbol), position: c.position || null, ...(i ? { linked: true } : {}) }))
  },
  board(p, host) {
    const out = []
    if (!Array.isArray(p.after?.board)) return out            // not a board state (a plan builder that could not build one)
    const info = p.snap?.charts || new Map()
    const all = liveCharts(host)
    const chartOf = (id) => { const c = info.get?.(String(id)); const ref = c?.ref ?? String(id); return { ref, symbol: up(c?.symbol), position: all.find(x => x.ref === ref)?.position || null } }
    const was = (p.before?.board || []).filter(w => w.type === 'chart')
    const gone = was.filter(w => !(p.after?.board || []).some(x => String(x.id) === String(w.id)))
    for (const w of gone) out.push({ type: 'remove', ...chartOf(w.id) })
    for (const r of p.after?.grid?.reuse || []) {
      const from = up(r.from?.symbol), to = up(r.symbol)
      if (to && from && to !== from) out.push({ type: 'symbol', ...chartOf(r.id), symbol: from, to })
    }
    return out
  },
  multiChart(p) {
    const d = p.after?.do
    if (!d) return []
    const cells = (p.before?.cells || []).filter(c => c.sym)
    const at = (c) => ({ ref: c.id, symbol: up(c.sym), position: null })
    if (d.op === 'layout') {
      const n = p.after.cellCount ?? (p.after.rows * p.after.cols)
      return (p.before?.cells || []).slice(n).filter(c => c.sym).map(c => ({ type: 'remove', ...at(c) }))
    }
    if (['pickGroup', 'stepGroup', 'refreshGroup', 'applySaved'].includes(d.op)) return cells.map(c => ({ type: 'symbol', ...at(c), to: null }))
    return []
  },
  layouts(p, host) {
    if (!p.after?.op?.open) return []
    return liveCharts(host).map(c => ({ type: 'switch', ref: c.ref, symbol: up(c.symbol), position: c.position || null }))
  },
}
export const RAIL_KINDS = Object.keys(EFFECTS)

/** Every effect a planned change has on the charts already on screen: [{ type, ref, symbol, to?, position, kind }]. */
export function chartEffects(plan, host) {
  const out = []
  for (const p of plan?.plans || []) {
    const f = EFFECTS[p.kind]
    if (!f) continue
    try { for (const e of f(p, host)) out.push({ ...e, kind: p.kind }) } catch { /* an unreadable plan has no effects to claim */ }
  }
  return out
}

/** How many charts the board holds once the plan has run (null when the plan does not change the board's charts). */
export function panelsAfter(plan, host) {
  const plans = plan?.plans || []
  const mc = plans.find(p => p.kind === 'multiChart' && p.after?.do?.op === 'layout')
  if (mc) return mc.after.cellCount ?? (mc.after.rows * mc.after.cols)
  const board = plans.find(p => p.kind === 'board')
  const created = plans.filter(p => p.virtual && p.kind === 'chart').length
  if (!board?.after?.grid && !created && !chartEffects(plan, host).some(e => e.type === 'remove')) return null
  const before = liveCharts(host).length
  const removed = chartEffects(plan, host).filter(e => e.type === 'remove').length
  const added = (board?.after?.grid?.add || []).filter(a => !a.type || a.type === 'chart').length
  return before - removed + added + created
}

// ── what the member's words say ────────────────────────────────────────────────────────────────────────────────────────
const POS = /\b(top[- ]left|top[- ]right|bottom[- ]left|bottom[- ]right|upper[- ]left|upper[- ]right|lower[- ]left|lower[- ]right|left|right|top|bottom|upper|lower)\b/gi
const normPos = (w) => w.toLowerCase().replace(/\s/, '-').replace('upper', 'top').replace('lower', 'bottom')
const KEEP_LEAD = /\b(?:keep|keeping|kept|leave|leaving|retain|retaining|preserve|preserving|hold on to|holding on to|(?:do not|don['’]?t|never) (?:change|touch|replace|remove|move|lose|drop)|without (?:changing|touching|replacing|removing|losing|dropping))\s+/gi
const KEEP_END = /(?=$|[.;!?]|,\s*(?:but|then|and then)\b|\s(?:but|then|while|so)\b|\sand (?:then |also )?(?:add|put|make|change|switch|replace|set|open|show|create)\b)/i
const STAY = /\b((?:[A-Z]{1,5}|\$[A-Za-z]{1,5})(?:\s*(?:,|and|&)\s*(?:[A-Z]{1,5}|\$[A-Za-z]{1,5}))*)\s+(?:stays?|remains?|should stay|stay(?:s)? put|in place)\b/g
const ALL_KEPT = /^(?:(?:all|both|every|each)\b|(?:my|the|these|those|current|existing)\s+(?:current\s+|existing\s+)?(?:charts?|ones|panels?|layout|board)\b|everything\b|them\b)/i

/** The charts the words name as KEPT: { refs: Set, symbols: Set, all: boolean }. */
export function keptCharts(words, host) {
  const t = String(words || '')
  const charts = liveCharts(host)
  const refs = new Set(), symbols = new Set()
  let all = false
  const phrases = []
  for (const m of t.matchAll(KEEP_LEAD)) {
    const rest = t.slice(m.index + m[0].length)
    const end = rest.search(KEEP_END)
    phrases.push((end < 0 ? rest : rest.slice(0, end)).slice(0, 100))
  }
  for (const m of t.matchAll(STAY)) phrases.push(m[1])
  for (const ph of phrases) {
    if (ALL_KEPT.test(ph.trim().replace(/^the\s+(?=(?:two|three|four)\b)/i, ''))) all = true
    for (const s of tickersIn(ph)) symbols.add(s)
    // a ticker typed in lowercase counts when a chart on screen shows it ("keep spy and nvda")
    for (const c of charts) if (c.symbol && new RegExp(`(^|[^A-Za-z])\\$?${String(c.symbol).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z])`, 'i').test(ph)) symbols.add(up(c.symbol))
    for (const pm of ph.matchAll(POS)) for (const c of matchPosition(charts, normPos(pm[1]))) refs.add(c.ref)
  }
  return { refs, symbols, all }
}

const ADDITIVE = /\b(?:new|another|more|additional|extra|as well|too|also|in addition|besides?|alongside|on top of (?:those|these|them|my)|next to (?:them|those|these|my (?:charts?|other)))\b/i
// ⛔ ADD NEVER REPLACES (hotfix 2026-11-13, AUDIT): an ADD verb asks for more charts — it never changes one already there,
// whatever position the words give (only replace words — replace / instead / swap out / change … to — permit that)
const ADD_VERB = /\b(?:add|adds|added|adding|include|includes|included|including)\b/gi
// an ADD whose object is CHARTS — tickers, or chart / panel / cell, in its own clause ("add AAPL and MSFT", "add two charts", "I want
// AAPL added") — never an indicator or a drawing ("…, then add rsi to all of them": a step's own change to the charts it made)
const CLAUSE_END = /[.;,!?]|\bthen\b|\band (?:make|put|set|change|switch|draw|turn|give)\b/i
export function addsCharts(words, known = []) {
  const t = String(words || '')
  const has = (clause) => tickersIn(clause).length > 0 || knownIn(clause, known).length > 0
  for (const m of t.matchAll(ADD_VERB)) {
    const after = t.slice(m.index + m[0].length)
    const end = after.search(CLAUSE_END)
    // the object comes BEFORE only a passive "added" / "included" ("I want AAPL added"); otherwise it follows the verb
    const before = /^(?:added|included)$/i.test(m[0]) ? t.slice(Math.max(0, m.index - 40), m.index).split(CLAUSE_END).pop().split(/\band\b(?=[^]*$)/i).pop() : ''
    const clause = `${before} ${end < 0 ? after : after.slice(0, end)}`
    if (/\b(?:charts?|panels?|cells?)\b/i.test(clause) || has(clause)) return true
  }
  return false
}
// ⛔ hotfix 11-13 (AUDIT probe 33 e1): a ticker typed in LOWERCASE counts too — any word that is a symbol this plan resolved
// (the ticker search already answered for it: a plan's new symbols, the charts' own symbols)
export const knownIn = (text, known) => {
  const words = new Set((String(text || '').toLowerCase().match(/\$?[a-z][a-z0-9.]{0,9}/g) || []).map(x => x.replace(/^\$/, '')))
  return [...new Set((known || []).map(k => String(k || '').toLowerCase()).filter(k => k && words.has(k)))]
}
const ADD_REST = /\badd(?:ing)?\b[^.;!?]*\b(?:other|others|remaining|rest)\b|\b(?:as|for|in|into) the (?:other|remaining|empty|new)\b/i
const REPLACE = /\b(?:replace|replacing|replaced|instead|swap(?:ping)? out|swap (?:the |my )?(?:tickers?|symbols?|charts?)\b|swap \$?[A-Za-z]{1,5} (?:and|with) |get rid of|switch (?:out|over)|change (?:the |my |that |this |both |all )?(?:\w+ )?(?:chart|charts|one|ones|symbol|ticker)s?\b(?!\s+layout)|(?:change|switch|turn|flip) (?:the |my |that |this )?(?:\w+ )?(?:chart |one )?(?:to|into) \$?[A-Za-z]{1,5}\b)/i
const REMOVAL = /\b(?:remove|removing|delete|deleting|close|closing|get rid|replace|replacing|clear|clean(?:ing)? up|tidy|drop|dropping|only|just|fewer|less|reduce|down to|instead|swap(?:ping)? out|single|one chart)\b/i
// ⛔ CHANGE RELATION + SEE words — the ONE place (AUDIT probe 52a / 53, STRUCTURAL: each word set is read by its POSITION
// against the tickers, never as a phrase list; tests generate their forms from these exports):
//   CHANGE_TAKE  "<word> X"      → X is the chart being changed ("replace SPY", "instead of SPY", "in place of SPY")
//   CHANGE_TO    "X <word> Y"    → X changes to Y ("SPY for AAPL", "SPY into AAPL", "SPY to AAPL", "SPY switched to AAPL")
//   CHANGE_BACK  "Y … <word> X"  → X changes to Y ("AAPL where SPY is", "AAPL over SPY", "AAPL rather than SPY")
//   CHANGE_OFF   "X <word>"      → X is taken off ("SPY off and AAPL on") — only AFTER the ticker: "<word> X" is the exclusion
//                cue "hands off NVDA", never a change
//   SEE_VERBS    a verb that asks to SEE the tickers it governs ("show SPY and AAPL")
export const CHANGE_TAKE = ['replace', 'replaces', 'replaced', 'replacing', 'swap out', 'swapping out', 'swapped out', 'get rid of', 'getting rid of', 'switch out', 'switching out', 'instead of', 'in place of', 'rather than']
export const CHANGE_TO = ['for', 'into', 'to']
export const CHANGE_BACK = ['where', 'instead of', 'in place of', 'rather than', 'over']
export const CHANGE_OFF = ['off']
export const SEE_VERBS = ['show', 'showing', 'open', 'opening', 'pull up', 'pulling up', 'bring up', 'bringing up', 'see', 'view', 'viewing', 'display', 'displaying']
const altOf = (ws) => ws.map(x => x.replace(/\s+/g, String.raw`\s+`)).join('|')
const SEE_VERB = new RegExp(String.raw`\b(?:${altOf(SEE_VERBS)})\b`, 'gi')
const SEE_FILLER = new Set(['and', '&', 'plus', 'also', 'both', 'the', 'me', 'my', 'us', 'a', 'an', 'up', 'of', 'chart', 'charts', 'too', 'as', 'well'])
const SHAPE = /\b([1-4])\s*(?:x|×|by|-by-|\s+by\s+)\s*([1-4])\b/i
const QUAD = /\bquad\b/i

/** Is the chart addressed by its position in the words ("the left one", "top right")? */
const named = (words, e, host) => {
  if (!e.position) return false
  for (const pm of String(words || '').matchAll(POS)) if (matchPosition([{ position: e.position }], normPos(pm[1])).length) return true
  return false
}
export const isAdditive = (words, known = []) => (ADDITIVE.test(words) || ADD_REST.test(words) || addsCharts(words, known)) && !REPLACE.test(words)
// ⛔ MULTI (hotfix 11-13, AUDIT probe 33 e1/e2 — STRUCTURAL, not vocabulary): a change that gives TWO OR MORE existing charts new
// tickers in one turn needs the words to say so outright: a replace word (replace / instead / swap out / change|switch <chart> to
// …), every one of those charts addressed by its position ("NVDA on the left and AMD on the right"), or the WHOLE grid stated
// with no add — a shape or a count of charts and its tickers ("make a 2x2 of SPY QQQ IWM DIA", GRID-REUSE). Anything else
// ("put these up there", "add aapl and msft") is refused, whatever reader or model planned it.
const CHART_COUNT = /\b(?:two|three|four|five|six|seven|eight|nine|[2-9])\s+(?:new\s+)?(?:(?:daily|weekly|monthly|hourly|intraday|equal(?:ly[- ]sized)?|equal-sized|same-sized)\s+)?charts?\b/i
export function multiResymbolAllowed(words, resym, known, host) {
  const w = String(words || '')
  if (REPLACE.test(w)) return true
  if (resym.every(e => named(w, e, host))) return true
  return gridStated(w, known)
}
/** The words state a WHOLE GRID of named tickers (a shape or a count of charts, and their tickers or the set they come from). */
export function gridStated(words, known = []) {
  const w = String(words || '')
  const named2 = new Set([...tickersIn(w), ...knownIn(w, known).map(x => x.toUpperCase())]).size
  return !addsCharts(w, known) && (requestedPanels(w) != null || CHART_COUNT.test(w) || LAYOUT_WORDS.test(w)) && (named2 >= 2 || RESULT_SET.test(w))
}
// the tickers of a set the conversation already holds (the screen / list it showed): "those tickers", "these stocks"
const RESULT_SET = /\b(?:those|these|them|the same)\s+(?:tickers?|symbols?|stocks?|names|ones)\b/i
const LAYOUT_WORDS = /\b(?:side[\s-]by[\s-]side|next to each other|beside each other|stacked|on top of each other|in a (?:row|column|grid))\b/i
// "just add …" / "only add …" limit what is ADDED — never a permission to remove
const removalWords = (w) => String(w || '').replace(/\b(?:just|only)\s+(?=(?:add|adds|added|adding|put|include|includes|included|including)\b)/gi, ' ')
export function requestedPanels(words) {
  const t = String(words || '').replace(/(\d)\s*-\s*by\s*-\s*(\d)/gi, '$1x$2')
  const m = SHAPE.exec(t)
  if (m) return Number(m[1]) * Number(m[2])
  return QUAD.test(t) ? 4 : null
}

const nameOf = (e) => (e.symbol ? `the ${e.symbol} chart` : 'a chart')
const listOf = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`)
const said = (e) => (e.type === 'symbol' ? `${nameOf(e)} would ${e.to ? `become ${e.to}` : 'be refilled'}` : e.type === 'remove' ? `${nameOf(e)} would be removed` : `${nameOf(e)} would be replaced by another layout`)

/**
 * The refusal sentence for a plan the rail stops, or null. `words`: this turn's words (the message, and the request a
 * pending question carried). `mode`: 'apply' | 'propose' | 'approved' — a removal shown on a card first is allowed.
 */
// ⛔ UNIQUE IDENTIFICATION (H14 hotfix 2026-11-14, AUDIT probes 47/48): an EXISTING chart is given another ticker only when the
// words identify THAT chart — its own ticker ("the SPY chart", "replace SPY …"), its position ("the left one"), a deixis on the
// sole / selected / conversation chart ("this chart", "it"), the class noun on a board of exactly one chart ("the chart"), the
// member's own pick from the choices this rail asked, or a REPLACE word (the existing REPLACE set) on the sole or selected chart.
// "show / open / pull up / bring up X" alone never re-symbols: several charts → asked with the charts as choices; one → refused.
// (a grid whose shape or count the words state re-symbols the cells it reuses — multiResymbolAllowed — as before)
const DEIXIS = /\b(?:this|that|the current|the selected|current|selected)\s+(?:chart|one|panel|graph)\b|\b(?:it|here)\b/i
const ONE_CHART_NOUN = /\b(?:the|my|that|this)\s+(?:chart|graph|panel)\b(?!s)/i
const escRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const symbolSaid = (w, sym) => !!sym && (tickersIn(w).includes(up(sym))
  || new RegExp(`(^|[^A-Za-z])\\$?${escRe(sym)}(?:['’]s)?\\s+(?:chart|one|panel|graph)\\b`, 'i').test(w))
// ⛔ D23 (owner, AUDIT T2): the SOLE chart is identified by being the only one — counted over EVERY chart in scope: the
// charts the executor lists (Multi Chart cells included) AND the board's chart widgets with their hidden chart tabs / widget
// tabs (a chart in a tab that is not showing is still a chart this board holds). Only charts count, never other widgets.
export function chartsInScope(host) {
  const listed = liveCharts(host)
  let onBoard = 0
  try {
    // (the board kind's own source — what the executor writes to — then the layout)
    let raw = null
    try { raw = host?.widgets?.snapshot?.()?.raw || null } catch { raw = null }
    const widgets = (Array.isArray(raw) && raw.length ? raw : null) || host?.layout?.()?.widgets || []
    for (const w of widgets) {
      const tabs = (() => { try { return widgetTabList(w) } catch { return [] } })()
      const extraChartTabs = tabs.slice(1).filter(t => t?.type === 'chart').length
      if (w?.type === 'chart') {
        // a chart TAB on its own link colour can show another ticker: another chart in scope (a timeframe tab of the same
        // ticker is the same chart)
        // (AUDIT conditions 1/2: no colour, another colour, or a same-colour tab showing ANOTHER ticker now — another chart)
        const shown = up(listed.find(c => String(c.ref) === String(w.id))?.symbol)
        const own = (() => { try { return sanitizeChartTabs(w.opts || {}).tabs.filter(t => !t.color || t.color !== (w.color || 'A') || (t.symbol && shown && up(t.symbol) !== shown)).length } catch { return 0 } })()
        onBoard += 1 + own
      } else if (tabs[0]?.type === 'chart') onBoard += 1
      onBoard += extraChartTabs
    }
  } catch { onBoard = 0 }
  return { listed, count: Math.max(listed.length, onBoard) }
}
/** ⛔ D23 (AUDIT T2 6): is a chart pick from the rail's choices STALE — its chart gone, or showing another ticker than when asked? */
// ⛔ probe 50b1: a ticker is SET ASIDE only by a negation that GOVERNS it — the negator immediately before it ("not NVDA",
// "except NVDA", "leave NVDA …", "don't touch NVDA", "keep NVDA"), never an earlier clause about another ticker
const NEGATOR = String.raw`(?:not|except(?:\s+for)?|other\s+than|excluding|without|leave|leaving|keep|keeping|(?:do\s+not|don['’]?t|never)\s+(?:touch|change|move|replace|remove)|never)`
export function tickerSetAside(words, ticker) {
  // (a ticker the words CHANGE is never one they set aside: "AAPL instead of SPY" changes SPY)
  if (tickerChanged(words, ticker, namedTickers(words))) return false
  const t = String(ticker || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  if (!t) return false
  return new RegExp(String.raw`\b${NEGATOR}\s+(?:(?:the|my|your|on|to|for|of)\s+)?\$?${t}\b`, 'i').test(String(words || ''))
}
// ⛔ SEEN vs CHANGED (AUDIT probe 52a, STRUCTURAL — never a phrase list): a ticker already on the board is one the words ask to
// SEE only when a see verb GOVERNS it — the verb, then nothing but tickers and coordination up to it ("show SPY and AAPL",
// "pull up SPY, AAPL") — and it is never the OBJECT OF A CHANGE: the ticker on one side of a relation word whose other side is
// another named ticker ("SPY for AAPL", "AAPL where SPY", "SPY into / to AAPL", "AAPL in place of / instead of SPY"), a ticker taken
// "off", or a ticker a replace verb takes ("replace SPY", "swap out SPY"). Everything else is not asked to see.
// (is this ticker the OBJECT OF A CHANGE? — the CHANGE_* sets above, by position; every per-ticker pattern ESCAPED: "BRK.B" never
// makes "." a wildcard; no lookbehind: the iOS 16 floor. Read by the final-board rule, tickerSetAside and spatialCheck excludedCharts)
const reEsc = (s) => String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
// (tight: the other ticker is ALREADY on the board — it is the new symbol only as the relation's DIRECT complement: "QQQ instead
//  of SPY", "SPY to QQQ", "replace SPY with QQQ"; "make QQQ weekly rather than SPY" changes no ticker)
export function tickerChanged(words, ticker, others = [], { tight = false } = {}) {
  const w = String(words || '')
  const t = reEsc(up(ticker))
  if (!t) return false
  const T = String.raw`\$?${t}(?![A-Za-z0-9])`
  const det = String.raw`(?:(?:the|my|that|this|a|an)\s+)?`
  // (a change needs a NEW symbol: with no other ticker named, "rather than the NVDA one" / "X off" is about a setting — "log on
  //  this one rather than the NVDA one" excludes NVDA's chart, it changes no ticker)
  if (!others.some(o => up(o) && up(o) !== up(ticker))) return false
  if (!tight && new RegExp(String.raw`\b(?:${altOf(CHANGE_TAKE)})\s+${det}${T}`, 'i').test(w)) return true
  if (!tight && new RegExp(String.raw`(?:^|[^A-Za-z0-9])${T}(?:['’]s)?\s+(?:(?:chart|one|panel|graph)\s+)?(?:${altOf(CHANGE_OFF)})\b`, 'i').test(w)) return true
  for (const o of others) {
    if (up(o) === up(ticker)) continue
    const O = String.raw`\$?${reEsc(up(o))}(?![A-Za-z0-9])`
    if (tight) {
      const N = String.raw`(?:\s+(?:chart|one|panel|graph))?`
      if (new RegExp(String.raw`(?:^|[^A-Za-z0-9])${O}\s+(?:${altOf(CHANGE_BACK)})\s+${det}${T}`, 'i').test(w)) return true
      if (new RegExp(String.raw`(?:^|[^A-Za-z0-9])${T}${N}\s+(?:${altOf(CHANGE_TO)})\s+${det}${O}`, 'i').test(w)) return true
      if (new RegExp(String.raw`\b(?:${altOf(CHANGE_TAKE)})\s+${det}${T}${N}\s+(?:with|for)\s+${det}${O}`, 'i').test(w)) return true
      continue
    }
    // the ticker, then a relation word, then the other ticker ("SPY for AAPL", "SPY into AAPL", "SPY to AAPL"; a participle
    // between them states the change outright: "SPY switched to AAPL", "SPY swapped for AAPL")
    if (new RegExp(String.raw`(?:^|[^A-Za-z0-9])${T}(?:['’]s)?\s+(?:(?:chart|one|panel|graph)\s+)?(?:[a-z]+(?:ed|en)\s+)?(?:${altOf(CHANGE_TO)})\s+${det}${O}`, 'i').test(w)) return true
    // the other ticker, then a relation word that points back at this one ("AAPL where SPY is", "AAPL in place of SPY")
    // (AUDIT N2: for the back words CHANGE_TAKE also holds — instead of / in place of / rather than — the "<word> X" line above
    //  already decides; for "where" / "over" this line is the ONLY reader. It matters when X is said again under a stay cue —
    //  "AAPL over SPY and SPY is fine" — which excludes X, and the elimination step would then license the OTHER chart: the
    //  swap test's N2 block is red without it)
    if (new RegExp(String.raw`(?:^|[^A-Za-z0-9])${O}\b(?:[^.;!?]|\.(?=\S)){0,40}?\b(?:${altOf(CHANGE_BACK)})\s+${det}${T}`, 'i').test(w)) return true
  }
  return false
}

/** The other tickers a sentence names, for tickerChanged: its all-caps symbols, plus any board symbol said in any casing. */
export function namedTickers(words, symbols = []) {
  const w = String(words || '')
  // (an all-caps symbol, or any "$"-prefixed one in any casing)
  const caps = [...w.matchAll(/(?:^|[^A-Za-z0-9$])(\$[A-Za-z][A-Za-z0-9.]{0,9}|[A-Z][A-Z0-9.]{0,9})(?![A-Za-z0-9])/g)].map(x => up(x[1].replace(/^\$/, '').replace(/\.$/, '')))
  const lower = w.toLowerCase()
  const said = (symbols || []).map(up).filter(Boolean).filter(x => new RegExp(String.raw`(?:^|[^a-z0-9])\$?${reEsc(x.toLowerCase())}(?![a-z0-9])`).test(lower))
  return [...new Set([...caps, ...said])]
}
export function tickerAskedToSee(words, ticker, others = []) {
  const w = String(words || '')
  const want = up(ticker)
  if (!want || tickerChanged(w, want, others)) return false
  for (const m of w.matchAll(SEE_VERB)) {
    const rest = w.slice(m.index + m[0].length).split(/[.;!?](?=\s|$)/)[0]     // (a dotted ticker is no sentence end)
    for (const tok of rest.match(/[^\s,]+/g) || []) {
      const t = up(tok.replace(/^\$/, ''))
      if (t === want) return true
      if (SEE_FILLER.has(tok.toLowerCase()) || others.some(o => up(o) === t)) continue
      break
    }
  }
  return false
}
export function chartPickStale(pick, host) {
  if (!pick?.chartRef) return false
  let now = null
  try { now = host?.charts?.read?.(pick.chartRef) || null } catch { now = null }
  return !now || (pick.fp !== undefined && up(now.symbol) !== (pick.fp || ''))
}
/** How many OBJECTS in scope show this symbol (every chart following one link colour is one object). */
export function sameSymbolObjects(host, symbol) {
  const want = up(symbol)
  return new Set(liveCharts(host).filter(c => up(c.symbol) === want).map(c => (linked(c.group) ? `g:${c.group}` : `c:${c.ref}`))).size
}
/** How the words identify this existing chart (for a re-symbol), or null: 'pick' | 'name' | 'position' | 'deixis' | 'class' | 'replace'. */
export function identifiesChart(w, e, host, { selected = null, subject = null, picked = null, sole = false, made = null } = {}) {
  // (AUDIT condition 6: "remove AAPL" never re-symbols the AAPL chart — removal words are no licence to change one)
  if (REMOVE_WORDS.test(w) && !REPLACE.test(w)) return null
  if (!e.symbol) return 'empty'                                    // an EMPTY chart filled replaces nothing
  if (made && made.has(e.ref)) return 'made'                       // a chart THIS request created (its own new chart)
  if (picked && picked.has(`chart:${e.ref}`)) return 'pick'
  // ⛔ AUDIT 53 (H14): a ticker NAMES a chart only when exactly ONE object in scope shows it (a link group is one object) — two
  // independent SPY charts are not identified by "SPY": asked
  if (symbolSaid(w, e.symbol) && sameSymbolObjects(host, e.symbol) <= 1) return 'name'
  if (named(w, e, host)) return 'position'
  try { if (ordinalChart(w, liveCharts(host))?.ref === e.ref) return 'ordinal' } catch { /* no ordinal */ }
  if (DEIXIS.test(w) && (sole || e.ref === selected || e.ref === subject)) return 'deixis'
  if (sole && ONE_CHART_NOUN.test(w)) return 'class'
  // the member's CLICK identifies the chart ("open the third one" with the left chart clicked: that chart)
  if (e.ref === selected) return 'selection'
  // (the words leave exactly this chart: every other one is excluded — "switch to AAPL, but not NVDA")
  try {
    const all = liveCharts(host)
    if (all.length > 1) {
      const ex = new Set(excludedCharts(w, all, selected))
      // (a ticker the words CHANGE — with THIS plan's new symbol among the tickers they name, in any casing — is the target, never
      //  an exclusion that leaves another chart: "aapl instead of spy" never licenses the QQQ chart)
      const shown = new Set(all.map(c => up(c.symbol)))
      const others = [...namedTickers(w).filter(t => !shown.has(t)), ...knownIn(w, [e.to]).map(up)]
      for (const c of all) if (c.symbol && ex.has(c.ref) && tickerChanged(w, c.symbol, others)) ex.delete(c.ref)
      const left = all.filter(c => !ex.has(c.ref))
      if (!ex.has(UNPLACED) && left.length === 1 && left[0].ref === e.ref) return 'elimination'
    }
  } catch { /* no exclusion read */ }
  if (sole) return 'sole'                                          // ⛔ D23: the only chart in scope is identified by being it
  return null
}
const REMOVE_WORDS = /\b(?:remove|removing|delete|deleting|drop|dropping|get rid of|take (?:off|out|away))\b/i
const CHART_WORD = /\b(?:charts?|panels?|graphs?|widgets?)\b/i
export function chartRailRefusal(plan, { words = '', host = null, mode = 'apply', subject = null, picked = null, made = null, lists = null, out = null } = {}) {
  if (!plan?.ok) return null
  const w = String(words || '')
  const effects = chartEffects(plan, host)
  const known = [...new Set(effects.flatMap(e => [e.to, e.symbol]).filter(Boolean))]
  // KEPT: no exemption
  if (effects.length) {
    const kept = keptCharts(w, host)
    const hit = effects.filter(e => kept.all || kept.refs.has(e.ref) || (e.symbol && kept.symbols.has(e.symbol)))
    if (hit.length) {
      const keptNames = [...new Set(hit.map(e => e.symbol).filter(Boolean))]
      return `I can’t change a chart you asked to keep — you asked to keep ${keptNames.length ? listOf(keptNames) : 'those charts'}, and this would have changed them (${listOf([...new Set(hit.map(said))])}). Nothing was changed. Tell me which chart to replace, or ask to add the new charts beside them.`
    }
    // ADDITIVE: exempt only a chart the words address by its position
    if (isAdditive(w, known)) {
      // a chart addressed by position is exempt for "too / as well" — never for an ADD verb (add = new charts)
      const bad = effects.filter(e => addsCharts(w, known) || !named(w, e, host))
      if (bad.length) return `I didn’t change anything: you asked for more charts, but this would have changed the ones you have (${listOf([...new Set(bad.map(said))])}). I only replace a chart when you say which one — ask to add them as new charts, or say which chart to replace.`
    }
    // MULTI: two or more existing charts re-symbolled in one turn only on explicit words (structural)
    const resym = [...new Map(effects.filter(e => e.type === 'symbol' && !e.linked && e.to).map(e => [e.ref, e])).values()]
    const want0 = requestedPanels(w)
    const short = want0 && (panelsAfter(plan, host) ?? want0) < want0
    if (resym.length >= 2 && !short && mode !== 'approved' && !multiResymbolAllowed(w, resym, known, host)) {
      return `I didn’t change anything: this would have changed ${resym.length} of your charts at once (${listOf(resym.map(said))}), and you didn’t say to replace them. Say which charts to replace — for example “replace both charts with …” or “change the left to … and the right to …” — or ask to add them as new charts.`
    }
    // ⛔ UNIQUE IDENTIFICATION (H14): one existing chart re-symbolled — only the chart the words identify
    if (resym.length === 1 && mode !== 'approved' && !gridStated(w, known)) {
      const e = resym[0]
      const { listed: charts, count: inScope } = chartsInScope(host)
      let selected = null
      try { selected = host?.charts?.selected?.() || null } catch { selected = null }
      // (a link group is ONE object: every chart following one link colour is the sole chart when they are the whole board)
      // (a link group is ONE object: every chart in scope following one link colour is the sole chart)
      const groups = new Set(charts.map(c => (linked(c.group) ? `g:${c.group}` : `c:${c.ref}`)))
      const sole = inScope === 1 || (groups.size === 1 && inScope === charts.length)
      if (!identifiesChart(w, e, host, { selected, subject, picked, sole, made })) {
        if (inScope > 1) {
          if (out) out.ask = { kind: 'chart', from: e.ref, to: e.to, candidates: charts.map(c => ({ ref: c.ref, symbol: up(c.symbol) || '', label: c.label || (c.symbol ? `the ${up(c.symbol)} chart` : 'a chart') })) }
          return `Which chart should change to ${e.to}? You didn’t say which one, so nothing was changed — pick one, or say “add ${e.to}” for a new chart beside them.`
        }
        return `I didn’t change anything: this would turn ${nameOf(e)} into ${e.to}, and you didn’t say to change that chart. Say “switch this chart to ${e.to}” to replace it, or “add ${e.to}” for a new chart beside it.`
      }
    }
    // ⛔ D23 (AUDIT T2 4): every NEW ticker the words name ends up on the board — "open AAPL and MSFT" never ends showing MSFT alone
    {
      const before = new Set(liveCharts(host).map(c => up(c.symbol)).filter(Boolean))
      // (a ticker the words set aside — "but not NVDA", "leave TSLA", "except AMD" — is never one they ask to see)
      const setAside = (t) => tickerSetAside(w, t)
      const asked = [...new Set(tickersIn(w))].filter(t => !before.has(t) && !setAside(t))
      // (every ticker the words ask to SEE — a shown one counts as on the board only while it STAYS there: #1275 reuse.
      //  ⛔ AUDIT probe 52a: a SHOWN ticker counts only when a see verb governs it and it is never the object of a change)
      const spoken = [...new Set(tickersIn(w))]
      const named = spoken.filter(t => !setAside(t) && (!before.has(t) || tickerAskedToSee(w, t, spoken)))
      // (a stated grid is checked by its own COUNT rule)
      const gridded = (plan.plans || []).some(p => p.kind === 'board' || p.kind === 'multiChart') || gridStated(w, known) || requestedPanels(w) != null
      // (on the SOLE chart: a multi-step request on several charts lands its tickers one step at a time)
      // a single chart this plan gives two or more of the named tickers (re-symbolled twice: only the last would remain)
      const stacked = (plan.plans || []).filter(p => p.kind === 'chart' && !p.virtual).find(p => new Set((p.items || []).filter(i => i.op?.action === 'chart.setSymbol').map(i => up(i.op?.args?.symbol)).filter(x => asked.includes(x))).size >= 2)
      if (!gridded && stacked) {
        const got = [...new Set((stacked.items || []).filter(i => i.op?.action === 'chart.setSymbol').map(i => up(i.op?.args?.symbol)))]
        return `I didn’t change anything: this would put ${listOf(got)} on ONE chart one after the other, and only ${got[got.length - 1]} would stay. Say “add ${listOf(asked)}” for new charts, or which chart each one replaces.`
      }
      if (!gridded && named.length >= 2 && chartsInScope(host).count === 1 && effects.some(e => e.type === 'symbol' && e.to)) {
        const final = new Map(liveCharts(host).map(c => [c.ref, up(c.symbol)]))
        for (const e of effects) if (e.type === 'symbol' && e.to) final.set(e.ref, up(e.to))
        const shown = new Set([...final.values(), ...(plan.plans || []).filter(p => p.virtual && p.after?.symbol).map(p => up(p.after.symbol)),
          ...(plan.plans || []).flatMap(p => (p.after?.grid?.add || []).map(a => up(a.symbol)))].filter(Boolean))
        const missing = named.filter(t => !shown.has(t))
        if (missing.length) return `I didn’t change anything: you asked for ${listOf(named)}, but this would leave ${listOf(missing)} off your board. Say “add ${listOf(asked)}” for new charts, or which chart each one replaces.`
      }
    }
    // REMOVAL: never at once without the words for it
    const removed = effects.filter(e => e.type === 'remove')
    if (removed.length && mode !== 'approved') {
      let selected = null
      try { selected = host?.charts?.selected?.() || null } catch { selected = null }
      const bare = removed.filter(e => e.symbol && symbolSaid(w, e.symbol) && !CHART_WORD.test(w) && !named(w, e, host) && !DEIXIS.test(w) && e.ref !== selected && !(picked && picked.has(`chart:${e.ref}`)))
      if (bare.length) {
        const e = bare[0]
        const inList = (lists || []).filter(l => (l.symbols || []).includes(up(e.symbol)))
        if (inList.length) return `Do you mean ${up(e.symbol)} in your ${listOf(inList.map(l => `“${l.name}”`))} list, or the ${up(e.symbol)} chart? Nothing was changed — say “remove ${up(e.symbol)} from ${inList[0].name}”, or “close the ${up(e.symbol)} chart”.`
        return `I didn’t change anything: “${up(e.symbol)}” alone doesn’t say to close a chart. Say “close the ${up(e.symbol)} chart” if that is what you want.`
      }
    }
    if (removed.length && mode === 'apply' && !REMOVAL.test(removalWords(w))) {
      return `I didn’t change anything: this would have removed ${listOf(removed.map(nameOf))}, and you didn’t ask to remove a chart. Say which chart to remove or replace.`
    }
  }
  // COUNT: a grid shape asked for in words never ends with fewer charts
  const want = requestedPanels(w)
  const have = want ? panelsAfter(plan, host) : null
  if (want && have != null && have < want) {
    return `I didn’t change anything: you asked for a ${want}-chart grid, but this would leave ${have} chart${have === 1 ? '' : 's'}. Tell me the ticker for each chart and I’ll set up all ${want}.`
  }
  return null
}
