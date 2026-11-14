// ⛔ STATE RAIL (owner principle 2026-11-13: "An additive request must never be treated as permission to replace or destroy
// existing user state.") — stateRail.js, through the REAL panel (AgentPanel + useAgent + registry, planner, both rails,
// runtime) on a Charts workspace holding existing state of every kind (__fixtures__/stateBoard.js). Stand-in: the model
// (scripted, and scripted DESTRUCTIVE: it plans the wrong, destroying change — the direct action path, as #1210's tests did).
//   layer 1  the rail alone, GENERATED: every kind's destroying plan × additive verbs (add / put / include / insert / new /
//            another / also / more / as well / too / extra) × casing (lower / UPPER / Title) × with and without a verb → refused
//   layer 2  through the panel, the model scripted DESTRUCTIVE under additive words: nothing written, the reason said
//   layer 3  through the panel, the model inert: whatever the instant readers make of additive words, no existing state is lost
//   CONTROL  explicit words (remove / change / delete / replace / clear …) still work — at once with an exact Undo, or on the
//            card they always needed
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { AuthContext } from '../context/AuthContext'
import { planOps, collectTargets, prepareOps } from './executor'
import { buildContext } from './capabilities'
import { commitPlan, undoEntry } from './runtime'
import { stateRailRefusal, stateEffects, permits } from './stateRail'
import { stateFixture } from './__fixtures__/stateBoard'
import { buildDrawingSource } from './host'
import * as store from '../components/chart/drawingsStore'
import { indicatorRowsOf } from './capabilities/indicatorEdits'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
import AgentPanel from './AgentPanel'

vi.stubEnv('VITE_INDICATOR_TEMPLATES_ENABLED', '1')
registerBuiltins()

// ── the destroying plans, one or more per kind (each the model's wrong reading of an additive request) ──
const op = (action, target, args) => ({ action, target, args })
export const WRONG = {
  indicator: {
    'indicator.update (RSI 14 → 20)': [op('indicator.update', 'ixe:c1', { instance: 'inst:rsi:1', inputs: [{ key: 'period', value: 20 }] })],
    'indicator.remove (the RSI)': [op('indicator.remove', 'ixe:c1', { instance: 'inst:rsi:1' })],
    'chart.applyTemplate (indicators replaced)': [op('chart.applyTemplate', 'c1', { template: 'Dark' })],
  },
  drawing: {
    'drawing.clear (SPY)': [op('drawing.clear', 'SPY', {})],
    'drawing.remove (the trendline)': [op('drawing.remove', 'SPY', { drawing: 'dr-t' })],
    'drawing.style (the trendline restyled)': [op('drawing.style', 'SPY', { drawing: 'dr-t', color: 'red', style: 'dashed', width: 3 })],
    'drawing.deleteBoard (Swing board)': [op('drawing.deleteBoard', 'drawingBoards', { board: 'Swing board' })],
  },
  watchlist: {
    'watchlist.keepOnly (Tech → SPY)': [op('watchlist.keepOnly', 'wl1', { symbols: ['SPY'] })],
    'watchlist.clear (Tech)': [op('watchlist.clear', 'wl1', {})],
    'watchlist.delete (Swing)': [op('watchlist.delete', 'wl2', {})],
    'watchlist.remove (NVDA)': [op('watchlist.remove', 'wl1', { symbols: ['NVDA'] })],
    'watchlist.setNote (SPY note overwritten)': [op('watchlist.setNote', 'wl1', { symbol: 'SPY', note: 'gone' })],
  },
  widget: {
    'widget.remove (the Watchlist widget)': [op('widget.remove', 'board', { widget: 'wl' })],
    'widget.showList (Tech → Swing)': [op('widget.showList', 'board', { widget: 'wl', list: 'wl2' })],
    'widget.closeTab (the News tab)': [op('widget.closeTab', 'board', { widget: 'wl', tab: '1' })],
  },
  layout: {
    'layout.saveCurrent (saved over Mine)': [op('layout.saveCurrent', 'layouts', {})],
    'layout.delete (Swing)': [op('layout.delete', 'layouts', { layout: '12' })],
    'layout.rename (Swing)': [op('layout.rename', 'layouts', { layout: '12', name: 'Renamed' })],
    'chartSetup.deleteTemplate (Dark)': [op('chartSetup.deleteTemplate', 'chartTemplates', { name: 'Dark' })],
  },
}
// what each kind's member asks for, additively (objects for the generated verbs)
const OBJECT = { indicator: 'rsi', drawing: 'trendline', watchlist: 'aapl to my tech watchlist', widget: 'news widget', layout: 'layout' }
const VERBS = [
  (o) => `add ${o}`, (o) => `add a ${o}`, (o) => `put a ${o} on`, (o) => `include ${o}`, (o) => `insert a ${o}`, (o) => `a new ${o}`,
  (o) => `another ${o}`, (o) => `${o} also`, (o) => `more ${o}`, (o) => `${o} as well`, (o) => `${o} too`, (o) => `an extra ${o}`,
  (o) => `can you add one more ${o} please`, (o) => `adding ${o}`,
]
const CASES = { lower: (s) => s.toLowerCase(), UPPER: (s) => s.toUpperCase(), Title: (s) => s.replace(/(^|\s)\w/g, (m) => m.toUpperCase()) }
const additive = (kind) => VERBS.flatMap(v => Object.entries(CASES).map(([c, f]) => [c, f(v(OBJECT[kind]))]))
// the explicit words each destroying plan needs — the member said it
const EXPLICIT = {
  'indicator.update (RSI 14 → 20)': 'change the rsi length to 20', 'indicator.remove (the RSI)': 'remove the rsi',
  'chart.applyTemplate (indicators replaced)': 'apply my dark template', 'drawing.clear (SPY)': 'clear the drawings on spy',
  'drawing.remove (the trendline)': 'delete the trendline', 'drawing.style (the trendline restyled)': 'make the trendline red and dashed',
  'drawing.deleteBoard (Swing board)': 'delete my swing board', 'watchlist.keepOnly (Tech → SPY)': 'keep only spy in my tech watchlist',
  'watchlist.clear (Tech)': 'clear my tech watchlist', 'watchlist.delete (Swing)': 'delete my swing watchlist', 'watchlist.remove (NVDA)': 'remove nvda from tech',
  'watchlist.setNote (SPY note overwritten)': 'change the note on spy', 'widget.remove (the Watchlist widget)': 'remove the watchlist widget',
  'widget.showList (Tech → Swing)': 'show my swing list in the watchlist widget', 'widget.closeTab (the News tab)': 'remove the news tab',
  'layout.saveCurrent (saved over Mine)': 'save my layout', 'layout.delete (Swing)': 'delete my swing layout', 'layout.rename (Swing)': 'rename swing to renamed',
  'chartSetup.deleteTemplate (Dark)': 'delete my dark template',
}

