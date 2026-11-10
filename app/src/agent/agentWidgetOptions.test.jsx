// W1-B (Wave 1, BOARD B-05) — widget.setOption: ONE per-widget option, validated against the widget registry's own
// param schema (widgets/registry.js paramsSchema: enum | boolean | number, never an identity key), written through the
// board writer's `set[id].opts` — the same `{...w, opts}` + scheduleSave that ChartsWorkspace.handleOptsChange performs
// for a widget's own settings panel. Undo puts the previous opts object back exactly. Keys the schema does not declare
// as options are refused, and so are the ones it declares that the mounted widget does not read (settingsLiveness.test.js).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup, screen } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { buildContext, getCapability, manifestFor, refreshContext, shapeError } from './capabilities'
import { planOps, collectTargets, prepareOps } from './executor'
import { commitPlan, undoEntry } from './runtime'
import { makeBoard } from './__fixtures__/board'
import { setupPanel, ONE } from './testing/panelHarness'
import { WIDGET_REGISTRY, WORKSPACE_MENU_TYPES } from '../widgets/registry'
import { widgetControls } from '../widgets/widgetControls'
import { allControls } from './widgetNames'
import { loadAgentConfig, _resetAgentConfig } from './agentClient'
import { fastParse } from './fastPath'
import { FLOW_FIELDS, RATING_FIELDS } from './capabilities/scanHidden'
import { routingV2Active } from './nlm1/flag'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
registerBuiltins()
const CTX = { surface: 'charts' }
const w = (id, type, x, y, opts = {}) => ({ id, type, x, y, w: 6, h: 10, color: 'N', opts })
const BOARD = () => [
  w('ch', 'chart', 0, 0, { tf: 'D' }), w('th', 'themes', 6, 0, { period: '1d', sortDir: 'desc', openTheme: 'Semis' }), w('fu', 'fundamentals', 12, 0, { view: 'quarterly' }),
  w('nw', 'news', 18, 0, {}), w('br', 'breadth', 0, 10, { tileStyle: 'values', hiddenMetrics: ['x'] }), w('of', 'optionsflow', 6, 10, { lead: 'tape' }), w('ca', 'calendar', 12, 10, { date: '2026-10-30', econStars: 3 }),
  w('vs', 'volumescan', 18, 10, { minRvol: 2 }), w('nh', 'nhnl', 0, 0, {}),
]
const op = (args) => ({ action: 'widget.setOption', target: 'board', args })
async function plan(h, ops) {
  buildContext(h, CTX)
  const env = await prepareOps(ops)
  return { p: planOps(collectTargets(h, ['board']), ops, env, CTX), env }
}
const optsOf = (board, id) => board.state.widgets.find(x => x.id === id).opts
const refuse = async (h, args) => (await plan(h, [op(args)])).p.refusals[0]?.reason

