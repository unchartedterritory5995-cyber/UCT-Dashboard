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
import { readCopyIntent } from './copyIntent'
import { ordinalChart, thingWord, chartishWord, relativeChart, relationMatch } from './deixis'
import { CLASS as STATE_CLASS } from './stateRail'
import { excludedCharts, UNPLACED, LOWER_STOP } from './spatialCheck'
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
// (the ONE position vocabulary — a corner, a side, an edge, the middle; "far" / "-most" / "-hand" say the same place: probe 60b
//  "the leftmost chart" is the left one — normPos reduces every form to the host's own position word)
const POS = /\b((?:top|bottom|upper|lower)[- ](?:left|right)(?:most|[- ]hand)?|(?:far[- ])?(?:left|right)(?:most|[- ]hand)?|(?:far[- ])?(?:top|bottom|upper|lower)(?:most)?|middle|cent(?:er|re))\b(?![-‐][A-Za-z])/gi
const normPos = (w) => w.toLowerCase().replace(/^far[- ]/, '').replace(/most$/, '').replace(/[- ]hand$/, '').replace(/^cent(?:er|re)$/, 'middle')
  .replace(/\s/, '-').replace('upper', 'top').replace('lower', 'bottom')
const KEEP_LEAD = /\b(?:keep|keeping|kept|leave|leaving|retain|retaining|preserve|preserving|hold on to|holding on to|(?:do not|don['’]?t|never) (?:change|touch|replace|remove|move|lose|drop)|without (?:changing|touching|replacing|removing|losing|dropping)|(?:plus|with|alongside|besides|and|along with) (?:my|the|our) (?:existing|current|old|original))\s+/gi
// (D31: a kept phrase also ends where a REMOVAL clause starts — "don't remove SPY, close the IWM chart", "leave the left chart, remove
//  the right one": the chart that clause names is no kept chart)
const KEEP_END = /(?=$|[.;!?]|,\s*(?:but|then|and then)\b|,\s*(?:and\s+)?(?:close|remove|delete|drop|clear|get\s+rid\s+of|take)\b|\s(?:but|then|while|so)\b|\sand (?:then |also )?(?:add|put|make|change|switch|replace|set|open|show|create)\b)/i
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
//   SEE_VERBS    a verb that asks to SEE the tickers it governs ("show SPY and AAPL", "give me SPY and AAPL", "put up SPY, AAPL")
//   TAKE_OFF + PUT_ON  "<off> X … <on> Y" (either order, one request) → X changes to Y ("take off SPY, put on AAPL", "put AAPL
//                on and take off SPY"); "<off> X" ALONE is a removal, never a change (H14 follow-up 3)
//   (CHANGE_TAKE "no more X" with another ticker named is a change, never an ADD: "no more SPY, AAPL" — H14 follow-up 4)
export const CHANGE_TAKE = ['replace', 'replaces', 'replaced', 'replacing', 'swap out', 'swapping out', 'swapped out', 'get rid of', 'getting rid of', 'switch out', 'switching out', 'instead of', 'in place of', 'rather than', 'no more']
export const CHANGE_TO = ['for', 'into', 'to']
export const CHANGE_BACK = ['where', 'instead of', 'in place of', 'rather than', 'over']
export const CHANGE_OFF = ['off']
export const SEE_VERBS = ['show', 'showing', 'open', 'opening', 'pull up', 'pulling up', 'bring up', 'bringing up', 'see', 'view', 'viewing', 'display', 'displaying',
  'give me', 'giving me', 'give us', 'let me see', 'let me look at', 'look at', 'looking at', 'put up', 'putting up']
export const TAKE_OFF = ['take off', 'taking off', 'take down', 'taking down']
export const PUT_ON = ['put on', 'putting on', 'put up', 'putting up']
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
// ⛔ H14 follow-up 4: a CHANGE_TAKE phrase that takes a ticker the words change ("no more SPY, AAPL") is no ADDITIVE word —
// read with those phrases out ("no more" is not "more"); with no other ticker named ("no more SPY" alone) the words are as said
const takenOut = (words, known = []) => {
  const w = String(words || '')
  // (a sentence-ending "." is no part of a lowercase ticker: "no more spy. aapl now")
  const named = [...new Set([...tickersIn(w), ...knownIn(w.replace(/\.(?=\s|$)/g, ' '), known).map(up)])]
  if (named.length < 2) return w
  return w.replace(new RegExp(String.raw`\b(?:${altOf(CHANGE_TAKE)})\s+(?:(?:the|my|that|this|a|an)\s+)?\$?([A-Za-z][A-Za-z0-9.]{0,9})`, 'gi'),
    (m, x) => { const t = up(x.replace(/\.$/, '')); return named.includes(t) && tickerChanged(w, t, named) ? ' ' : m })
}
export const isAdditive = (words, known = []) => (ADDITIVE.test(takenOut(words, known)) || ADD_REST.test(words) || addsCharts(words, known)) && !REPLACE.test(words)
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
  if (others.some(o => up(o) !== up(ticker) && offOnSwap(w, ticker, o))) return true
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

/** ⛔ H14 follow-up 3: "<TAKE_OFF> X … <PUT_ON> Y" (or "put Y on"), either order, in one request — X's chart changes to Y. */
export function offOnSwap(words, ticker, to) {
  const t = reEsc(up(ticker)), o = reEsc(up(to))
  if (!t || !o || t === o) return false
  const det = String.raw`(?:(?:the|my|that|this|a|an)\s+)?`
  const N = String.raw`(?:(?:['’]s)?\s+(?:chart|one|panel|graph))?`
  const OFF = String.raw`\b(?:${altOf(TAKE_OFF)})\s+${det}\$?${t}(?![A-Za-z0-9])${N}`
  const O = String.raw`${det}\$?${o}(?![A-Za-z0-9])`
  const ON = [String.raw`\b(?:${altOf(PUT_ON)})\s+${O}`,
    ...PUT_ON.map(p => { const [v, ...rest] = p.split(/\s+/); return String.raw`\b${reEsc(v)}\s+${O}\s+${rest.map(reEsc).join(String.raw`\s+`)}\b` })].join('|')
  return new RegExp(String.raw`${OFF}[^]*?(?:${ON})|(?:${ON})[^]*?${OFF}`, 'i').test(String(words || ''))
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
// ⛔ AUDIT RULING (H14 follow-up 1, made STRICT 11-16): a see verb that GOVERNS X wins over any change relation on X in the
// request ("AAPL where SPY and show me SPY and AAPL", "show SPY for AAPL": SPY is asked to see — a plan dropping it is refused)
// (a token typed in lowercase that is a common word is never a ticker: a see filler is coordination ("show me a chart" never
//  reads a board "A" chart); any other common word — LOWER_STOP — ENDS the governed list ("show AMD on the SPY chart": "on")
export function tickerAskedToSee(words, ticker, others = []) {
  const w = String(words || '')
  const want = up(ticker)
  if (!want) return false
  for (const m of w.matchAll(SEE_VERB)) {
    const rest = w.slice(m.index + m[0].length).split(/[.;!?](?=\s|$)/)[0]     // (a dotted ticker is no sentence end)
    for (const tok of rest.match(/[^\s,]+/g) || []) {
      const t = up(tok.replace(/^\$/, ''))
      const typedLower = tok !== tok.toUpperCase()
      if (typedLower && SEE_FILLER.has(tok.toLowerCase())) continue
      if (typedLower && LOWER_STOP.test(tok)) break
      if (t === want) return true
      if (SEE_FILLER.has(tok.toLowerCase()) || others.some(o => up(o) === t)) continue
      break
    }
  }
  return false
}
/** The tickers a request names for the final-board rules: its all-caps / "$" tickers, plus a symbol of `vocab` (the board's own
 *  symbols, this plan's) typed in any casing — never a common word (LOWER_STOP), never a one-letter word. */
export function spokenTickers(words, vocab = []) {
  const w = String(words || '')
  const lower = [...new Set((vocab || []).map(up).filter(s => s.length >= 2 && !LOWER_STOP.test(s)))]
    .filter(s => new RegExp(String.raw`(?:^|[^A-Za-z0-9])\$?${reEsc(s)}(?![A-Za-z0-9])`, 'i').test(w))
  return [...new Set([...tickersIn(w), ...lower])]
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
  // (H14 follow-up 3: "take off SPY, put on AAPL" is a change of THIS chart's ticker — offOnSwap — never a removal word)
  if (REMOVE_WORDS.test(w) && !REPLACE.test(w) && !(e.symbol && e.to && offOnSwap(w, e.symbol, e.to))) return null
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
// (every TAKE_OFF phrase is a removal word too: "take down SPY" / "taking off SPY" alone never re-symbols — H14 follow-up 3)
const REMOVE_WORDS = new RegExp(String.raw`\b(?:remove|removing|delete|deleting|drop|dropping|get rid of|take (?:off|out|away)|${altOf(TAKE_OFF)})\b`, 'i')
const CHART_WORD = /\b(?:charts?|panels?|graphs?|widgets?)\b/i
// ⛔ REMOVAL TARGET (AUDIT held-out probe 59, 2026-11-16 — pre-existing): "close the SPY chart" on SPY · QQQ · IWM with a plan
// closing the QQQ chart was APPLIED — unique identification read re-symbols only; a removal's TARGET was never checked against the
// words. A removal whose words NAME a chart — its ticker, its position / ordinal, a deixis on the selected / conversation chart, the
// member's pick — closes ONLY the chart(s) those words identify: the SAME reader as a re-symbol (identifiesChart on asRemoval words),
// less every chart spatialCheck excludedCharts sets aside. A ticker on two or more independent charts (a link group is one object:
// naming a linked pair names every chart in it) names them all only in the plural ("both SPY charts"); in the singular, unless a
// position / deixis narrows it, it is asked. Words that name no chart: as before. (a grid the words state: its own COUNT rule)
const NAMES_CHART = new Set(['pick', 'name', 'position', 'ordinal', 'deixis'])
// (identifiesChart refuses every REMOVE_WORDS sentence — AUDIT condition 6, no re-symbol licence; for a removal's TARGET the
//  same reader runs with those verbs read as the one removal verb it does not gate, "close")
const REMOVE_WORDS_ALL = new RegExp(REMOVE_WORDS.source, 'gi')
const asRemoval = (w) => String(w || '').replace(REMOVE_WORDS_ALL, 'close')
// (the REMOVAL gate also reads "take off / take down <chart>" and "take <the SPY chart> off": the target is checked above)
const REMOVAL_TAKE = /\btake (?:off|down|away|out)\b|\btake (?:[^\s.;!?]+ ){0,4}?(?:chart|one|panel|graph)s? (?:off|down|away|out)\b/i
/** The REMOVAL gate: do the words ask to remove a chart at all? A removal word, a "take … off / down" of a chart, or a pronoun taken
 *  off the BOARD / layout / screen (probe 64a-7 control) — unless an appositive says the pronoun is a THING (probe 66a-2: "take it
 *  off the board (the trendline)" never asks to remove a chart). */
export const removalAskedFor = (w) => REMOVAL.test(removalWords(w)) || REMOVAL_TAKE.test(w)
  || removalPronouns(w).some(p => p.from === 'chart' && pronounAntecedent(p.appos || '')?.type !== 'thing')
// (a removal may name SEVERAL positions — "close the middle and right charts": each position word of the ONE vocabulary, POS,
//  read against the chart's own position word, as `named` does)
const positionSaid = (w, e) => named(w, e)
// ⛔ FAIL CLOSED (AUDIT probe 60b: "remove the leftmost chart" with a plan closing the RIGHT chart was applied — the position word was
// unknown, so no target was read and the removal fell through as untargeted): words that ask to remove ONE SPECIFIC chart — a
// singular chart noun under a determiner, with or without a qualifier ("the … chart", "that one", "this chart", "my … chart") — and
// resolve to NO chart never close one: asked. Only a whole-board or set removal ("close all my charts", "clear the board", "close
// everything except X", "close the charts") proceeds without a named target. Never depends on the position vocabulary.
const SPECIFIC_CHART = /\b(?:the|that|this|my|your|our)\s+(?:[^\s.,;:!?]+\s+){0,3}?(?:chart|one|panel|graph|widget)\b(?!s)/i
const SET_REMOVAL = /\b(?:all|every|everything|each|both|whole|entire|rest|others|remaining|except|excluding|other\s+than|apart\s+from|but\s+not)\b|\b(?:clear|close|wipe|empty|reset|clean(?:\s+up)?)\s+(?:out\s+)?(?:the|my)\s+(?:whole\s+|entire\s+)?(?:board|layout|screen)\b/i
const QUALIFIED_SET = /\b(?:both|all|every|each)\s+(?:of\s+)?(?:(?:the|my|these|those|your)\s+)?((?:[a-z][\w-]*\s+){1,2}?)charts?\b/i
// (NP_FILLER without its ticker-shaped catch-all: a qualifier word that is a determiner / position / ordinal / timeframe)
let DET_FILLER_RE = null
const DET_FILLER = () => (DET_FILLER_RE ||= new RegExp(NP_FILLER.source.replace(String.raw`|\$?[a-z]{1,5})$`, ')$')))
const POS_ONE = new RegExp(String.raw`^(?:${POS.source})$`, 'i')
const SET_FILLER = /^(?:open|current|other|remaining|existing|two|three|four|five|six|of)$/i
const BACK_REF = /\b(?:the|that)\s+(?:chart|one|graph|panel)\s+(?:(?:that|which)\s+)?(?:I|you|we)\b/i
const SEVERAL = /\b(?:charts|ones|panels|graphs|widgets|and)\b|[&,]/i
const pluralOf = (sym) => new RegExp(String.raw`\b(?:both|all|every|each)\b[^.;!?]*?\$?${escRe(sym)}(?![A-Za-z0-9])|(?:^|[^A-Za-z0-9])\$?${escRe(sym)}\s+(?:charts|ones|panels|graphs)\b`, 'i')
// ⛔ PRONOUN OBJECT (AUDIT held-out probe 61a, 2026-11-16 — LIVE): board SPY · QQQ · IWM, nothing selected, no conversation chart,
// "close it" with a model plan closing QQQ was APPLIED — "it" is no chart noun, so SPECIFIC_CHART never failed closed. A bare object
// PRONOUN of a removal verb ("close it", "remove that", "delete this", "get rid of them", "close that one", "take it off") resolves
// as a deixis does, in this order: (1) the SELECTED chart; (2) else the conversation's chart (`subject`, as the back-reference);
// (3) else 2+ chart OBJECTS on the board (a link group is one) → ASKED, never applied; (4) else the sole chart object. "them" /
// "those" name the set the selection and the conversation chart make; with neither → asked. A plan closing any other chart is
// refused (removalTargetRefusal's `bad`). Only the OBJECT of a removal verb counts: "make it weekly and close the SPY chart" never
// reads "it" as a removal target (every other bare "it" is left out of the target read).
export const REMOVAL_PRONOUNS = ['it', 'that', 'this', 'them', 'those', 'that one', 'this one']
const PRONOUN_OBJ = String.raw`(?:(?:that|this)\s+one|it|that|this|them|those)`
const PRONOUN_VERB = String.raw`(?:remove|removing|delete|deleting|close|closing|drop|dropping|clear|get(?:ting)?\s+rid\s+of|tak(?:e|ing)\s+(?:off|down|away|out))`
// ⛔ AUDIT probe 62 (held-out, 2026-11-16): the pronoun is a removal OBJECT only when its clause ENDS there (PRONOUN_TAIL) — on the
// verb form AND the split "take <it> off" form: a pronoun (or its particle) followed by to / of / a / an / by / into ("take it down
// to weekly", "take this down a timeframe", "clear it of drawings") or "from the chart" CONTINUES into something else — no chart
// removal (`cont`: a plan closing a chart is refused unless the words name one).
const PRONOUN_TAIL = String.raw`(?:\s*(?:$|[.,;:!?(—–])|\s+-\s|\s+(?:and|then|but|please|pls|now|too|also|as\s+well|for\s+me|right\s+now)\b)`
const PRONOUN_PART = String.raw`\s+(?:off|down|away|out)`
const PRONOUN_END = String.raw`(?=${PRONOUN_TAIL}|${PRONOUN_PART}${PRONOUN_TAIL})`
const FROM_CHART = String.raw`\s+from\s+(?:the|my|this|that)\s+(?:chart|graph)\b`
const PRONOUN_NEXT = String.raw`(?=\s+(?:to|of|a|an|by|into)\b|${FROM_CHART})`
const PRONOUN_SRC = String.raw`\b${PRONOUN_VERB}\s+(${PRONOUN_OBJ})${PRONOUN_END}|\btak(?:e|ing)\s+(${PRONOUN_OBJ})${PRONOUN_PART}(?=${PRONOUN_TAIL})`
const PRONOUN_CONT_SRC = String.raw`\b${PRONOUN_VERB}\s+(${PRONOUN_OBJ})(?:${PRONOUN_PART})?${PRONOUN_NEXT}|\btak(?:e|ing)\s+(${PRONOUN_OBJ})${PRONOUN_PART}${PRONOUN_NEXT}`
const PRONOUN_AT = new RegExp(String.raw`^\S+(?:\s+\S+)*?\s+(?=${PRONOUN_OBJ}\b)`, 'i')
// ⛔ AUDIT probe 64a-7 (CONTAINER): "remove / take / drop / delete <pronoun> from / out of / off <container>" — the pronoun is an ITEM
// of that container. A THING container (a watchlist, a list, a note, an alert, a drawing board… — the same thing vocabularies)
// makes it no chart (`from: 'thing'`); the chart CONTAINER — the board / layout / screen (SET_REMOVAL's own words) — makes it a
// chart, removed from the board (`from: 'chart'`). (from the CHART itself: `cont`, above — a thing taken off a chart.)
const CONTAINER_NP = String.raw`(?!(?:to|of|a|an|by|into)\b)((?:(?:the|my|your|our|this|that)\s+)?[a-z][\w'-]*(?:\s+[a-z][\w'-]*){0,2})`
const PRONOUN_FROM_SRCS = [
  String.raw`\b${PRONOUN_VERB}\s+(${PRONOUN_OBJ})(?:${PRONOUN_PART})?\s+(?:from|out\s+of|off(?:\s+of)?)\s+${CONTAINER_NP}`,
  String.raw`\btak(?:e|ing)\s+(${PRONOUN_OBJ})\s+(?:off(?:\s+of)?|out\s+of|out|away\s+from|down\s+from)\s+${CONTAINER_NP}`,
]
const CHART_CONTAINER = /^(?:boards?|layouts?|screens?)$/
/** The type of a container noun phrase ("my tech watchlist", "the board", "my drawing board"): 'chart' | 'thing' | null. */
function containerType(np) {
  const ws = String(np || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
  for (let i = ws.length - 1; i >= 0; i--) {
    if (CHART_CONTAINER.test(ws[i])) return ws[i - 1] === 'drawing' ? { type: 'thing', word: `drawing ${ws[i]}` } : { type: 'chart', word: ws[i] }
    // (out of a CHART — "remove it from the right one", "take it off the SPY chart" — the pronoun is a thing ON that chart, as `cont`)
    if (chartishWord(ws[i])) return { type: 'thing', word: null, onChart: true }
    if (thingWord(ws[i]) || antecedentClass().some(re => re.test(ws[i]))) return { type: 'thing', word: ws[i] }
  }
  return null
}
// ⛔ AUDIT probe 64a-1 (APPOSITIVE): a noun phrase right AFTER the pronoun clause says what the pronoun is, exactly as one before it
// does — ", the RSI I mean" / " — the RSI" / ", I mean the RSI" / " (the RSI)"; typed by the same reader (pronounAntecedent)
const APPOS = /^(?:\s+(?:off|down|away|out))?\s*(?:,|—|–|\(|\s-\s)\s*(?:(?:i\s+mean|i\.e\.?|namely|meaning)\s*,?\s*)?((?:the|my|that|this|your)\s+[^,.;:!?()—–]{1,40}?)\s*(?:,?\s*i\s+mean)?\s*(?:\)|$|[.,;:!?—–])/i
/** The bare pronoun objects of removal verbs in the words: [{ phrase, plural, index, length, verbAt, cont, from?, container?, appos? }]
 *  (the pronoun's own span; `verbAt` where its verb starts; `cont`: the words go on past it — no removal object; `from`: the type of
 *  the container it is taken out of; `appos`: the noun phrase said right after it). */
export function removalPronouns(words) {
  const w = String(words || '')
  const out = []
  const at = (m) => m.index + (PRONOUN_AT.exec(m[0])?.[0].length ?? 0)
  for (const [src, cont] of [[PRONOUN_SRC, false], [PRONOUN_CONT_SRC, true]]) {
    for (const m of w.matchAll(new RegExp(src, 'gi'))) {
      const phrase = m[1] || m[2]
      const index = at(m)
      const appos = cont ? null : (APPOS.exec(w.slice(index + phrase.length))?.[1] || null)
      out.push({ phrase, plural: /^(?:them|those)$/i.test(phrase), index, length: phrase.length, verbAt: m.index, cont, appos })
    }
  }
  for (const src of PRONOUN_FROM_SRCS) {
    for (const m of w.matchAll(new RegExp(src, 'gi'))) {
      const index = at(m)
      const c = containerType(m[2])
      if (!c) continue
      // (from the CHART itself is `cont`, above, and stays; "out of <container>" read as `cont` "out" + "of" is this container instead)
      const same = out.findIndex(o => o.index === index)
      if (same >= 0) { if (!out[same].cont || c.onChart) continue; out.splice(same, 1) }
      // ⛔ AUDIT probe 66a: an appositive after the container ("take it off the board (the trendline)", "remove it from the board,
      // the RSI I mean") says what the pronoun is — it OUTRANKS the container (removalTargets types `appos` first)
      const appos = APPOS.exec(w.slice(m.index + m[0].length))?.[1] || null
      out.push({ phrase: m[1], plural: /^(?:them|those)$/i.test(m[1]), index, length: m[1].length, verbAt: m.index, cont: false, from: c.type, container: c.word, appos })
    }
  }
  return out.sort((a, b) => a.index - b.index)
}
// ⛔ REFERENT TYPE (AUDIT probe 62 + owner directive 2026-11-16: "destructive references such as 'close it', 'take it off', 'delete it'
// resolve to the correct OBJECT TYPE using conversational context; if the target is ambiguous, ask instead of acting"). A destroying
// pronoun refers to an OBJECT OF A TYPE — a chart, or a thing on one (an indicator, a drawing, an alert, a note, a pane, a list…):
//   (1) the WORDS: the nearest noun before its verb ("add an RSI, then delete it" → the RSI; "the SPY chart — close it" → a chart). A
//       chart word that only says WHERE a thing went ("put an RSI on the SPY chart, then delete it") is a place, not the antecedent.
//   (2) else the CONVERSATION: the one object the previous applied turn made or changed (stateRail turnStartOf `previous` — typed
//       ids: chart:… / ind:… / draw:… / list:…), the same referent the state rail licenses a destroy right after by.
// A plan destroying an object of ANOTHER type than the referent's is refused; a referent the words and the conversation leave
// ambiguous (a thing just made AND a clicked chart) is asked. Never a verb list: the noun sets are the Agent's own — deixis thingWord
// (PLACED chart-surface nouns, ONE_IS_A_THING, the live indicator catalog's ids), chartishWord (CHARTISH), and stateRail CLASS.
let ANTECEDENT_CLASS = null
const antecedentClass = () => (ANTECEDENT_CLASS ||= [STATE_CLASS.indicator, STATE_CLASS.drawing, STATE_CLASS.watchlist].map(re => new RegExp(String.raw`^(?:${re.source})$`, 'i')))
const PLACE_PREP = /^(?:on|onto|to|into|in|from|for)$/
const NP_FILLER = /^(?:the|my|your|our|this|that|these|those|a|an|left|right|top|bottom|upper|lower|middle|first|second|third|last|other|daily|weekly|monthly|hourly|\$?[a-z]{1,5})$/
/** The type of the thing the words name nearest before `at` (a pronoun's verb): { type: 'chart' } | { type: 'thing', word } | null.
 *  `isSymbol(word)`: a ticker word (a chart on the board, or a ticker said). */
export function pronounAntecedent(before, isSymbol = () => false) {
  const words = String(before || '').toLowerCase().split(/[^a-z0-9%$]+/).map(x => x.replace(/^\$/, '')).filter(Boolean)
  for (let i = words.length - 1; i >= 0; i--) {
    const x = words[i]
    if (chartishWord(x) || isSymbol(x)) {
      // (a chart word under a place preposition — "on the SPY chart", "to my left chart" — is where something went: read on)
      let k = i - 1
      while (k >= 0 && k >= i - 4 && NP_FILLER.test(words[k]) && !PLACE_PREP.test(words[k])) k--
      if (k >= 0 && PLACE_PREP.test(words[k])) { i = k; continue }
      return { type: 'chart' }
    }
    if (thingWord(x) || antecedentClass().some(re => re.test(x))) return { type: 'thing', word: x }
  }
  return null
}
const REMOVAL_VERB_ANY = new RegExp(String.raw`\b${PRONOUN_VERB}\b|\btak(?:e|ing)\s+(?:\S+\s+){1,4}?(?:off|down|away|out)\b`, 'gi')
const removalVerbCount = (w) => (String(w || '').match(REMOVAL_VERB_ANY) || []).length
const typeOfId = (id) => (String(id || '').startsWith('chart:') ? 'chart' : id ? 'thing' : null)
/** The referent of the destroying pronouns in `words`, typed: { kind: 'none' } (no destroying pronoun) | { kind: 'cont' } (every
 *  one goes on past itself: no destroy) | { kind: 'chart' } | { kind: 'thing', word?, id? } | { kind: 'conflict', id } |
 *  { kind: 'open' } (nothing in the words or the conversation types it). Shared by both rails. */
export function pronounReferent(words, { isSymbol = () => false, previous = null, chartPointed = false } = {}) {
  const prons = removalPronouns(words).filter(p => !p.cont)
  if (!prons.length) return { kind: removalPronouns(words).length ? 'cont' : 'none' }
  const p = prons[0]
  const ap = p.appos ? pronounAntecedent(p.appos, isSymbol) : null
  if (ap) return ap.type === 'chart' ? { kind: 'chart' } : { kind: 'thing', word: ap.word }
  if (p.from) return p.from === 'chart' ? { kind: 'chart' } : p.container ? { kind: 'thing', word: p.container } : { kind: 'thing' }
  const a = (p.appos && pronounAntecedent(p.appos, isSymbol)) || pronounAntecedent(String(words || '').slice(0, p.verbAt), isSymbol)
  if (a) return a.type === 'chart' ? { kind: 'chart' } : { kind: 'thing', word: a.word }
  const t = typeOfId(previous)
  if (t === 'thing') return chartPointed ? { kind: 'conflict', id: previous } : { kind: 'thing', id: previous }
  if (t === 'chart') return { kind: 'chart', id: previous }
  return { kind: 'open' }
}
/** What a removal's pronoun object names: { refs: Set } — or { ask: true } when nothing resolves it. */
function resolvePronoun(pr, all, { selected = null, subject = null } = {}) {
  const key = (c) => (linked(c.group) ? `g:${c.group}` : `c:${c.ref}`)
  // (a chart in a link group names its whole group: one object)
  const groupOf = (ref) => { const c = ref != null && all.find(x => x.ref === ref); return c ? all.filter(x => key(x) === key(c)).map(x => x.ref) : [] }
  const sel = groupOf(selected), sub = groupOf(subject)
  if (pr.plural) {
    const set = [...sel, ...sub]
    return set.length ? { refs: new Set(set) } : { ask: true }
  }
  if (sel.length) return { refs: new Set(sel) }
  if (sub.length) return { refs: new Set(sub) }
  if (new Set(all.map(key)).size === 1) return { refs: new Set(all.map(c => c.ref)) }
  return { ask: true }
}
// ⛔ REMOVAL TARGET TYPE (AUDIT H14 · D31 oracle masterGaps, 2026-11-16 — live wrong-target): the rules below read the OBJECT of each
// removal verb — never a new vocabulary: the verbs are PRONOUN_VERB (+ the split "take <X> off"), the object is typed by the ONE
// reader the pronoun path uses (pronounAntecedent: chartishWord / thingWord / stateRail CLASS), a chart named by symbolSaid / named.
//   (1) TYPE: every removal object the words hold is a THING ("delete the trendline", "remove the RSI from the SPY chart" — a chart
//       after from / on / off is the PLACE, cut before typing) → no chart is closed.
//   (2) NEGATED: "don't close SPY" / "never remove the left chart" — the object of a negated removal verb is set aside.
//   (3) RELATION: "the chart next to / right of / left of <anchor>" — the anchor is never the target (deixis relationMatch /
//       relativeChart; the target is the relation's hit when it has one).
//   (4) the words' own back-reference "the last chart I opened" is the conversation's chart, never an ordinal.
const OBJ_STOP = String.raw`(?=\s+(?:from|off|on|onto|in|into|out\s+of|to|of|at|for|with|next|beside|alongside|near|above|below|under|over|left|right|except|but|and|then|please|now|too)\b|\s*[.,;:!?(—–]|$)`
const REMOVAL_OBJECTS = [
  // (a pronoun is skipped only when it IS the whole object — "close it", "take that off" — never "that horizontal line")
  new RegExp(String.raw`\b${PRONOUN_VERB}\s+(?!(?:${PRONOUN_OBJ})(?:\s+(?:off|down|away|out))?${OBJ_STOP})((?:[^\s.,;:!?(—–]+\s*?){1,6}?)${OBJ_STOP}`, 'gi'),
  new RegExp(String.raw`\btak(?:e|ing)\s+(?!(?:${PRONOUN_OBJ})\s+(?:off|out|away|down)\b)((?:[^\s.,;:!?]+\s+){1,5}?)(?:off|out|away|down)\b`, 'gi'),
]
/** The removal verbs' objects in the words, typed: [{ np, type: 'chart' | 'thing' | null }] (pronoun objects are the pronoun path's). */
export function removalObjects(words, isSymbol = () => false) {
  const w = String(words || '')
  const out = []
  for (const re of REMOVAL_OBJECTS) for (const m of w.matchAll(new RegExp(re.source, re.flags))) {
    const np = String(m[1] || '').trim()
    if (!np || NEG_LEAD.test(w.slice(Math.max(0, m.index - 12), m.index))) continue
    out.push({ np, type: pronounAntecedent(np, isSymbol)?.type || null })
  }
  return out
}
const NEG_LEAD = /\b(?:do\s+not|don['’]?t|dont|never|not)\s+$/i
// (2) the object of a NEGATED removal verb: "don't close SPY", "never remove the left chart", "do not drop the QQQ one"
const NEG_REMOVAL = new RegExp(String.raw`\b(?:do\s+not|don['’]?t|dont|never|not)\s+${PRONOUN_VERB}\s+([^.;:!?,]{1,60})`, 'gi')
function negatedRemovalCharts(w, all, host) {
  const out = new Set()
  for (const m of String(w || '').matchAll(NEG_REMOVAL)) {
    const np = m[1].replace(/\s+(?:and|but|then)\b[\s\S]*$/i, '')
    for (const c of all) if (symbolSaid(np, c.symbol) || named(np, { ref: c.ref, symbol: up(c.symbol), position: c.position || null }, host)) out.add(c.ref)
  }
  return out
}
// (4) "the last chart I opened" / "the newest one we added": the conversation's chart (made / changed by an earlier turn)
const LAST_MADE = /\b(?:the\s+)?(?:last|latest|newest|most\s+recent)\s+(?:chart|one|graph|panel)\s+(?:(?:that|which)\s+)?(?:I|you|we)\s+(?:just\s+)?(?:opened|added|made|created|pulled\s+up|put\s+up|brought\s+up)\b/i
// (3) the relation's anchor and target: { anchors: Set, hits: Set } — null when the words relate nothing
// (the relation words of deixis RELATIVE, with a NAMED anchor after them — "next to the QQQ chart", "left of SPY": deixis reads only
//  the click as an anchor, relationMatch)
const REL_NAMED = /\b(?:(?:right|just|directly|immediately|exactly)\s+)?(?:above|over|below|under|underneath|beneath|(?:to\s+the\s+|on\s+the\s+)?(?:left|right)\s+of|next\s+(?:door\s+)?to|beside|alongside|adjacent\s+to|near|nearest(?:\s+to)?|closest\s+to)\s+([^.,;:!?]{1,40})/i
function relationOf(w, all, selected, host) {
  let m = null
  try { m = relationMatch(w) } catch { m = null }
  if (m) {
    // the click is the anchor: the relation's hit is the target (deixis relativeChart)
    let rel = null
    try { rel = relativeChart(w, all, selected) } catch { rel = null }
    const anchors = new Set(selected != null ? [selected] : [])
    return { anchors, hits: new Set((rel?.hits || []).map(c => c.ref).filter(r => !anchors.has(r))), said: String(m[0] || '').trim() }
  }
  const n = REL_NAMED.exec(String(w || ''))
  if (!n) return null
  const anchors = new Set()
  for (const c of all) if (symbolSaid(n[1], c.symbol) || named(n[1], { ref: c.ref, symbol: up(c.symbol), position: c.position || null }, host)) anchors.add(c.ref)
  if (!anchors.size) return null
  return { anchors, hits: new Set(), said: n[0].trim() }
}
export function removalTargets(w, host, { selected = null, subject = null, picked = null, previous = null, previousLabel = null } = {}) {
  const all = liveCharts(host)
  const ids = new Set()
  // (the SOLE chart in scope — a link group is one object — is named by the class noun: "close the chart", as for a re-symbol)
  //  (counted over the chart WIDGETS a removal can close: closing one closes its chart tabs with it, so a tab is no other target)
  const groups = new Set(all.map(c => (linked(c.group) ? `g:${c.group}` : `c:${c.ref}`)))
  const sole = groups.size === 1
  // (probe 61a: each pronoun object is resolved in its own order, below; it — and every other bare "it" — is out of the deixis read)
  const prons = removalPronouns(w)
  let wr = String(w || '')
  for (const p of [...prons].sort((a, b) => b.index - a.index)) wr = `${wr.slice(0, p.index)} ${wr.slice(p.index + p.length)}`
  wr = wr.replace(/\bit\b/gi, ' ')
  // (4) "the last chart I opened" is no ordinal: read as the conversation's chart, below
  const lastMade = LAST_MADE.test(wr)
  if (lastMade) wr = wr.replace(LAST_MADE, ' the chart ')
  // (3) the relation's anchor is named only as the anchor: out of the named read
  const relation = relationOf(w, all, selected, host)
  if (relation?.said) wr = wr.replace(relation.said, ' ')
  // (probe 62: "remove it from the chart" — the chart there is where the thing comes off, never the chart named for closing)
  if (prons.some(p => p.cont)) wr = wr.replace(new RegExp(FROM_CHART, 'gi'), ' ')
  let pronoun = null
  let deferred = null
  for (const p of prons) {
    // (probe 62: a pronoun the words go on past, or one that stands for a thing named before it, is no chart reference)
    if (p.cont) { pronoun = { phrase: p.phrase, notChart: true }; break }
    // (probe 64a-7: an item taken out of a THING container — "remove it from my watchlist" — is no chart)
    if (p.from === 'thing') { pronoun = { phrase: p.phrase, notChart: true, thing: p.container ? `something in your ${p.container}` : 'something on the chart' }; break }
    // (the referent's TYPE: the words — said right after it (64a-1), else before it — then the conversation's previous object)
    const syms = new Set(all.map(c => String(c.symbol || '').toLowerCase()).filter(Boolean))
    const isSym = (x) => syms.has(x)
    const a = (p.appos && pronounAntecedent(p.appos, isSym)) || pronounAntecedent(String(w || '').slice(0, p.verbAt), isSym)
    if (a?.type === 'thing') { pronoun = { phrase: p.phrase, notChart: true, thing: `the ${a.word}` }; break }
    // (a chart the words name — before or after the pronoun — is THAT chart: the named read below decides; only when it names none
    //  is the pronoun resolved as a deixis)
    if (a?.type === 'chart') { deferred = deferred || p; continue }
    const prevType = a ? null : typeOfId(previous)
    if (prevType === 'thing') {
      const pointed = [selected, subject].find(r0 => r0 != null && all.some(c => c.ref === r0))
      pronoun = pointed != null ? { phrase: p.phrase, conflict: true, thing: previousLabel || 'what you just changed', chart: all.find(c => c.ref === pointed) } : { phrase: p.phrase, notChart: true, thing: previousLabel || 'what you just changed' }
      break
    }
    const prevChart = prevType === 'chart' ? String(previous).slice('chart:'.length) : null
    const r = resolvePronoun(p, all, { selected, subject: subject ?? prevChart })
    // (an antecedent the words name — "the SPY chart is done, close it" — is that chart: read below, never asked)
    if (r.ask) { pronoun = { phrase: p.phrase, ask: true, named: a?.type === 'chart' }; break }
    for (const ref of r.refs) ids.add(ref)
    pronoun = { phrase: p.phrase, refs: r.refs }
  }
  for (const c of all) {
    const e = { ref: c.ref, symbol: up(c.symbol), position: c.position || null }
    const how = identifiesChart(asRemoval(wr), e, host, { selected, subject, picked, sole })
    if (NAMES_CHART.has(how) || (sole && how === 'class') || positionSaid(w, e)) ids.add(c.ref)
    // (a back-reference to the conversation's chart — "the one I just changed", "the chart you made" — is that chart, as a deixis is)
    if (subject && c.ref === subject && BACK_REF.test(w)) ids.add(c.ref)
  }
  if (deferred && !pronoun && !ids.size) {
    const prevChart = typeOfId(previous) === 'chart' ? String(previous).slice('chart:'.length) : null
    const r = resolvePronoun(deferred, all, { selected, subject: subject ?? prevChart })
    if (r.ask) pronoun = { phrase: deferred.phrase, ask: true }
    else { for (const ref of r.refs) ids.add(ref); pronoun = { phrase: deferred.phrase, refs: r.refs } }
  }
  const ambiguous = []
  for (const sym of new Set(all.map(c => up(c.symbol)).filter(Boolean))) {
    if (sameSymbolObjects(host, sym) <= 1 || !(symbolSaid(w, sym) || pluralOf(sym).test(w))) continue
    const mine = all.filter(c => up(c.symbol) === sym)
    if (mine.some(c => ids.has(c.ref))) continue                    // a position / deixis narrowed it
    if (pluralOf(sym).test(w)) for (const c of mine) ids.add(c.ref)
    else ambiguous.push({ symbol: sym, charts: mine })
  }
  if (lastMade) {
    const prevChart = typeOfId(previous) === 'chart' ? String(previous).slice('chart:'.length) : null
    const conv = [prevChart, subject].find(r0 => r0 != null && all.some(c => c.ref === r0))
    ids.clear()
    if (conv != null) ids.add(conv)
    else if (!pronoun) pronoun = { phrase: 'the last chart you opened', ask: true }
  }
  if (relation) { for (const r of relation.anchors) ids.delete(r); for (const r of relation.hits) ids.add(r) }
  let excluded = new Set()
  try { excluded = new Set(excludedCharts(w, all, selected)) } catch { excluded = new Set() }
  try { for (const r of negatedRemovalCharts(w, all, host)) excluded.add(r) } catch { /* no negated read */ }
  for (const r of excluded) ids.delete(r)
  return { ids, ambiguous, excluded, all, pronoun, anchors: relation?.anchors || new Set() }
}
function removalTargetRefusal(w, host, removed, { selected, subject, picked, known, previous, previousLabel }) {
  if (requestedPanels(w) != null || gridStated(w, known)) return null
  const { ids, ambiguous, excluded, all, pronoun, anchors } = removalTargets(w, host, { selected, subject, picked, previous, previousLabel })
  const where = (c) => (c.position ? `the ${c.position.replace('-', ' ')} one` : c.label || 'a chart')
  const syms0 = new Set(all.map(c => String(c.symbol || '').toLowerCase()).filter(Boolean))
  // ⛔ (1) TYPE: every removal object the words hold is a thing on a chart / in a list — no chart is closed
  const objs = removalObjects(w, (x) => syms0.has(x))
  if (objs.length && objs.every(o => o.type === 'thing')) {
    const eg = removed.map(e => all.find(c => c.ref === e.ref)).find(c => c?.symbol) || all.find(c => c.symbol)
    return `I didn’t close a chart: you asked to remove ${listOf([...new Set(objs.map(o => `“${o.np}”`))])}, which is not a chart, so nothing was changed. To close a chart, name it — for example “close ${eg?.symbol ? `the ${up(eg.symbol)} chart` : 'the left chart'}”.`
  }
  // ⛔ (3) RELATION: the anchor is never the target
  const anchored = removed.filter(e => anchors.has(e.ref))
  if (anchored.length) {
    const c = all.find(x => x.ref === anchored[0].ref)
    return `Which chart should I close? ${c?.symbol ? `The ${up(c.symbol)} chart` : 'That chart'} is where you pointed from, not the one to close, so nothing was changed — name the chart to close, for example “close ${listOf([...ids].map(r => all.find(x => x.ref === r)).filter(Boolean).map(x => (x.symbol ? `the ${up(x.symbol)} chart` : where(x))).slice(0, 1)) || 'the left chart'}”.`
  }
  // ⛔ (I4, AUDIT A1) a demonstrative on a NAMED chart ("close this IWM chart") while ANOTHER chart is clicked: which one is asked
  const demo = /\b(?:this|that)\s+\$?([A-Za-z]{1,5})\s+(?:chart|one|panel|graph)\b/i.exec(w)
  if (demo && selected != null) {
    const mine = all.filter(c => up(c.symbol) === up(demo[1]))
    const sel = all.find(c => c.ref === selected)
    if (mine.length && sel && !mine.some(c => c.ref === selected)) return `Which chart do you mean — the ${up(sel.symbol)} chart you clicked, or the ${up(demo[1])} chart? Nothing was changed. Say “close the ${up(demo[1])} chart” or “close the ${up(sel.symbol)} chart”.`
  }
  // ⛔ probe 62: the pronoun is no chart (a thing named before it, or words that go on past it) and no chart is named AS WHAT TO
  // REMOVE — none at all, or every removal verb the words hold takes such a pronoun ("put an RSI on the SPY chart, now delete it":
  // the SPY chart is where the RSI went) — refused
  const onlyPronouns = removalVerbCount(w) <= removalPronouns(w).length
  if (pronoun?.notChart && (!ids.size || onlyPronouns)) {
    const eg = removed.map(e => all.find(c => c.ref === e.ref)).find(c => c?.symbol) || all.find(c => c.symbol)
    return `I didn’t close a chart: “${pronoun.phrase}” here ${pronoun.thing ? `means ${pronoun.thing}` : 'is about something on the chart'}, not a chart, so nothing was changed. To close a chart, name it — for example “close ${eg?.symbol ? `the ${up(eg.symbol)} chart` : 'the left chart'}”.`
  }
  // ⛔ (owner 11-16) the words / conversation say a thing was just made or changed AND a chart is pointed at: which one is asked
  if (pronoun?.conflict && (!ids.size || onlyPronouns)) {
    const sym = up(pronoun.chart?.symbol)
    return `Which do you mean by “${pronoun.phrase}” — ${pronoun.thing}, or the ${sym ? `${sym} ` : ''}chart? Nothing was changed. Say “close the ${sym ? `${sym} ` : ''}chart” to close the chart, or name what to remove.`
  }
  // ⛔ probe 61a: a pronoun object nothing resolves (no selection, no conversation chart, 2+ chart objects) — asked, never applied
  if (pronoun?.ask && !(pronoun.named && ids.size)) {
    const eg = all.find(c => c.symbol) || all[0]
    return `Which chart should I close? Nothing is selected, so I can’t tell which chart “${pronoun.phrase}” means, and nothing was changed. Click the chart, or name it by its ticker or its place — for example “close ${eg?.symbol ? `the ${up(eg.symbol)} chart` : 'the left chart'}”.`
  }
  if (ambiguous.length) {
    const a = ambiguous[0]
    return `Which ${a.symbol} chart should I close? ${a.charts.length} charts show ${a.symbol} (${listOf(a.charts.map(where))}), so nothing was changed — say which one, for example “close the ${a.charts[0].position ? `${a.charts[0].position.replace('-', ' ')} ` : ''}${a.symbol} chart”, or “close both ${a.symbol} charts”.`
  }
  // ⛔ (AUDIT A12) a SET described by a qualifier no chart answers to ("both index charts", "all the tech charts") — never a guess
  const qual = !ids.size ? QUALIFIED_SET.exec(w) : null
  if (qual && qual[1].trim().split(/\s+/).some(x => !DET_FILLER().test(x.toLowerCase()) && !SET_FILLER.test(x) && !chartishWord(x) && !syms0.has(x.toLowerCase()) && !POS_ONE.test(x))) {
    return `Which charts should I close? I can’t tell which charts “${qual[0].trim()}” are, so nothing was changed. Name them by their tickers or their places — for example “close the SPY and QQQ charts”.`
  }
  const specific = !ids.size && !SET_REMOVAL.test(w) ? SPECIFIC_CHART.exec(w) : null
  if (specific) {
    const eg = all.find(c => c.symbol) || all[0]
    return `Which chart should I close? I can’t tell which chart “${specific[0]}” is, so nothing was changed. Name it by its ticker or its place — for example “close ${eg?.symbol ? `the ${up(eg.symbol)} chart` : 'the left chart'}”.`
  }
  // (…and ONE specific chart the words fit SEVERAL objects of — "the bottom chart" on a 2×2 — is asked, never a guess: a link group is
  //  one object; a plural noun or a list names several on purpose)
  const one = !SET_REMOVAL.test(w) && !SEVERAL.test(w) ? SPECIFIC_CHART.exec(w) : null
  if (one && new Set(all.filter(c => ids.has(c.ref)).map(c => (linked(c.group) ? `g:${c.group}` : `c:${c.ref}`))).size > 1) {
    const fits = all.filter(c => ids.has(c.ref)).map(where)
    return `Which chart should I close? “${one[0]}” fits ${fits.length} charts (${listOf(fits)}), so nothing was changed — say which one.`
  }
  const bad = removed.filter(e => excluded.has(e.ref) || (ids.size && !ids.has(e.ref)))
  if (!bad.length) return null
  // (a ticker on several charts is told apart by its position: "the middle NVDA chart")
  const label = (c) => {
    const sym = up(c.symbol)
    if (!sym) return where(c)
    const pos = all.find(x => x.ref === c.ref)?.position || c.position
    return all.filter(x => up(x.symbol) === sym).length > 1 && pos ? `the ${pos.replace('-', ' ')} ${sym} chart` : `the ${sym} chart`
  }
  const meant = all.filter(c => ids.has(c.ref)).map(label)
  return `Which chart should I close? ${meant.length ? `You named ${listOf([...new Set(meant)])}, but` : 'Your words leave that chart out, but'} this would have closed ${listOf([...new Set(bad.map(label))])}, so nothing was changed. Say which chart to close — for example “close ${meant[0] || label(bad[0])}”.`
}
export function chartRailRefusal(plan, { words = '', host = null, mode = 'apply', subject = null, picked = null, made = null, lists = null, out = null, previous = null, previousLabel = null } = {}) {
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
      const asked = spokenTickers(w, [...before, ...known]).filter(t => !before.has(t) && !setAside(t))
      // (every ticker the words ask to SEE — a shown one counts as on the board only while it STAYS there: #1275 reuse.
      //  ⛔ AUDIT probe 52a: a SHOWN ticker counts only when a see verb governs it and it is never the object of a change)
      // (⛔ AUDIT probe 57 (a): a ticker typed in LOWERCASE counts when it is a symbol a chart on this board shows or this plan's own
      //  symbol — never a common word: "show spy and aapl" keeps SPY; spokenTickers)
      const spoken = spokenTickers(w, [...before, ...known])
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
      // ⛔ SEEN STAYS (AUDIT probe 57 — ANY board, any plan kind): a SHOWN ticker the words ask to SEE (a SEE_VERBS verb governs
      // it: tickerAskedToSee) is never taken off the board — a plan that re-symbols or removes the last chart showing it is refused.
      // (Before, only the sole chart was checked here; on several charts only the LOCAL side-by-side reader (multiChart) caught
      // "show X and Y" before any model plan — "pull up X and Y" / "I want to see X and Y" reached the model's plan and wrote.)
      const seen = spoken.filter(t => before.has(t) && !setAside(t) && tickerAskedToSee(w, t, spoken))
      if (seen.length && effects.some(e => (e.type === 'symbol' && e.to) || e.type === 'remove')) {
        const final = new Map(liveCharts(host).map(c => [c.ref, up(c.symbol)]))
        for (const e of effects) {
          if (e.type === 'symbol' && e.to) final.set(e.ref, up(e.to))
          else if (e.type === 'remove') final.delete(e.ref)
          // (AUDIT N6: a removal the words LICENSE — "close the QQQ chart and pull up SPY and AAPL" with a plan closing the SPY chart —
          //  passes the removal rail; this line is the only reader that sees it takes the seen SPY off the board)
        }
        const shown = new Set([...final.values(), ...(plan.plans || []).filter(p => p.virtual && p.after?.symbol).map(p => up(p.after.symbol)),
          ...(plan.plans || []).flatMap(p => (p.after?.grid?.add || []).map(a => up(a.symbol)))].filter(Boolean))
        const dropped = seen.filter(t => !shown.has(t))
        if (dropped.length) {
          const adds = asked.length ? asked : [...new Set(effects.map(e => e.to).filter(Boolean).map(up))]
          return `I didn’t change anything: you asked for ${listOf(named)}, but this would leave ${listOf(dropped)} off your board. Say “add ${listOf(adds)}” for new charts, or which chart each one replaces.`
        }
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
      const wrong = removalTargetRefusal(w, host, removed, { selected, subject, picked, known, previous, previousLabel })
      if (wrong) return wrong
    }
    if (removed.length && mode === 'apply' && !removalAskedFor(w)) {
      return `I didn’t change anything: this would have removed ${listOf(removed.map(nameOf))}, and you didn’t ask to remove a chart. Say which chart to remove or replace.`
    }
  }
  // COUNT: a grid shape asked for in words never ends with fewer charts
  const want = requestedPanels(w)
  const have = want ? panelsAfter(plan, host) : null
  if (want && have != null && have < want) {
    return `I didn’t change anything: you asked for a ${want}-chart grid, but this would leave ${have} chart${have === 1 ? '' : 's'}. Tell me the ticker for each chart and I’ll set up all ${want}.`
  }
  // FINAL BOARD (KEEP ≠ RE-CREATE, D18 item 3): the planned final chart set must be the charts kept (the SAME panels) ∪ the new
  // tickers — a symbol a chart already shows (on the timeframe asked, or none asked) is never created again, and none is created
  // twice, beyond the copies the words attach to it structurally (copyIntent.readCopyIntent)
  const fin = finalBoard(plan, host)
  if (fin) {
    const kept = keptCharts(w, host)
    if (fin.unknown && (kept.all || kept.refs.size || kept.symbols.size)) {
      return 'I didn’t change anything: I can’t tell which charts this would add, so I can’t check it keeps the ones you asked to keep. Name the tickers for the new charts.'
    }
    const dup = duplicatesIn(fin, w, host)
    if (dup.length) return dupSentence(dup)
    // (a kept chart stays the SAME panel: closing it — even to re-create it on its ticker — is a KEPT 'remove' effect, refused above)
  }
  return null
}

/** The duplicate refusal: WHICH ticker, and how to ask for a second copy. */
export const dupSentence = (syms) => `I didn’t change anything: ${listOf(syms)} ${syms.length === 1 ? 'is' : 'are'} already on your board. Say “add another ${syms[0]} chart” if you want a second one.`

// ── D18 item 3: what is DISPLAYED, and how many new charts of a symbol the request allows ───────────────────────────────────────
const tfOk = (chartTf, wantTf) => !wantTf || String(chartTf || '') === String(wantTf)
/** The charts on the board showing `sym` on a compatible timeframe (reading order). */
export const displayedAs = (host, sym, tf = null) => liveCharts(host).filter(c => up(c.symbol) === up(sym) && tfOk(c.tf, tf))
  .sort((a, b) => ((a.cell?.y ?? 0) - (b.cell?.y ?? 0)) || ((a.cell?.x ?? 0) - (b.cell?.x ?? 0)))
/**
 * The symbols a plan's creations would map onto charts already displayed — REUSED, not created (planChartGrid `keep`, the
 * reuse screen): each requested symbol a chart shows on the timeframe asked (or none asked), with no copy intent attached, and
 * each symbol the words name as KEPT. `created`: [{ symbol, tf }] or symbols.
 */
export function keepTickers(words, host, created = []) {
  const w = String(words || '')
  const list = (created || []).map(c => (typeof c === 'string' ? { symbol: up(c), tf: null } : { symbol: up(c.symbol), tf: c.tf || null })).filter(c => c.symbol)
  const shown = Object.fromEntries(list.map(c => [c.symbol, displayedAs(host, c.symbol, c.tf).length]))
  const copies = readCopyIntent(w, list.map(c => c.symbol), shown)
  const out = new Set()
  for (const c of list) if (shown[c.symbol] && !copies[c.symbol]) out.add(c.symbol)
  const k = keptCharts(w, host)
  for (const c of liveCharts(host)) if (k.all || k.refs.has(c.ref) || k.symbols.has(up(c.symbol))) out.add(up(c.symbol))
  return out
}
/** The creations of a list of ops: [{ symbol, tf }] (chartGrid.set / widget.addCharts literal lists, widget.add + setSymbol). */
export function createdTickers(ops) {
  const out = []
  const aliasTf = new Map((ops || []).filter(o => o?.action === 'chart.setTimeframe').map(o => [String(o.target), o.args?.timeframe || null]))
  for (const o of ops || []) {
    if ((o?.action === 'chartGrid.set' || o?.action === 'widget.addCharts') && Array.isArray(o.args?.symbols)) out.push(...o.args.symbols.map(s0 => ({ symbol: up(s0), tf: o.args.timeframe || null })))
    if (o?.action === 'chart.setSymbol' && (ops || []).some(a => a?.action === 'widget.add' && String(a.args?.as) === String(o.target))) out.push({ symbol: up(o.args?.symbol), tf: aliasTf.get(String(o.target)) || null })
  }
  return out.filter(c => c.symbol)
}
/** The symbols a final board would show once too often: per symbol, created > (displayed-compatible ? 0 : 1) + copies. */
export function duplicatesIn(fin, words, host) {
  const by = new Map()
  for (const c of fin.createdTf) { const k = `${c.symbol}`; by.set(k, [...(by.get(k) || []), c]) }
  const shownCount = Object.fromEntries([...by.keys()].map(S => [S, displayedAs(host, S, by.get(S)[0].tf).length]))
  const copies = readCopyIntent(words, [...by.keys()], shownCount)
  const kept = keptCharts(words, host)
  const out = []
  for (const [S, cs] of by) {
    // shown in the FINAL board (after the plan's own symbol changes: a grid that re-symbols NVDA's chart and creates NVDA elsewhere
    // has moved it, not duplicated it), on a compatible timeframe
    const shownHere = cs.some(c => fin.kept.some(k => k.symbol === S && (!c.tf || !k.tf || String(k.tf) === String(c.tf)))) || kept.symbols.has(S)
    const allowed = (shownHere ? 0 : 1) + (copies[S] || 0)
    if (cs.length > allowed) out.push(S)
  }
  return out
}

export function finalBoard(plan, host) {
  const plans = plan?.plans || []
  const created = []
  let unknown = false
  for (const p of plans) {
    if (p.kind === 'board' && p.after?.grid && !p.after.grid.dup) for (const a of p.after.grid.add || []) if (!a.type || a.type === 'chart') created.push({ symbol: up(a.symbol) || null, tf: a.tf || null })
    if (p.kind === 'chart' && p.virtual) created.push({ symbol: up(p.after?.symbol) || null, tf: p.after?.tf !== p.before?.tf ? p.after?.tf || null : null })
    if (p.kind === 'workspace') {
      for (const pc of p.after?.pendingCharts || []) {
        if (Array.isArray(pc.symbols)) created.push(...pc.symbols.map(s0 => ({ symbol: up(s0) || null, tf: pc.timeframe || null })))
        else unknown = true
      }
    }
  }
  if (!created.length && !unknown) return null
  if (created.some(c => !c.symbol)) unknown = true
  const effects = chartEffects(plan, host)
  const gone = new Set(effects.filter(e => e.type === 'remove').map(e => e.ref))
  const now = new Map(effects.filter(e => e.type === 'symbol' && e.to).map(e => [e.ref, e.to]))
  const live = liveCharts(host)
  return {
    kept: live.filter(c => !gone.has(c.ref)).map(c => ({ ref: c.ref, symbol: now.get(c.ref) || up(c.symbol), tf: c.tf || null })),
    removed: live.filter(c => gone.has(c.ref)).map(c => ({ ref: c.ref, symbol: up(c.symbol) })),
    created: created.map(c => c.symbol).filter(Boolean),
    createdTf: created.filter(c => c.symbol),
    unknown,
  }
}