// ── the member's whole state, as it reads back from every writer (nothing may change under an additive request) ──
function stateOf(fx) {
  const { b, host } = fx
  return JSON.stringify({
    indicators: ['c1', 'c2'].map(id => indicatorRowsOf(host.charts.read(id).cs).map(r => [r.instanceId, r.inputs, r.hidden])),
    drawings: ['SPY', 'NVDA'].map(s => store.peekTracingDrawings(store.listTracings()[0].id, s)),
    boards: store.listTracings().map(t => [t.id, t.name]),
    watchlists: b.state.server.lists.map(l => [l.id, l.name, l.items.map(i => [i.sym, i.notes])]),
    flags: fx.flags(),
    widgets: b.state.widgets.map(w => [w.id, w.type, w.opts?.watchKey ?? null, w.opts?.scanKey ?? null, (w.wtabs || []).map(t => t.id)]),
    layouts: [b.state.layouts.entries.map(e => [e.id, e.name]), b.state.layouts.activeId, (b.state.layouts.calls || []).filter(c => c[0] !== 'open')],
    templates: fx.prefs(),
  })
}

let envelopes, calls
const env = (disposition, ops, reply = '') => ({ disposition, reply, question: null, ops, unsupported_category: null })
beforeEach(() => {
  envelopes = []; calls = []
  try { localStorage.clear() } catch { /* */ }
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : null
    calls.push([init.method || 'GET', String(url), body])
    const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } })
    if (url === '/api/agent/turn') {
      const e = envelopes.shift()
      return json({ conversationId: 'ac_1', envelope: typeof e === 'function' ? e(body) : (e || env('answer', [], 'NO SCRIPTED MODEL TURN')), usage: { research_calls: 0, citations: [] } })
    }
    if (url === '/api/agent/record') return json({ conversationId: 'ac_1' })
    const q = /ticker-search\?q=([^&]+)/.exec(String(url))
    if (q) return json({ results: [{ ticker: decodeURIComponent(q[1]).toUpperCase() }] })
    if (String(url).startsWith('/api/live-prices')) return json({})
    if (String(url).startsWith('/api/watchlist-alerts')) return json([])
    return json({ conversations: [] })
  })
})
afterEach(() => { vi.restoreAllMocks(); cleanup() })

const idle = () => waitFor(() => expect(screen.queryByTestId('agent-typing')).toBeNull(), { timeout: 10000 })
function mount() {
  const fx = stateFixture()
  // the left chart (SPY) is the selected one, as a click on it makes it: a request with no chart named means it
  const ch = fx.host.charts
  const sel = (x) => (x && x.ref === 'c1' ? { ...x, selected: true } : x)
  fx.host.charts = { ...ch, read: (r) => sel(ch.read(r)), list: () => ch.list().map(sel), selected: () => 'c1' }
  fx.host.drawings = buildDrawingSource(fx.host.charts)
  render(<AuthContext.Provider value={{ user: { id: 1, role: 'admin' } }}><AgentPanel host={fx.host} onClose={() => {}} /></AuthContext.Provider>)
  const box = screen.getByLabelText('Message UCT Agent')
  const say = async (t) => { await idle(); fireEvent.change(box, { target: { value: t } }); fireEvent.keyDown(box, { key: 'Enter' }); await idle() }
  return { fx, say, transcript: () => screen.getByTestId('agent-transcript').textContent }
}
async function planOf(fx, ops) {
  buildContext(fx.host, { surface: 'charts' })              // what the panel builds first (the saved templates are read here)
  const kinds = [...new Set(ops.map(o => o.target === 'board' ? 'board' : o.target === 'layouts' ? 'layouts' : o.target === 'drawingBoards' ? 'drawingBoards' : o.target === 'chartTemplates' ? 'chartTemplates'
    : String(o.target).startsWith('ixe:') ? 'indicatorEdits' : /^wl\d$/.test(o.target) ? 'watchlist' : /^[A-Z]+$/.test(o.target) ? 'drawing' : 'chart'))]
  return planOps(collectTargets(fx.host, kinds), ops, { boundDrawingIds: new Set(), boundAlerts: [], ...(await prepareOps(ops)) }, { surface: 'charts' })
}

// ── layer 1 — the rail alone, generated ──
describe('STATE RAIL · layer 1: every kind’s destroying plan × additive verbs × casing — refused; its explicit words — allowed', () => {
  for (const [kind, plans] of Object.entries(WRONG)) for (const [pname, ops] of Object.entries(plans)) {
    it(`${kind} · ${pname}`, async () => {
      const fx = stateFixture()
      const plan = await planOf(fx, ops)
      expect(plan.ok, JSON.stringify(plan.refusals)).toBe(true)
      expect(stateEffects(plan).length, pname).toBeGreaterThan(0)
      for (const [c, words] of additive(kind)) expect(stateRailRefusal(plan, { words }), `${c} "${words}"`).toMatch(/^I didn’t change anything: you asked to add/)
      // the other kinds' additive words too (the rail reads the effect, never the noun)
      for (const k of Object.keys(OBJECT)) expect(stateRailRefusal(plan, { words: `add ${OBJECT[k]}` }), `add ${OBJECT[k]}`).toBeTruthy()
      expect(stateRailRefusal(plan, { words: EXPLICIT[pname] }), EXPLICIT[pname]).toBe(null)
      expect(stateRailRefusal(plan, { words: `add ${OBJECT[kind]}, and ${EXPLICIT[pname]}` }), `additive + ${EXPLICIT[pname]}`).toBe(null)
      // a negated destroy word never permits ("add an rsi, don't remove anything")
      expect(stateRailRefusal(plan, { words: `add ${OBJECT[kind]}, don't remove or change anything` })).toBeTruthy()
    })
  }
  it('fails closed: a plan whose effect cannot be read is refused for additive words (never let through)', () => {
    const plan = { ok: true, plans: [{ kind: 'indicatorEdits', ref: 'ixe:c1', before: { rows: [] }, after: { change: { request: { op: 'someNewOp' } } }, patch: { change: { request: { op: 'someNewOp' } } } }] }
    expect(stateRailRefusal(plan, { words: 'add an rsi' })).toMatch(/didn’t change anything/)
    const broken = { ok: true, plans: [{ kind: 'watchlist', get patch() { throw new Error('unreadable') } }] }
    expect(stateRailRefusal(broken, { words: 'add AAPL' })).toMatch(/didn’t change anything/)
    expect(stateRailRefusal(broken, { words: 'show me AAPL' })).toMatch(/didn’t change anything/)   // any words: fail closed
  })
  it('kinds the fixture cannot drive to a destroying plan (no saved indicator of the member’s own; a new widget only adds): their readers still refuse the shape', () => {
    // definition.delete — the plan Indicators' planDefinitionAction returns for one of the member's saved indicators
    const del = { ok: true, plans: [{ kind: 'definitionLibrary', ref: 'definitions', patch: { action: { plan: { op: 'delete', defId: 'u_0123456789ab', preview: { name: 'Volume Thrust' } } } } }] }
    expect(stateRailRefusal(del, { words: 'add a new indicator' })).toMatch(/delete your saved indicator “Volume Thrust”/)
    expect(stateRailRefusal(del, { words: 'delete my volume thrust indicator' })).toBe(null)
    const dup = { ok: true, plans: [{ kind: 'definitionLibrary', ref: 'definitions', patch: { action: { plan: { op: 'duplicate', defId: 'rsi' } } } }] }
    expect(stateRailRefusal(dup, { words: 'add another copy' })).toBe(null)
    // a workspace patch that removes a widget (only an Undo has that shape) is read as a removal
    const rm = { ok: true, plans: [{ kind: 'workspace', ref: 'workspace', patch: { remove: ['wl'] } }] }
    expect(stateRailRefusal(rm, { words: 'add a widget' })).toMatch(/remove a widget/)
    expect(stateRailRefusal({ ok: true, plans: [{ kind: 'workspace', ref: 'workspace', patch: { add: [{ type: 'news' }] } }] }, { words: 'add a widget' })).toBe(null)
  })
  it('adds, shows, hides, moves and reorders are never refused (nothing the member had is lost)', async () => {
    const fx = stateFixture()
    for (const ops of [
      [op('indicator.add', 'ixe:c1', { defId: 'macd', inputs: null })], [op('indicator.hide', 'ixe:c1', { instance: 'inst:rsi:1' })],
      [op('drawing.addLevel', 'SPY', { price: 101, color: null, style: null })], [op('watchlist.add', 'wl1', { symbols: ['AAPL'] })],
      [op('watchlist.reorder', 'wl1', { sort: 'az', top: [] })], [op('widget.add', 'workspace', { type: 'news', as: null })],
      [op('layout.saveAs', 'layouts', { name: 'Brand new' })], [op('drawing.createBoard', 'drawingBoards', { name: 'Fresh' })],
    ]) {
      const kinds = ops[0].target === 'workspace' ? ['workspace'] : null
      const plan = kinds ? planOps(collectTargets(fx.host, kinds), ops, {}, { surface: 'charts' }) : await planOf(fx, ops)
      expect(plan.ok, `${ops[0].action} ${JSON.stringify(plan.refusals)}`).toBe(true)
      expect(stateRailRefusal(plan, { words: 'add another one as well' }), ops[0].action).toBe(null)
    }
  })
})

