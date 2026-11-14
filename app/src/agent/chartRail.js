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
export function chartEffects(plan, host, { strict = false } = {}) {
  const out = []
  for (const p of plan?.plans || []) {
    const f = EFFECTS[p.kind]
    if (!f) continue
    // (`strict`: targetDecl.js reads an unreadable plan as a fail-closed mismatch; the rail's own reading is unchanged)
    try { for (const e of f(p, host)) out.push({ ...e, kind: p.kind }) } catch (err) { if (strict) throw err /* an unreadable plan has no effects to claim */ }
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
export const REPLACE = /\b(?:replace|replacing|replaced|instead|swap(?:ping)? out|swap (?:the |my )?(?:tickers?|symbols?|charts?)\b|swap \$?[A-Za-z]{1,5} (?:and|with) |get rid of|switch (?:out|over)|change (?:the |my |that |this |both |all )?(?:\w+ )?(?:chart|charts|one|ones|symbol|ticker)s?\b(?!\s+layout)|(?:change|switch|turn|flip) (?:the |my |that |this )?(?:\w+ )?(?:chart |one )?(?:to|into) \$?[A-Za-z]{1,5}\b)/i
export const REMOVAL = /\b(?:remove|removing|delete|deleting|close|closing|get rid|replace|replacing|clear|clean(?:ing)? up|tidy|drop|dropping|only|just|fewer|less|reduce|down to|instead|swap(?:ping)? out|single|one chart)\b/i
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
export const CHART_COUNT = /\b(?:two|three|four|five|six|seven|eight|nine|[2-9])\s+(?:new\s+)?(?:(?:daily|weekly|monthly|hourly|intraday)\s+)?charts?\b/i
export function multiResymbolAllowed(words, resym, known, host) {
  const w = String(words || '')
  if (REPLACE.test(w)) return true
  if (resym.every(e => named(w, e, host))) return true
  const named2 = new Set([...tickersIn(w), ...knownIn(w, known).map(x => x.toUpperCase())]).size
  return !addsCharts(w, known) && (requestedPanels(w) != null || CHART_COUNT.test(w) || LAYOUT_WORDS.test(w)) && named2 >= 2
}
export const LAYOUT_WORDS = /\b(?:side[\s-]by[\s-]side|next to each other|beside each other|stacked|on top of each other|in a (?:row|column|grid))\b/i
// "just add …" / "only add …" limit what is ADDED — never a permission to remove
export const removalWords = (w) => String(w || '').replace(/\b(?:just|only)\s+(?=(?:add|adds|added|adding|put|include|includes|included|including)\b)/gi, ' ')
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
export function chartRailRefusal(plan, { words = '', host = null, mode = 'apply' } = {}) {
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
    // REMOVAL: never at once without the words for it
    const removed = effects.filter(e => e.type === 'remove')
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
