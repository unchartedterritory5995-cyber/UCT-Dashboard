// The widget control family: every control a person has on a widget is one registry row (widgets/registry.js
// widgetControls), written by widget.setOption through the writer the widget's own control uses, read back by
// widget.readOptions. A control in `opts` goes through the board writer; a control the widget keeps itself goes through its
// door (pages/charts/widgetDoors.js), which here is a small stand-in holding that state. The real widgets are driven in a
// real browser by the harness (app/src/testing/agent/agentHarness.jsx ?board=widgets), and settingsLiveness.test.js proves
// each row against the widget's own source.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { registerBuiltins } from './builtins'
import { buildContext, getCapability, manifestFor, refreshContext, MANIFEST_CONTRACT } from './capabilities'
import { planOps, collectTargets, prepareOps } from './executor'
import { commitPlan, undoEntry } from './runtime'
import { makeBoard } from './__fixtures__/board'
import { publishWidgetDoor } from '../pages/charts/widgetDoors'
import { WIDGET_REGISTRY } from '../widgets/registry'
import { widgetControls } from '../widgets/widgetControls'
import { allControls } from './widgetNames'
import { etToday } from './dateWords'
import { routeManifestV2 } from './nlm1/routingV2'

const send = vi.hoisted(() => ({ fn: null }))
vi.mock('../components/journalCaptureLoader', () => ({ loadJournalCapture: async () => ({ sendCaptureToJournal: (...a) => send.fn(...a) }) }))

registerBuiltins()
const CTX = { surface: 'charts' }
const w = (id, type, opts = {}, x = 0, y = 0) => ({ id, type, x, y, w: 6, h: 10, color: 'N', opts })
const op = (args, action = 'widget.setOption') => ({ action, target: 'board', args })
async function plan(h, ops) {
  buildContext(h, CTX)
  const env = await prepareOps(ops)
  return { p: planOps(collectTargets(h, ['board']), ops, env, CTX), env }
}
const apply = async (host, args) => {
  const { p, env } = await plan(host, [op(args)])
  expect(p.ok, JSON.stringify(p.refusals)).toBe(true)
  return { res: await commitPlan(host, p, { env }), p }
}
const refuse = async (h, args, action) => (await plan(h, [op(args, action)])).p.refusals?.[0]?.reason
const optsOf = (state, id) => state.widgets.find(x => x.id === id).opts
const CHOICES = {
  reading: [{ value: 'a20', label: '% Above 20-Day' }, { value: 'a50', label: '% Above 50-Day' }],
  index: [{ value: 'SPY', label: 'SPY' }, { value: 'QQQ', label: 'QQQ' }],
  watchlist: [{ value: null, label: 'All' }, { value: 'wl1', label: 'Momentum' }],
  list: [{ value: null, label: 'Top 1,000' }, { value: 'v1', label: 'Semis' }],
  universe: [{ value: 0, label: 'S&P 500' }, { value: 1, label: 'Nasdaq 100' }],
  xKey: [{ value: 'rvol', label: 'RVOL' }, { value: 'adr', label: 'ADR %' }],
}
// a widget's own state and writer, as a mounted widget publishes it. `render` stands in for the commit React does.
function door(state, { options = {}, writeSync = true } = {}) {
  const live = {
    read: () => ({ ...state }),
    options: () => options,
    write: (k, v) => { live.writes.push([k, v]); if (writeSync) state[k] = v },
    writes: [],
  }
  return live
}
const cleanups = []
const publish = (id, live) => { cleanups.push(publishWidgetDoor(id, () => live)); return live }
afterEach(() => { while (cleanups.length) cleanups.pop()() })

