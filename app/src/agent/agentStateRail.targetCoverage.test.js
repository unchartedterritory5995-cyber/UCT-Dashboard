// ⛔ STATE RAIL TARGET COVERAGE (AUDIT safety, 2026-11-17) — for every state-rail effect that targets a SPECIFIC object, the
// member's WORDS must pick out THE object the plan acts on. The class of three recent bugs: "delete the MACD alert" licensed
// deleting the RSI alert; "move the news widget into the watchlist tabs" licensed moving the calendar; "revert to the previous
// version" licensed restoring v1 instead of v4.
//
// Method: the rail's reader kinds are read at runtime (stateRail.STATE_KINDS — the census's own enumeration); for each kind
// whose effects target an object, a fixture holds 2–3 objects of that kind (qa/testing/targetBoard.js) and the REAL planner
// (executor.planOps) builds one plan aimed at each. Target-naming phrasings are generated (verbs × object phrases × casing /
// politeness variants). An INDEPENDENT oracle (qa/testing/targetOracle.js — never the rail's code) says which object the words
// pick out: when it picks X, plans at any other object must be REFUSED (and the plan at X should be licensed); when it says
// none / ambiguous, EVERY plan must be refused (or asked). NON-VACUITY: a target-bearing kind with 0 cases, or with no plan
// at a "different" object, fails the suite.
//
// RATCHET: master's findings on the day this landed are LOCKED (qa/testing/targetCoverage.lock.json — per capability, per class:
// wrongTarget / ambiguity / allCapsOnly, as stable case ids). A finding not in the lock, or a class count that rises, fails. A
// finding that disappears passes and prints "lock can shrink: <ids>"; the lock-hygiene test then fails until the PR removes
// those ids (UPDATE_TARGET_LOCK=1 — it refuses to ADD ids) or records an explicit decision for one. Over-refusals (the words pick
// X, the plan at X is refused) are reported in the lock, never locked against.
import { describe, it, expect, vi, beforeAll } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { registerBuiltins } from './builtins'
import { getCapability } from './capabilities'
import { planOps, collectTargets, planShape } from './executor'
import { stateEffects, stateRailDecision, STATE_KINDS } from './stateRail'
import { targetFixture, LISTS } from './qa/testing/targetBoard'
import { oracle } from './qa/testing/targetOracle'

vi.stubEnv('VITE_INDICATOR_TEMPLATES_ENABLED', '1')
registerBuiltins()

const ENV = { mcGroups: [], boundDrawingIds: new Set(), boundAlerts: [], positionQuotes: { SPY: 105 } }
const CTX = { surface: 'charts' }
const lex = (dim, map) => Object.entries(map).flatMap(([values, phrases]) => phrases.map(phrase => ({ dim, phrase, values: values.split('|') })))
const ALL = (cls, phrases) => lex('cls', { [cls]: phrases })

// ── the kinds, their objects (facets), their lexicon, and the capabilities that act on one object ──
const IND = [['ovl:0', 'ema', '9', 'EMA 9'], ['ovl:1', 'ema', '20', 'EMA 20'], ['ovl:2', 'sma', '50', 'SMA 50'], ['ovl:3', 'sma', '200', 'SMA 200'], ['inst:rsi:1', 'rsi', '14', 'RSI (14)']]
const CHARTS = [['c1', 'spy'], ['c2', 'nvda']]
const indCands = CHARTS.flatMap(([c, sym]) => IND.map(([inst, ind, len, card]) => ({ id: `${c}/${inst}`, ref: `ixe:${c}`, inst, facets: { ind, len, sym, cls: 'indicator' }, card: [card, `Chart ${c}`] })))
const indObjs = ['the RSI', 'the 20 EMA', 'the EMA 20', 'the 9 ema', 'the 50 SMA', 'the 200 SMA', 'the 200', 'the 50', 'the EMA', 'the SMA', 'the moving average',
  'the MACD', 'the 100 SMA', 'the indicator', 'the RSI on NVDA', 'the 20 EMA on NVDA', 'the 50 SMA on SPY', 'the RSI on AAPL', 'the ATR',
  // (AUDIT synonyms: "graph" for chart, $-tickers)
  'the RSI on the NVDA graph', 'the RSI on $NVDA', 'the 20 EMA on the $NVDA chart', 'the 50 SMA on the SPY graph']
const indLex = [...lex('ind', { ema: ['ema', 'exponential'], sma: ['sma', 'simple'], rsi: ['rsi'], 'ema|sma': ['moving average', 'average', 'ma'], macd: ['macd'], atr: ['atr'] }),
  ...lex('len', { 9: ['9'], 20: ['20'], 50: ['50'], 200: ['200'], 14: ['14'], 100: ['100'] }), ...lex('sym', { spy: ['spy'], nvda: ['nvda'], aapl: ['aapl'] }), ...ALL('indicator', ['indicator', 'study'])]

const DRAW = [['dr-h', 'SPY', 'horizontal', null, 'Horizontal'], ['dr-t', 'SPY', 'trendline', null, 'Trendline'], ['dr-f', 'SPY', 'fib', null, 'Fib'], ['dr-p', 'SPY', 'position', null, 'osition'],
  ['dr-x', 'SPY', 'text', 'note', 'Note'], ['dr-n', 'NVDA', 'horizontal', null, 'Horizontal']]
