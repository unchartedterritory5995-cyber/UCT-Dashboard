// EXECUTION FAMILIES, ROUND 3 (pl-exec) — through the REAL Agent panel (panelHarness), the model scripted.
//   per-clause targets: a sentence that names a chart AND points at the clicked one runs each clause's change on its own
//                       clause's chart, affirmative clauses only; anything uncertain is asked
//   scoped undo:        "undo the timeframe bit" takes back the most recent change of that kind, newer changes stay
// The held-out phrasings (agentExecHeldOut3) are run here as written; the tune phrasings are this file's own.
// Evidence: LOCAL native Windows Node, BROWSER-MOCK-MODEL / SIMULATED.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { setupPanel, bareSettings, ONE } from './testing/panelHarness'
import { mergeChartSettings } from '../components/chart/chartDefaults'
import { CLAUSE_HELD_OUT, UNDO_HELD_OUT } from './agentExecHeldOut3.test.js'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
registerBuiltins()
let p
beforeEach(() => { p = setupPanel() })
afterEach(() => { vi.restoreAllMocks(); cleanup() })

const cell = (id, x, y) => ({ id, type: 'chart', x, y, w: 12, h: 10, color: 'N', opts: { settings: bareSettings() } })
const FOUR = [cell('c0', 0, 0), cell('c1', 12, 0), cell('c2', 0, 10), cell('c3', 12, 10)]
const SYMS = { 'N:c0': 'SPY', 'N:c1': 'QQQ', 'N:c2': 'NVDA', 'N:c3': 'TSLA' }
const label = (s) => ({ ...s, label: `Chart (${s.ref})` })
const w = (b, id) => b.state.widgets.find(x => x.id === id)
const tfOf = (b, id) => w(b, id).opts?.tf || 'D'
const logOf = (b, id) => !!mergeChartSettings(w(b, id).opts?.settings || null).logScale
const state = (b) => ['c0', 'c1', 'c2', 'c3'].map(id => `${tfOf(b, id)}${logOf(b, id) ? 'L' : ''}`).join(' ')
const planOf = (ops) => (body) => p.env('apply', ops.map(([id, action, args]) => ({ action, target: body.context.charts.find(c => c.label === `Chart (${id})`).ref, args })))
const expected = (ops) => {
  const s = { c0: 'D', c1: 'D', c2: 'D', c3: 'D' }
  const l = {}
  for (const [id, action, args] of ops) { if (action === 'chart.setTimeframe') s[id] = args.timeframe; else l[id] = true }
  return ['c0', 'c1', 'c2', 'c3'].map(id => `${s[id]}${l[id] ? 'L' : ''}`).join(' ')
}
const mount = (clicked) => { const m = p.mount(FOUR, SYMS, { decorate: label }); p.select(clicked); return m }

// ── per-clause targets ──
const CLAUSE_TUNE = [
  { text: 'make the NVDA chart weekly and this one log', clicked: 'c1', ops: [['c2', 'chart.setTimeframe', { timeframe: 'W' }], ['c1', 'chart.setScale', { scale: 'log' }]] },
  { text: 'weekly on this chart and log on the TSLA chart', clicked: 'c0', ops: [['c0', 'chart.setTimeframe', { timeframe: 'W' }], ['c3', 'chart.setScale', { scale: 'log' }]] },
]
describe('per-clause targets: each clause\'s change on its own clause\'s chart', () => {
  it.each([...CLAUSE_TUNE, ...CLAUSE_HELD_OUT].map(c => [c.text, c]))('%s: the plan runs as each clause says', async (_t, c) => {
    const { say, board } = mount(c.clicked)
    p.st.envelopes.push(planOf(c.ops))
    const out = await say(c.text)
    expect(state(board), out).toBe(expected(c.ops))
  }, 30000)
  it.each(CLAUSE_TUNE.map(c => [c.text, c]))('NEGATIVE %s: the two changes SWAPPED between the charts are asked about, nothing changes', async (_t, c) => {
    const { say, board } = mount(c.clicked)
    const swapped = [[c.ops[1][0], c.ops[0][1], c.ops[0][2]], [c.ops[0][0], c.ops[1][1], c.ops[1][2]]]
    p.st.envelopes.push(planOf(swapped))
    await say(c.text)
    // an instant reader that reads the sentence per clause itself (planCompound) never asks the model: then the state is the
    // sentence's own; a model plan that swaps the changes is asked about and nothing changes
    expect(state(board)).toBe(p.turns() ? 'D D D D' : expected(c.ops))
  }, 30000)
  it('NEGATIVE: a clause\'s change on a THIRD chart neither clause names never runs', async () => {
    const { say, board } = mount('c1')
    p.st.envelopes.push(planOf([['c2', 'chart.setTimeframe', { timeframe: 'W' }], ['c0', 'chart.setScale', { scale: 'log' }]]))
    await say('make the NVDA chart weekly and this one log')
    expect(state(board)).toBe('D D D D')
  }, 30000)
  it('NEGATIVE: a negated clause is never a target ("weekly on the NVDA chart, and leave this one alone"), a plan on the click never runs', async () => {
    const { say, board } = mount('c1')
    p.st.envelopes.push(planOf([['c2', 'chart.setTimeframe', { timeframe: 'W' }], ['c1', 'chart.setScale', { scale: 'log' }]]))
    await say('weekly on the NVDA chart, and leave this one alone')
    expect(logOf(board, 'c1')).toBe(false)
  }, 30000)
})

