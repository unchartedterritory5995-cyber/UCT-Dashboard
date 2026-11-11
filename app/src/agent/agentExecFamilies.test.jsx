// EXECUTION FAMILIES (pl-exec, exec-gen-1) — through the REAL Agent panel (panelHarness: the real AgentPanel, useAgent,
// routing, planner, runtime, receipts and Undo over the fixture board's real writer). The phrasings are the TUNE set
// (agentExecTune.js); the held-out set is only measured (agentExecReach.test.jsx), never asserted here.
//
// ⛔ THE MODEL IS SCRIPTED. Each plan is built from the REQUEST the panel sent (the widget id / chart ref from
// `body.context`), so a case proves the first call carries what a correct plan needs (the action and, for a widget, its
// controls) and that the plan lands in state, is read back and is undone exactly. It does NOT prove a real model picks it.
// Evidence: LOCAL native Windows Node, BROWSER-MOCK-MODEL / SIMULATED.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup, screen } from '@testing-library/react'
import { setupPanel, ONE } from './testing/panelHarness'
import { mergeChartSettings } from '../components/chart/chartDefaults'
import { headerFieldKeys } from '../components/chart/headerFields'
import { barInfoFieldsOf } from '../components/chart/barInfoFields'
import { WIDGET_TUNE, LIST_TUNE } from './agentExecTune'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
const env = (ops) => ({ disposition: 'apply', reply: '', question: null, unsupported_category: null, ops })
const w = (id, type, x, y, opts = {}) => ({ id, type, x, y, w: 3, h: 5, color: 'N', opts })
const firstTurn = (p) => p.st.calls.find(c => c[1] === '/api/agent/turn')?.[2] || null
const optsOf = (board, id) => board.state.widgets.find(x => x.id === id).opts

// ── Family W: one control of one widget, on a control the widget keeps in `opts` (no mounted door needed) ──
const OPTS_ROWS = WIDGET_TUNE.filter(c => ['optionsflow', 'scatter', 'news', 'tradeExchangeNews', 'volumescan', 'periodsort', 'calendar', 'breadth'].includes(c.type)
  && !['day', 'tbdOpen', 'reading', 'universe', 'sizeKey', 'xKey', 'yKey'].includes(c.key))
// where each key lives in opts, and the value the widget reads back (the registry/control row's own type)
const STORED = {
  minPremium: (o) => o.filters?.minPrem, direction: (o) => o.filters?.dir, callPut: (o) => o.filters?.cp, printType: (o) => o.filters?.type,
  category: (o) => o.categories,
}
const WANT = { '+Earnings': ['Earnings'] }
const START = { calendar: { date: '2026-11-06' }, periodsort: { start: 20260101, end: 20260201 } }
// a case whose value is the widget's default starts from the other value, so the write is a change, not a no-op
const FROM = { 'breadth.view': { view: 'ratio' }, 'optionsflow.scope': { scope: 'symbol' }, 'volumescan.showLogos': { showLogos: true } }
// what the reach measure found the FIRST call misses (no widget named): the scripted model asks for the group, as a real one
// does (need_groups), and the write lands on the second call
const NOT_NAMED = new Set(['filter the headlines to earnings'])

describe('family W through the REAL panel: the first call carries widget.setOption and that widget\'s controls; the write lands; Undo exact', () => {
  let p
  beforeEach(() => { p = setupPanel() })
  afterEach(() => { cleanup() })
  it.each(OPTS_ROWS.map(c => [c.row, c.text, c]))('%s "%s"', async (_row, text, c) => {
    const [[chart], syms] = ONE('NVDA')
    const { say, board } = p.mount([{ ...chart, w: 18 }, w('x1', c.type, 18, 0, { ...START[c.type], ...FROM[`${c.type}.${c.key}`] })], syms)
    const before = JSON.stringify(board.state.widgets)
    if (NOT_NAMED.has(text)) p.st.envelopes.push({ disposition: 'clarify', reply: '', ops: [], unsupported_category: null, question: { text: 'Looking at more of UCT…', choices: [] }, need_groups: ['boardEdit'] })
    p.st.envelopes.push((body) => {
      const id = body.context.board[0].widgets.find(x => x.type === c.type)?.id
      return env([{ action: 'widget.setOption', target: body.context.board[0].ref, args: { widget: id, key: c.key, value: c.value } }])
    })
    const out = await say(text)
    expect(p.turns()).toBe(NOT_NAMED.has(text) ? 2 : 1)
    const b = NOT_NAMED.has(text) ? p.lastTurnBody() : firstTurn(p)
    expect(b.capabilities.map(x => x.name)).toContain('widget.setOption')
    expect(b.context.widgetControls[0].controls[c.type]).toContain(`${c.key}(`)
    // the named widget's controls only: the other types on a board are not this request's (bytes)
    if (!NOT_NAMED.has(text)) expect(Object.keys(b.context.widgetControls[0].controls)).toEqual([c.type])
    const read = (STORED[c.key] || ((o) => o[c.key]))(optsOf(board, 'x1'))
    expect(read, out).toEqual(WANT[c.value] ?? c.value)
    expect(out).toMatch(new RegExp(`${c.key} is now`))
    await say('undo')
    expect(JSON.stringify(board.state.widgets)).toBe(before)
  }, 40000)
})

