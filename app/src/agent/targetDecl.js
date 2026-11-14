// ── TARGET DECLARATIONS (Phase 1, UNWIRED) — docs/agent/design/TARGET-DECLARATIONS.md, AUDIT verdict on 5f3ecdd618 ──────────
//
// Two PURE functions and their helpers. Nothing here is called by useAgent yet (wiring waits for #1247 and #1261 to merge) and
// nothing here imports from useAgent. Every rail stays as it is; this is one more reading of the same plan, run in SHADOW first.
//
//   declareTargets   the turn's DECLARATION: which EXISTING charts the member's words + UI state let this turn change, and how
//                    far (create < overwrite < replace < remove; switch apart). Entries come ONLY from positive evidence
//                    (AUDIT condition 2): a click, a chart the words NAME (position / ordinal / relation / symbol / "all"), the
//                    memory subject behind an anaphor, the created set behind a created-set reference, words that state the
//                    WHOLE board, a layout-open verb, or a stored card. Never from the absence of a keep.
//   validateDeclaration   the plan's effects (the planner's own before / after, read by chartRail.chartEffects, plus content
//                    writes to a chart through any chart-backed kind) must be a subset of the declaration, per kind; and, only
//                    when the words name a keep / count / shape / explicit symbols (AUDIT condition 4), the FINAL BOARD check.
//
// Default-deny inside a declared kind: an effect on an existing object with no entry is a MISMATCH (condition 2). A kind the
// resolver could not read is OPEN — reported, and never a pass for an ENFORCED kind (condition 1, `refusesUnder`). A kept panel
// is an IDENTITY: the same ref must survive; closing it and re-creating its ticker is remove + create, a mismatch unless the
// words ask to move / reorder (condition 5). Model-supplied targets never authorise (condition 3): `narrowByModel` may only
// remove entries.
//
// Shadow telemetry (`shadowTelemetry`, condition 9) carries counts, verdict letters, kind names and evidence-type names only —
// never member words, symbols or ids.
import { chartEffects, keptCharts, addsCharts, knownIn, requestedPanels, REPLACE, REMOVAL, CHART_COUNT, LAYOUT_WORDS, removalWords, RAIL_KINDS } from './chartRail'
import { chartsNamedBy, chartRefOf, leftOut, pointsAtChart, selectedChart } from './deixis'
import { getTargetKind } from './capabilities'
import { tickersIn } from './multiChart'

export const TD_MARK = 'target-decl'
export const TD_VERSION = 1
/** Every kind the validator reports on. `final` and `fanout` are checks of the whole plan, not target kinds. */
export const TD_KINDS = [...RAIL_KINDS, 'content', 'final', 'fanout']
const CHART_KINDS = [...RAIL_KINDS, 'content']

const up = (s) => String(s || '').trim().toUpperCase()
const liveCharts = (host) => { try { return host?.charts?.list?.() || [] } catch { return [] } }
const liveCells = (host) => { try { return (host?.gridControl?.state?.()?.cells || []).filter(c => c && c.sym) } catch { return [] } }

// ── the effect lattice ───────────────────────────────────────────────────────────────────────────────────────────────────
const RANK = { create: 0, overwrite: 1, replace: 2, remove: 3 }
/** Does a declared effect cover an actual one? `switch` only covers `switch`; nothing covers `unreadable`. */
export function permitsEffect(declared, actual) {
  if (actual === 'unreadable' || !(declared in RANK || declared === 'switch')) return false
  if (declared === 'switch' || actual === 'switch') return declared === actual
  return actual in RANK && RANK[declared] >= RANK[actual]
}

