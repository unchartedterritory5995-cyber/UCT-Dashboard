// W1.1 repair-a (overnight 2026-11-03, BOARD R-01..R-03) — the browser half of the live-production findings:
//   R-01 (LT-3): the production planner's args for chart.setSetting / chart.replay / screener.run refinements / widget.addCharts
//                came back off-schema. Capabilities now DECLARE their tolerance (argAliases / coerce / defaults / shape); the
//                manifest carries it, the server (turn.normalize_args) and the registry (normalizeArgs, every planOps) apply the
//                same rules. "turn the gradient off" is a real setting now (bgMode, the dialog's own Solid / Gradient control).
//   R-02 (LT-1): on an EMPTY board "add a daily chart of NVDA to this board" is the fast path's new chart; a model plan that put
//                chart ops on a non-chart target becomes ONE new chart on that symbol (screenEmptyBoardChart).
//   R-03 (LT-9): "rename Main Trading to x" is refused by NAME before any path (listed or not), 0 model calls; routing sends the
//                layouts group for a rename phrase. (LT-10 is server-side: tests/test_uct_agent_args_live_shapes.py.)
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup, screen, waitFor } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { manifestFor, getCapability, normalizeArgs, shapeError, registerCapability, MAX_SHAPE } from './capabilities'
import { planOps, collectTargets } from './executor'
import { fastParse } from './fastPath'
import { selectGroups } from './routing'
import { newChartRequest, newChartTicker, screenEmptyBoardChart } from './capabilities/workspace'
import { protectedRenameRefusal, protectedNameRefusal, protectionRefusal, PROTECTED_LAYOUTS_KEY } from './protectedLayouts'
import { setupPanel, ONE } from './testing/panelHarness'
import { makeBoard } from './__fixtures__/board'
import { ELIGIBLE_SETTINGS, settingDescriptor, CHART_SETTING_DESCRIPTORS } from '../components/chart/chartSettingsDescriptors'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
registerBuiltins()
const CTX = { surface: 'charts' }
const FAMILIES = ['chart.setSetting', 'chart.replay', 'screener.run', 'widget.addCharts']

let p
beforeEach(() => { p = setupPanel() })
afterEach(() => { vi.restoreAllMocks(); cleanup() })
const settings = (board, id = 'c') => board.state.widgets.find(w => w.id === id).opts.settings

describe('R-01 — the tolerance declarations are part of the manifest', () => {
  it('each repaired capability declares its exact shape (≤ MAX_SHAPE) and its aliases; one that declares nothing carries nulls', () => {
    const by = Object.fromEntries(manifestFor(CTX).map(c => [c.name, c]))
    for (const n of FAMILIES) {
      expect(by[n].shape, n).toBeTruthy()
      expect(by[n].shape.length, n).toBeLessThanOrEqual(MAX_SHAPE)
      expect(Object.keys(by[n]).sort()).toEqual(['argAliases', 'args', 'coerce', 'defaults', 'defaultsWhen', 'domain', 'hints', 'name', 'query', 'reversible', 'risk', 'shape', 'summary', 'target', 'undo'])
    }
    expect(by['chart.setSetting'].argAliases.setting).toContain('key')
    expect(by['chart.replay'].coerce.date.exit).toBe(null)
    expect(by['screener.run'].defaults).toEqual({ filters: [] })
    expect(by['widget.addCharts'].argAliases['symbols.top']).toContain('count')
    expect(by['layout.rename'].shape).toMatch(/"layout"/)
    expect(by['chart.renameTab'].shape).toMatch(/layout\.rename/)
    const plain = by['chart.setType']
    expect([plain.argAliases, plain.coerce, plain.defaults, plain.shape]).toEqual([null, null, null, null])
    // every hint is still under the shared cap (the shape carries the example, not the hints)
    for (const c of manifestFor(CTX)) expect(String(c.hints || '').length, c.name).toBeLessThanOrEqual(1000)
  })
  it('a malformed declaration never ships: it throws at registration', () => {
    const base = { target: 'chart', summary: 'x', args: { type: 'object', properties: { a: { type: 'string' } }, required: ['a'], additionalProperties: false }, check: () => null, apply: s => s, describe: () => null }
    expect(() => registerCapability({ ...base, name: 'test.badAlias', argAliases: { nope: ['x'] } })).toThrow(/not an argument/)
    expect(() => registerCapability({ ...base, name: 'test.badAlias2', argAliases: { a: ['a'] } })).toThrow(/bad alias/)
    expect(() => registerCapability({ ...base, name: 'test.badCoerce', coerce: { a: { x: [1] } } })).toThrow(/scalars/)
    expect(() => registerCapability({ ...base, name: 'test.badDefault', defaults: { b: 1 } })).toThrow(/not an argument/)
    expect(() => registerCapability({ ...base, name: 'test.badShape', shape: 'x'.repeat(MAX_SHAPE + 1) })).toThrow(/at most/)
    const off = registerCapability({ ...base, name: 'test.goodAlias', argAliases: { a: ['b', 'c.d'] }, coerce: { a: { yes: 'y' } }, shape: '{"a":"y"}' })
    expect(normalizeArgs('test.goodAlias', { c: { d: 'YES' } })).toEqual({ args: { a: 'y' }, applied: ['alias:c.d->a', 'a:word'] })
    off()
  })
})