const drawCands = DRAW.map(([id, sym, dtype, label, card]) => ({ id, ref: sym, facets: { dtype, sym: sym.toLowerCase(), label, cls: 'drawing' }, card: [card, sym] }))
const drawObjs = ['the trendline', 'the horizontal line', 'the fib', 'the position', 'the long position', 'the Note text', 'the text', 'the line', 'the drawing', 'the box',
  'the horizontal line on NVDA', 'the horizontal line on SPY', 'the trendline on NVDA', 'the fib on NVDA', 'the ray',
  'the horizontal line on $NVDA', 'the trendline on the SPY graph', 'the horizontal line on the NVDA graph']
const drawLex = [...lex('dtype', { horizontal: ['horizontal line', 'horizontal', 'hline'], trendline: ['trendline', 'trend line'], fib: ['fib', 'fibonacci'], position: ['position', 'long position'],
  text: ['text', 'label'], 'horizontal|trendline': ['line'], rect: ['box', 'rectangle'], ray: ['ray'] }), ...lex('label', { note: ['note'] }), ...lex('sym', { spy: ['spy'], nvda: ['nvda'], aapl: ['aapl'] }), ...ALL('drawing', ['drawing'])]

const clearCands = [{ id: 'SPY', ref: 'SPY', facets: { sym: 'spy', cls: 'drawing' }, card: ['SPY'] }, { id: 'NVDA', ref: 'NVDA', facets: { sym: 'nvda', cls: 'drawing' }, card: ['NVDA'] }]
const clearLex = [...lex('sym', { spy: ['spy'], nvda: ['nvda'], aapl: ['aapl'] }), ...ALL('drawing', ['drawings'])]

const boardCands = [{ id: 'Swing board', ref: 'drawingBoards', facets: { name: 'swing', cls: 'board' }, card: ['Swing board'] }, { id: 'Macro board', ref: 'drawingBoards', facets: { name: 'macro', cls: 'board' }, card: ['Macro board'] }]
const boardLex = [...lex('name', { swing: ['swing'], macro: ['macro'], options: ['options'] }), ...ALL('board', ['board', 'drawing board'])]
const boardObjs = ['the Swing board', 'the Macro board', 'the Swing drawing board', 'the board', 'the drawing board', 'the Options board']

const listCands = LISTS.map(l => ({ id: l.id, ref: l.id, facets: { list: l.name.toLowerCase(), cls: 'list' }, card: [l.name] }))
const listLex = [...lex('list', { tech: ['tech'], swing: ['swing'], growth: ['growth'], value: ['value'], momentum: ['momentum'] }), ...ALL('list', ['watchlist', 'list'])]
const listObjs = ['my Swing watchlist', 'the Value list', 'the Tech list', 'my Growth watchlist', 'the watchlist', 'my list', 'my Momentum list']
const SYMS = ['SPY', 'NVDA', 'AMD', 'TSLA', 'META', 'CRWD', 'NET', 'KO', 'PG', 'AAPL', 'MSFT']
const symLex = lex('sym', Object.fromEntries(SYMS.map(s => [s.toLowerCase(), [s.toLowerCase()]])))
const rowCands = LISTS.flatMap(l => l.symbols.map(s => ({ id: `${l.id}/${s}`, ref: l.id, sym: s, facets: { list: l.name.toLowerCase(), sym: s.toLowerCase(), cls: 'list' }, card: [s, l.name] })))
const rowWords = [...SYMS.filter(s => s !== 'MSFT').flatMap(s => [`remove ${s}`, `remove ${s} from my list`, ...LISTS.map(l => `remove ${s} from ${l.name}`)]), 'take AMD off Tech', 'drop NET from Growth', 'take KO off my Value list', 'remove MSFT from Tech',
  // (AUDIT synonyms: $-tickers; the fixture's lists have no nicknames)
  'remove $AMD from Tech', 'remove $TSLA from my Swing list', 'take $NET off Growth', 'remove $AAPL from Tech', 'remove $SPY from Swing']
const noteCands = rowCands.filter(r => LISTS.find(l => l.id === r.ref).notes?.[r.sym])
const noteWords = ['change the note on SPY to hold', 'change my TSLA note to hold', 'set the note on SPY in Tech to hold', 'replace the TSLA note in Swing with hold', 'change my note to hold', 'change the note on NVDA to hold', 'change the AMD note to hold']
const flagCands = ['SPY', 'AMD'].map(s => ({ id: s, ref: 'flagged', facets: { sym: s.toLowerCase(), cls: 'flag' }, card: [s] }))
const flagWords = ['unflag SPY', 'unflag AMD', 'remove the flag from AMD', 'remove SPY from my flagged list', 'unflag NVDA', 'unflag it', 'clear the flag on AMD', 'unflag $AMD', 'unflag $NVDA']