// ── KIND-MATCHED permits (AUDIT #1247): a permit word licenses only the class its own clause names ──
// one explicit permit clause per class (what a member says to change THAT kind of thing)
const PERMIT = {
  indicator: 'remove the rsi', drawing: 'delete the trendline', drawingBoard: 'delete the swing board', watchlist: 'remove nvda from my watchlist',
  widget: 'remove the news tab', layout: 'delete my swing layout', template: 'delete my dark template',
}
const PERMIT_FORMS = (p) => [`add aapl, and ${p}`, `ADD AAPL. ${p.toUpperCase()}`, `add aapl then ${p}`, `add a 20 ema and ${p}`]
describe('STATE RAIL · kind-matched: a permit for one class never licenses a destroying plan on another (every A≠B), and the same class still works', () => {
  for (const [kind, plans] of Object.entries(WRONG)) for (const [pname, ops] of Object.entries(plans)) {
    it(`${kind} · ${pname}`, async () => {
      const fx = stateFixture()
      const plan = await planOf(fx, ops)
      expect(plan.ok).toBe(true)
      const classes = new Set(stateEffects(plan).flatMap(e => e.classes || [e.state]))
      let cross = 0
      for (const [a, p] of Object.entries(PERMIT)) {
        if (classes.has(a)) continue
        for (const w of PERMIT_FORMS(p)) { cross++; expect(stateRailRefusal(plan, { words: w }), `${a} permit "${w}" on ${pname}`).toMatch(/^I didn’t change anything/) }
      }
      expect(cross).toBeGreaterThan(0)
      // the same class, said in its own clause, still licenses it — and a permit word with no class in its clause licenses nothing
      expect(stateRailRefusal(plan, { words: `add aapl, and ${EXPLICIT[pname]}` }), EXPLICIT[pname]).toBe(null)
      for (const w of ['add aapl and remove it', 'add aapl, and clear up the confusion', 'add aapl, then delete that', 'add aapl and change it'])
        expect(stateRailRefusal(plan, { words: w }), `no class: "${w}"`).toMatch(/^I didn’t change anything/)
    })
  }
  it('the AUDIT example: "add a 20 EMA, and clear up the layout name confusion" never clears drawings (nor touches indicators)', async () => {
    const fx = stateFixture()
    const w = 'add a 20 EMA, and clear up the layout name confusion'
    for (const ops of [WRONG.drawing['drawing.clear (SPY)'], WRONG.indicator['indicator.remove (the RSI)'], WRONG.watchlist['watchlist.clear (Tech)']]) {
      expect(stateRailRefusal(await planOf(fx, ops), { words: w }), ops[0].action).toMatch(/^I didn’t change anything/)
    }
  })
  it('a clause with no class speaks of the class the clause before it named — ONLY that one', async () => {
    const fx = stateFixture()
    const rsi = await planOf(fx, WRONG.indicator['indicator.update (RSI 14 → 20)'])
    const line = await planOf(fx, WRONG.drawing['drawing.style (the trendline restyled)'])
    expect(stateRailRefusal(rsi, { words: 'add a macd, then make the rsi 20' })).toBe(null)
    expect(stateRailRefusal(rsi, { words: 'add the 9 ema. Colour the fast one green' })).toBe(null)          // the ema clause carries
    expect(stateRailRefusal(line, { words: 'add the 9 ema. Colour the fast one green' })).toMatch(/^I didn’t change anything/)
    expect(stateRailRefusal(rsi, { words: 'add a trendline, then make it red' })).toMatch(/^I didn’t change anything/)
    expect(stateRailRefusal(line, { words: 'add a trendline, then make it red' })).toBe(null)
    expect(stateRailRefusal(rsi, { words: 'add aapl, then make it red' })).toMatch(/^I didn’t change anything/)          // nothing named before
  })
  it('a widget named by what it shows is a WIDGET: "remove the watchlist widget" never licenses clearing or deleting a watchlist', async () => {
    const fx = stateFixture()
    for (const k of ['watchlist.clear (Tech)', 'watchlist.delete (Swing)', 'watchlist.remove (NVDA)']) {
      expect(stateRailRefusal(await planOf(fx, WRONG.watchlist[k]), { words: 'add aapl, and remove the watchlist widget' }), k).toMatch(/^I didn’t change anything/)
    }
    expect(stateRailRefusal(await planOf(fx, WRONG.widget['widget.remove (the Watchlist widget)']), { words: 'add aapl, and remove the watchlist widget' })).toBe(null)
  })
  it('a shared NAME never crosses kinds: "delete my swing layout" never licenses deleting the Swing watchlist', async () => {
    const fx = stateFixture()
    expect(stateRailRefusal(await planOf(fx, WRONG.watchlist['watchlist.delete (Swing)']), { words: 'add aapl, and delete my swing layout' })).toMatch(/^I didn’t change anything/)
    expect(stateRailRefusal(await planOf(fx, WRONG.watchlist['watchlist.delete (Swing)']), { words: 'add aapl, and delete swing' })).toBe(null)
  })
})

// ── ADDING TO A LIST NEVER SWITCHES WHAT A WIDGET SHOWS (AUDIT #1247 ii) ──
describe('STATE RAIL · adding to a list leaves the displayed list unchanged unless the words ask to show it', () => {
  const show = WRONG.widget['widget.showList (Tech → Swing)']
  for (const w of ['put AAPL on my watchlist', 'put AAPL in my watchlist widget', 'add AAPL to my watchlist', 'put AAPL and MSFT on the watchlist too', 'include AAPL in my list', 'PUT TSLA ON MY WATCHLIST'])
    it(`"${w}" + a plan switching the widget to Swing → refused`, async () => {
      const fx = stateFixture()
      expect(stateRailRefusal(await planOf(fx, show), { words: w })).toMatch(/^I didn’t change anything/)
    })
  for (const w of ['put my Swing list in the watchlist widget', 'put Swing up in my watchlist', 'add AAPL, and show my swing list in the watchlist widget', 'also switch the watchlist widget to swing'])
    it(`"${w}" names the list to show → allowed`, async () => {
      const fx = stateFixture()
      expect(stateRailRefusal(await planOf(fx, show), { words: w })).toBe(null)
    })
  it('through the panel: "put AAPL on my watchlist" with the model switching the widget — the widget still shows Tech', async () => {
    const { fx, say } = mount()
    envelopes.push(env('apply', show))
    await say('put AAPL on my watchlist')
    expect(fx.b.state.widgets.find(w => w.id === 'wl').opts.watchKey).toBe('user:wl1')
  }, 30000)
})