// ── what the member's words say (existing readers, composed — no new vocabulary beyond the few shapes below) ────────────
// "all my charts", "every chart", "both charts", "all of them", "both of them"
const ALL_CHARTS = /\b(?:all|every|each|both)(?:\s+of)?\s+(?:my\s+|the\s+|these\s+|those\s+)?(?:\w+\s+)?(?:charts?|ones|panels?)\b|\b(?:all|both)\s+of\s+them\b|\bevery\s+one\b/i
// an anaphor that can stand for the conversation's subject chart
const ANAPHOR = /\b(?:it|that\s+(?:chart|one|ticker|stock|symbol))\b/i
// the click: words that point at it outright
const HERE = /\b(?:this|here)\b/i
// a created-set reference (the idea of #1261's structural NEW_REF A/B, not its import): determiner + fresh word + chart noun,
// or determiner + chart noun + "you (just) added / made / opened / created"
const CREATED_REF = /\b(?:the|those|these|both(?:\s+of)?(?:\s+the)?|all(?:\s+of)?(?:\s+the)?|my)\s+(?:(?:one|two|three|four|five|six|\d)\s+)?(?:brand[\s-]+new|newly\s+\w+|new|fresh|latest)\s+(?:[\w$.-]+\s+){0,3}?(?:charts?|ones?|panels?|panes?)\b|\b(?:the|those|these)\s+(?:charts?|ones?|panels?)\s+(?:that\s+)?(?:you(?:['’]ve|\s+have)?\s+)?(?:just\s+)?(?:added|made|created|opened|built|set\s+up|pulled\s+up)\b/i
// a layout opened by name / verb ("open my Swing layout", "switch to the Momentum layout", "load layout 2")
const LAYOUT_OPEN = /\b(?:open|opens|opening|switch(?:\s+over)?\s+to|go\s+(?:back\s+)?to|load|loads|loading|pull\s+up|bring\s+up|use|show)\b[^.;!?]{0,40}\blayouts?\b/i
// a saved layout NAMED after an open verb ("load Momentum", "go to Swing") — a named ref of the layouts kind
const OPEN_VERB = new RegExp(String.raw`\b(?:open|opens|opening|switch(?:\s+over)?\s+to|go\s+(?:back\s+)?to|load|loads|loading|pull\s+up|bring\s+up|use)\b`, 'i')
function layoutNamed(w, host) {
  if (!OPEN_VERB.test(w)) return false
  let entries = []
  try { entries = host?.layouts?.snapshot?.()?.entries || [] } catch { return false }
  const after = w.slice(w.search(OPEN_VERB))
  return entries.some(e => e?.name && mentions(after, String(e.name)))
}
// moving / reordering panels: the only words that let a kept panel be closed and re-created (condition 5)
const MOVE = /\b(?:move|moves|moving|moved|reorder\w*|rearrang\w*|re-?arrang\w*|reposition\w*|shuffle\w*|swap\s+(?:places|positions|sides)|switch\s+(?:places|positions|sides))\b/i
// a copy of a ticker asked for outright ("another SPY chart", "a second NVDA") — the idea of #1275's ANOTHER, not its import
const ANOTHER = /\b(?:another|second|2nd|duplicate|copy|clone|twice|extra)\b/i
const NEW_COUNT = /\b(?:two|three|four|five|six|seven|eight|nine|[2-9])\s+(?:new|more|additional|extra|other)\s+(?:(?:daily|weekly|monthly|hourly|intraday)\s+)?charts?\b/i
const NUM = { two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9 }
const numOf = (m) => (m ? (NUM[String(m).toLowerCase()] || Number(m)) : null)
const mentions = (words, sym) => new RegExp(`(^|[^A-Za-z0-9])\\$?${String(sym).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9])`, 'i').test(words)

/** How far this turn's words let a chart they point at be changed. */
export function ceilingOf(words) {
  const w = String(words || '')
  if (REMOVAL.test(removalWords(w))) return 'remove'
  if (REPLACE.test(w)) return 'replace'
  return 'overwrite'
}
const maxEffect = (a, b) => (RANK[a] >= RANK[b] ? a : b)

/** Words that state the WHOLE board (a shape, a count or an arrangement, with two or more tickers, no add, no keep). */
function statesWholeBoard(w, host, kept) {
  if (kept.all || kept.refs.size || kept.symbols.size) return false
  if (addsCharts(w)) return false
  if (requestedPanels(w) == null && !CHART_COUNT.test(w) && !LAYOUT_WORDS.test(w)) return false
  return tickersIn(w).length >= 2
}

/**
 * The FINAL-BOARD spec, or null — only when the words name a keep, a count, a shape or explicit symbols (condition 4). It never
 * describes an exact board: it lists what must hold (kept refs survive, kept symbols not re-created, named off-board symbols
 * present, at least the count asked).
 * `known`: symbols the plan resolved (lowercase words count when they are one of these — chartRail.knownIn).
 */
export function finalSpec(words, host, known = []) {
  const w = String(words || '')
  const charts = liveCharts(host)
  const kept = keptCharts(w, host)
  const keptRefs = new Set(kept.refs)
  for (const c of charts) if (kept.all || kept.symbols.has(up(c.symbol))) keptRefs.add(c.ref)
  const keptSymbols = [...new Set(charts.filter(c => keptRefs.has(c.ref)).map(c => up(c.symbol)).filter(Boolean))]
  const named = [...new Set([...tickersIn(w), ...knownIn(w, known).map(up)])]
  const total = requestedPanels(w)
  const nc = NEW_COUNT.exec(w)
  const cc = CHART_COUNT.exec(w)
  const minCreated = nc ? numOf(nc[0].split(/\s+/)[0]) : null
  const minTotal = total ?? (cc && !nc ? numOf(cc[0].split(/\s+/)[0]) : null)
  if (!keptRefs.size && !named.length && total == null && minTotal == null && minCreated == null) return null
  const onBoard = new Set(charts.map(c => up(c.symbol)).filter(Boolean))
  return {
    keptRefs: [...keptRefs],
    keptSymbols,
    // a named symbol that is not on the board yet is one the words want to see (one already there may be the one replaced)
    required: named.filter(s => !onBoard.has(s)),
    another: named.filter(s => ANOTHER.test(w) && mentions(w, s)),
    minTotal: minTotal ?? null,
    minCreated: minCreated ?? null,
  }
}

/**
 * The turn's declaration. Pure; never throws (a reader that throws → `error`, every chart kind OPEN).
 *   words    this turn's words (railWordsRef: the message + the request a pending question carried)
 *   subject  the memory subject chart ref (memory.js subjects.chart.ref), or null
 *   created  the created set (createdRef.current.refs)
 *   card     a declaration stored with a proposal card → returned as the authority (source 'card')
 *   opts.sole  a one-chart board's chart counts as named (NOT one of AUDIT's evidence types: off by default, measured apart)
 */
export function declareTargets({ words = '', host = null, subject = null, created = [], card = null, opts = {} } = {}) {
  if (card && card.v === TD_VERSION) return { ...card, source: 'card' }
  try {
    return declare(String(words || ''), host, subject, created, opts)
  } catch {
    return { v: TD_VERSION, source: 'resolver', error: true, entries: [], keep: { refs: [], all: false }, open: [...CHART_KINDS], final: null, move: false }
  }
}
function declare(w, host, subject, created, opts) {
  const charts = liveCharts(host)
  const refs = new Set(charts.map(c => String(c.ref)))
  const sel = selectedChart(host)
  const kept = keptCharts(w, host)
  const keepRefs = new Set(kept.refs)
  for (const c of charts) if (kept.all || kept.symbols.has(up(c.symbol))) keepRefs.add(c.ref)
  let excluded = new Set()
  try { excluded = leftOut(w, charts, sel) || new Set() } catch { excluded = new Set() }
  const blocked = (r) => keepRefs.has(r) || excluded.has(r)
  const ceiling = ceilingOf(w)
  const ev = new Map()                          // ref → { via, effect }
  // (a chart already named keeps its first evidence; a later, wider grant — the whole board stated — widens its effect)
  const put = (ref, via, effect = ceiling) => {
    const r = String(ref ?? '')
    if (ref == null || !refs.has(r) || blocked(r)) return
    const had = ev.get(r)
    if (!had) ev.set(r, { via, effect })
    else if (RANK[effect] > RANK[had.effect]) ev.set(r, { via: had.via, effect })
  }

  // created set behind a created-set reference — read FIRST: "both new charts" is the created set, not "both charts"
  const createdLive = [...new Set((created || []).map(String))].filter(r => refs.has(r))
  const refersCreated = CREATED_REF.test(w)
  if (refersCreated) for (const r of createdLive) put(r, 'created')
  // named by the words (position, ordinal, relation, qualifier, symbol)
  for (const r of chartsNamedBy(w, charts, sel)) put(r, 'named')
  // every chart, said outright
  if (!refersCreated && ALL_CHARTS.test(w)) for (const c of charts) put(c.ref, 'all')
  // the whole board stated (GRID-REUSE: "make a 2x2 of SPY QQQ IWM DIA")
  if (statesWholeBoard(w, host, kept)) for (const c of charts) put(c.ref, 'board', maxEffect(ceiling, 'replace'))
  const namedAny = ev.size > 0
  // the click: words that point here, or a bare command with nothing else named
  if (sel && (HERE.test(w) || !namedAny)) put(sel, 'click')
  // the conversation's subject, behind an anaphor, when nothing else answered
  if (!ev.size && subject && ANAPHOR.test(w)) put(subject, 'subject')
  // (off by default) the one chart of a one-chart board
  if (opts.sole && !ev.size && charts.length === 1) put(charts[0].ref, 'sole')

  const entries = [...ev].map(([ref, e]) => ({ family: 'chart', ref, effect: e.effect, via: e.via }))
  // a layout opened in words switches every chart on screen — never a kept one (that stays a mismatch: KEPT)
  if (LAYOUT_OPEN.test(w) || layoutNamed(w, host)) for (const c of charts) if (!blocked(c.ref)) entries.push({ family: 'chart', ref: String(c.ref), effect: 'switch', via: 'layout' })
  // Multi Chart cells: a cell named by a ticker only it shows, or the whole grid stated
  const cells = liveCells(host)
  const whole = statesWholeBoard(w, host, kept)
  const said = new Set(tickersIn(w))
  for (const c of cells) {
    const sym = up(c.sym)
    const unique = cells.filter(x => up(x.sym) === sym).length === 1
    if (kept.symbols.has(sym) || kept.all) continue
    if (whole) entries.push({ family: 'cell', ref: String(c.id), effect: maxEffect(ceiling, 'replace'), via: 'board' })
    else if (unique && said.has(sym)) entries.push({ family: 'cell', ref: String(c.id), effect: ceiling, via: 'named' })
  }
  // OPEN: the words point at a chart and nothing above could say which (reported; never a pass when enforced)
  const open = []
  if (!ev.size && pointsAtChart(w, { chartOp: true, charts })) open.push(...CHART_KINDS)
  const keptCells = cells.filter(c => kept.all || kept.symbols.has(up(c.sym))).map(c => String(c.id))
  return {
    v: TD_VERSION,
    source: 'resolver',
    entries,
    keep: { refs: [...keepRefs].map(String), cells: keptCells, all: !!kept.all },
    open,
    final: finalSpec(w, host),
    move: MOVE.test(w),
  }
}

/** Model-supplied targets NEVER authorise (condition 3): they can only take entries away. `targets`: [{ ref, effect }]. */
export function narrowByModel(decl, targets) {
  if (!decl || !Array.isArray(targets)) return decl
  const entries = []
  for (const e of decl.entries) {
    // the model's own effect for that ref, when the declaration already covers it — never wider, never a new ref
    const t = targets.find(x => String(x?.ref) === e.ref && permitsEffect(e.effect, x?.effect))
    if (t) entries.push({ ...e, effect: t.effect })
  }
  // an OPEN kind stays open: a model target never fills it (condition 3)
  return { ...decl, entries, open: [...(decl.open || [])] }
}

/** Charts this request will create (widget.add aliases): each may be changed by the request's later steps, never removed. */
export function withAliases(decl, aliases = []) {
  if (!decl) return decl
  const extra = [...new Set((aliases || []).map(String))].filter(a => !decl.entries.some(e => e.alias === a)).map(a => ({ family: 'chart', ref: a, alias: a, effect: 'overwrite', via: 'alias' }))
  return { ...decl, entries: [...decl.entries, ...extra] }
}
/** The deferred-step rewrite (useAgent landDeferred's `real()`): an alias entry is aimed at the chart the request created. */
export function rewriteAliases(decl, created = {}) {
  if (!decl) return decl
  const real = (v) => (typeof v === 'string' && created && Object.prototype.hasOwnProperty.call(created, v) ? String(created[v]) : v)
  return { ...decl, entries: decl.entries.map(e => (e.alias != null ? { ...e, ref: real(e.alias) } : e)) }
}

// ── what the plan does: per target kind, from the planner's own states ─────────────────────────────────────────────────
const classOf = (e) => (e.type === 'switch' ? 'switch' : e.type === 'remove' ? 'remove' : e.type === 'symbol' ? (e.kind === 'chart' ? 'overwrite' : 'replace') : 'unreadable')

/** → { effects: [{ kind, ref, effect, symbol, linked, plan }], created: [symbol|null], unknownCreates } */
export function planEffects(plan, host) {
  const effects = []
  const created = []
  let unknownCreates = false
  const plans = plan?.plans || []
  plans.forEach((p, i) => {
    try {
      const mine = chartEffects({ plans: [p] }, host, { strict: true }).map(e => ({ kind: p.kind, ref: e.ref == null ? null : String(e.ref), effect: classOf(e), symbol: e.symbol || null, linked: !!e.linked, plan: i }))
      effects.push(...mine)
      // creations (the idea of #1275's finalBoard, not its import)
      if (p.kind === 'board' && p.after?.grid && !p.after.grid.dup) for (const a of p.after.grid.add || []) if (!a.type || a.type === 'chart') created.push(up(a.symbol) || null)
      if (p.kind === 'chart' && p.virtual) created.push(up(p.after?.symbol) || null)
      if (p.kind === 'workspace') for (const pc of p.after?.pendingCharts || []) { if (Array.isArray(pc.symbols)) created.push(...pc.symbols.map(s => up(s) || null)); else unknownCreates = true }
      // a content write to an existing chart through any chart-backed kind (indicators, drawings, its settings…)
      if (p.changed && !p.virtual && !(RAIL_KINDS.includes(p.kind) && p.kind !== 'chart')) {
        const ref = chartRefOf(getTargetKind(p.kind), p.snap)
        if (ref != null && !mine.some(e => e.ref === String(ref))) effects.push({ kind: 'content', ref: String(ref), effect: 'overwrite', symbol: null, linked: false, plan: i })
      }
    } catch {
      effects.push({ kind: RAIL_KINDS.includes(p?.kind) ? p.kind : 'content', ref: null, effect: 'unreadable', symbol: null, linked: false, plan: i })
    }
  })
  if (created.includes(null)) unknownCreates = true
  return { effects, created: created.filter(Boolean), unknownCreates }
}

// ── the validator ────────────────────────────────────────────────────────────────────────────────────────────────────────
const blank = () => Object.fromEntries(TD_KINDS.map(k => [k, { match: 0, mismatch: 0, open: 0 }]))

/**
 * → { verdict: 'none' | 'match' | 'mismatch' | 'open', kinds: { kind: { match, mismatch, open } }, mismatches: [{ kind, why, ref?, effect? }],
 *     final: 'skip' | 'ok' | 'fail' }. Pure; never throws (a throw → every chart kind mismatched, 'unreadable').
 * `words`: the same words the declaration was made from (only to read lowercase symbols the plan resolved, for the final board).
 */
export function validateDeclaration(plan, decl, { host = null, words = '' } = {}) {
  if (!plan?.ok) return { verdict: 'none', kinds: blank(), mismatches: [], final: 'skip' }
  try { return validate(plan, decl, host, String(words || '')) } catch {
    const kinds = blank()
    kinds.content.mismatch++
    return { verdict: 'mismatch', kinds, mismatches: [{ kind: 'content', why: 'unreadable' }], final: 'skip' }
  }
}
function validate(plan, decl, host, w) {
  const kinds = blank()
  const mismatches = []
  const { effects, created, unknownCreates } = planEffects(plan, host)
  const miss = (kind, why, e = {}) => { kinds[kind].mismatch++; mismatches.push({ kind, why, ...(e.ref != null ? { ref: e.ref } : {}), ...(e.effect ? { effect: e.effect } : {}) }) }
  if (!decl || decl.error) {
    for (const e of effects) kinds[e.kind].open++
    return { verdict: effects.length ? 'open' : 'none', kinds, mismatches, final: 'skip' }
  }
  const keepRefs = new Set(decl.keep?.refs || [])
  const keepCells = new Set(decl.keep?.cells || [])
  const leaders = new Map()                  // plan index → verdict of its first (non-linked) symbol effect
  for (const e of effects) {
    if (e.effect === 'unreadable') { miss(e.kind, 'unreadable', e); continue }
    const family = e.kind === 'multiChart' ? 'cell' : 'chart'
    // KEPT: an identity — any effect on it is a mismatch; a close is allowed only as a MOVE that re-creates its ticker
    if ((family === 'chart' && keepRefs.has(e.ref)) || (family === 'cell' && keepCells.has(e.ref))) {
      if (e.effect === 'remove' && decl.move && e.symbol && created.includes(up(e.symbol))) { kinds[e.kind].match++; continue }
      miss(e.kind, 'kept', e)
      continue
    }
    if (e.linked && leaders.has(e.plan)) { kinds[e.kind][leaders.get(e.plan)]++; if (leaders.get(e.plan) === 'mismatch') mismatches.push({ kind: e.kind, why: 'linked', ref: e.ref }); continue }
    if ((decl.open || []).includes(e.kind)) { kinds[e.kind].open++; if (!e.linked) leaders.set(e.plan, 'open'); continue }
    const entry = (decl.entries || []).find(x => x.family === family && x.ref === e.ref && permitsEffect(x.effect, e.effect))
    if (entry) { kinds[e.kind].match++; if (!e.linked) leaders.set(e.plan, 'match'); continue }
    const near = (decl.entries || []).some(x => x.family === family && x.ref === e.ref)
    miss(e.kind, near ? 'exceeds' : 'no-entry', e)
    if (!e.linked) leaders.set(e.plan, 'mismatch')
  }
  // FINAL BOARD (condition 4): only with a spec — the declaration's, or symbols the words name in lowercase that the plan resolved
  const known = [...new Set([...created, ...effects.map(e => e.symbol).filter(Boolean)])]
  const spec = decl.final || (knownIn(w, known).length ? finalSpec(w, host, known) : null)
  let final = 'skip'
  // …and only for a plan that changes which charts the board holds (a creation, a removal, a re-symbol, a switch) — a write to a
  // chart's content (a compare overlay, an indicator) leaves the board's charts as they are
  const composes = created.length || unknownCreates || effects.some(e => e.kind !== 'content')
  if (spec && composes) {
    final = 'ok'
    const charts = liveCharts(host)
    const gone = new Set(effects.filter(e => e.effect === 'remove' || e.effect === 'switch').map(e => e.ref))
    const symbolNow = new Map()
    for (const ee of chartEffects(plan, host)) if (ee.type === 'symbol' && ee.to) symbolNow.set(String(ee.ref), up(ee.to))
    const stays = charts.filter(c => !gone.has(String(c.ref))).map(c => symbolNow.get(String(c.ref)) || up(c.symbol))
    const board = [...stays, ...created]
    const bad = (why) => { final = 'fail'; miss('final', why) }
    // (i) a declared-kept ticker is never created again (unless the words ask for another copy)
    if (created.some(s => spec.keptSymbols.includes(s) && !spec.another.includes(s))) bad('duplicate-kept')
    // (ii) every named off-board ticker is on the final board (a plan whose creations cannot be read cannot show it)
    if (!unknownCreates && spec.required.some(s => !board.includes(s))) bad('missing-named')
    // (iii) at least the count asked
    if (!unknownCreates && spec.minTotal != null && board.length < spec.minTotal) bad('count')
    if (!unknownCreates && spec.minCreated != null && created.length < spec.minCreated) bad('count')
    // a kept panel that is not on the final board (removed or switched away) — the identity check, said once for the board
    if (spec.keptRefs.some(r => gone.has(String(r))) && !decl.move) bad('kept-gone')
    if (final === 'ok') kinds.final.match++
  }
  const any = (k) => Object.values(kinds).some(x => x[k] > 0)
  return { verdict: any('mismatch') ? 'mismatch' : any('open') ? 'open' : any('match') ? 'match' : 'none', kinds, mismatches, final }
}

/**
 * F5 fan-out: one declaration, several per-chart plans. Each plan is validated on its own; the UNION of the existing charts
 * they write must EQUAL the declared chart set (no chart left out, none added).
 */
export function validateFanOut(plans, decl, { host = null, words = '' } = {}) {
  const results = (plans || []).map(p => validateDeclaration(p, decl, { host, words }))
  const kinds = blank()
  const mismatches = []
  for (const r of results) { for (const k of TD_KINDS) for (const v of ['match', 'mismatch', 'open']) kinds[k][v] += r.kinds[k][v]; mismatches.push(...r.mismatches) }
  const written = new Set()
  for (const p of plans || []) { try { for (const e of planEffects(p, host).effects) if (e.ref != null && e.kind !== 'multiChart') written.add(e.ref) } catch { /* counted by its own result */ } }
  const declared = new Set((decl?.entries || []).filter(e => e.family === 'chart' && e.effect !== 'switch').map(e => e.ref))
  const extra = [...written].filter(r => !declared.has(r))
  const missing = [...declared].filter(r => !written.has(r))
  if (decl && !decl.error && (extra.length || missing.length)) {
    kinds.fanout.mismatch++
    mismatches.push({ kind: 'fanout', why: extra.length ? 'fan-extra' : 'fan-missing' })
  } else if (written.size) kinds.fanout.match++
  const any = (k) => Object.values(kinds).some(x => x[k] > 0)
  return { verdict: any('mismatch') ? 'mismatch' : any('open') ? 'open' : any('match') ? 'match' : 'none', kinds, mismatches, results }
}

/**
 * Would ENFORCEMENT refuse? Only kinds in `enforced` count; in an enforced kind a mismatch AND an open both refuse (condition 1:
 * open is never a bypass). Shadow passes an empty set: nothing refuses.
 */
export function refusesUnder(result, enforced = new Set()) {
  if (!result?.kinds) return false
  for (const k of enforced) {
    const c = result.kinds[k]
    if (c && (c.mismatch > 0 || c.open > 0)) return true
  }
  return false
}

// ── shadow telemetry (condition 9): counts, letters and names only ────────────────────────────────────────────────────────
export const TELEMETRY_FIELDS = ['td', 'tdPath', 'tdKinds', 'tdCounts', 'tdFinal', 'tdVia', 'tdOpen']
const LETTER = (c) => (c.mismatch ? 'x' : c.open ? 'o' : c.match ? 'm' : null)
/**
 * The fields a shadow run adds to the existing telemetry record:
 *   td        verdict: 'none' | 'match' | 'mismatch' | 'open'
 *   tdPath    the execute path ('fast' | 'model' | 'approved' | 'card' | 'fan' | 'deferred' | 'split')
 *   tdKinds   { kind: 'm' | 'x' | 'o' } for each kind with an effect
 *   tdCounts  { match, mismatch, open } totals
 *   tdFinal   'skip' | 'ok' | 'fail'
 *   tdVia     the evidence TYPES the declaration used (e.g. ['click', 'named']) — never the refs
 *   tdOpen    the kinds the declaration left open
 * No member words, symbols or ids.
 */
export function shadowTelemetry(result, decl, { path = null } = {}) {
  const kinds = {}
  const counts = { match: 0, mismatch: 0, open: 0 }
  for (const k of TD_KINDS) {
    const c = result?.kinds?.[k]
    if (!c) continue
    const l = LETTER(c)
    if (l) kinds[k] = l
    counts.match += c.match; counts.mismatch += c.mismatch; counts.open += c.open
  }
  const PATHS = ['fast', 'model', 'approved', 'card', 'fan', 'deferred', 'split']
  return {
    td: ['none', 'match', 'mismatch', 'open'].includes(result?.verdict) ? result.verdict : 'none',
    tdPath: PATHS.includes(path) ? path : 'other',
    tdKinds: kinds,
    tdCounts: counts,
    tdFinal: ['skip', 'ok', 'fail'].includes(result?.final) ? result.final : 'skip',
    tdVia: [...new Set((decl?.entries || []).map(e => e.via).filter(v => VIAS.has(v)))].sort(),
    tdOpen: (decl?.open || []).filter(k => TD_KINDS.includes(k)),
  }
}
const VIAS = new Set(['named', 'all', 'board', 'click', 'subject', 'created', 'sole', 'layout', 'alias', 'card'])