const W = [['wl', 'watchlist', 'tech', 'Watchlist'], ['sc', 'scanner', 'hv', 'Scanner'], ['wg', 'watchlist', 'growth', 'Watchlist']]
const widCands = W.map(([id, wtype, shows, card]) => ({ id, ref: 'board', facets: { wtype, shows, cls: 'widget' }, card: [card] }))
const widLex = [...lex('wtype', { watchlist: ['watchlist widget', 'watchlist'], scanner: ['scanner', 'scan'], news: ['news widget', 'news'], chart: ['chart', 'graph'] }),
  ...lex('shows', { tech: ['tech'], growth: ['growth'], hv: ['highest volume'] }), ...ALL('widget', ['widget', 'panel'])]
const widObjs = ['the scanner', 'the scanner widget', 'the Growth watchlist', 'the Tech watchlist widget', 'the watchlist widget', 'the widget', 'the news widget', 'the highest volume scanner',
  // (AUDIT synonyms: "panel" for widget, "graph" for chart)
  'the scanner panel', 'the Growth watchlist panel', 'the watchlist panel', 'the panel', 'the graph']
const tabCands = [{ id: '1', ref: 'board', facets: { tab: 'news', cls: 'tab' }, card: ['News'] }, { id: '2', ref: 'board', facets: { tab: 'calendar', cls: 'tab' }, card: ['Calendar'] }]
const tabLex = [...lex('tab', { news: ['news'], calendar: ['calendar'], screener: ['screener'] }), ...ALL('tab', ['tab'])]
const tabObjs = ['the news tab', 'the calendar tab', 'the tab', 'the screener tab', 'the News tab on the Tech watchlist', 'the news tab on the Tech watchlist panel']
const showCands = widCands.filter(c => c.facets.wtype === 'watchlist')

const layCands = [[11, 'Mine'], [12, 'Swing'], [13, 'Day']].map(([id, name]) => ({ id: String(id), ref: 'layouts', facets: { name: name.toLowerCase(), cls: 'layout' }, card: [name] }))
const layLex = [...lex('name', { mine: ['mine'], swing: ['swing'], day: ['day'], weekly: ['weekly'] }), ...ALL('layout', ['layout'])]
const layObjs = ['my Swing layout', 'the Day layout', 'the Mine layout', 'my layout', 'the layout', 'the Weekly layout', 'Swing']
const dockCands = layCands.map(c => ({ ...c, ref: 'layoutDock' }))
const dockWords = ['unpin Swing from the bar', 'take the Day layout off the layout bar', 'remove Mine from the layout bar', 'unpin my layout from the bar', 'unpin the Weekly layout', 'unpin Swing', 'take Day off the bar']

const TPL = [['Dark', 'chart', 'chartTemplates'], ['Light', 'chart', 'chartTemplates'], ['Momentum', 'indicator', 'indicatorTemplates'], ['Breakout', 'indicator', 'indicatorTemplates']]
const tplCands = TPL.map(([name, tkind, ref]) => ({ id: name, ref, facets: { name: name.toLowerCase(), tkind, cls: 'template' }, card: [name] }))
const tplLex = [...lex('name', { dark: ['dark'], light: ['light'], momentum: ['momentum'], breakout: ['breakout'], neon: ['neon'] }),
  ...lex('tkind', { chart: ['chart template'], indicator: ['indicator template'] }), ...ALL('template', ['template'])]
const tplObjs = ['the Dark template', 'my Light chart template', 'the Momentum template', 'the Breakout indicator template', 'the template', 'the chart template', 'the indicator template', 'the Neon template', 'the Dark indicator template']

const colCands = [['Earnings'], ['Watch']].map(([name]) => ({ id: name, ref: 'library', facets: { name: name.toLowerCase(), cls: 'collection' }, card: [name] }))
const colLex = [...lex('name', { earnings: ['earnings'], watch: ['watch'], macro: ['macro'] }), ...ALL('collection', ['collection'])]
const colObjs = ['my Earnings collection', 'the Watch collection', 'the collection', 'the Macro collection', 'my news collection']