// ── AUDIT #1247 rulings: a carried-over clause DESTROYS only the object the clause before it named or made ──
describe('STATE RAIL · an inherited destroy / replace licence binds to the OBJECT the previous clause named — never the whole class', () => {
  it('"add a 20 EMA, then remove it": removing RSI (14) → refused; removing that 20 EMA → allowed', async () => {
    const fx = stateFixture()
    const rsi = await planOf(fx, WRONG.indicator['indicator.remove (the RSI)'])
    const ema20 = await planOf(fx, [op('indicator.remove', 'ixe:c1', { instance: 'ovl:1' })])
    expect(ema20.ok, JSON.stringify(ema20.refusals)).toBe(true)
    expect(stateEffects(ema20)[0].label).toMatch(/EMA 20/)
    for (const w of ['add a 20 EMA, then remove it', 'Add a 20 ema. Remove it', 'add a 20 EMA and remove it']) {
      expect(stateRailRefusal(rsi, { words: w }), w).toMatch(/^I didn’t change anything/)
      expect(stateRailRefusal(ema20, { words: w }), w).toBe(null)
    }
  })
  it('"add a trendline. clear it": a plan clearing all drawings → refused (and deleting the existing trendline too)', async () => {
    const fx = stateFixture()
    for (const k of ['drawing.clear (SPY)', 'drawing.remove (the trendline)']) {
      for (const w of ['add a trendline. clear it', 'add a trendline, then delete it', 'Add a fib and remove them'])
        expect(stateRailRefusal(await planOf(fx, WRONG.drawing[k]), { words: w }), `${k} · ${w}`).toMatch(/^I didn’t change anything/)
    }
  })
  it('an OVERWRITE still inherits the class ("add the 9 ema. Colour the fast one green")', async () => {
    const fx = stateFixture()
    expect(stateRailRefusal(await planOf(fx, WRONG.indicator['indicator.update (RSI 14 → 20)']), { words: 'add the 9 ema. make it 20' })).toBe(null)
  })
})

// ── AUDIT #1247 (ii): the OBJECT decides — a LIST name switches the display; a SYMBOL is added and the display stays; a word
// that is both is asked, nothing written ──
describe('STATE RAIL · "put X in my watchlist": a list switches the display, a symbol never does, a homograph is asked', () => {
  // a Watchlist widget showing Tech, and a plan switching it to a list whose name is `to`
  const switchTo = (to) => ({ ok: true, plans: [{ kind: 'board', ref: 'board',
    before: { board: [{ id: 'wl', type: 'watchlist', opts: { watchKey: 'user:wl1', watchName: 'Tech' } }] },
    patch: { set: { wl: { opts: { watchKey: 'user:wl9', watchName: to, watchTab: 'mine' } } } } }] })
  for (const [w, to] of [['put Swing up in my watchlist', 'Swing'], ['put the Flagged list in my watchlist widget', 'Flagged'], ['put Long Term on the Swing watchlist widget', 'Long Term'],
    ['put the AI list in my watchlist', 'AI'], ['put my NOW list on the watchlist widget', 'NOW']])
    it(`a LIST: "${w}" → the display switch is allowed`, () => expect(stateRailRefusal(switchTo(to), { words: w })).toBe(null))
  for (const [w, to] of [['put AAPL on my watchlist', 'Swing'], ['put TSLA in my watchlist widget', 'Swing']])
    it(`a SYMBOL: "${w}" + a switch → refused (the display stays)`, () => expect(stateRailRefusal(switchTo(to), { words: w })).toMatch(/^I didn’t change anything/))
  for (const [w, to] of [['put AI up in my watchlist', 'AI'], ['put NOW in my watchlist widget', 'NOW'], ['PUT AI ON MY WATCHLIST', 'AI']])
    it(`a HOMOGRAPH: "${w}" (a list called ${to}, and the ticker ${to}) → asked which, nothing written`, () => {
      expect(stateRailRefusal(switchTo(to), { words: w })).toMatch(new RegExp(`^Do you mean your “${to}” list, or the ticker ${to}\\? Nothing was changed`))
    })
  it('a word that is a ticker never licenses the switch on its own (the ask comes first; this is the second wall)', () => {
    const e = stateEffects(switchTo('AI'))[0]
    expect(permits(e, 'put AI up in my watchlist')).toBe(false)
    expect(permits(e, 'put the AI list up in my watchlist')).toBe(true)
  })
  it('through the panel: "put AAPL on my watchlist" (model inert) — AAPL is added to the list shown; the widget still shows Tech', async () => {
    const { fx, say } = mount()
    await say('put AAPL on my watchlist')
    expect(fx.b.state.widgets.find(w => w.id === 'wl').opts.watchKey).toBe('user:wl1')
  }, 30000)
})

// ── A REFUSED BUNDLE says its add parts did NOT happen either (AUDIT #1247) ──
describe('STATE RAIL · a refused bundle names the adds that were not done too', () => {
  const BUNDLE = [op('watchlist.add', 'wl1', { symbols: ['AAPL'] }), op('widget.showList', 'board', { widget: 'wl', list: 'wl2' })]
  it('rail: "put AAPL on my watchlist" + add AAPL & switch to Swing → refused, and AAPL named as NOT added', async () => {
    const fx = stateFixture()
    const t = stateRailRefusal(await planOf(fx, BUNDLE), { words: 'put AAPL on my watchlist' })
    expect(t).toMatch(/^I didn’t change anything/)
    expect(t).toMatch(/Nothing was changed: I didn’t add AAPL to Tech either — say “add AAPL to Tech” on its own/)
  })
  it('every kind: a bundle of an add and a blocked change names the add (a drawing with a watchlist clear; a list add with a drawing delete)', async () => {
    const fx = stateFixture()
    const cases = [
      [[op('drawing.addLevel', 'SPY', { price: 101, color: null, style: null }), op('watchlist.clear', 'wl1', {})], /didn’t draw a horizontal line at \$101/i],
      [[op('watchlist.add', 'wl2', { symbols: ['AAPL'] }), op('drawing.remove', 'SPY', { drawing: 'dr-t' })], /didn’t add AAPL to Swing/i],
    ]
    for (const [ops, re] of cases) {
      const p = await planOf(fx, ops)
      expect(p.ok, JSON.stringify(p.refusals)).toBe(true)
      expect(stateRailRefusal(p, { words: 'add another one' }), ops[0].action).toMatch(re)
    }
    // a plan with nothing additive in it says no "either"
    expect(stateRailRefusal(await planOf(fx, WRONG.watchlist['watchlist.clear (Tech)']), { words: 'add aapl' })).not.toMatch(/either/)
  })
  it('through the panel: the bundled plan writes 0 changes, and the reply names AAPL as not added', async () => {
    // ("put AAPL on my watchlist" word for word is read by the instant path: it ADDS AAPL and leaves the display — the next
    // test; a wording that reaches the model meets the bundled plan)
    const { fx, say, transcript } = mount()
    const before = stateOf(fx)
    envelopes.push(env('apply', BUNDLE))
    await say('can you put AAPL on my watchlist')
    expect(calls.some(c => c[1] === '/api/agent/turn')).toBe(true)
    expect(stateOf(fx)).toBe(before)
    expect(fx.b.state.server.lists.find(l => l.id === 'wl1').items.map(i => i.sym)).not.toContain('AAPL')
    expect(fx.b.state.widgets.find(w => w.id === 'wl').opts.watchKey).toBe('user:wl1')
    expect(transcript()).toMatch(/I didn’t add AAPL to Tech either/)
  }, 30000)
  it('through the panel: "put AAPL on my watchlist" (instant path) adds AAPL to the list shown, and the display stays Tech', async () => {
    const { fx, say } = mount()
    await say('put AAPL on my watchlist')
    expect(fx.b.state.server.lists.find(l => l.id === 'wl1').items.map(i => i.sym)).toContain('AAPL')
    expect(fx.b.state.widgets.find(w => w.id === 'wl').opts.watchKey).toBe('user:wl1')
  }, 30000)
})