// ── scoped undo ──
describe('a described Undo takes back the most recent change of THAT kind; newer changes stay', () => {
  const ONE_SPY = () => ONE('SPY')
  const tfC = (b) => w(b, 'c').opts?.tf || 'D'
  const rsiOn = (b) => (mergeChartSettings(w(b, 'c').opts?.settings || null).indicatorInstances || []).some(i => !i.deleted && /rsi/i.test(i.defId))
  const symC = (b) => b.state.groupSyms['N:c']
  const H = Object.fromEntries(UNDO_HELD_OUT.map(c => [c.text, c]))
  it.each([['undo the timeframe bit'], ['take back only the weekly change'], ['undo just the timeframe change']])('after weekly, then an RSI: "%s" → daily again, the RSI stays', async (t) => {
    const { say, board } = p.mount(...ONE_SPY())
    await say('weekly')
    await say('add rsi')
    expect([tfC(board), rsiOn(board)]).toEqual(['W', true])
    const out = await say(t)
    expect([tfC(board), rsiOn(board)], out).toEqual(['D', true])
    expect(out).toMatch(/earlier change/)
    expect(p.turns()).toBe(0)
  }, 30000)
  it('after an RSI, then weekly: "revert just the rsi I added" → the RSI goes, weekly stays', async () => {
    expect(H['revert just the rsi I added']).toBeTruthy()
    const { say, board } = p.mount(...ONE_SPY())
    await say('add rsi')
    await say('weekly')
    const out = await say('revert just the rsi I added')
    expect([tfC(board), rsiOn(board)], out).toEqual(['W', false])
  }, 30000)
  it('after a symbol switch, then weekly: "undo the symbol switch" → the ticker goes back, weekly stays', async () => {
    expect(H['undo the symbol switch']).toBeTruthy()
    const { say, board } = p.mount(...ONE_SPY())
    await say('switch to AMD')
    await say('weekly')
    expect([symC(board), tfC(board)]).toEqual(['AMD', 'W'])
    const out = await say('undo the symbol switch')
    expect([symC(board), tfC(board)], out).toEqual(['SPY', 'W'])
  }, 30000)
  it('NEGATIVE: no change of that kind this session → nothing undone, said', async () => {
    const { say, board } = p.mount(...ONE_SPY())
    await say('weekly')
    const out = await say('undo the symbol switch')
    expect(out).toMatch(/My last change wasn't a symbol change.*Nothing was undone/)
    expect(tfC(board)).toBe('W')
  }, 30000)
  it('NEGATIVE: the changed field moved since (the member set it again) → refused, nothing overwritten', async () => {
    const { say, board, h } = p.mount(...ONE_SPY())
    await say('weekly')
    await say('add rsi')
    await h.charts.commit('c', { tf: 'M' })                         // the member's own change to the same field
    const out = await say('undo the timeframe bit')
    expect(tfC(board)).toBe('M')
    expect(out).toMatch(/changed since/)
  }, 30000)
})

// pl-auto u4 (BROWSER-MOCK-MODEL), own phrasings here: per-clause targets with "the other" and with a relation clause; the scope
// of "undo the scale change" after a later indicator add.
describe('per-clause: "the other", a relation clause, and the scale undo', () => {
  const TWO_W = [cell('a', 0, 0), cell('b', 12, 0)]
  const mountTwo = (clicked) => { const m = p.mount(TWO_W, { 'N:a': 'SPY', 'N:b': 'QQQ' }, { decorate: label }); p.select(clicked); return m }
  const st2 = (b) => ['a', 'b'].map(id => `${tfOf(b, id)}${logOf(b, id) ? 'L' : ''}`).join(' ')
  it.each([['weekly on this chart, log scale on the other one', 'a'], ['put the other chart on weekly and this one on log', 'b']])('%s (clicked %s): each clause on its own chart; a plan that puts both on the click is asked about', async (text, clicked) => {
    const other = clicked === 'a' ? 'b' : 'a'
    const wkOnClick = /weekly on this|this chart weekly/.test(text)
    const right = [[wkOnClick ? clicked : other, 'chart.setTimeframe', { timeframe: 'W' }], [wkOnClick ? other : clicked, 'chart.setScale', { scale: 'log' }]]
    {
      const { say, board } = mountTwo(clicked)
      p.st.envelopes.push(planOf(right))
      const out = await say(text)
      const want = { [right[0][0]]: 'W', [right[1][0]]: 'DL' }
      expect(st2(board), out).toBe(['a', 'b'].map(id => (id === right[0][0] ? 'W' : 'DL')).join(' '))
      void want
    }
    cleanup(); p = setupPanel()
    {
      const { say, board } = mountTwo(clicked)
      p.st.envelopes.push(planOf([[clicked, 'chart.setTimeframe', { timeframe: 'W' }], [clicked, 'chart.setScale', { scale: 'log' }]]))
      await say(text)
      expect(st2(board)).toBe('D D')
    }
  }, 60000)
  it('a relation clause: "make this one weekly and the chart below it log" (c0 clicked): weekly on c0, log on c2', async () => {
    const { say, board } = mount('c0')
    p.st.envelopes.push(planOf([['c0', 'chart.setTimeframe', { timeframe: 'W' }], ['c2', 'chart.setScale', { scale: 'log' }]]))
    const out = await say('make this one weekly and the chart below it log')
    expect(state(board), out).toBe('W D DL D')
  }, 30000)
  it('"undo the scale change" after a later "add rsi": the scale goes back, the RSI stays', async () => {
    const { say, board } = p.mount(...ONE('SPY'))
    await say('log scale')
    await say('add rsi')
    const out = await say('undo the scale change')
    expect(logOf(board, 'c'), out).toBe(false)
    expect((mergeChartSettings(w(board, 'c').opts?.settings || null).indicatorInstances || []).some(i => !i.deleted && /rsi/i.test(i.defId))).toBe(true)
  }, 30000)
})