describe('a control in opts: the registry validates, the board writer writes, Undo is exact', () => {
  const cases = [
    ['breadth', { view: 'heatmap' }, 'view', 'ratio', o => o.view === 'ratio'],
    ['breadth', {}, 'reading', '-a20', o => JSON.stringify(o.hiddenMetrics) === '["a20"]'],
    ['breadth', { hiddenMetrics: ['a20', 'a50'] }, 'reading', '+a20', o => JSON.stringify(o.hiddenMetrics) === '["a50"]'],
    ['indexes', {}, 'index', '-QQQ', o => JSON.stringify(o.hiddenSymbols) === '["QQQ"]'],
    ['optionsflow', { filters: { minPrem: 0, cp: 'all', type: 'SWEEP', dir: 'all' } }, 'callPut', 'C', o => o.filters.cp === 'C' && o.filters.type === 'SWEEP'],
    ['optionsflow', {}, 'minPremium', 500000, o => o.filters.minPrem === 500000],
    ['optionsflow', {}, 'printType', 'block', o => o.filters.type === 'BLOCK'],
    ['optionsflow', {}, 'direction', 'BEAR', o => o.filters.dir === 'BEAR'],
    ['themes', {}, 'todayBasis', 'open', o => o.todayBasis === 'open'],
    ['tradeExchangeNews', {}, 'watchlist', 'Momentum', o => o.watchlistId === 'wl1'],
    ['researchLibrary', {}, 'category', '+Macro', o => JSON.stringify(o.categories) === '["Macro"]'],
    ['volumescan', {}, 'list', 'Semis', o => o.volActive === 'v1'],
    ['nhnl', { universes: [{ key: 'all', label: 'S&P 500' }, { key: 'b', label: 'Nasdaq 100' }] }, 'universe', 'nasdaq', o => o.activeUniverse === 1],
    ['scatter', {}, 'xKey', 'ADR %', o => o.xKey === 'adr'],
    ['scatter', {}, 'labelMode', 'off', o => o.labelMode === 'off'],
    ['scatter', {}, 'followList', 'on', o => o.followList === true],
    ['scatter', { followList: true }, 'universe', 'Nasdaq 100', o => o.activeUniverse === 1 && !o.followList],
    ['calendar', {}, 'econStars', 2, o => o.econStars === 2],
    ['news', {}, 'filter', 'up', o => o.filter === 'up'],
    ['fundamentals', { view: 'quarterly' }, 'view', 'annual', o => o.view === 'annual'],
  ]
  it.each(cases)('%s %j: %s = %s', async (type, opts, key, value, landed) => {
    const { host, state } = makeBoard([w('x', type, opts)], {})
    publish('x', door({}, { options: CHOICES }))
    const before = JSON.stringify(state.widgets)
    const { res, p } = await apply(host, { widget: 'x', key, value })
    expect(res.ok).toBe(true)
    expect(state.boardWrites).toBe(1)
    expect(landed(optsOf(state, 'x')), JSON.stringify(optsOf(state, 'x'))).toBe(true)
    expect(p.lines[0]).toContain(`${key} is now`)
    expect((await undoEntry(host, res.undo)).ok).toBe(true)
    expect(JSON.stringify(state.widgets)).toBe(before)
  })
  it('a set: an empty "all" is expanded when one goes, a full one is stored empty, in the menu\'s order, and the preset is cleared as the menu does', async () => {
    const { host, state } = makeBoard([w('x', 'tradeExchangeNews', { presetId: 'p1' })], {})
    await apply(host, { widget: 'x', key: 'category', value: '-Other' })
    expect(optsOf(state, 'x')).toMatchObject({ categories: ['News', 'Macro', 'Options', 'Earnings', 'Price', 'Press Release', 'Filing'], presetId: null })
    await apply(host, { widget: 'x', key: 'category', value: '+other' })
    expect(optsOf(state, 'x').categories).toEqual([])
  })
  it('refused, nothing written: a wrong word, a set value with no sign, a member that is not one, a set going empty through a door', async () => {
    const { host, state } = makeBoard([w('o', 'optionsflow'), w('b', 'breadth'), w('n', 'nhnl')], {})
    publish('b', door({}, { options: CHOICES }))
    publish('n', door({ universes: ['S&P 500'] }, { options: { universe: CHOICES.universe, universes: [{ value: 'S&P 500', label: 'S&P 500' }] } }))
    const before = JSON.stringify(state.widgets)
    expect(await refuse(host, { widget: 'o', key: 'callPut', value: 'strangles' })).toMatch(/“callPut” can be All, Calls, Puts — not “strangles”/)
    expect(await refuse(host, { widget: 'b', key: 'reading', value: 'a20' })).toMatch(/takes \+member or -member/)
    expect(await refuse(host, { widget: 'b', key: 'reading', value: '-z9' })).toMatch(/“z9” isn't one of reading: % Above 20-Day, % Above 50-Day/)
    expect(await refuse(host, { widget: 'n', key: 'universes', value: '-S&P 500' })).toMatch(/keeps at least one/)
    expect(JSON.stringify(state.widgets)).toBe(before)
  })
  it('two labels that both fit are a refusal, never a guess; an exact label wins over a partial one', async () => {
    const { host, state } = makeBoard([w('m', 'scatter')], {})
    publish('m', door({}, { options: { xKey: [{ value: 'a', label: 'Change 1D' }, { value: 'b', label: 'Change 5D' }, { value: 'c', label: 'Change' }] } }))
    expect(await refuse(host, { widget: 'm', key: 'xKey', value: 'Change 1' })).toBeFalsy()
    expect(await refuse(host, { widget: 'm', key: 'xKey', value: 'hang' })).toMatch(/can be Change 1D, Change 5D, Change/)
    await apply(host, { widget: 'm', key: 'xKey', value: 'change' })
    expect(optsOf(state, 'm').xKey).toBe('c')
  })
})

describe('a control the widget keeps itself: its own writer, read back through its door, Undo through it again', () => {
  const THEMES = [{ value: 'SMH', label: 'Semiconductors' }, { value: 'IGV', label: 'Software' }]
  const tracker = (over = {}) => door({ period: '1d', sortDir: 'desc', openTheme: null, themeSet: null, ...over }, { options: { openTheme: THEMES, themeSet: [{ value: null, label: 'Default' }, { value: 's1', label: 'Growth' }] } })
  it.each([
    ['period', '1w', '1w', 'period is now 1w'],
    ['sortDir', 'asc', 'asc', 'sortDir is now asc'],
    ['openTheme', 'semis', null, null],
    ['openTheme', 'Semiconductors', 'SMH', 'openTheme is now Semiconductors'],
    ['themeSet', 'Growth', 's1', 'themeSet is now Growth'],
  ])('themes %s = %s', async (key, value, want, line) => {
    const { host, state } = makeBoard([w('t', 'themes')], {})
    const before = JSON.stringify(state.widgets)
    const d = publish('t', tracker())
    if (want == null) { expect(await refuse(host, { widget: 't', key, value })).toMatch(/can be/); return }
    const { res, p } = await apply(host, { widget: 't', key, value })
    expect(p.lines[0]).toContain(line)
    expect(d.read()[key]).toBe(want)
    expect(d.writes).toEqual([[key, want]])
    expect(state.boardWrites ?? 0).toBe(0)                    // nothing here is the board's
    expect((await undoEntry(host, res.undo)).ok).toBe(true)
    expect(d.writes.at(-1)[0]).toBe(key)
    expect(d.read()[key]).toBe(key === 'period' ? '1d' : key === 'sortDir' ? 'desc' : null)
    expect(JSON.stringify(state.widgets)).toBe(before)
  })
  it('the Calendar\'s day takes the words the calendar capabilities take, and its TBD section', async () => {
    const { host } = makeBoard([w('c', 'calendar')], {})
    const today = etToday()
    const d = publish('c', door({ day: '2026-01-05', tbdOpen: false }))
    await apply(host, { widget: 'c', key: 'day', value: 'today' })
    expect(d.read().day).toBe(today)
    await apply(host, { widget: 'c', key: 'tbdOpen', value: 'on' })
    expect(d.read().tbdOpen).toBe(true)
    expect(await refuse(host, { widget: 'c', key: 'day', value: 'someday' })).toMatch(/as a day/)
  })
  it('with no door there is nothing to write to: refused in words, for a door control and for choices only the widget knows', async () => {
    const { host } = makeBoard([w('t', 'themes'), w('b', 'breadth')], {})
    expect(await refuse(host, { widget: 't', key: 'openTheme', value: 'Semis' })).toMatch(/isn't showing right now/)
    expect(await refuse(host, { widget: 'b', key: 'reading', value: '-a20' })).toMatch(/isn't showing right now/)
    const empty = publish('t', door({ openTheme: null }, { options: { openTheme: [] } }))
    expect(empty).toBeTruthy()
    expect(await refuse(host, { widget: 't', key: 'openTheme', value: 'Semis' })).toMatch(/nothing to choose/)
  })
  it('⛔ a writer that does not take the value fails the change: no receipt, no Undo', async () => {
    const { host } = makeBoard([w('t', 'themes')], {})
    publish('t', door({ period: '1d', sortDir: 'desc', openTheme: null, themeSet: null }, { writeSync: false }))
    const { p, env } = await plan(host, [op({ widget: 't', key: 'period', value: '1w' })])
    vi.useFakeTimers({ toFake: ['Date'] })
    const realNow = Date.now
    let t = realNow()
    Date.now = () => (t += 1000)
    try {
      const res = await commitPlan(host, p, { env })
      expect(res.ok).toBe(false)
      expect(res.undo).toBeFalsy()
    } finally { Date.now = realNow; vi.useRealTimers() }
  }, 20000)
  it('no change needed: the receipt says so and nothing is written', async () => {
    const { host } = makeBoard([w('t', 'themes')], {})
    const d = publish('t', tracker({ period: '1w' }))
    const { p } = await plan(host, [op({ widget: 't', key: 'period', value: '1w' })])
    expect(p.ok).toBe(true)
    expect(p.lines.length).toBe(0)
    expect(d.writes).toEqual([])
  })
  it('a universe added through the widget\'s own writer: Undo restores the opts whole, without calling a door write to re-create the old list', async () => {
    const before = { universes: [{ key: 'all', label: 'UCT Universe' }], activeUniverse: 0 }
    const { host, state } = makeBoard([w('n', 'nhnl', before)], {})
    const d = publish('n', door({}, { options: { universe: [{ value: 0, label: 'UCT Universe' }], universes: ['UCT Universe', 'Nasdaq 100'].map(l => ({ value: l, label: l })) } }))
    d.read = () => ({ universes: optsOf(state, 'n').universes.map(u => u.label) })     // the widget's tabs ARE its opts
    d.write = (k, next) => {
      d.writes.push([k, next])
      state.widgets[0] = { ...state.widgets[0], opts: { universes: next.map(l => ({ key: l, label: l })), activeUniverse: next.length - 1 } }
    }
    const { res } = await apply(host, { widget: 'n', key: 'universes', value: '+nasdaq' })
    expect(d.writes).toEqual([['universes', ['UCT Universe', 'Nasdaq 100']]])
    expect(optsOf(state, 'n').activeUniverse).toBe(1)
    expect((await undoEntry(host, res.undo)).ok).toBe(true)
    expect(optsOf(state, 'n')).toEqual(before)
    expect(d.writes.length).toBe(1)
  })
  it('Undo is refused when the widget has moved on since', async () => {
    const { host } = makeBoard([w('t', 'themes')], {})
    const d = publish('t', tracker())
    const { res } = await apply(host, { widget: 't', key: 'period', value: '1w' })
    d.write('period', '3m')
    expect((await undoEntry(host, res.undo)).ok).toBe(false)
    expect(d.read().period).toBe('3m')
  })
})

describe('widget.readOptions: how a widget is set, read back', () => {
  const read = (host, widget) => {
    const { refMap } = buildContext(host, CTX)
    const ref = Object.keys(refMap).find(k => refMap[k].kind === 'board')
    expect(ref).toBeTruthy()
    return getCapability('widget.readOptions').answer(collectTargets(host, ['board']).get('board')?.snap, { widget })
  }
  it('every control\'s value and choices, opts and door alike; a scan\'s criteria; a list that is long is said to be', () => {
    const { host } = makeBoard([w('o', 'optionsflow', { lead: 'biggest', filters: { cp: 'P' } }), w('t', 'themes'), w('s', 'scanner', { scanKey: 'ipo-1y' })], {})
    const many = Array.from({ length: 20 }, (_, i) => ({ value: `T${i}`, label: `Theme ${i}` }))
    publish('t', door({ period: '1w', sortDir: 'desc', openTheme: 'T3', themeSet: null }, { options: { openTheme: many, themeSet: [] } }))
    publish('s', { about: () => 'criteria: Listed Within The Last 1-Year; Price Above $1' })
    const flow = read(host, 'o')
    expect(flow.split('\n')[0]).toMatch(/lead biggest, .*callPut Puts, /)
    expect(flow).toMatch(/lead: tape, biggest, sentiment/)
    expect(flow).toMatch(/callPut: All, Calls, Puts/)
    expect(flow).toMatch(/minPremium All,/)   // corrected after F-16 run 2: the premium chip reads as its own word (All), not 0 — docs/agent/program/evidence/f16-run2-dark-pool.txt
    const th = read(host, 't')
    expect(th).toMatch(/period 1w/)
    expect(th).toMatch(/openTheme Theme 3/)
    expect(th).toMatch(/openTheme: Theme 0, .* and 8 more/)
    expect(th).toMatch(/todayBasis close/)
    expect(read(host, 's')).toMatch(/criteria: Listed Within The Last 1-Year/)
    expect(read(host, 'zz')).toMatch(/no widget “zz”/)
  })
  it('a door control of a widget that is not showing is left out, never guessed', () => {
    const { host } = makeBoard([w('t', 'themes')], {})
    const out = read(host, 't')
    expect(out).toMatch(/todayBasis/)
    expect(out).not.toMatch(/period/)
  })
  it('is a query: no plan, no write, no Undo', () => {
    const c = getCapability('widget.readOptions')
    expect(c.query).toBe(true)
    expect(c.surfaces).toEqual(['charts'])
  })
})

describe('what the model is told: the types on THIS board, not every type on every request', () => {
  const ROUTED = { groups: ['boardEdit'] }
  const entry = async (host, message = '') => {
    await refreshContext(1500, ROUTED)
    return buildContext(host, { ...CTX, message }).context.widgetControls?.[0]
  }
  const noRoute = (host, message) => buildContext(host, { ...CTX, message }).context.widgetControls
  it('each type once, with its choices; a widget says only what differs from how it starts', async () => {
    const { host } = makeBoard([w('a', 'news', { filter: 'up' }), w('b', 'news'), w('c', 'fundamentals', { view: 'quarterly' }), w('d', 'chart')], {})
    const e = await entry(host)
    expect(e.controls).toEqual({ news: 'filter(all|up|down)', fundamentals: 'view(annual|quarterly|analyst|ownership)' })
    expect(e.set).toEqual({ a: { filter: 'up' } })
  })
  it('a widget\'s own state is in `set`, and a list only it knows says to ask', async () => {
    const { host } = makeBoard([w('t', 'themes')], {})
    publish('t', door({ period: '1w', sortDir: 'desc', openTheme: 'SMH', themeSet: null }))
    const e = await entry(host)
    expect(e.set.t).toEqual({ period: '1w', openTheme: 'SMH' })
    expect(e.controls.themes).toContain('openTheme(ask widget.readOptions)')
    expect(e.controls.themes).toContain('period(1d|1w|1m|3m|1y|ytd)')
  })
  it('⛔ a turn that does not touch widgets carries none of it, and the board entry stays as it was', () => {
    const { host } = makeBoard([w('a', 'news', { filter: 'up' }), w('t', 'themes'), w('b', 'breadth')], {})
    for (const m of ['make it weekly', 'thanks', 'add the 50 day', 'what is a pullback', '']) expect(noRoute(host, m), m).toBeUndefined()
    const board = buildContext(host, { ...CTX, message: 'thanks' }).context.board[0]
    expect(board.controls).toBeUndefined()
    expect(board.widgets.some(x => 'set' in x)).toBe(false)
  })
  it('the routing that carries the group sends it, once: the next turn starts clean, and a reroute is armed the same way', async () => {
    const { host } = makeBoard([w('a', 'news')], {})
    await refreshContext(1500, { groups: ['charts'] })
    expect(noRoute(host, 'make it weekly')).toBeUndefined()
    await refreshContext(1500, ROUTED)
    expect(noRoute(host, 'make it weekly')).toBeTruthy()
    expect(noRoute(host, 'make it weekly')).toBeUndefined()
    await refreshContext(1500)                                          // no routing to read (planner v2): the message decides
    expect(noRoute(host, 'make it weekly')).toBeUndefined()
  })
  it.each(['undo', 'undo that', 'take that back', 'roll back what you just did'])('routing v2: "%s" may pack the group, but its evidence does not load the list', (m) => {
    const opts = { enabled: true, limit: MANIFEST_CONTRACT.limits.maxCapabilities, budget: MANIFEST_CONTRACT.routingThreshold }
    expect(routeManifestV2(manifestFor(CTX), m, opts).refresh || []).not.toContain('boardEdit')
  })
  it('routing v2: a request with evidence for the group does load it', () => {
    const opts = { enabled: true, limit: MANIFEST_CONTRACT.limits.maxCapabilities, budget: MANIFEST_CONTRACT.routingThreshold }
    expect(routeManifestV2(manifestFor(CTX), 'show the theme tracker by week', opts).refresh).toContain('boardEdit')
  })
  it('a message that names a widget on this board brings that type alone, in the registry\'s words', () => {
    const { host } = makeBoard([w('f', 'fundamentals'), w('n', 'news'), w('m', 'scatter')], {})
    expect(noRoute(host, 'show annual on the fundamentals')[0].controls).toEqual({ fundamentals: expect.any(String) })
    expect(Object.keys(noRoute(host, 'use spotlight labels on the market map')[0].controls)).toEqual(['scatter'])
    expect(noRoute(host, 'hide the breadth heatmap')).toBeUndefined()   // no Breadth widget here
    expect(noRoute(host, 'switch to quarterly')).toBeUndefined()        // one word alone: routing decides (a reroute arms it)
    expect(noRoute(host, 'any news on TSLA')).toBeUndefined()
  })
  it('every row the registry describes reaches the model; a type with none is absent', async () => {
    for (const type of Object.keys(WIDGET_REGISTRY)) {
      const { host } = makeBoard([w('x', type)], {})
      const line = (await entry(host))?.controls[type]
      // the Agent's own controls too (widgetNames AGENT_CONTROLS: a Notebook's note, a chart's Company Info panel), each
      // offered only while the widget can take it (a chart with no panel offers none)
      const rows = allControls(type).filter(f => !f.when?.({}))
      if (!rows.length) { expect(line, type).toBeUndefined(); continue }
      for (const f of rows) expect(line, `${type}.${f.key}`).toContain(`${f.key}(`)
    }
  })
  it('the three capabilities stay inside the contract, with no per-widget list in the manifest', () => {
    const L = MANIFEST_CONTRACT.limits
    const names = ['widget.setOption', 'widget.readOptions', 'widget.sendToJournal']
    const rows = manifestFor(CTX).filter(c => names.includes(c.name))
    expect(rows.map(c => c.name).sort()).toEqual([...names].sort())
    for (const c of rows) {
      expect(c.summary.length, c.name).toBeLessThanOrEqual(L.maxSummary)
      expect((c.hints || '').length, c.name).toBeLessThanOrEqual(L.maxHints)
    }
    expect(JSON.stringify(rows).length).toBeLessThanOrEqual(2600)
    expect(rows.find(c => c.name === 'widget.setOption').hints).not.toMatch(/fundamentals|optionsflow/)
  })
})

describe('widget.sendToJournal: the widget\'s own door, the Journal\'s one send path', () => {
  const capture = { symbol: 'NVDA' }
  beforeEach(() => { send.fn = vi.fn(async (kind, c, { label }) => `${label} sent to “Tuesday”`) })
  const propose = async (host, args) => plan(host, [op(args, 'widget.sendToJournal')])
  it('asks first, sends exactly what the door froze, and the receipt is the Journal\'s own line; no Undo', async () => {
    const { host, state } = makeBoard([w('s', 'scanner', { scanKey: 'ipo-1y' })], {})
    publish('s', { capture: () => ({ kind: 'scanner', capture, label: 'IPOs' }) })
    const before = JSON.stringify(state.widgets)
    const c = getCapability('widget.sendToJournal')
    expect([c.risk, c.reversible, c.undo]).toEqual(['confirm', false, 'none'])
    const { p, env } = await propose(host, { widget: 's', where: null })
    expect(p.ok).toBe(true)
    expect(p.lines[0]).toMatch(/^Send the Scanner.* to your current note \(or the Notebook inbox\)$/)
    expect(send.fn).not.toHaveBeenCalled()
    const res = await commitPlan(host, p, { env })
    expect(res.ok).toBe(true)
    expect(send.fn).toHaveBeenCalledWith('scanner', capture, { label: 'IPOs', target: 'note' })
    expect(res.lines.join(' ')).toContain('IPOs sent to “Tuesday”')
    expect(res.undo).toBeFalsy()
    expect(JSON.stringify(state.widgets)).toBe(before)
  })
  it('a named place goes through; a chart has no label of its own, as at its door', async () => {
    const { host } = makeBoard([w('c', 'chart')], {})
    publish('c', { capture: () => ({ kind: 'chart', capture }) })
    const { p, env } = await propose(host, { widget: 'c', where: 'inbox' })
    await commitPlan(host, p, { env })
    expect(send.fn).toHaveBeenCalledWith('chart', capture, { target: 'inbox' })
  })
  it('several widgets in one request go one by one, each with its line', async () => {
    const { host } = makeBoard([w('a', 'breadth'), w('b', 'indexes')], {})
    publish('a', { capture: () => ({ kind: 'breadth', capture, label: 'Breadth' }) })
    publish('b', { capture: () => ({ kind: 'indexes', capture, label: 'Indexes' }) })
    const { p, env } = await plan(host, [op({ widget: 'a', where: 'inbox' }, 'widget.sendToJournal'), op({ widget: 'b', where: 'inbox' }, 'widget.sendToJournal')])
    expect(p.ok).toBe(true)
    const res = await commitPlan(host, p, { env })
    expect(send.fn).toHaveBeenCalledTimes(2)
    expect(res.lines.join(' ')).toMatch(/Breadth sent.*Indexes sent/)
  })
  it.each([['Capture failed — try again'], ['This note is still syncing — try again in a moment.']])('⛔ the Journal said no (%s): the change fails, in its words', async (text) => {
    send.fn = vi.fn(async () => text)
    const { host } = makeBoard([w('s', 'scanner')], {})
    publish('s', { capture: () => ({ kind: 'scanner', capture, label: 'IPOs' }) })
    const { p, env } = await propose(host, { widget: 's', where: null })
    const res = await commitPlan(host, p, { env })
    expect(res.ok).toBe(false)
    expect(JSON.stringify(res.failed)).toContain(text.slice(0, 12))
  })
  it('refused where the door is not offered: nothing shown, a widget with no door, an unknown widget', async () => {
    const { host } = makeBoard([w('s', 'scanner'), w('n', 'nhnl')], {})
    publish('s', { capture: () => null })
    expect(await refuse(host, { widget: 's', where: null }, 'widget.sendToJournal')).toMatch(/nothing to send/)
    expect(await refuse(host, { widget: 'n', where: null }, 'widget.sendToJournal')).toMatch(/nothing to send/)
    expect(await refuse(host, { widget: 'zz', where: null }, 'widget.sendToJournal')).toMatch(/no widget “zz”/)
    expect(send.fn).not.toHaveBeenCalled()
  })
})

describe('who reports on /charts: the calendar\'s own reads, on the board too', () => {
  const week = { days: { '2026-11-05': { bmo: [{ sym: 'AAA' }], amc: [{ sym: 'BBB' }], tbd: [] } }, week_start: '2026-11-02' }
  beforeEach(() => { vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => week }))) })
  afterEach(() => { vi.unstubAllGlobals() })
  it('the day read is offered here, with a target to aim at, and needs no Calendar page; the date of one stock stays with stock.earnings', async () => {
    const { host } = makeBoard([w('c', 'chart')], {})
    const names = manifestFor(CTX).map(c => c.name)
    expect(names).toContain('calendar.day')
    expect(names).not.toContain('calendar.nextReport')
    expect(buildContext(host, { ...CTX, message: 'make it weekly' }).context.calendar).toBeUndefined()
    await refreshContext(1500, { groups: ['calendar'] })
    expect(buildContext(host, { ...CTX, message: 'hello' }).context.calendar[0].ref).toBeTruthy()
    expect(buildContext(host, { ...CTX, message: 'who reports on friday' }).context.calendar[0].ref).toBeTruthy()
    const out = await getCapability('calendar.day').answer(collectTargets(host, ['calendar']).get('calendar')?.snap, { date: '2026-11-05' })
    expect(fetch).toHaveBeenCalled()
    expect(String(out?.text ?? out)).toMatch(/AAA/)
    expect(String(out?.text ?? out)).toMatch(/BBB/)
  })
})