describe('widget.setOption — options the widget reads, off the Widgets menu too', () => {
  const BOARD2 = () => [w('tn', 'tradeExchangeNews', 0, 0, { presetId: 'p1', presets: [{ id: 'p1', name: 'Mine' }] }), w('rl', 'researchLibrary', 6, 0, {}), w('ps', 'periodsort', 12, 0, { start: 1, end: 2 })]
  const apply = async (host, args) => {
    const { p, env } = await plan(host, [op(args)])
    expect(p.ok, JSON.stringify(p.refusals)).toBe(true)
    return commitPlan(host, p, { env })
  }
  it('News: pause (follow) and the linked filter; a Period Sort: its grouping; each listed for the model, each undone exactly', async () => {
    const { host, state } = makeBoard(BOARD2(), {})
    await refreshContext(1500, { groups: ['boardEdit'] })
    const said = buildContext(host, CTX).context.widgetControls[0].controls
    expect(said.tradeExchangeNews).toMatch(/^follow\(on\/off\), linked\(on\/off\)/)
    expect(said.periodsort).toBe('group(theme|sector|industry)')
    for (const [widget, key, value, want] of [['tn', 'follow', 'off', false], ['rl', 'linked', 'on', true], ['ps', 'group', 'Sector', 'sector']]) {
      const before = JSON.stringify(state.widgets)
      const res = await apply(host, { widget, key, value })
      expect(optsOf({ state }, widget)[key], `${widget}.${key}`).toBe(want)
      expect((await undoEntry(host, res.undo)).ok).toBe(true)
      expect(JSON.stringify(state.widgets)).toBe(before)
    }
  })
  it('the linked filter clears the applied preset as the widget\'s own control does; a no-op does not, and Undo puts the preset back', async () => {
    const { host, state } = makeBoard(BOARD2(), {})
    const res = await apply(host, { widget: 'tn', key: 'linked', value: 'on' })
    expect(optsOf({ state }, 'tn')).toMatchObject({ linked: true, presetId: null })
    await undoEntry(host, res.undo)
    expect(optsOf({ state }, 'tn').presetId).toBe('p1')
    await apply(host, { widget: 'tn', key: 'follow', value: 'off' })
    expect(optsOf({ state }, 'tn').presetId).toBe('p1')                       // follow is no filter: a preset does not store it
    const { host: h2, state: s2 } = makeBoard([w('tn', 'tradeExchangeNews', 0, 0, { linked: true, presetId: 'p1' })], {})
    await plan(h2, [op({ widget: 'tn', key: 'linked', value: 'on' })])
    expect(s2.widgets[0].opts.presetId).toBe('p1')
  })
})