// ── AUDIT #1247 probe 38 — the gate is INVERTED and the permit is STRUCTURAL: every destroying plan needs a COMMAND on a NAMED
// object, never negated — whatever the words look like (AUDIT's three shapes, in our own phrasings, over every destroy plan) ──
const SLANG = ['throw an indicator on there', 'slap a drawing on SPY', 'gimme a widget', 'toss AAPL into Tech', 'drop a 20 ema on it', 'I want an rsi on this',
  'chuck a trendline on NVDA', 'pop a macd up there', 'stick a fib on spy', 'lemme get a scanner', 'bung a line on it', 'whack an ema on there', 'I’d like a news panel', 'could use a vwap']
const NEGATED_WORDS = ['Add RSI. Delete nothing.', 'add rsi and wipe nothing', 'add a trendline, no deleting', 'add a macd but don’t remove anything', 'put a line on, never clear',
  'add aapl without removing a thing', 'add a fib, not replacing anything', 'add an ema; nothing gets deleted', 'add rsi, I don’t want anything changed', 'include tsla, no changes to the rest',
  'remove nothing and add an rsi', 'DON’T CLEAR MY DRAWINGS, ADD A LINE', 'never delete the rsi, add a macd', 'add a 20 ema and do not change the rsi']
const NON_COMMAND = ['clear up how to add an ema', 'add a 20 ema to replace my bad habits', 'add rsi, I want to clear my head', 'add a trendline and delete that thought',
  'add a macd to remove the guesswork', 'add a line so I can reset my focus', 'add aapl to clear the confusion', 'add a fib to wipe away the doubt',
  'put an ema on to switch up my routine', 'add rsi, then clear up why my list is slow', 'I want to change my life with an rsi', 'add a scanner to remove the noise']
const PLAIN = (o) => [o, `what about ${o}`, `look at ${o}`, `${o} please`, `can you handle ${o}`, 'thanks', 'ok', 'do it', 'go ahead', 'sounds good', `hmm ${o}`, `explain ${o}`, `${o}?`, `the ${o} one`]
describe('STATE RAIL · probe 38: slang additive, negated destroy words, destroy words that are not commands, plain words — every destroy plan REFUSED', () => {
  for (const [kind, plans] of Object.entries(WRONG)) for (const [pname, ops] of Object.entries(plans)) {
    it(`${kind} · ${pname}`, async () => {
      const fx = stateFixture()
      const plan = await planOf(fx, ops)
      expect(plan.ok).toBe(true)
      for (const [shape, list] of [['slang', SLANG], ['negated', NEGATED_WORDS], ['non-command', NON_COMMAND], ['plain', additive(kind).map(([, w]) => w).concat(PLAIN(OBJECT[kind]).flatMap(w => Object.values(CASES).map(f => f(w))))]])
        for (const w of list) expect(stateRailRefusal(plan, { words: w }) || 'LET THROUGH', `${shape} "${w}"`).toMatch(/^I didn’t change anything/)
      // the explicit command on the named object still works, said plainly or after an add
      expect(stateRailRefusal(plan, { words: EXPLICIT[pname] }), EXPLICIT[pname]).toBe(null)
      // an approved card is its own permit (the member saw what it removes)
      expect(stateRailRefusal(plan, { words: 'gimme a widget', mode: 'approved' })).toBe(null)
    })
  }
  it('through the panel: slang additive + a destroying model plan writes nothing (the model was reached)', async () => {
    for (const [said, ops] of [['could you throw an indicator on there for me', WRONG.indicator['indicator.remove (the RSI)']], ['can you slap a drawing on SPY for me', WRONG.drawing['drawing.clear (SPY)']], ['gimme a widget please', WRONG.widget['widget.remove (the Watchlist widget)']]]) {
      cleanup()
      const { fx, say, transcript } = mount()
      const before = stateOf(fx)
      envelopes.push(env('apply', ops))
      await say(said)
      expect(calls.some(c => c[1] === '/api/agent/turn'), said).toBe(true)
      expect(stateOf(fx), said).toBe(before)
      expect(transcript(), said).toMatch(/didn’t change anything/)
    }
  }, 90000)
})

// ── AUDIT #1247 rulings at 57d2605c5c ──
describe('STATE RAIL · a pointer at the start of a message restyles EXACTLY the conversation’s subject — never another of its class', () => {
  it('"make it thicker": the subject RSI → allowed; another indicator, or no subject → refused', async () => {
    const fx = stateFixture()
    const rsi = await planOf(fx, WRONG.indicator['indicator.update (RSI 14 → 20)'])
    expect(stateEffects(rsi)[0].id).toBe('ind:c1:inst:rsi:1')
    for (const w of ['make it thicker', 'Make it a 20', 'change that to a 20', 'make the fast one 20'])
      expect(stateRailRefusal(rsi, { words: w, subjects: new Set(['ind:c1:inst:rsi:1']) }), w).toBe(null)
    for (const subj of [new Set(['ind:c1:ovl:0']), new Set(['ind:c2:inst:rsi:1']), new Set(), null])
      expect(stateRailRefusal(rsi, { words: 'make it thicker', subjects: subj }) || 'LET THROUGH', JSON.stringify([...(subj || [])])).toMatch(/^I didn’t change anything/)
  })
  it('a drawing: "make it red" restyles the drawing last drawn / changed, never another one', async () => {
    const fx = stateFixture()
    const line = await planOf(fx, WRONG.drawing['drawing.style (the trendline restyled)'])
    expect(stateRailRefusal(line, { words: 'make it red', subjects: new Set(['draw:SPY:dr-t']) })).toBe(null)
    expect(stateRailRefusal(line, { words: 'make it red', subjects: new Set(['draw:SPY:dr-h']) }) || 'LET THROUGH').toMatch(/^I didn’t change anything/)
  })
  it('a destroy pointed at the subject still ASKS ("remove it" — cross-turn stays fail-closed)', async () => {
    const fx = stateFixture()
    const rm = await planOf(fx, WRONG.indicator['indicator.remove (the RSI)'])
    expect(stateRailRefusal(rm, { words: 'remove it', subjects: new Set(['ind:c1:inst:rsi:1']) }) || 'LET THROUGH').toMatch(/^I didn’t change anything/)
  })
  it('"save it" at the start never saves over a layout (it has no exact Undo); "save my layout" / "save it to my layout" do', async () => {
    const fx = stateFixture()
    const save = await planOf(fx, WRONG.layout['layout.saveCurrent (saved over Mine)'])
    for (const w of ['save it', 'Save it.', 'save', 'save that'])
      expect(stateRailRefusal(save, { words: w, subjects: new Set(['layout:11']) }) || 'LET THROUGH', w).toMatch(/^I didn’t change anything/)
    for (const w of ['save my layout', 'make this chart weekly and save it to my layout', 'save the layout'])
      expect(stateRailRefusal(save, { words: w }), w).toBe(null)
  })
})