const v = (verbs, objs) => verbs.flatMap(t => objs.map(o => t.replace('{o}', o)))
const REMOVE = ['remove {o}', 'delete {o}', 'get rid of {o}']
// each: kind (the rail's reader kind), cap, candidates (all existing objects of that kind), args per candidate, words, defaults
const SPECS = [
  { kind: 'indicatorEdits', cap: 'indicator.remove', cands: indCands, args: c => ({ instance: c.inst }), lexicon: indLex, defaults: { sym: 'spy' }, words: v([...REMOVE, 'take off {o}'], indObjs) },
  { kind: 'indicatorEdits', cap: 'indicatorStyle.set', cands: indCands, args: c => ({ instance: c.inst, property: 'color', value: 'red' }), lexicon: indLex, defaults: { sym: 'spy' }, words: v(['make {o} red', 'change {o} color to red', 'color {o} red'], indObjs) },
  { kind: 'drawing', cap: 'drawing.remove', cands: drawCands, args: c => ({ drawing: c.id }), lexicon: drawLex, defaults: { sym: 'spy' }, words: v(REMOVE, drawObjs) },
  { kind: 'drawing', cap: 'drawing.style', cands: drawCands, args: c => ({ drawing: c.id, color: 'red' }), lexicon: drawLex, defaults: { sym: 'spy' }, words: v(['make {o} red', 'change {o} to red', 'recolor {o} red'], drawObjs) },
  { kind: 'drawing', cap: 'drawing.clear', cands: clearCands, args: () => ({}), lexicon: clearLex, defaults: { sym: 'spy' }, words: v(['clear {o}', 'remove {o}', 'delete {o}'], ['all drawings on SPY', 'all the drawings on NVDA', 'all drawings', 'all drawings on AAPL', 'all drawings on $NVDA', 'all drawings on the NVDA graph']) },
  { kind: 'drawingBoards', cap: 'drawing.deleteBoard', cands: boardCands, args: c => ({ board: c.id }), lexicon: boardLex, words: v(REMOVE, boardObjs) },
  { kind: 'drawingBoards', cap: 'drawing.renameBoard', cands: boardCands, args: c => ({ board: c.id, to: 'Zeta' }), lexicon: boardLex, words: v(['rename {o} to Zeta', 'call {o} Zeta'], boardObjs) },
  { kind: 'watchlist', cap: 'watchlist.delete', cands: listCands, args: () => ({}), lexicon: listLex, words: v(REMOVE, listObjs) },
  { kind: 'watchlist', cap: 'watchlist.clear', cands: listCands, args: () => ({}), lexicon: listLex, words: v(['clear {o}', 'empty {o}', 'remove every symbol from {o}'], listObjs) },
  { kind: 'watchlist', cap: 'watchlist.rename', cands: listCands, args: () => ({ name: 'Zeta' }), lexicon: listLex, words: v(['rename {o} to Zeta', 'call {o} Zeta'], listObjs) },
  { kind: 'watchlist', cap: 'watchlist.remove', cands: rowCands, args: c => ({ symbols: [c.sym] }), lexicon: [...listLex, ...symLex], words: rowWords },
  { kind: 'watchlist', cap: 'watchlist.setNote', cands: noteCands, args: c => ({ symbol: c.sym, note: 'hold' }), lexicon: [...listLex, ...symLex, ...ALL('list', ['note'])], words: noteWords },
  { kind: 'flaggedList', cap: 'watchlist.setFlag', cands: flagCands, args: c => ({ symbols: [c.id], flagged: false }), lexicon: [...symLex, ...ALL('flag', ['flag', 'flagged'])], words: flagWords },
  { kind: 'board', cap: 'widget.remove', cands: widCands, args: c => ({ widget: c.id }), lexicon: widLex, words: v(['remove {o}', 'close {o}', 'delete {o}'], widObjs) },
  { kind: 'board', cap: 'widget.closeTab', cands: tabCands, args: c => ({ widget: 'wl', tab: c.id }), lexicon: tabLex, words: v(['close {o}', 'remove {o}'], tabObjs) },
  { kind: 'board', cap: 'widget.showList', cands: showCands, args: c => ({ widget: c.id, list: 'wl2' }), lexicon: widLex, words: v(['show Swing in {o}', 'switch {o} to Swing', 'make {o} show my Swing list'], widObjs) },
  { kind: 'layouts', cap: 'layout.delete', cands: layCands, args: c => ({ layout: c.id }), lexicon: layLex, words: v(REMOVE, layObjs) },
  { kind: 'layouts', cap: 'layout.rename', cands: layCands, args: c => ({ layout: c.id, name: 'Zeta' }), lexicon: layLex, words: v(['rename {o} to Zeta', 'call {o} Zeta'], layObjs) },
  { kind: 'layoutDock', cap: 'layout.unpinFromBar', cands: dockCands, args: c => ({ layout: c.id }), lexicon: layLex, words: dockWords },
  { kind: 'chartTemplates', cap: 'chartSetup.deleteTemplate', cands: tplCands, args: c => ({ name: c.id }), lexicon: tplLex, words: v(REMOVE, tplObjs) },
  { kind: 'indicatorTemplates', cap: 'indicatorTemplate.delete', cands: tplCands, args: c => ({ name: c.id }), lexicon: tplLex, words: v(REMOVE, tplObjs) },
  { kind: 'newsLibrary', cap: 'newsLibrary.deleteCollection', cands: colCands, args: c => ({ collection: c.id }), lexicon: colLex, words: v(REMOVE, colObjs) },
  { kind: 'newsLibrary', cap: 'newsLibrary.collection', cands: colCands, args: c => ({ op: 'rename', collection: c.id, name: 'Zeta' }), lexicon: colLex, words: v(['rename {o} to Zeta', 'call {o} Zeta'], colObjs) },
]
// reader kinds with NO object-specific target this suite can aim at (each with its reason; a NEW reader kind fails until listed
// here or covered above)
const NO_TARGET = {
  chart: 'a whole-chart settings write (chart.applyTemplate): the object is the CHART, which the chart rail census owns',
  workspace: 'a widget ADD — its only removal is its own Undo shape',
  definitionLibrary: 'no registered capability plans a saved-definition delete on the Charts fixture (state-rail census)',
}
const VARIANTS = (w) => [w, `please ${w}`, `can you ${w}?`, w.toUpperCase()]
const RAIL_STATE = { indicatorEdits: 'indicator', drawing: 'drawing', drawingBoards: 'drawingBoard', watchlist: 'watchlist', flaggedList: 'watchlist', board: 'widget', layouts: 'layout', layoutDock: 'layoutBar', chartTemplates: 'template', indicatorTemplates: 'template', newsLibrary: 'newsLibrary' }