describe('R-01 — normalizeArgs reads what the live planner sends (the browser half of turn.normalize_args)', () => {
  const ok = (name, given, want) => {
    const { args } = normalizeArgs(name, given)
    expect(args).toEqual(want)
    expect(shapeError(name, args, CTX)).toBe(null)
  }
  it('chart.setSetting: the id under another key, the id case-folded; the value is the dialog\'s to read ("off", "90%")', () => {
    ok('chart.setSetting', { key: 'bgMode', value: 'solid' }, { setting: 'bgMode', value: 'solid' })
    ok('chart.setSetting', { id: 'BGMODE', value: 'off' }, { setting: 'bgMode', value: 'off' })
    ok('chart.setSetting', { name: 'Grid.Visible', value: 'false' }, { setting: 'grid.visible', value: 'false' })
    ok('chart.setSetting', { setting: 'volume.paneHeightPct', value: '90%' }, { setting: 'volume.paneHeightPct', value: '90%' })
    expect(shapeError('chart.setSetting', normalizeArgs('chart.setSetting', { setting: 'bgGradient.enabled', value: false }).args, CTX)).toMatch(/isn't an option/)
    expect(shapeError('chart.setSetting', normalizeArgs('chart.setSetting', { key: 'bgMode', value: 'solid', extra: 1 }).args, CTX)).toMatch(/Unexpected/)
  })
  it('chart.replay: "exit" / "null" / "off" and the cutoff under another key', () => {
    for (const given of [{ date: 'exit' }, { date: 'null' }, { date: 'off' }, { date: 'NONE' }, { cutoff: null }, {}]) ok('chart.replay', given, { date: null })
    ok('chart.replay', { to: '2026-03-02' }, { date: '2026-03-02' })
    expect(shapeError('chart.replay', normalizeArgs('chart.replay', { exit: true }).args, CTX)).toMatch(/Unexpected/)
    expect(shapeError('chart.replay', normalizeArgs('chart.replay', { date: false }).args, CTX)).toMatch(/wrong kind/)
  })
  it('screener.run: a sort-only refinement without filters, with a nested sort object, with "descending"', () => {
    const want = { filters: [], sort_field: 'chg_pct_3m', sort_dir: 'desc', mode: 'refine', show: null, as: null, within: null, logic: null, rank: null }
    ok('screener.run', { sort_field: 'chg_pct_3m', sort_dir: 'descending', mode: 'refine' }, want)
    ok('screener.run', { sort: { field: 'chg_pct_3m', dir: 'DESC' }, mode: 'Refine', filters: null }, want)
    ok('screener.run', { sort_by: 'chg_pct_3m', order: 'high to low', mode: 'refinement', limit: '10' }, { ...want, show: 10 })
    expect(shapeError('screener.run', normalizeArgs('screener.run', { sort_field: 'chg_pct_3m', sort_dir: 'sideways', mode: 'refine' }).args, CTX)).toMatch(/isn't an option/)
  })
  it('widget.addCharts: the list under another key, timeframe and type words, the reference flat or with other inner keys', () => {
    ok('widget.addCharts', { tickers: ['NVDA'], tf: 'daily', type: 'candlestick', exact: 'false' }, { symbols: ['NVDA'], timeframe: 'D', chart_type: 'candles', exact: false })
    ok('widget.addCharts', { symbols: { list: 'w1', count: '2' } }, { symbols: { from: 'w1', top: 2 }, timeframe: null, chart_type: null, exact: null })
    ok('widget.addCharts', { from: 'w1', top: 2, interval: 'hourly' }, { symbols: { from: 'w1', top: 2 }, timeframe: '60', chart_type: null, exact: null })
    ok('widget.addCharts', { symbols: ['NVDA'], timeframe: 60 }, { symbols: ['NVDA'], timeframe: '60', chart_type: null, exact: null })
    expect(shapeError('widget.addCharts', normalizeArgs('widget.addCharts', { symbols: { from: 'w1', top: 2 }, indicators: ['EMA 9'] }).args, CTX)).toMatch(/Unexpected/)
    expect(shapeError('widget.addCharts', normalizeArgs('widget.addCharts', { symbols: ['NVDA'], timeframe: '2h' }).args, CTX)).toMatch(/isn't an option/)
  })
  it('never mutates the op it was given, and planOps applies the same tolerance on every path', () => {
    const given = { key: 'grid.visible', value: 'false' }
    const { host } = makeBoard([{ id: 'c', type: 'chart', x: 0, y: 0, w: 12, h: 20 }], { A: 'AAPL' })
    const plan = planOps(collectTargets(host, ['chart']), [{ action: 'chart.setSetting', target: 'c', args: given }], {}, CTX)
    expect(plan.ok).toBe(true)
    expect(plan.lines.join(' ')).toMatch(/Grid lines: off/)
    expect(given).toEqual({ key: 'grid.visible', value: 'false' })
  })
})

describe('R-01 — "turn the gradient off on this chart" is the dialog\'s own bgMode control', () => {
  it('bgMode is an eligible enum setting (solid | gradient) with the gradient words; nothing else in the table moved', () => {
    const d = settingDescriptor('bgMode')
    expect(d).toMatchObject({ agent: 'eligible', type: 'enum', options: ['solid', 'gradient'], boolMap: { true: 'gradient', false: 'solid' } })
    expect(d.words).toContain('gradient')
    expect(getCapability('chart.setSetting').args.properties.setting.enum).toContain('bgMode')
    expect(CHART_SETTING_DESCRIPTORS.filter(x => x.id === 'bgMode')).toHaveLength(1)
    expect(settingDescriptor('background').agent).toBe('specialized:chart.setBackground')     // the solid colour stays chart.setBackground's
    expect(ELIGIBLE_SETTINGS.filter(x => x.type === 'number').map(x => x.id).sort()).toEqual(['positionCalc.accountSize', 'positionCalc.riskPct', 'volume.maPeriod', 'volume.paneHeightPct', 'watermark.opacity', 'watermark.x', 'watermark.y'])
  })
  it('the fast path (0 model turns): on → gradient, "turn the gradient off on this chart" → solid, Undo walks back', async () => {
    const { say, board } = p.mount(...ONE('NVDA'))
    expect(await say('turn on the gradient')).toMatch(/Gradient background: gradient/)
    expect(settings(board).bgMode).toBe('gradient')
    const out = await say('turn the gradient off on this chart')
    expect(out).toMatch(/Gradient background: solid/)
    expect(settings(board).bgMode).toBe('solid')
    expect(settings(board).preset).toBe('custom')
    await say('undo')
    expect(settings(board).bgMode).toBe('gradient')
    expect(p.turns()).toBe(0)
  }, 40000)
  it('the model path with the live shape ({"key":"bgMode","value":"off"}): executed, not "couldn\'t fill in the details"', async () => {
    const { say, board } = p.mount(...ONE('NVDA'))
    await say('turn on the gradient')
    p.st.envelopes.push(p.env('apply', [{ action: 'chart.setSetting', target: 'c', args: { key: 'bgMode', value: 'off' } }]))
    const out = await say('please disable the gradient background effect')
    expect(out).toMatch(/Gradient background: solid/)
    expect(settings(board).bgMode).toBe('solid')
    expect(p.turns()).toBe(1)
  }, 40000)
})

describe('R-02 — an empty board: "add a daily chart of NVDA to this board"', () => {
  it('the phrase reads the timeframe word and the board tail; the capitals rule and the other phrases are unchanged', () => {
    expect(newChartRequest('add a daily chart of NVDA to this board')).toEqual({ symbol: 'NVDA', timeframe: 'D' })
    expect(newChartRequest('Add a weekly NVDA chart to this workspace')).toEqual({ symbol: 'NVDA', timeframe: 'W' })
    expect(newChartRequest('open a 5 minute chart of SPY here')).toEqual({ symbol: 'SPY', timeframe: '5' })
    expect(newChartRequest('open a 5m QQQ chart')).toEqual({ symbol: 'QQQ', timeframe: '5' })
    expect(newChartRequest('add an hourly chart of AMD on this layout')).toEqual({ symbol: 'AMD', timeframe: '60' })
    expect(newChartRequest('Open a QQQ chart.')).toEqual({ symbol: 'QQQ', timeframe: null })
    expect(newChartRequest('add a 2 hour chart of NVDA')).toBe(null)                 // not a native timeframe → the model
    expect(newChartRequest('add a daily chart of nvda to this board')).toBe(null)    // lower case: never read as a ticker (S6 F4)
    expect(newChartTicker('add a daily chart of NVDA to this board')).toBe('NVDA')
    expect(newChartTicker('Add a NEW chart')).toBe(null)
    expect(newChartTicker('open NVDA')).toBe(null)
    const hit = fastParse('add a daily chart of NVDA to this board', { host: makeBoard([], {}).host })
    expect(hit?.ops.map(o => [o.action, o.args])).toEqual([['widget.addCharts', { symbols: ['NVDA'], timeframe: 'D', chart_type: null, exact: null }]])
  })
  it('end to end, fast path: ONE new daily chart on NVDA, 0 model turns', async () => {
    const { say, board, h } = p.mount([], {})
    const out = await say('add a daily chart of NVDA to this board')
    await waitFor(() => expect(board.state.widgets.filter(w => w.type === 'chart')).toHaveLength(1), { timeout: 4000 })
    const fresh = board.state.widgets[0]
    expect(h.charts.read(fresh.id).symbol).toBe('NVDA')
    expect(h.charts.read(fresh.id).tf).toBe('D')
    expect(out).toMatch(/NVDA/)
    expect(p.turns()).toBe(0)
  }, 40000)
  it('the model path (the live plan: chart ops on the workspace entry, no chart on the board) = one new daily chart on NVDA, made at once — never "That target is not on the workspace"', async () => {
    const { say, board, h } = p.mount([], {})
    p.st.envelopes.push((body) => p.env('apply', [
      { action: 'chart.setSymbol', target: body.context.workspace[0].ref, args: { symbol: 'NVDA' } },
      { action: 'chart.setTimeframe', target: body.context.workspace[0].ref, args: { timeframe: 'D' } },
    ]))
    const out = await say('add a daily chart of nvda to this board')
    expect(out).not.toMatch(/not on the workspace/)
    expect(out).toMatch(/Created a daily chart: NVDA/)                 // the member asked for exactly this: one receipt, no card
    expect(p.proposals()).toHaveLength(0)
    await waitFor(() => expect(board.state.widgets.filter(w => w.type === 'chart')).toHaveLength(1), { timeout: 4000 })
    expect(h.charts.read(board.state.widgets[0].id).symbol).toBe('NVDA')
    expect(h.charts.read(board.state.widgets[0].id).tf).toBe('D')
    expect(p.turns()).toBe(1)
  }, 40000)
  it('screenEmptyBoardChart: only an empty board, only chart symbol / timeframe / type ops on ONE target; anything else is left alone', () => {
    const empty = makeBoard([], {}).host
    const sym = { action: 'chart.setSymbol', target: 'w1', args: { symbol: 'nvda' } }
    expect(screenEmptyBoardChart([sym], empty)).toEqual({ ops: [{ action: 'widget.addCharts', target: 'workspace', args: { symbols: ['NVDA'], timeframe: null, chart_type: null, exact: null } }], corrected: true })
    expect(screenEmptyBoardChart([sym, { action: 'chart.setType', target: 'w1', args: { type: 'bars' } }], empty).ops[0].args.chart_type).toBe('bars')
    expect(screenEmptyBoardChart([sym], makeBoard([{ id: 'c', type: 'chart', x: 0, y: 0, w: 12, h: 20 }], { A: 'AAPL' }).host).corrected).toBe(false)   // a chart exists
    expect(screenEmptyBoardChart([sym, { action: 'chart.setTimeframe', target: 'w2', args: { timeframe: 'D' } }], empty).corrected).toBe(false)     // two targets
    expect(screenEmptyBoardChart([{ action: 'chart.setTimeframe', target: 'w1', args: { timeframe: 'D' } }], empty).corrected).toBe(false)         // no symbol
    expect(screenEmptyBoardChart([sym, { action: 'indicator.add', target: 'w1', args: {} }], empty).corrected).toBe(false)                          // another kind of op
    expect(screenEmptyBoardChart([sym, { action: 'chart.setTimeframe', target: 'w1', args: { timeframe: '2h' } }], empty).corrected).toBe(false)   // not a native timeframe
  })
})

describe('W1.1 review NB-1 / NB-2 / NB-3 — the tolerance never invents a value or skips a guard', () => {
  it('NB-1: an explicit "none" / "nothing" is kept where the field is a name; "null" / "" still read as null', () => {
    const base = { sort_field: 'chg_pct_3m', sort_dir: 'desc', mode: 'refine' }
    const { args } = normalizeArgs('screener.run', { ...base, as: 'Nothing', within: 'none' })
    expect(args.as).toBe('Nothing')
    expect(args.within).toBe('none')
    expect(normalizeArgs('screener.run', { ...base, as: 'null', within: '' }).args).toMatchObject({ as: null, within: null })
    expect(normalizeArgs('screener.run', { ...base, show: 'none' }).args.show).toBe(null)       // integer|null: still the word
    expect(normalizeArgs('chart.replay', { date: 'none' }).args.date).toBe(null)               // replay declares it itself
  })
  it('NB-2: filters defaults to [] only for a refinement; a new screen without filters is still refused', () => {
    expect(normalizeArgs('screener.run', { sort_field: 'chg_pct_3m', sort_dir: 'desc', mode: 'Refine' }).args.filters).toEqual([])
    for (const mode of ['new', 'fresh']) {
      const { args } = normalizeArgs('screener.run', { sort_field: 'chg_pct_3m', sort_dir: 'desc', mode })
      expect(args.filters, mode).toBeUndefined()
      expect(shapeError('screener.run', args, CTX), mode).toBeTruthy()
    }
    expect(normalizeArgs('screener.run', { filters: [], sort_field: null, sort_dir: null, mode: 'new' }).args.filters).toEqual([])
  })
  it('NB-3: planOps hands the guards the NORMALIZED ops — a rename by an aliased key is refused by the protected name', () => {
    const host = { layouts: { snapshot: () => ({ entries: [{ id: '2', name: 'Agent Test' }], active: { id: '2' } }) } }
    const raw = [{ action: 'layout.rename', target: 'layouts', args: { id: 'Main Trading', name: 'x' } }]
    // the raw op names no `layout`: the old call (raw ops) missed it
    expect(protectionRefusal(host, { ok: true, plans: [] }, raw)).toBe(null)
    const { host: board } = makeBoard([{ id: 'c', type: 'chart', x: 0, y: 0, w: 12, h: 20 }], { A: 'AAPL' })
    const plan = planOps(collectTargets(board, ['chart']), [{ action: 'chart.setSetting', target: 'c', args: { key: 'grid.visible', value: 'false' } }], {}, CTX)
    expect(plan.normalizedOps[0].args).toEqual({ setting: 'grid.visible', value: 'false' })
    expect(Object.keys(plan)).not.toContain('normalizedOps')                       // non-enumerable: a plan's shape is unchanged
    const norm = raw.map(o => ({ ...o, args: normalizeArgs(o.action, o.args).args }))
    expect(protectionRefusal(host, { ok: true, plans: [] }, norm)).toMatch(/never renames or deletes/)
  })
})

describe('R-03 — "rename Main Trading to x" is refused by name, before any path', () => {
  it('the phrase guard: the built-in name and the member\'s added names (case-insensitive); any other rename phrase is untouched', () => {
    expect(protectedRenameRefusal('rename Main Trading to x')).toBe(protectedNameRefusal('Main Trading'))
    expect(protectedRenameRefusal('Rename the main trading layout to Old Desk.')).toMatch(/“main trading” is a protected layout — UCT Agent never renames or deletes it/)
    expect(protectedRenameRefusal('rename Swing to x')).toBe(null)
    expect(protectedRenameRefusal('rename the tab to Foo')).toBe(null)
    expect(protectedRenameRefusal('rename Main Trading')).toBe(null)
    localStorage.setItem(PROTECTED_LAYOUTS_KEY, JSON.stringify(['Swing']))
    expect(protectedRenameRefusal('rename swing to x')).toMatch(/“swing” is a protected layout/)
    localStorage.removeItem(PROTECTED_LAYOUTS_KEY)
    // the plan guard refuses by the typed name too when the list does not hold it
    const host = { layouts: { snapshot: () => ({ entries: [{ id: '2', name: 'Agent Test' }], active: { id: '2' } }) } }
    expect(protectionRefusal(host, { ok: true, plans: [] }, [{ action: 'layout.rename', args: { layout: 'Main Trading', name: 'x' } }])).toMatch(/never renames or deletes/)
    expect(protectionRefusal(host, { ok: true, plans: [] }, [{ action: 'layout.rename', args: { layout: '2', name: 'x' } }])).toBe(null)
  })
  it('through the panel: listed or not, the protected sentence — 0 model turns, nothing renamed', async () => {
    const widgets = [{ id: 'c', type: 'chart', x: 0, y: 0, w: 24, h: 20, color: 'N', opts: {} }]
    const unlisted = { entries: [{ id: 11, name: 'Agent Test', scope: 'user' }], active: 11, boards: { 11: widgets } }
    let m = p.mount(widgets, { 'N:c': 'NVDA' }, { layouts: unlisted })
    expect(await m.say('rename Main Trading to x')).toMatch(/“Main Trading” is a protected layout — UCT Agent never renames or deletes it/)
    expect(p.turns()).toBe(0)
    cleanup()
    p = setupPanel()
    const listed = { entries: [{ id: 1, name: 'Main Trading', scope: 'user' }, { id: 11, name: 'Agent Test', scope: 'user' }], active: 11, boards: { 11: widgets, 1: widgets } }
    m = p.mount(widgets, { 'N:c': 'NVDA' }, { layouts: listed })
    expect(await m.say('rename Main Trading to x')).toMatch(/“Main Trading” is a protected layout/)
    expect(p.turns()).toBe(0)
    expect(m.board.host.layouts.snapshot().entries.map(e => e.name)).toContain('Main Trading')
    expect(screen.queryAllByTestId('agent-proposal')).toHaveLength(0)
  }, 40000)
  it('routing: a rename phrase brings the layouts group unless the words name a list, tab or screen', () => {
    expect(selectGroups('rename Main Trading to x').selected).toContain('layouts')
    expect(selectGroups('Rename my Growth watchlist to Leaders').selected).toEqual(['lists', 'agent'])
    expect(selectGroups('rename the tab to Foo').selected).not.toContain('layouts')
  })
})

describe('R-03 (LT-10) — the server\'s nonsense clarify renders as a question with choices', () => {
  it('a clarify envelope with labelled choices shows the question and one button per choice', async () => {
    const { say } = p.mount(...ONE('NVDA'))
    p.st.envelopes.push({ disposition: 'clarify', reply: '', ops: [], unsupported_category: null,
      question: { text: "I didn't catch that — did you want to:", choices: [{ label: 'Open a chart' }, { label: 'Run a screen' }, { label: 'Ask about a stock' }] } })
    const out = await say('asdf qwer')
    expect(out).toMatch(/didn't catch that/)
    expect(out).not.toMatch(/couldn't complete that request/)
    expect(screen.getByRole('button', { name: 'Open a chart' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Run a screen' })).toBeTruthy()
  }, 40000)
})