describe('STATE RAIL · grammar extensions bind to the plan’s OWN target (never "any value / ticker counts")', () => {
  it('a fib level value names only a level THAT fib’s change touches', async () => {
    const fx = stateFixture()
    const hide786 = await planOf(fx, [op('drawing.setFibLevels', 'SPY', { drawing: 'dr-f', levels: [{ level: 0.786, visible: false, color: null }], bands: [], reset: false })])
    expect(hide786.ok, JSON.stringify(hide786.refusals)).toBe(true)
    for (const w of ['remove the 78.6', 'remove the 0.786', 'hide the 78.6'])
      expect(stateRailRefusal(hide786, { words: w }), w).toBe(null)
    for (const w of ['remove the 61.8', 'hide the 0.5', 'remove the 0.618'])
      expect(stateRailRefusal(hide786, { words: w }) || 'LET THROUGH', w).toMatch(/^I didn’t change anything/)
    // the same value said against ANOTHER drawing's change (a trendline restyled) licenses nothing
    const line = await planOf(fx, WRONG.drawing['drawing.style (the trendline restyled)'])
    expect(stateRailRefusal(line, { words: 'hide the 78.6' }) || 'LET THROUGH').toMatch(/^I didn’t change anything/)
  })
  it('a drawing setting names only a key THAT change sets ("use a large arrow size" ≠ a restyle of the line colour)', async () => {
    const fx = stateFixture()
    const line = await planOf(fx, WRONG.drawing['drawing.style (the trendline restyled)'])
    expect(stateRailRefusal(line, { words: 'use a large arrow size' }) || 'LET THROUGH').toMatch(/^I didn’t change anything/)
    const txt = await planOf(fx, [op('drawing.setProps', 'SPY', { drawing: 'dr-x', set: [{ prop: 'bold', value: true, opacity: null }] })])
    expect(txt.ok, JSON.stringify(txt.refusals)).toBe(true)
    expect(stateRailRefusal(txt, { words: 'make the bold on' })).toBe(null)
  })
  it('a ticker counts only if it is IN that list and the change removes it', async () => {
    const fx = stateFixture()
    const rmNvda = await planOf(fx, WRONG.watchlist['watchlist.remove (NVDA)'])
    for (const w of ['remove NVDA', 'drop NVDA', 'take NVDA off', 'remove nvda and amd'])
      expect(stateRailRefusal(rmNvda, { words: w }), w).toBe(null)
    for (const w of ['remove TSLA', 'drop AAPL', 'remove MSFT and NVDA'])
      expect(stateRailRefusal(rmNvda, { words: w }) || 'LET THROUGH', w).toMatch(/^I didn’t change anything/)
    const keep = await planOf(fx, WRONG.watchlist['watchlist.keepOnly (Tech → SPY)'])
    for (const w of ['keep only spy', 'drop all but SPY', 'remove everything except SPY'])
      expect(stateRailRefusal(keep, { words: w }), w).toBe(null)
    expect(stateRailRefusal(keep, { words: 'drop all but TSLA' }) || 'LET THROUGH').toMatch(/^I didn’t change anything/)
  })
  it('a widget’s content is named by THAT widget’s own kind ("the scanner" never switches the watchlist widget)', async () => {
    const fx = stateFixture()
    const show = await planOf(fx, WRONG.widget['widget.showList (Tech → Swing)'])
    for (const w of ['go back to the list picker', 'take the watchlist back to its picker', 'let me pick a different list in the watchlist'])
      expect(stateRailRefusal(show, { words: w }), w).toBe(null)
    for (const w of ['take the scanner back to its picker', 'go back to the scan picker', 'exit the scan'])
      expect(stateRailRefusal(show, { words: w }) || 'LET THROUGH', w).toMatch(/^I didn’t change anything/)
  })
})

describe('STATE RAIL · a typed approval runs the pending card approved — and with no card is never an approval', () => {
  it('"do it" with NO pending card: a destroying model plan is refused, nothing written', async () => {
    for (const w of ['do it', 'yes', 'apply it']) {
      cleanup()
      const { fx, say, transcript } = mount()
      const before = stateOf(fx)
      envelopes.push(env('apply', WRONG.watchlist['watchlist.clear (Tech)']))
      await say(w)
      expect(stateOf(fx), w).toBe(before)
      // never an approval: nothing ran, no card appeared, nothing is claimed done
      expect(screen.queryByRole('button', { name: 'Apply' }), w).toBeNull()
      expect(transcript(), w).not.toMatch(/Cleared|Removed .* from/)
    }
  }, 60000)
  it('"delete my swing watchlist" → its card → "do it": the card runs (approved), the list is gone', async () => {
    const { fx, say } = mount()
    envelopes.push(env('apply', WRONG.watchlist['watchlist.delete (Swing)']))
    await say('delete my swing watchlist')
    expect(screen.queryByRole('button', { name: 'Apply' })).toBeTruthy()
    await say('do it')
    await waitFor(() => expect(fx.b.state.server.lists.some(l => l.id === 'wl2')).toBe(false))
  }, 30000)
})