function plansFor(spec) {
  const out = []
  for (const c of spec.cands) {
    const { host, scope } = targetFixture()
    const cap = getCapability(spec.cap)
    let plan
    try { plan = planOps(collectTargets(host, [cap.target]), [{ action: spec.cap, target: c.ref, args: spec.args(c) }], ENV, CTX) } catch { continue }
    if (!plan.ok) continue
    const eff = stateEffects(plan, scope)
    if (!eff.length) continue
    const shape = planShape(plan)
    const card = shape.confirm || shape.irreversible
    const lines = (plan.lines || []).join(' | ')
    out.push({ cand: c, plan, scope, eff, card, lines, cardNames: card && c.card.every(t => lines.includes(t)) })
  }
  return out
}
const licensed = (p, words) => { const d = stateRailDecision(p.plan, { words, scope: p.scope }); return d === null || d?.card === true }


// ── case ids: stable across runs and orderings — a hash of the board version, the capability, the phrasing and the object
// the plan was aimed at (FNV-1a 64) ──
export const BOARD = 'targetBoard-v1'
const fnv64 = (s) => { let h = 0xcbf29ce484222325n; for (const ch of new TextEncoder().encode(s)) { h ^= BigInt(ch); h = (h * 0x100000001b3n) & 0xffffffffffffffffn } return h.toString(16).padStart(16, '0') }
export const caseId = (cap, words, plannedAt) => fnv64(`${BOARD}|${cap}|${words}|${plannedAt}`)
const isCaps = (base, words) => words === base.toUpperCase() && words !== base
// finding classes (locked): wrongTarget — the words pick X, a plan at Y is licensed; ambiguity — the words pick none / several,
// a plan is licensed; allCapsOnly — a finding that exists ONLY in the all-caps variant of its phrasing (its other variants refused).
// overRefusal (reported, never locked): the words pick X and the plan at X is refused.
export const LOCKED_CLASSES = ['wrongTarget', 'ambiguity', 'allCapsOnly']


export function runCoverage(specs = SPECS) {
  const rows = []
  for (const spec of specs) {
    const plans = plansFor(spec)
    const r = { kind: spec.kind, state: RAIL_STATE[spec.kind], cap: spec.cap, plans: plans.length, cases: 0, otherPlans: 0, caseIds: new Set(), findings: [], overRefusal: [], defaultOnly: 0 }
    for (const base of spec.words) for (const words of VARIANTS(base)) {
      const o = oracle(words, spec.cands, spec.lexicon, spec.defaults || {})
      const raw = spec.defaults ? oracle(words, spec.cands, spec.lexicon, {}) : o
      for (const p of plans) {
        r.cases++
        // EVERY generated case has an id (finding or not): the case set is locked too, so a finding can only leave the lock
        // when its case is still generated and now passes — never because its case stopped being generated
        r.caseIds.add(caseId(spec.cap, words, p.cand.id))
        const ok = licensed(p, words)
        const isPick = o.result === 'pick' && o.id === p.cand.id
        if (!isPick) r.otherPlans++
        if (isPick) { if (!ok) r.overRefusal.push(caseId(spec.cap, words, p.cand.id)); continue }
        if (!ok) continue
        // licensed for an object the words do not pick out — unless only the oracle's default scope said so
        const byDefault = (raw.result !== o.result || raw.id !== o.id) && (raw.result !== 'pick' || raw.id === p.cand.id)
        if (byDefault) { r.defaultOnly++; continue }
        r.findings.push({ id: caseId(spec.cap, words, p.cand.id), base, caps: isCaps(base, words), words, oracle: o.result === 'pick' ? `pick ${o.id}` : o.result, plannedAt: p.cand.id, card: p.card, cardNames: p.cardNames, lines: p.lines })
      }
    }
    // classify: an all-caps finding whose other variants (same phrasing, same object) were all refused is allCapsOnly
    const other = new Set(r.findings.filter(f => !f.caps).map(f => `${f.base}|${f.plannedAt}`))
    for (const f of r.findings) f.cls = f.caps && !other.has(`${f.base}|${f.plannedAt}`) ? 'allCapsOnly' : f.oracle.startsWith('pick') ? 'wrongTarget' : 'ambiguity'
    rows.push(r)
  }
  return rows
}