describe('widget.setOption — the registry schema decides, the board writer writes, Undo is exact', () => {
  it('a Fundamentals view: the option written beside the widget\'s other opts (nothing else touched); receipt; Undo restores the exact previous opts', async () => {
    const { host, state } = makeBoard(...[BOARD(), { 'N:ch': 'NVDA' }])
    const before = JSON.stringify(state.widgets)
    const { p, env } = await plan(host, [op({ widget: 'fu', key: 'view', value: 'Annual' })])
    expect(p.ok).toBe(true)
    expect(p.lines.length).toBe(1)
    expect(p.lines[0]).toMatch(/view is now annual \(was quarterly\)$/)
    const res = await commitPlan(host, p, { env })
    expect(res.ok).toBe(true)
    expect(optsOf({ state }, 'fu')).toEqual({ view: 'annual' })
    expect(state.boardWrites).toBe(1)                                             // the board writer (= handleOptsChange's write)
    expect((await undoEntry(host, res.undo)).ok).toBe(true)
    expect(JSON.stringify(state.widgets)).toBe(before)
  })
  it('every option type: an enum word in any case, on/off words for a boolean, a number for a number; a no-op is said', async () => {
    const { host, state } = makeBoard(...[BOARD(), { 'N:ch': 'NVDA' }])
    for (const [id, key, value, want] of [['fu', 'view', 'Annual', 'annual'], ['nw', 'filter', 'up', 'up'], ['of', 'scope', 'symbol', 'symbol'], ['ca', 'econStars', '2', 2], ['vs', 'showLogos', 'on', true]]) {
      const { p, env } = await plan(host, [op({ widget: id, key, value })])
      expect(p.ok, `${id}.${key}`).toBe(true)
      await commitPlan(host, p, { env })
      expect(optsOf({ state }, id)[key], `${id}.${key}`).toEqual(want)
    }
    const { p } = await plan(host, [op({ widget: 'fu', key: 'view', value: 'annual' })])
    expect(p.ok).toBe(true)
    expect(p.noops ?? p.plans?.[0]?.noops ?? []).toBeTruthy()
  })
  it('refused (nothing written): an unknown widget, a key the schema does not declare as an option (identity, json, capture-only), a wrong enum value, a non-number, a widget type with no options', async () => {
    const { host, state } = makeBoard(...[BOARD(), { 'N:ch': 'NVDA' }])
    const before = JSON.stringify(state.widgets)
    expect(await refuse(host, { widget: 'zz', key: 'period', value: '1w' })).toMatch(/no widget “zz”/)
    expect(await refuse(host, { widget: 'fu', key: 'rows', value: '1w' })).toMatch(/has no option “rows” — its options are view/)
    expect(await refuse(host, { widget: 'th', key: 'openTheme', value: 'x' })).toMatch(/isn't showing right now/)      // the widget's own list: no mounted widget, no write (agentWidgetControls)
    expect(await refuse(host, { widget: 'nw', key: 'symbol', value: 'AMD' })).toMatch(/no option “symbol”/)          // identity: chart.setSymbol's business
    expect(await refuse(host, { widget: 'ca', key: 'date', value: '2026-01-01' })).toMatch(/no option “date”/)
    expect(await refuse(host, { widget: 'fu', key: 'view', value: 'daily' })).toMatch(/“view” can be annual, quarterly, analyst, ownership — not “daily”/)
    expect(await refuse(host, { widget: 'ca', key: 'econStars', value: 'many' })).toMatch(/“econStars” is a number from 1 to 3/)
    // a NUMBER is accepted only within the product's own declared range, and a whole-number control takes whole numbers
    expect(await refuse(host, { widget: 'ca', key: 'econStars', value: 4 })).toMatch(/“econStars” is from 1 to 3/)
    expect(await refuse(host, { widget: 'ca', key: 'econStars', value: 2.5 })).toMatch(/whole number from 1 to 3/)
    // an UNBOUNDED numeric key (no min/max in the registry: nhnl.minPrice, volumescan.minRvol/minMove/minDollarK) is not an option at all
    expect(await refuse(host, { widget: 'nh', key: 'minPrice', value: 5 })).toMatch(/has no option “minPrice” — its options are universe, universes\.$/)
    expect(await refuse(host, { widget: 'vs', key: 'minRvol', value: 3 })).toMatch(/has no option “minRvol” — its options are showLogos, list\.$/)
    // (a chart's options are its Company Info panel's, round 5: the timeframe is chart.setTimeframe's)
    expect(await refuse(host, { widget: 'ch', key: 'tf', value: 'W' })).toMatch(/has no option “tf” — its options are companyTab, holdingsOpen, companyOpen/)
    // ⛔ declared in the schema, but the mounted widget never reads them back from opts: refused in words, nothing written
    for (const [id, key, value] of [['br', 'tileStyle', 'spark'], ['nh', 'minCount', 5]]) {
      expect(await refuse(host, { widget: id, key, value }), `${id}.${key}`).toMatch(new RegExp(`I can't change “${key}” .*doesn't read a saved value`))
    }
    // the widget's own state: only its mounted door can take it (agentWidgetControls), and with no door nothing is stored
    for (const [id, key, value] of [['th', 'period', '1w'], ['th', 'sortDir', 'asc'], ['ca', 'tbdOpen', true]]) {
      expect(await refuse(host, { widget: id, key, value }), `${id}.${key}`).toMatch(/isn't showing right now/)
    }
    expect(shapeError('widget.setOption', { widget: 'th', key: 'period' }, CTX)).toBeTruthy()                        // a closed schema
    expect(JSON.stringify(state.widgets)).toBe(before)
  })
  it('the offered keys are exactly the registry\'s controls; the capability is local and exactly undoable; the routed section names them per widget type', async () => {
    const c = getCapability('widget.setOption')
    expect([c.target, c.risk, c.undo]).toEqual(['board', 'local', 'exact'])
    const { host } = makeBoard(WORKSPACE_MENU_TYPES.map((t, i) => w(`t${i}`, t, 0, 0)), {})
    await refreshContext(1500, { groups: ['boardEdit'] })
    const said = buildContext(host, CTX).context.widgetControls[0].controls
    for (const type of WORKSPACE_MENU_TYPES) {
      if (allControls(type).some(f => !f.when?.({}))) expect(said[type], type).toBeTruthy()
      else expect(said[type], type).toBeUndefined()
      for (const f of WIDGET_REGISTRY[type].paramsSchema || []) {
        if (f.live === true) expect(said[type], `${type}.${f.key}`).toContain(`${f.key}(`)
      }
    }
    expect(JSON.stringify(said)).not.toContain('statYear')                      // a capture's frozen clock, not a control
    expect(said.calendar).toContain('econStars(1–3)')
    expect(JSON.stringify(said)).not.toContain('minRvol')                       // unbounded numbers are never offered
    expect(c.hints.length).toBeLessThanOrEqual(1000)
  })
})

describe('through the REAL panel (panelHarness)', () => {
  let p
  beforeEach(() => { p = setupPanel() })
  afterEach(() => { cleanup() })
  it('"show annual on the fundamentals" (scripted) → applied (local), receipt, undo exact', async () => {
    const [[chart], syms] = ONE('NVDA')
    const { say, board } = p.mount([{ ...chart, w: 18 }, w('fu', 'fundamentals', 18, 0, { view: 'quarterly' })], syms)
    const before = JSON.stringify(board.state.widgets)
    p.st.envelopes.push(p.env('apply', [op({ widget: 'fu', key: 'view', value: 'annual' })]))
    const out = await say('show annual on the fundamentals')
    expect(out).toMatch(/view is now annual \(was quarterly\)/)
    expect(optsOf(board, 'fu')).toEqual({ view: 'annual' })
    expect(screen.queryAllByTestId('agent-proposal').length).toBe(0)
    await say('undo')
    expect(JSON.stringify(board.state.widgets)).toBe(before)
    expect(p.turns()).toBe(1)
  }, 40000)
  it('⛔ a reroute to the group brings the control list: not on the first call, on the second, and the write lands', async () => {
    const [[chart], syms] = ONE('NVDA')
    const { say, board } = p.mount([{ ...chart, w: 18 }, w('nw', 'news', 18, 0, {})], syms)
    p.st.envelopes.push({ disposition: 'clarify', reply: '', ops: [], unsupported_category: null, question: { text: 'Looking at more of UCT…', choices: [] }, need_groups: ['boardEdit'] })
    p.st.envelopes.push(p.env('apply', [op({ widget: 'nw', key: 'filter', value: 'up' })]))
    const out = await say('only the up ones')
    const turns = p.st.calls.filter(c => c[1] === '/api/agent/turn').map(c => c[2])
    expect(turns.length).toBe(2)
    expect(turns[0].context.widgetControls).toBeUndefined()
    expect(turns[1].reroute).toBe(true)
    expect(turns[1].context.widgetControls[0].controls.news).toBe('filter(all|up|down)')
    expect(out).toMatch(/filter is now up/)
    expect(optsOf(board, 'nw').filter).toBe('up')
  }, 40000)
  it('"show the theme tracker by week" (scripted) with no mounted tracker to take it: it refuses and nothing is stored', async () => {
    const [[chart], syms] = ONE('NVDA')
    const { say, board } = p.mount([{ ...chart, w: 18 }, w('th', 'themes', 18, 0, { period: '1d', sortDir: 'desc' })], syms)
    p.st.envelopes.push(p.env('apply', [op({ widget: 'th', key: 'period', value: '1w' })]))
    expect(await say('show the theme tracker by week')).toMatch(/isn't showing right now/)
    expect(optsOf(board, 'th')).toEqual({ period: '1d', sortDir: 'desc' })
  }, 40000)
})

// Routing v2 is the live path for admins (nlm1/flag.js), and its router has its own refresh list.
describe('through the REAL panel with routing v2 on: a control request carries its list on the FIRST call', () => {
  let p
  const config = async (on) => {
    const base = globalThis.fetch
    globalThis.fetch = async (url, init) => (url === '/api/agent/config'
      ? new Response(JSON.stringify({ conversations: [], routing_v2: on }), { status: 200, headers: { 'content-type': 'application/json' } }) : base(url, init))
    localStorage.setItem('uct.agent.routingV2', on ? '1' : '0')
    _resetAgentConfig()
    await loadAgentConfig()
  }
  beforeEach(async () => { p = setupPanel(); await config(true) })
  afterEach(async () => { cleanup(); await config(false); localStorage.clear() })
  const firstTurn = () => p.st.calls.find(c => c[1] === '/api/agent/turn')[2]
  it('"show the theme tracker from the open": one model call, the list on it, the option set, Undo exact', async () => {
    expect(routingV2Active()).toBe(true)
    const [[chart], syms] = ONE('NVDA')
    const { say, board } = p.mount([{ ...chart, w: 18 }, w('th', 'themes', 18, 0, {})], syms)
    const before = JSON.stringify(board.state.widgets)
    p.st.envelopes.push(p.env('apply', [op({ widget: 'th', key: 'todayBasis', value: 'open' })]))
    const out = await say('show the theme tracker from the open')
    expect(p.turns()).toBe(1)
    const body = firstTurn()
    expect(body.capabilities.map(c => c.name)).toContain('widget.setOption')
    expect(body.context.widgetControls[0].controls.themes).toContain('todayBasis(close|open)')
    expect(out).toMatch(/todayBasis is now open/)
    expect(optsOf(board, 'th').todayBasis).toBe('open')
    await say('undo')
    expect(JSON.stringify(board.state.widgets)).toBe(before)
  }, 40000)
  const CALLS_WORDINGS = ['only show calls on the options flow', 'calls only on the options flow', 'filter the options flow to calls', 'show just calls in options flow',
    'only calls in the option flow', 'just the calls on the options-flow', 'keep only calls on the options flow', 'show me only calls on options flow']
  it.each(CALLS_WORDINGS)('owner exception, "%s": the widget\'s visible Calls filter through its own control, and no data read', async (message) => {
    const [[chart], syms] = ONE('NVDA')
    const { say, board } = p.mount([{ ...chart, w: 18 }, w('of', 'optionsflow', 18, 0, { filters: { type: 'SWEEP' } })], syms)
    const before = JSON.stringify(board.state.widgets)
    p.st.envelopes.push(p.env('apply', [op({ widget: 'of', key: 'callPut', value: 'Calls' })]))
    const out = await say(message)
    expect(p.turns()).toBe(1)
    expect(firstTurn().context.widgetControls[0].controls.optionsflow).toContain('callPut(')
    expect(out).toMatch(/callPut is now Calls/)
    expect(optsOf(board, 'of').filters).toEqual({ type: 'SWEEP', cp: 'C' })   // the chip's own writer, nothing else
    expect(p.st.calls.filter(c => /\/api\/(?:screener\/scan|agent\/data)/.test(c[1]))).toEqual([])
    await say('undo')
    expect(JSON.stringify(board.state.widgets)).toBe(before)
  }, 40000)
  it.each(['only show calls on the flow widget', 'calls only please', 'set the flow to calls only'])('"%s" names no hidden field, so it was never claimed: the model reaches the same control', async (message) => {
    const [[chart], syms] = ONE('NVDA')
    const { say, board } = p.mount([{ ...chart, w: 18 }, w('of', 'optionsflow', 18, 0, {})], syms)
    p.st.envelopes.push(p.env('apply', [op({ widget: 'of', key: 'callPut', value: 'calls' })]))
    await say(message)
    expect(p.turns()).toBeGreaterThanOrEqual(1)
    expect(optsOf(board, 'of').filters).toEqual({ cp: 'C' })
  }, 40000)
  // F-16 WIDENED (owner 2026-11-10): every chip, not only Calls — the same control, the same exact Undo
  it.each([['only show puts on the options flow', 'callPut', 'Puts', { cp: 'P' }], ['filter the options flow to puts', 'callPut', 'P', { cp: 'P' }],
    ['just sweeps on the options flow', 'printType', 'Sweep', { type: 'SWEEP' }], ['only show bears on the options flow', 'direction', 'Bear', { dir: 'BEAR' }]])('F-16 widened, "%s": the model is reached and sets that chip through the widget\'s own control; Undo exact', async (message, key, value, want) => {
    const [[chart], syms] = ONE('NVDA')
    const { say, board } = p.mount([{ ...chart, w: 18 }, w('of', 'optionsflow', 18, 0, {})], syms)
    const before = JSON.stringify(board.state.widgets)
    p.st.envelopes.push(p.env('apply', [op({ widget: 'of', key, value })]))
    await say(message)
    expect(p.turns()).toBe(1)
    expect(optsOf(board, 'of').filters).toEqual(want)
    expect(p.st.calls.filter(c => /\/api\/(?:screener\/scan|agent\/data)/.test(c[1]))).toEqual([])
    await say('undo')
    expect(JSON.stringify(board.state.widgets)).toBe(before)
  }, 40000)
  it.each(['only show balls on the options flow', 'only show falls on the options flow', 'filter the options flow to cells'])('⛔ "%s" is no chip word: the refusal, no model call, nothing changes', async (message) => {
    const [[chart], syms] = ONE('NVDA')
    const { say, board } = p.mount([{ ...chart, w: 18 }, w('of', 'optionsflow', 18, 0, {})], syms)
    const before = JSON.stringify(board.state.widgets)
    expect(await say(message)).toMatch(/can't screen on options-flow/)
    expect(p.turns()).toBe(0)
    expect(JSON.stringify(board.state.widgets)).toBe(before)
  }, 40000)
  it.each(CALLS_WORDINGS.filter(m => !m.startsWith('calls only')))('⛔ no flow widget on the board, "%s": the refusal, no model call, nothing run', async (message) => {
    const [[chart], syms] = ONE('NVDA')
    const { say } = p.mount([{ ...chart, w: 18 }], syms)
    expect(await say(message)).toMatch(/can't screen on options-flow/)
    expect(p.turns()).toBe(0)
    expect(p.st.calls.filter(c => /\/api\/screener\/scan/.test(c[1]))).toEqual([])
  }, 40000)
  it('⛔ no flow widget and the model tries the control anyway: refused, nothing written', async () => {
    const [[chart], syms] = ONE('NVDA')
    const { say, board } = p.mount([{ ...chart, w: 18 }], syms)
    const before = JSON.stringify(board.state.widgets)
    p.st.envelopes.push(p.env('apply', [op({ widget: 'of', key: 'callPut', value: 'Calls' })]))
    expect(await say('calls only on the options flow')).toMatch(/no widget “of”/)   // not screen-shaped, so the model gets it
    expect(JSON.stringify(board.state.widgets)).toBe(before)
  }, 40000)
  it.each([
    ['no such widget on the board', 'only show calls on the options flow', false],
    ['a universe of stocks', 'only show stocks with calls on the options flow', true],
    ['no control word', 'only show the options flow leaders', true],
    ['a rating', 'only show calls with a high rs rank', true],
    ['dark pool, which no control shows', 'only show calls with dark pool prints', true],
    ['another hidden flow phrase', 'only show calls with bullish premium', true],
  ])('⛔ F-16 holds: %s → the screen refusal, no model call, nothing run', async (_why, message, onBoard) => {
    const [[chart], syms] = ONE('NVDA')
    const { say } = p.mount([{ ...chart, w: 18 }, ...(onBoard ? [w('of', 'optionsflow', 18, 0, {})] : [])], syms)
    expect(await say(message)).toMatch(/can't screen on/)
    expect(p.turns()).toBe(0)
    expect(p.st.calls.filter(c => /\/api\/screener\/scan/.test(c[1]))).toEqual([])
  }, 40000)
  it('⛔ another widget earns no exception: the label of a widget with controls does not step the claim aside', async () => {
    const [[chart], syms] = ONE('NVDA')
    const { say } = p.mount([{ ...chart, w: 18 }, w('nw', 'news', 18, 0, {})], syms)
    expect(await say('only show calls on the options flow in the news')).toMatch(/can't screen on/)
    expect(p.turns()).toBe(0)
  }, 40000)
  it('⛔ a screen on a hidden field stays refused on the model path too: nothing is scanned', async () => {
    const [[chart], syms] = ONE('NVDA')
    const { say } = p.mount([{ ...chart, w: 18 }, w('of', 'optionsflow', 18, 0, {})], syms)
    p.st.envelopes.push((b) => ({ disposition: 'apply', reply: '', question: null, unsupported_category: null, ops: [{ action: 'screener.run', target: b.context.screener[0].ref,
      args: { filters: [{ field: 'opt_net_premium_1d', op: 'gte', value: 0, max: null, values: null }], sort_field: null, sort_dir: null, mode: 'new', show: null, as: null, within: null } }] }))
    expect(await say('only show calls on the options flow')).toMatch(/can't screen on options-flow/)
    expect(p.st.calls.some(c => c[1].startsWith('/api/screener/scan'))).toBe(false)
  }, 40000)
  it('⛔ no hidden field reaches the model: the Calls request carries only the widget control, never a hidden key', async () => {
    const [[chart], syms] = ONE('NVDA')
    const { say } = p.mount([{ ...chart, w: 18 }, w('of', 'optionsflow', 18, 0, {})], syms)
    p.st.envelopes.push(p.env('apply', [op({ widget: 'of', key: 'callPut', value: 'Calls' })]))
    await say('only show calls on the options flow')
    const sent = JSON.stringify(firstTurn())
    for (const k of [...FLOW_FIELDS, ...RATING_FIELDS].filter(x => x.includes('_'))) expect(sent, k).not.toContain(k)   // one-word keys are ordinary words
    const spec = firstTurn().capabilities.find(c => c.name === 'widget.setOption')
    expect(Object.keys(spec.args.properties).sort()).toEqual(['key', 'value', 'widget'])
  }, 40000)
  it('⛔ no control, no reach: off the Charts board the capability is not offered, and the exception cannot fire with no board', () => {
    const args = { widget: 'of', key: 'callPut', value: 'Calls' }
    for (const surface of ['breadth', 'screener', 'calendar', 'journal']) {
      expect(manifestFor({ surface }).map(c => c.name), surface).not.toContain('widget.setOption')
      expect(shapeError('widget.setOption', args, { surface }), surface).toMatch(/can't “widget.setOption” here/)
    }
    const hit = fastParse('only show calls on the options flow', { host: {} })
    expect(hit?.ops?.[0]?.action).toBe('screener.run')                                  // the F-16 claim: buildSpec refuses it, in its words
    expect(hit?.ops?.[0]?.args.filters[0].field).toBe('opt_net_premium_1d')
  })
  it('⛔ no control, no reach: a flow widget floating or popped out is off the grid, so the Agent is refused and writes nothing', async () => {
    const { host, state } = makeBoard([w('ch', 'chart', 0, 0, {}), w('of', 'optionsflow', 12, 0, {})], {})
    const real = host.widgets.snapshot
    host.widgets.snapshot = () => { const x = real(); return { ...x, visible: x.raw.filter(y => y.id !== 'of') } }
    const before = JSON.stringify(state.widgets)
    expect((await plan(host, [op({ widget: 'of', key: 'callPut', value: 'Calls' })])).p.refusals[0]?.reason).toMatch(/floating or popped out/)
    expect(JSON.stringify(state.widgets)).toBe(before)
  })
  it('⛔ a value the control does not have is refused: the Agent cannot set more than the chips', async () => {
    const { host, state } = makeBoard([w('of', 'optionsflow', 0, 0, {})], {})
    const before = JSON.stringify(state.widgets)
    expect((await plan(host, [op({ widget: 'of', key: 'callPut', value: 'opt_net_premium_1d' })])).p.refusals[0]?.reason).toMatch(/“callPut” can be All, Calls, Puts/)
    expect((await plan(host, [op({ widget: 'of', key: 'filters', value: 'x' })])).p.refusals[0]?.reason).toMatch(/has no option “filters”/)
    expect(JSON.stringify(state.widgets)).toBe(before)
  })
  it('a turn that does not touch widgets carries no list, on the same board', async () => {
    const [[chart], syms] = ONE('NVDA')
    const { say } = p.mount([{ ...chart, w: 18 }, w('of', 'optionsflow', 18, 0, {})], syms)
    await say('what does a pullback mean for momentum names')
    expect(firstTurn().context.widgetControls).toBeUndefined()
  }, 40000)
})

// Real calendar phrasings, routing v2 on, on /charts with no Calendar page (the sealed set has none).
describe('who reports, through the REAL panel on /charts with routing v2 on', () => {
  let p
  const week = (monday) => Object.fromEntries(Array.from({ length: 7 }, (_, i) => {
    const d = new Date(`${monday}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + i)
    return [d.toISOString().slice(0, 10), { bmo: [{ sym: 'AAA' }], amc: [{ sym: 'BBB' }], tbd: [] }]
  }))
  const config = async (on) => {
    const base = globalThis.fetch
    const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } })
    globalThis.fetch = async (url, init) => {
      if (url === '/api/agent/config') return json({ conversations: [], routing_v2: on })
      const m = /^\/api\/calendar\?week=(\d{4}-\d{2}-\d{2})/.exec(String(url))
      return m ? json({ days: week(m[1]) }) : base(url, init)
    }
    localStorage.setItem('uct.agent.routingV2', on ? '1' : '0')
    _resetAgentConfig()
    await loadAgentConfig()
  }
  beforeEach(async () => { p = setupPanel(); await config(true) })
  afterEach(async () => { cleanup(); await config(false); localStorage.clear() })
  const mount = () => { const [[chart], syms] = ONE('NVDA'); return p.mount([{ ...chart, w: 24 }], syms) }
  const turnsSent = () => p.st.calls.filter(c => c[1] === '/api/agent/turn').map(c => c[2])
  const dayOp = (body, date) => ({ disposition: 'apply', reply: '', question: null, unsupported_category: null, ops: [{ action: 'calendar.day', target: body.context.calendar[0].ref, args: { date } }] })

  it.each(['who reports today', 'who is reporting tomorrow', 'what reports on friday', 'which stocks report thursday'])('"%s": answered from the calendar, no model call', async (message) => {
    const { say } = mount()
    expect(await say(message)).toMatch(/AAA.*BBB/s)
    expect(p.turns()).toBe(0)
  }, 40000)
  it.each(['who reports tonight', 'who is reporting after the close', 'any earnings on the calendar tomorrow', 'which names are on the calendar for friday'])('"%s": the model has the read and a ref to aim it at, on the first call', async (message) => {
    const { say } = mount()
    p.st.envelopes.push((b) => dayOp(b, 'today'))
    const out = await say(message)
    expect(turnsSent().length).toBe(1)
    expect(turnsSent()[0].capabilities.map(c => c.name)).toContain('calendar.day')
    expect(out).toMatch(/AAA.*BBB/s)
  }, 40000)
  it.each(['how is the market looking', 'anything big after the close', 'what should i watch tomorrow'])('"%s": whenever the read is sent, its ref is sent too, or it could not be used', async (message) => {
    const { say } = mount()
    await say(message)
    const body = turnsSent()[0]
    if (body.capabilities.some(c => c.name === 'calendar.day')) expect(body.context.calendar?.[0]?.ref).toBeTruthy()
  }, 40000)
  it('a reroute to the calendar group brings the ref: not on the first call, on the second, and the read answers', async () => {
    const { say } = mount()
    p.st.envelopes.push({ disposition: 'clarify', reply: '', ops: [], unsupported_category: null, question: { text: 'Looking at more of UCT…', choices: [] }, need_groups: ['calendar'] })
    p.st.envelopes.push((b) => dayOp(b, 'today'))
    const out = await say('add the 50 day to this chart')
    const sent = turnsSent()
    expect(sent.length).toBe(2)
    expect(sent[0].context.calendar).toBeUndefined()
    expect(sent[1].reroute).toBe(true)
    expect(sent[1].context.calendar[0].ref).toBeTruthy()
    expect(out).toMatch(/AAA.*BBB/s)
  }, 40000)
  it('a stock\'s own date stays stock.earnings: calendar.nextReport is not offered here', async () => {
    const { say } = mount()
    await say('who reports tonight')
    expect(turnsSent()[0].capabilities.map(c => c.name)).not.toContain('calendar.nextReport')
  }, 40000)
})