// ── AUDIT #1247 (e2d3cabbda): copies join the subject only from the turn that MADE them; "remove it" right after ──
describe('STATE RAIL · the subject through the real panel: copies the latest turn made, never earlier ones; "delete it" right after one add', () => {
  const rowsOn = (fx, chart) => indicatorRowsOf(fx.host.charts.read(chart).cs)
  const macdOn = (fx, chart) => rowsOn(fx, chart).find(r => r.defId === 'macd')
  const vwapOn = (fx, chart) => rowsOn(fx, chart).find(r => r.defId === 'vwap')
  it('copies made by the LATEST turn are restyled by "make them all green"; copies from an EARLIER turn are not', async () => {
    const { fx, say } = mount()
    envelopes.push(env('apply', [op('indicator.add', 'ixe:c1', { defId: 'vwap', inputs: null })]))
    await say('could you put a vwap on the left chart for me')
    envelopes.length = 0                                      // (the instant reader may have read it itself)
    const orig = vwapOn(fx, 'c1')
    expect(orig).toBeTruthy()
    // (the instant reader copies it itself; if it reaches the model, the model plans the same copy)
    envelopes.push(env('apply', [op('indicatorCopy.copyTo', 'ixe:c2', { from: 'c1', instances: [orig.instanceId] })]))
    await say('could you copy that over to the right chart for me')
    envelopes.length = 0
    const copy = vwapOn(fx, 'c2')
    expect(copy).toBeTruthy()
    // an unrelated adding turn in between: the copy is no longer what the conversation is about
    envelopes.push(env('apply', [op('indicator.add', 'ixe:c1', { defId: 'macd', inputs: null })]))
    await say('could you put a macd on the left chart for me')
    envelopes.length = 0                                      // (the instant reader may have read it itself)
    const was = JSON.stringify(rowsOn(fx, 'c2'))
    envelopes.push(env('apply', [op('indicatorStyle.set', 'ixe:c2', { instance: copy.instanceId, property: 'color', value: 'green', output: null })]))
    await say('make them all green')
    envelopes.length = 0                                      // (the instant reader may have read it itself)
    expect(JSON.stringify(rowsOn(fx, 'c2')), 'an earlier turn’s copy never joins the subject').toBe(was)
  }, 60000)
  it('right after the copy turn, its copies ARE the subject ("make them all green" restyles the copy)', async () => {
    const { fx, say } = mount()
    envelopes.push(env('apply', [op('indicator.add', 'ixe:c1', { defId: 'vwap', inputs: null })]))
    await say('could you put a vwap on the left chart for me')
    envelopes.length = 0                                      // (the instant reader may have read it itself)
    const orig = vwapOn(fx, 'c1')
    // (the instant reader copies it itself; if it reaches the model, the model plans the same copy)
    envelopes.push(env('apply', [op('indicatorCopy.copyTo', 'ixe:c2', { from: 'c1', instances: [orig.instanceId] })]))
    await say('could you copy that over to the right chart for me')
    envelopes.length = 0
    const copy = vwapOn(fx, 'c2')
    const was = JSON.stringify(rowsOn(fx, 'c2'))
    envelopes.push(env('apply', [op('indicatorStyle.set', 'ixe:c2', { instance: copy.instanceId, property: 'color', value: 'green', output: null })]))
    await say('make them all green')
    envelopes.length = 0                                      // (the instant reader may have read it itself)
    expect(JSON.stringify(rowsOn(fx, 'c2'))).not.toBe(was)
  }, 60000)
})

describe('STATE RAIL · "remove it" right after: only the ONE object the previous turn made', () => {
  const macdOn = (fx, chart) => indicatorRowsOf(fx.host.charts.read(chart).cs).find(r => r.defId === 'macd')
  it('rail: previous = that object → allowed; previous = another id, or none (two made) → asks', async () => {
    const fx = stateFixture()
    const rm = await planOf(fx, WRONG.indicator['indicator.remove (the RSI)'])
    expect(stateRailRefusal(rm, { words: 'remove it', previous: 'ind:c1:inst:rsi:1' })).toBe(null)
    expect(stateRailRefusal(rm, { words: 'delete it', previous: 'ind:c1:ovl:0' }) || 'LET THROUGH').toMatch(/^I didn’t change anything/)
    expect(stateRailRefusal(rm, { words: 'remove it', previous: null }) || 'LET THROUGH').toMatch(/^I didn’t change anything/)
    // only at the start of a message: after words of its own, "it" is what those words named
    expect(stateRailRefusal(rm, { words: 'add a macd, then remove it', previous: 'ind:c1:inst:rsi:1' }) || 'LET THROUGH').toMatch(/^I didn’t change anything/)
  })
  it('panel: one add, then "remove it" removes exactly that one; after a turn that added TWO, "remove it" asks', async () => {
    const { fx, say } = mount()
    envelopes.push(env('apply', [op('indicator.add', 'ixe:c1', { defId: 'macd', inputs: null })]))
    await say('could you put a macd on the left chart for me')
    envelopes.length = 0                                      // (the instant reader may have read it itself)
    const macd = macdOn(fx, 'c1')
    envelopes.push(env('apply', [op('indicator.remove', 'ixe:c1', { instance: macd.instanceId })]))
    await say('could you remove it for me')
    envelopes.length = 0                                      // (the instant reader may have read it itself)
    const apply = screen.queryByRole('button', { name: 'Apply' })
    if (apply) { await waitFor(() => expect(apply.disabled).toBe(false)); fireEvent.click(apply); await idle() }
    expect(macdOn(fx, 'c1')).toBeFalsy()
    // two in one turn → "remove it" is not one object
    envelopes.push(env('apply', [op('indicator.add', 'ixe:c1', { defId: 'macd', inputs: null }), op('indicator.add', 'ixe:c1', { defId: 'vwap', inputs: null })]))
    await say('could you put a macd and a vwap on the left chart for me')
    const m2 = macdOn(fx, 'c1')
    envelopes.push(env('apply', [op('indicator.remove', 'ixe:c1', { instance: m2.instanceId })]))
    await say('could you remove it for me')
    envelopes.length = 0                                      // (the instant reader may have read it itself)
    expect(macdOn(fx, 'c1')).toBeTruthy()
  }, 60000)
})

// ── A DRAWING BOARD SWITCH (AUDIT #1247 iii, accepted residual): the receipt names the board now shown; Undo is exact ──
describe('STATE RAIL · a Drawing Board switch says which board is shown, and Undo puts the previous board back exactly', () => {
  it('drawing.setActiveBoard → "Swing board": receipt names it; Undo restores Board 1 and every drawing on it', async () => {
    const fx = stateFixture()
    const first = store.getActiveTracingId()
    const was = ['SPY', 'NVDA'].map(s => store.peekDrawings(s))
    const p = await planOf(fx, [op('drawing.setActiveBoard', 'drawingBoards', { board: 'Swing board' })])
    expect(p.ok, JSON.stringify(p.refusals)).toBe(true)
    // never refused (nothing is destroyed: Board 1's drawings stay on Board 1)
    expect(stateRailRefusal(p, { words: 'add a new board' })).toBe(null)
    const res = await commitPlan(fx.host, p, { env: {} })
    expect(res.ok, JSON.stringify(res.failed)).toBe(true)
    expect(res.lines.join(' ')).toMatch(/Swing board/)
    expect(store.getActiveTracingId()).toBe(fx.boards.second)
    expect((await undoEntry(fx.host, res.undo)).ok).toBe(true)
    expect(store.getActiveTracingId()).toBe(first)
    expect(['SPY', 'NVDA'].map(s => store.peekDrawings(s))).toEqual(was)
  }, 30000)
})

// ── layer 2 — through the panel, the model scripted DESTRUCTIVE ──
// (phrasings the instant readers leave to the model — the test asserts the model was reached; layer 3 covers the instant reading)
const SAYS = { indicator: ['ANOTHER RSI TOO', 'add a macd as well'], drawing: ['Add a trendline', 'put a new line on'], watchlist: ['add AAPL to my Tech watchlist', 'include MSFT as well'],
  widget: ['Another widget please', 'add one more widget'], layout: ['add a layout', 'save a new layout'] }
describe('STATE RAIL · layer 2: through the real panel — a destroying model plan under additive words writes nothing and says why', () => {
  for (const [kind, plans] of Object.entries(WRONG)) for (const [pname, ops] of Object.entries(plans)) for (const said of SAYS[kind]) {
    it(`${kind} · ${pname} · "${said}"`, async () => {
      const { fx, say, transcript } = mount()
      const before = stateOf(fx)
      envelopes.push(env('apply', ops))
      await say(said)
      expect(calls.some(c => c[1] === '/api/agent/turn'), `${said}: the model was reached`).toBe(true)
      expect(stateOf(fx), said).toBe(before)
      expect(transcript(), said).toMatch(/didn’t change anything: you asked to add/)
      // a destroying change that would have needed a card never reached one either
      expect(screen.queryByRole('button', { name: 'Apply' }), said).toBeNull()
    }, 30000)
  }
})