// ── THE RATCHET (lock: qa/testing/targetCoverage.lock.json) — today's findings, by capability and class, may only SHRINK, and
// only by being FIXED (the case still generated, now passing). The CASE SET is locked per capability (count + hash of every
// case id), so editing the generator / lexicon / fixture is visible: a finding whose case VANISHED fails (`vanished-case`)
// unless `decisions` names it ──
const LOCK_PATH = resolve(globalThis.process.cwd(), 'src/agent/qa/testing/targetCoverage.lock.json')
const readLock = () => { try { return JSON.parse(readFileSync(LOCK_PATH, 'utf8')) } catch { return null } }
const idsOf = (r, cls) => [...new Set(r.findings.filter(f => f.cls === cls).map(f => f.id))].sort()
export const caseSetOf = (r) => { const ids = [...r.caseIds].sort(); return { count: ids.length, hash: fnv64(ids.join(',')) } }
/** The lock a fresh run supports: every locked class's ids (sorted), counts, the over-refusals (reported only), the case set. */
export function lockOf(rows, decisions = {}) {
  const capabilities = {}, caseSet = {}
  for (const r of rows) {
    const e = { kind: r.kind, counts: {} }
    for (const c of LOCKED_CLASSES) { e[c] = idsOf(r, c); e.counts[c] = e[c].length }
    e.counts.overRefusal = new Set(r.overRefusal).size
    capabilities[r.cap] = e
    caseSet[r.cap] = caseSetOf(r)
  }
  return { version: 2, board: BOARD, note: 'Target-coverage ratchet (agentStateRail.targetCoverage.test.js). Finding ids may only be REMOVED, and only when FIXED (their case is still generated and now passes): UPDATE_TARGET_LOCK=1 rewrites the lock, refuses to add an id, and refuses when a case that held a finding is no longer generated. caseSet locks each capability\'s generated cases (count + hash of every case id). overRefusal is reported, never locked. `decisions`: { id: reason } keeps a locked id whose case vanished or that no longer reproduces, on purpose.', capabilities, caseSet, decisions }
}
/** Against the lock: NEW ids, count rises, FIXED ids (case generated, now passing), VANISHED ids (case no longer generated,
 *  no decision), and case-set changes. */
export function compareLock(rows, lock) {
  const added = [], rises = [], fixed = [], vanished = [], caseSet = []
  const decided = lock?.decisions || {}
  for (const r of rows) {
    const l = lock?.capabilities?.[r.cap]
    const found = new Set(r.findings.map(f => f.id))
    for (const c of LOCKED_CLASSES) {
      const fresh = idsOf(r, c), had = new Set(l?.[c] || [])
      for (const id of fresh) if (!had.has(id)) { const f = r.findings.find(x => x.id === id); added.push(`${r.cap} [${c}] ${id} "${f.words}" → oracle ${f.oracle}, licensed at ${f.plannedAt}${f.card ? '' : ' (auto-applies)'}`) }
      if (fresh.length > (l?.counts?.[c] ?? 0)) rises.push(`${r.cap} [${c}] ${l?.counts?.[c] ?? 0} → ${fresh.length}`)
      const now = new Set(fresh)
      for (const id of had) {
        if (now.has(id) || found.has(id)) continue                     // still found (another class: that is an ADD there)
        if (r.caseIds.has(id)) fixed.push({ cap: r.cap, cls: c, id })
        else if (!decided[id]) vanished.push({ cap: r.cap, cls: c, id })
      }
    }
    const want = lock?.caseSet?.[r.cap], got = caseSetOf(r)
    if (!want || want.count !== got.count || want.hash !== got.hash) caseSet.push(`${r.cap}: lock ${want ? `${want.count}/${want.hash}` : 'none'} → fresh ${got.count}/${got.hash}`)
  }
  // a capability the lock lists that the suite no longer runs: every case vanished
  for (const [cap, l] of Object.entries(lock?.capabilities || {})) {
    if (rows.some(r => r.cap === cap)) continue
    for (const c of LOCKED_CLASSES) for (const id of l[c] || []) if (!decided[id]) vanished.push({ cap, cls: c, id })
    caseSet.push(`${cap}: no longer generated`)
  }
  return { added, rises, fixed, vanished, caseSet }
}
/** UPDATE_TARGET_LOCK=1: the shrunk lock, or { error } — never adds an id, never drops one whose case vanished. */
export function updatedLock(rows, lock) {
  if (!lock) return { error: 'UPDATE_TARGET_LOCK=1: no lock to update' }
  const { added, vanished } = compareLock(rows, lock)
  if (added.length) return { error: `UPDATE_TARGET_LOCK=1 refuses to ADD ids (${added.length}):\n${added.slice(0, 20).join('\n')}` }
  if (vanished.length) return { error: `UPDATE_TARGET_LOCK=1 refuses: vanished-case — ${vanished.length} locked finding(s) whose case is no longer generated (restore the case, or name it in decisions):\n${vanished.slice(0, 20).map(v => `${v.cap} [${v.cls}] ${v.id}`).join('\n')}` }
  const fresh = lockOf(rows, lock.decisions || {})
  // (an id an explicit decision keeps stays in the lock)
  for (const id of Object.keys(lock.decisions || {})) for (const [cap, l] of Object.entries(lock.capabilities)) for (const c of LOCKED_CLASSES) if ((l[c] || []).includes(id) && fresh.capabilities[cap] && !fresh.capabilities[cap][c].includes(id)) { fresh.capabilities[cap][c] = [...fresh.capabilities[cap][c], id].sort(); fresh.capabilities[cap].counts[c]++ }
  return { lock: fresh }
}

