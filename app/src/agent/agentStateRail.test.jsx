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
import { stateRailRefusal, stateEffects } from './stateRail'
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
  'widget.showList (Tech → Swing)': 'show my swing list in the watchlist widget', 'widget.closeTab (the News tab)': 'close the news tab and remove it',
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
      // a negated destroy word never permits ("add an rsi, don't remove anything")
      expect(stateRailRefusal(plan, { words: `add ${OBJECT[kind]}, don't remove or change anything` })).toBeTruthy()
    })
  }
  it('fails closed: a plan whose effect cannot be read is refused for additive words (never let through)', () => {
    const plan = { ok: true, plans: [{ kind: 'indicatorEdits', ref: 'ixe:c1', before: { rows: [] }, after: { change: { request: { op: 'someNewOp' } } }, patch: { change: { request: { op: 'someNewOp' } } } }] }
    expect(stateRailRefusal(plan, { words: 'add an rsi' })).toMatch(/didn’t change anything/)
    const broken = { ok: true, plans: [{ kind: 'watchlist', get patch() { throw new Error('unreadable') } }] }
    expect(stateRailRefusal(broken, { words: 'add AAPL' })).toMatch(/didn’t change anything/)
    expect(stateRailRefusal(broken, { words: 'show me AAPL' })).toBe(null)            // not additive: the rail has nothing to say
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