// ── layer 3 — through the panel, the model inert: the instant readers' own reading of additive words ──
const INSTANT = ['add an rsi', 'add a 20 ema', 'add RSI to both charts', 'add a horizontal line at 105', 'add AAPL to my Tech watchlist', 'add AAPL and MSFT to Tech',
  'add a news widget', 'add a scanner', 'save this as a new layout called Fresh', 'add a layout', 'add a new drawing board', 'put a line at 120 on SPY', 'add MACD too']
describe('STATE RAIL · layer 3: through the real panel — whatever the instant readers make of additive words, nothing existing is lost', () => {
  for (const said of INSTANT) {
    it(`"${said}"`, async () => {
      const { fx, say } = mount()
      const was = JSON.parse(stateOf(fx))
      await say(said)
      const now = JSON.parse(stateOf(fx))
      // every indicator, drawing, board, list item, widget, layout and template still there, unchanged
      for (const [i, rows] of was.indicators.entries()) for (const r of rows) expect(now.indicators[i], said).toContainEqual(r)
      for (const [i, ds] of was.drawings.entries()) for (const d of ds) expect((now.drawings[i] || []).find(x => x.id === d.id), said).toEqual(d)
      for (const t of was.boards) expect(now.boards, said).toContainEqual(t)
      for (const l of was.watchlists) {
        const n = now.watchlists.find(x => x[0] === l[0])
        expect(n?.[1], said).toBe(l[1])
        for (const it0 of l[2]) expect(n[2], said).toContainEqual(it0)
      }
      for (const w of was.widgets) expect(now.widgets, said).toContainEqual(w)
      for (const e of was.layouts[0]) expect(now.layouts[0], said).toContainEqual(e)
      expect(now.layouts[2].filter(c => ['remove', 'rename', 'saveCurrent'].includes(c[0])), said).toEqual([])
      expect(now.templates, said).toEqual(was.templates)
    }, 30000)
  }
})

// ── CONTROL — explicit words still work: at once with an exact Undo, or on the card they always needed ──
describe('STATE RAIL · CONTROL: explicit replace / remove / change still work; Undo is exact; a card stays a card', () => {
  it('"change the rsi length to 20" — applied; Undo puts the RSI back exactly', async () => {
    const { fx, say } = mount()
    const before = stateOf(fx)
    envelopes.push(env('apply', WRONG.indicator['indicator.update (RSI 14 → 20)']))
    await say('change the rsi length to 20')
    expect(indicatorRowsOf(fx.host.charts.read('c1').cs).find(r => r.instanceId === 'inst:rsi:1').inputs.period).toBe(20)
    await say('undo')                                          // the panel's Undo is said (AgentPanel: no Undo button)
    await waitFor(() => expect(stateOf(fx)).toBe(before))
  }, 30000)
  it('"remove the rsi" — removed (or carded); Undo restores it with its identity', async () => {
    const { fx, say } = mount()
    const before = stateOf(fx)
    envelopes.push(env('apply', WRONG.indicator['indicator.remove (the RSI)']))
    await say('remove the rsi')
    const apply = screen.queryByRole('button', { name: 'Apply' })
    if (apply) { await waitFor(() => expect(apply.disabled).toBe(false)); fireEvent.click(apply); await idle() }
    expect(indicatorRowsOf(fx.host.charts.read('c1').cs).some(r => r.instanceId === 'inst:rsi:1')).toBe(false)
    await say('undo')                                          // the panel's Undo is said (AgentPanel: no Undo button)
    await waitFor(() => expect(stateOf(fx)).toBe(before))
  }, 30000)
  it('"remove nvda from tech" — removed; Undo puts NVDA back', async () => {
    const { fx, say } = mount()
    envelopes.push(env('apply', WRONG.watchlist['watchlist.remove (NVDA)']))
    await say('remove nvda from tech')
    const apply = screen.queryByRole('button', { name: 'Apply' })
    if (apply) { await waitFor(() => expect(apply.disabled).toBe(false)); fireEvent.click(apply); await idle() }
    const syms = () => fx.b.state.server.lists.find(l => l.id === 'wl1').items.map(i => i.sym)
    expect(syms()).toEqual(['SPY', 'AMD'])
    await say('undo')                                          // the panel's Undo is said (AgentPanel: no Undo button)
    await waitFor(() => expect([...syms()].sort()).toEqual(['AMD', 'NVDA', 'SPY']))
  }, 30000)
  it('"delete the trendline" — deleted through the panel; the runtime Undo restores it exactly, under its own id', async () => {
    const { fx, say } = mount()
    const was = store.peekDrawings('SPY').find(d => d.id === 'dr-t')
    envelopes.push(env('apply', WRONG.drawing['drawing.remove (the trendline)']))
    await say('delete the trendline')
    const apply = screen.queryByRole('button', { name: 'Apply' })
    if (apply) { await waitFor(() => expect(apply.disabled).toBe(false)); fireEvent.click(apply); await idle() }
    expect(store.peekDrawings('SPY').some(d => d.id === 'dr-t')).toBe(false)
    // (the panel's receipt waits on the tracings sync, which this harness has no server for) — the same change through the
    // runtime, and its Undo
    const fx2 = stateFixture()
    const p = await planOf(fx2, WRONG.drawing['drawing.remove (the trendline)'])
    const res = await commitPlan(fx2.host, p, { env: {} })
    expect(res.ok).toBe(true)
    expect(store.peekDrawings('SPY').some(d => d.id === 'dr-t')).toBe(false)
    expect((await undoEntry(fx2.host, res.undo)).ok).toBe(true)
    expect(store.peekDrawings('SPY').find(d => d.id === 'dr-t')).toEqual(was)
  }, 30000)
  it('"show my swing list in the watchlist widget" — the widget shows Swing', async () => {
    const { fx, say } = mount()
    envelopes.push(env('apply', WRONG.widget['widget.showList (Tech → Swing)']))
    await say('show my swing list in the watchlist widget')
    expect(fx.b.state.widgets.find(w => w.id === 'wl').opts.watchKey).toBe('user:wl2')
  }, 30000)
  it('"delete my swing watchlist" / "delete my swing layout" / "clear the drawings on spy" — explicit, and still a CARD first (nothing gone until Apply)', async () => {
    for (const [said, ops] of [['delete my swing watchlist', WRONG.watchlist['watchlist.delete (Swing)']], ['delete my swing layout', WRONG.layout['layout.delete (Swing)']], ['clear the drawings on spy', WRONG.drawing['drawing.clear (SPY)']]]) {
      cleanup()
      const { fx, say, transcript } = mount()
      const before = stateOf(fx)
      envelopes.push(env('apply', ops))
      await say(said)
      expect(transcript(), said).not.toMatch(/you asked to add/)
      // the card it always needed (risk: confirm), and nothing destroyed yet
      expect(screen.queryByRole('button', { name: 'Apply' }), said).toBeTruthy()
      expect(stateOf(fx), said).toBe(before)
    }
  }, 60000)
})