let ROWS = []
beforeAll(() => {
  ROWS = runCoverage()
  // UPDATE_TARGET_LOCK=1: rewrite the lock from a fresh run (updatedLock's rules). UPDATE_TARGET_LOCK=bootstrap: write the
  // first lock, only when none exists (a baseline PR — the lock grows only there, its counts in the PR body).
  const mode = globalThis.process.env.UPDATE_TARGET_LOCK
  if (!mode) return
  const lock = readLock()
  if (mode === 'bootstrap') {
    if (lock) throw new Error('UPDATE_TARGET_LOCK=bootstrap: a lock already exists — use UPDATE_TARGET_LOCK=1 (it may only shrink)')
    writeFileSync(LOCK_PATH, `${JSON.stringify(lockOf(ROWS), null, 1)}\n`)
    return
  }
  const u = updatedLock(ROWS, lock)
  if (u.error) throw new Error(u.error)
  writeFileSync(LOCK_PATH, `${JSON.stringify(u.lock, null, 1)}\n`)
}, 300000)

describe('STATE RAIL target coverage — the words must pick out THE object the plan acts on (ratchet)', () => {
  it('prints per-kind counts by class (non-vacuity: every capability has plans at 2+ objects and a plan at a different object)', () => {
    const lines = ROWS.map(r => {
      const n = (c) => r.findings.filter(f => f.cls === c).length
      const auto = r.findings.filter(f => !f.card).length, named = r.findings.filter(f => f.card && f.cardNames).length
      const seen = new Set(), ex = []
      for (const f of r.findings) { const k = `${f.oracle}>${f.plannedAt}`; if (!seen.has(k) && ex.length < 4) { seen.add(k); ex.push(`      "${f.words}" → oracle ${f.oracle}; licensed at ${f.plannedAt}${f.card ? '' : ' [no card]'} (${f.cls})`) } }
      return `  ${r.cap.padEnd(30)} [${r.kind}] plans ${r.plans} · cases ${r.cases} · other-object ${r.otherPlans} · wrongTarget ${n('wrongTarget')} · ambiguity ${n('ambiguity')} · allCapsOnly ${n('allCapsOnly')} · overRefusal ${new Set(r.overRefusal).size} · default-scope only ${r.defaultOnly} · (auto-apply ${auto} · card names target ${named} · card unnamed ${r.findings.length - auto - named})${ex.length ? `\n${ex.join('\n')}` : ''}`
    })
    console.log(`TARGET COVERAGE: ${ROWS.reduce((n, r) => n + r.cases, 0)} cases, ${ROWS.reduce((n, r) => n + r.findings.length, 0)} findings\n${lines.join('\n')}`)
    for (const r of ROWS) { expect(r.plans, `${r.cap}: no plan could be built`).toBeGreaterThan(1); expect(r.otherPlans, `${r.cap}: no different-object plan`).toBeGreaterThan(0); expect(r.caseIds.size, `${r.cap}: case ids collide`).toBe(r.cases) }
  })
  it('every target-bearing reader kind (stateRail.STATE_KINDS, read at runtime) is covered or exempt with a reason — a NEW kind fails here', () => {
    const covered = new Set(ROWS.filter(r => r.cases > 0 && r.otherPlans > 0).map(r => r.kind))
    expect(STATE_KINDS.filter(k => !covered.has(k) && !NO_TARGET[k])).toEqual([])
    // an exemption is only for a kind that exists and is not covered (a stale exemption fails)
    expect(Object.keys(NO_TARGET).filter(k => !STATE_KINDS.includes(k) || covered.has(k))).toEqual([])
    for (const [k, why] of Object.entries(NO_TARGET)) expect(why.length, k).toBeGreaterThan(20)
  })
  it('the lock exists, is for this board, and covers every capability the suite runs', () => {
    const lock = readLock()
    expect(lock, 'no lock — UPDATE_TARGET_LOCK=bootstrap writes the first one').toBeTruthy()
    expect(lock.board).toBe(BOARD)
    expect(ROWS.map(r => r.cap).filter(c => !lock.capabilities[c] || !lock.caseSet?.[c])).toEqual([])
  })
  for (const spec of SPECS) {
    it(`${spec.cap}: no finding beyond the lock, no vanished case, the case set as locked`, () => {
      const r = ROWS.find(x => x.cap === spec.cap)
      const lock = readLock() || {}
      const { added, rises, fixed, vanished, caseSet } = compareLock([r], { ...lock, capabilities: { [spec.cap]: lock.capabilities?.[spec.cap] } })
      if (fixed.length) console.log(`lock can shrink: ${spec.cap} ${fixed.map(g => `${g.cls}:${g.id}`).join(' ')}`)
      expect(added.slice(0, 20), `${added.length} NEW findings`).toEqual([])
      expect(rises).toEqual([])
      expect(vanished.map(v => `vanished-case ${v.cls}:${v.id}`).slice(0, 20), `${vanished.length} locked findings whose case is no longer generated`).toEqual([])
      expect(caseSet, 'the generated case set changed — update lock.caseSet in the same diff (UPDATE_TARGET_LOCK=1)').toEqual([])
    })
  }
  it('the committed lock holds no FIXED id (its case generated, now passing), unless an explicit decision keeps it (fixing PRs remove their ids)', () => {
    const lock = readLock() || {}
    const stale = compareLock(ROWS, lock).fixed.filter(g => !(lock.decisions || {})[g.id])
    expect(stale.map(g => `${g.cap} [${g.cls}] ${g.id}`).slice(0, 40), `${stale.length} fixed ids — run UPDATE_TARGET_LOCK=1 to remove them`).toEqual([])
  })
})