// ── Family L: which fields a chart's Info row / Bar info strip print, one member at a time ──
describe('family L through the REAL panel: chart.setSetting header.fields | header.barInfo, read back through the product resolver', () => {
  let p
  beforeEach(() => { p = setupPanel() })
  afterEach(() => { cleanup() })
  const csOf = (board) => mergeChartSettings(board.state.widgets.find(x => x.id === 'c').opts.settings || null)
  const listOf = (setting, cs) => (setting === 'header.fields' ? headerFieldKeys(cs.header) : barInfoFieldsOf(cs))
  const op = (body, setting, value) => env([{ action: 'chart.setSetting', target: body.context.charts[0].ref, args: { setting, value } }])
  it.each(LIST_TUNE.map(c => [c.row, c.text, c]))('%s "%s"', async (_row, text, c) => {
    const [[chart0], syms] = ONE('NVDA')
    // an add of a field the strip prints by default starts from a strip without it (a change, not a no-op)
    const key0 = c.value.slice(1), cs0 = chart0.opts.settings
    const seeded = c.value[0] === '+' && listOf(c.setting, mergeChartSettings(cs0)).includes(key0)
      ? { ...chart0, opts: { ...chart0.opts, settings: { ...cs0, header: { ...(cs0.header || {}), [c.setting.split('.')[1]]: listOf(c.setting, mergeChartSettings(cs0)).filter(k => k !== key0) } } } } : chart0
    const { say, board } = p.mount([seeded], syms)
    const before = JSON.stringify(board.state.widgets)
    const was = listOf(c.setting, csOf(board))
    p.st.envelopes.push((body) => op(body, c.setting, c.value))
    const out = await say(text)
    const b = firstTurn(p)
    expect(b.capabilities.find(x => x.name === 'chart.setSetting').args.properties.setting.enum).toContain(c.setting)
    const now = listOf(c.setting, csOf(board))
    const key = c.value.slice(1)
    expect(now.includes(key), out).toBe(c.value[0] === '+')
    expect(now.filter(k => k !== key)).toEqual(was.filter(k => k !== key))       // nothing else moved
    expect(out).toMatch(/(Info row|Bar info): (added|removed) /)
    await say('undo')
    expect(JSON.stringify(board.state.widgets)).toBe(before)
  }, 40000)
  it('a field by the name Chart Settings shows ("Dollar Volume") is the same field; the receipt names what the row shows now', async () => {
    const { say, board } = p.mount(...ONE('NVDA'))
    p.st.envelopes.push((body) => op(body, 'header.fields', '+Dollar Volume'))
    const out = await say('add dollar volume to the info row')
    expect(headerFieldKeys(csOf(board).header)).toEqual(['mcap', 'earn', 'rating', 'dolvol'])
    expect(out).toMatch(/Info row: added Dollar Volume — it shows Market Cap, Next Earnings, UCT Rating, Dollar Volume/)
  }, 40000)
  it('the Bar info strip keeps its canonical order (the product writer), whatever order fields come back in', async () => {
    const { say, board } = p.mount(...ONE('NVDA'))
    p.st.envelopes.push((body) => env([{ action: 'chart.setSetting', target: body.context.charts[0].ref, args: { setting: 'header.barInfo', value: '-open' } },
      { action: 'chart.setSetting', target: body.context.charts[0].ref, args: { setting: 'header.barInfo', value: '-date' } }]))
    await say('take the open and the date out of the bar info')
    expect(barInfoFieldsOf(csOf(board))).toEqual(['high', 'low', 'close', 'change', 'changePct'])
  }, 40000)
  it('NEGATIVE: a field that is not there is refused with the real list; a word that fits two fields asks, never guesses; nothing changes', async () => {
    const { say, board } = p.mount(...ONE('NVDA'))
    const before = JSON.stringify(board.state.widgets)
    p.st.envelopes.push((body) => op(body, 'header.fields', '+short interest'))
    expect(await say('add short interest to the info row')).toMatch(/isn't a Info row field — the fields are Company Name, Price/)
    p.st.envelopes.push((body) => op(body, 'header.barInfo', '-chg'))
    expect(await say('drop chg from the bar info')).toMatch(/fits Net Chg and % Chg/)
    expect(JSON.stringify(board.state.widgets)).toBe(before)
    expect(screen.queryAllByTestId('agent-receipt').length).toBe(0)
  }, 40000)
  it('a field already shown is a no-op said in words, no receipt', async () => {
    const { say, board } = p.mount(...ONE('NVDA'))
    const before = JSON.stringify(board.state.widgets)
    p.st.envelopes.push((body) => op(body, 'header.fields', '+mcap'))
    expect(await say('add market cap to the info row')).toMatch(/Info row already shows Market Cap/)
    expect(JSON.stringify(board.state.widgets)).toBe(before)
  }, 40000)
})