// ── the ratchet's own mutants (AUDIT hold on #1671): a fix shrinks the lock; a vanished case, an added phrasing never do ──
describe('target-coverage ratchet — mutants', () => {
  // every case id one phrasing generates (all its variants, at every object the capability's plans are aimed at)
  const allIdsOf = (r, base) => { const spec = SPECS.find(s => s.cap === r.cap); return new Set(VARIANTS(base).flatMap(w => spec.cands.map(c => caseId(r.cap, w, c.id))).filter(id => r.caseIds.has(id))) }
  // the row as if that phrasing were deleted from the generator: its cases (and so its findings) are no longer generated
  const drop = (r, base) => {
    const ids = allIdsOf(r, base)
    return { gone: new Set(r.findings.filter(f => ids.has(f.id)).map(f => f.id)), row: { ...r, caseIds: new Set([...r.caseIds].filter(id => !ids.has(id))), findings: r.findings.filter(f => !ids.has(f.id)) } }
  }
  const withFinding = () => ROWS.find(r => r.cap === 'widget.closeTab')
  it('deleting ONE phrasing from the generator → RED (vanished-case, the case set changed), never "lock can shrink"; UPDATE refuses', () => {
    const r = withFinding()
    const base = r.findings[0].base
    const { gone, row } = drop(r, base)
    expect(gone.size).toBeGreaterThan(0)
    const lock = readLock()
    const cmp = compareLock([row], { ...lock, capabilities: { [r.cap]: lock.capabilities[r.cap] } })
    expect(cmp.vanished.map(v => v.id).sort()).toEqual([...gone].sort())
    expect(cmp.fixed).toEqual([])
    expect(cmp.caseSet.length).toBe(1)
    expect(updatedLock([row], { ...lock, capabilities: { [r.cap]: lock.capabilities[r.cap] } }).error).toMatch(/vanished-case/)
    // …unless decisions names every one of them
    const decided = { ...lock, capabilities: { [r.cap]: lock.capabilities[r.cap] }, decisions: Object.fromEntries([...gone].map(id => [id, 'mutant'])) }
    expect(compareLock([row], decided).vanished).toEqual([])
  })
  it('a FIX (the case still generated, now passing) → "lock can shrink", and UPDATE removes exactly that id', () => {
    const r = withFinding()
    const f = r.findings[0]
    const row = { ...r, findings: r.findings.filter(x => x.id !== f.id) }
    const lock = readLock()
    const one = { ...lock, capabilities: { [r.cap]: lock.capabilities[r.cap] } }
    const cmp = compareLock([row], one)
    expect(cmp.fixed.map(x => x.id)).toEqual([f.id])
    expect([cmp.added, cmp.rises, cmp.vanished, cmp.caseSet]).toEqual([[], [], [], []])
    const u = updatedLock([row], one)
    expect(u.lock.capabilities[r.cap][f.cls]).toEqual(lock.capabilities[r.cap][f.cls].filter(id => id !== f.id))
    expect(u.lock.caseSet[r.cap]).toEqual(lock.caseSet[r.cap])
  })
  it('ADDING a phrasing → the case set changes (RED until the lock is updated), and its new findings are NEW ids → RED; UPDATE refuses', () => {
    const spec = SPECS.find(s => s.cap === 'widget.closeTab')
    const [row] = runCoverage([{ ...spec, words: [...spec.words, 'close the news tab right now'] }])
    const lock = readLock()
    const one = { ...lock, capabilities: { [spec.cap]: lock.capabilities[spec.cap] } }
    const cmp = compareLock([row], one)
    expect(cmp.caseSet.length).toBe(1)
    expect(cmp.added.length).toBeGreaterThan(0)
    expect(updatedLock([row], one).error).toMatch(/refuses to ADD/)
  })
  it('ADDING a phrasing with no finding → only the case set changes; UPDATE may record it (no id vanished, none added)', () => {
    const spec = SPECS.find(s => s.cap === 'watchlist.delete')
    const [row] = runCoverage([{ ...spec, words: [...spec.words, 'delete my Value watchlist right now'] }])
    const lock = readLock()
    const one = { ...lock, capabilities: { [spec.cap]: lock.capabilities[spec.cap] } }
    const cmp = compareLock([row], one)
    expect([cmp.added, cmp.vanished, cmp.caseSet.length]).toEqual([[], [], 1])
    const u = updatedLock([row], one)
    expect(u.error).toBeUndefined()
    expect(u.lock.caseSet[spec.cap]).toEqual(caseSetOf(row))
  })
})
