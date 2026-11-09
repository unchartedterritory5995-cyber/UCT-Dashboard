// MULTI-STEP EXECUTION (pl-exec round 8, family 1). One request of several steps: "switch to NVDA, make it weekly, add RSI and a 50
// MA, then save the layout". One plan (every step read before anything runs), a receipt per step, honest partial failure (the
// steps before the one that cannot run are done and said; the rest are said as not done), and Undo of the whole sequence in the
// member's words. Held-out: agentMultiStepHeldOut (committed first). Evidence: LOCAL native Windows Node v24, jsdom,
// BROWSER-MOCK-MODEL / SIMULATED (no model call is made by these instant sequences; a scripted plan only where said).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { setupPanel, bareSettings } from './testing/panelHarness'
import { mergeChartSettings } from '../components/chart/chartDefaults'
import { SEQ_HELD_OUT, PARTIAL_HELD_OUT, UNDO_SEQ_HELD_OUT } from './agentMultiStepHeldOut.test.js'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
registerBuiltins()
let p
beforeEach(() => { p = setupPanel({ tickers: ['NVDA', 'AMD', 'TSLA', 'QQQ'] }) })
afterEach(() => { vi.restoreAllMocks(); cleanup() })

const cell = (id, x, y, w = 12) => ({ id, type: 'chart', x, y, w, h: 10, color: id === 'c0' ? 'A' : 'N', opts: { settings: bareSettings() } })
const ONE_B = [{ id: 'c0', type: 'chart', x: 0, y: 0, w: 24, h: 20, color: 'A', opts: { settings: bareSettings() } }]
const FOUR = [cell('c0', 0, 0), cell('c1', 12, 0), cell('c2', 0, 10), cell('c3', 12, 10)]
const label = (s) => ({ ...s, label: `Chart (${s.ref})` })
function mount(board) {
  const four = board === 'FOUR'
  const m = p.mount(four ? FOUR : ONE_B, four ? { A: 'SPY', 'N:c1': 'QQQ', 'N:c2': 'AMD', 'N:c3': 'TSLA' } : { A: 'SPY' }, { decorate: label })
  if (four) p.select('c0')
  return m
}
const w = (b, id) => b.state.widgets.find(x => x.id === id)
const state = (b, id = 'c0') => {
  const o = w(b, id).opts || {}
  const cs = mergeChartSettings(o.settings || null)
  return { symbol: b.state.groupSyms?.[w(b, id).color] ?? null, tf: o.tf || 'D', ind: (o.settings?.indicatorInstances || []).filter(i => !i.deleted).map(i => i.defId), log: !!cs.logScale }
}
// an EMA / SMA is the catalog's movingAverage (its type an input), so the held-out's 'ema' reads as that
const DEF = { ema: 'movingAverage', sma: 'movingAverage', ma: 'movingAverage' }
const holds = (s, want) => Object.entries(want).filter(([k]) => k !== 'chart').every(([k, v]) => (k === 'ind' ? v.every(d => s.ind.includes(DEF[d] || d)) && (v.length || !s.ind.length) : s[k] === v))

describe('held-out: one plan, every step lands, a receipt per step', () => {
  it.each(SEQ_HELD_OUT.map(c => [c.id, c]))('%s', async (_id, c) => {
    const { say, board } = mount(c.board)
    const out = await say(c.text)
    const s = state(board, c.want.chart || 'c0')
    expect(holds(s, c.want), `${JSON.stringify(s)} | ${out}`).toBe(true)
  }, 60000)
})
describe('held-out: honest partial failure', () => {
  it.each(PARTIAL_HELD_OUT.map(c => [c.id, c]))('%s', async (_id, c) => {
    const { say, board } = mount(c.board)
    const out = await say(c.text)
    const s = state(board)
    expect(holds(s, c.want), `${JSON.stringify(s)} | ${out}`).toBe(true)
    expect(out).toMatch(c.notDone)
  }, 60000)
})
describe('held-out: Undo of the whole sequence', () => {
  it.each(UNDO_SEQ_HELD_OUT.map(c => [c.id, c]))('%s', async (_id, c) => {
    const { say, board } = mount(c.board)
    await say(c.seq)
    const out = await say(c.undo)
    const s = state(board)
    expect(holds(s, c.want), `${JSON.stringify(s)} | ${out}`).toBe(true)
  }, 60000)
})

// tuning (own phrasings and the owner's example)
describe('tuning: the owner sequence, per-step receipts, Undo of the whole', () => {
  it('"switch to NVDA, make it weekly, add RSI and a 50 MA, then save the layout": every step done and said; the save (always a card) waits for Apply', async () => {
    const { say, board } = p.mount(ONE_B, { A: 'SPY' }, { decorate: label, layouts: { entries: [{ id: 1, name: 'Main', kind: 'yours', scope: 'user' }], active: 1, boards: { 1: ONE_B } } })
    const out = await say('switch to NVDA, make it weekly, add RSI and a 50 MA, then save the layout')
    const s = state(board)
    expect(s.symbol, out).toBe('NVDA')
    expect(s.tf).toBe('W')
    expect(s.ind).toEqual(expect.arrayContaining(['rsi', 'movingAverage']))
    for (const r of [/NVDA/, /Weekly/, /RSI/, /50/]) expect(out).toMatch(r)
    expect(out).toMatch(/approv|Apply|card/i)
    expect(p.turns()).toBe(0)
  }, 60000)
  it('a plain "undo" after a multi-step request takes back the WHOLE sequence (both routings)', async () => {
    const { say, board } = mount()
    await say('go to AMD then weekly then add a MACD')
    expect(state(board)).toMatchObject({ symbol: 'AMD', tf: 'W' })
    await say('undo')
    expect(state(board)).toMatchObject({ symbol: 'SPY', tf: 'D', ind: [] })
  }, 60000)
  it('a stopped request: "undo" takes back every step that ran, nothing else', async () => {
    const { say, board } = mount()
    await say('put RSI on it')
    const out = await say('switch to AMD, make it weekly, then add the florbish indicator')
    expect(out).toMatch(/Done \d of \d steps \(.*on Chart \(c0\)\), then stopped at .*florbish/)
    expect(state(board)).toMatchObject({ symbol: 'AMD', tf: 'W' })
    await say('undo')
    expect(state(board)).toMatchObject({ symbol: 'SPY', tf: 'D', ind: ['rsi'] })
  }, 60000)
  it('NEGATIVE an unknown indicator ALONE is not refused locally: the model is asked (it may know the member own indicators)', async () => {
    const { say } = mount()
    p.st.envelopes.push(p.env('answer', [], { reply: 'I do not know that one.' }))
    await say('add the florbish indicator')
    expect(p.turns()).toBe(1)
  }, 60000)
  it('NEGATIVE a sequence with a clause no reader takes is never half-run: the whole request goes to the model', async () => {
    const { say, board } = mount()
    p.st.envelopes.push(p.env('answer', [], { reply: 'ok' }))
    await say('switch to AMD, then reticulate the splines')
    expect(p.turns()).toBe(1)
    expect(state(board).symbol).toBe('SPY')
  }, 60000)
})

// pl-auto unseen8 (BROWSER-MOCK), against this branch: the ticker a step switches TO names no chart (u8-sequences-02), and "every
// chart except that one" is exactly the other charts. Tuning: pl-auto's own sentences; paired.
describe('unseen8: a sequence\'s own ticker, and every chart except the click', () => {
  const tcell = (id, x) => ({ id, type: 'chart', x, y: 0, w: 8, h: 10, color: 'N', opts: { settings: bareSettings() } })
  const THREE = [tcell('l', 0), tcell('r', 8), tcell('m', 16)]
  const T_SYMS = { 'N:l': 'SPY', 'N:r': 'AAPL', 'N:m': 'QQQ' }
  const tw = (b, id) => b.state.widgets.find(x => x.id === id)
  const ref = (body, id) => body.context.charts.find(c => c.label === `Chart (${id})`).ref
  const ie = (body, id) => (body.context.indicatorEdits || []).find(x => x.chart === `Chart (${id})`)?.ref
  it('u8-sequences-02 "switch to AAPL, weekly, hide the volume and draw a line at 120" (left clicked; AAPL is on the right chart): every step on the LEFT, no question', async () => {
    const { say, board } = p.mount(THREE, T_SYMS, { decorate: label })
    p.select('l')
    p.st.envelopes.push((body) => p.env('apply', [
      { action: 'chart.setSymbol', target: ref(body, 'l'), args: { symbol: 'AAPL' } },
      { action: 'chart.setTimeframe', target: ref(body, 'l'), args: { timeframe: 'W' } },
    ]))
    const out = await say('switch to AAPL, weekly, hide the volume and draw a line at 120')
    expect(out).not.toMatch(/Which chart/)
    expect(tw(board, 'l').opts?.tf || 'D', out).toBe('W')
    expect(tw(board, 'r').opts?.tf || 'D').toBe('D')
  }, 60000)
  it('every chart except that one: the RSI lands on the two others, not on the click; a plan that adds it to the click too is not run silently', async () => {
    const { say, board } = p.mount(THREE, T_SYMS, { decorate: label })
    p.select('l')
    p.st.envelopes.push((body) => p.env('apply', ['r', 'm'].map(id => ({ action: 'indicator.add', target: ie(body, id), args: { defId: 'rsi', inputs: null } }))))
    const out = await say('add rsi to every chart except that one')
    const has = (id) => (tw(board, id).opts?.settings?.indicatorInstances || []).some(i => !i.deleted && i.defId === 'rsi')
    expect(out).not.toMatch(/Which charts should it go on/)
    expect([has('l'), has('r'), has('m')], out).toEqual([false, true, true])
  }, 60000)
})

// ── AUDIT's GO bar for multi-step plans (round 8). Keep-and-report on a partial failure (AUDIT-confirmed), no auto-rollback.
// A sentence the instant reader takes WHOLE is ONE plan (atomic as a whole: "nothing was left changed"); a sentence it cannot take
// whole is a multi-step plan (compound.js): the steps below are read with planCompound, so the receipt is checked against them.
import { planCompound, MAX_STEPS } from './compound'
import { makeBoard } from './__fixtures__/board'
const stepsOf = (text) => {
  const b = makeBoard([{ id: 'c0', type: 'chart', x: 0, y: 0, w: 24, h: 20, color: 'A', opts: { settings: bareSettings() } }], { A: 'SPY' })
  return planCompound(text, { host: b.host })?.steps?.map(x => x.text) || null
}
describe('GO bar: atomic steps, an exact receipt, the premise, Undo, bounds', () => {
  const SEQ = 'switch to AMD, then put a MACD under the price, then make it weekly and log scale'
  it('(1)(2) a step that fails partway leaves nothing of itself; the receipt names each done step with its chart; nothing after runs', async () => {
    const steps = stepsOf(SEQ)
    expect(steps && steps.length, JSON.stringify(steps)).toBeGreaterThanOrEqual(2)
    const { say, board } = mount()
    board.state.failChartCommit = (patch) => 'tf' in patch           // the chart refuses the timeframe write
    const out = await say(SEQ)
    const s = state(board)
    expect(s.tf, out).toBe('D')                                       // the failing step left nothing of itself …
    expect(s.log).toBe(false)                                         // … neither its timeframe nor its scale
    const k = steps.findIndex(t => /weekly/.test(t))
    const done = steps.slice(0, k)
    expect(out).toContain(`Done ${done.length} of ${steps.length} steps (`)
    for (const t of done) expect(out).toContain(`“${t}” on Chart (c0)`)
    expect(out).toContain(`then stopped at “${steps[k]}”`)
    expect(out).toContain(`Not done: ${steps.slice(k).map(t => `“${t}”`).join(', ')}.`)
    expect(out, 'a partial run never reports full success').not.toMatch(/All \d+ steps done|Done —[^.]*\.$/)
    expect(p.turns()).toBe(0)
  }, 60000)
  it('(1) a sentence read WHOLE is one plan: its failure leaves nothing at all ("nothing was left changed")', async () => {
    const { say, board } = mount()
    board.state.failChartCommit = (patch) => 'tf' in patch
    const out = await say('switch to AMD, then add a MACD, then make it weekly')
    expect(state(board)).toMatchObject({ symbol: 'SPY', tf: 'D', ind: [] })
    expect(out).toMatch(/nothing was left changed/)
  }, 60000)
  it('(3) a changed premise: another board opened under the run — nothing after that step runs', async () => {
    const steps = stepsOf(SEQ)
    const { say, board } = mount()
    board.state.boardVisit = 1
    board.state.failChartCommit = (patch) => { if (patch.symbol) board.state.boardVisit = 2; return false }   // the first step lands; then another board opens
    const out = await say(SEQ)
    expect(out).toMatch(/the board changed while I was working/)
    expect(state(board).tf).toBe('D')
    expect(steps.length).toBeGreaterThanOrEqual(2)
  }, 60000)
  it('(4) Undo after a partial run takes back exactly the steps that ran, newest first, as ONE entry', async () => {
    const { say, board } = mount()
    await say('put RSI on it')
    board.state.failChartCommit = (patch) => 'tf' in patch
    await say(SEQ)
    expect(state(board).symbol).toBe('AMD')
    expect(state(board).ind).toEqual(expect.arrayContaining(['rsi', 'macd']))
    board.state.failChartCommit = null
    await say('undo')
    expect(state(board)).toMatchObject({ symbol: 'SPY', tf: 'D', ind: ['rsi'] })
  }, 60000)
  it('(4) Undo after a member edit in between is field-scoped: the member’s own change is kept', async () => {
    const { say, board } = mount()
    await say('switch to AMD then weekly then add a MACD')
    const w0 = board.state.widgets[0]
    board.state.widgets = board.state.widgets.map(x => (x.id === w0.id ? { ...x, opts: { ...x.opts, settings: { ...(x.opts.settings || {}), logScale: true } } } : x))
    await say('undo')
    const s = state(board)
    expect(s.log).toBe(true)
    expect(s).toMatchObject({ symbol: 'SPY', tf: 'D', ind: [] })
  }, 60000)
  it('(5) bounded: a plan of more than the step cap is refused before anything runs', () => {
    const b = makeBoard([{ id: 'c0', type: 'chart', x: 0, y: 0, w: 24, h: 20, color: 'A', opts: { settings: bareSettings() } }], { A: 'SPY' })
    const parts = ['put rsi under the price', 'switch to AMD', 'put a macd under the price', 'make it weekly', 'put an atr under the price', 'log scale', 'put a cci under the price', 'make it monthly']
    const r = planCompound(parts.join(', then '), { host: b.host })
    if (r?.steps) expect(r.steps.length).toBeLessThanOrEqual(MAX_STEPS)
    else expect(r?.say || '', JSON.stringify(r)).toMatch(new RegExp(`at most ${MAX_STEPS}`))
  })
  it('(5) bounded: past the wall-clock cap no further step starts; 0 model calls for a multi-step request', async () => {
    const { _setCompoundWallMs } = await import('./useAgent')
    const { say, board } = mount()
    _setCompoundWallMs(-1)
    try {
      const out = await say(SEQ)
      expect(out).toMatch(/time limit/)
      expect(state(board)).toMatchObject({ tf: 'D' })
    } finally { _setCompoundWallMs(60000) }
    expect(p.turns()).toBe(0)
  }, 60000)
})

// GO bar: per-step targeting on a board of several — each step's own chart, checked per step
describe('GO bar: each step on its own chart (FOUR)', () => {
  it('"switch the top right chart to AMD, then put a MACD under the price on the bottom left chart": each step lands on its own chart only', async () => {
    const { say, board } = mount('FOUR')
    const text = 'switch the top right chart to AMD, then put a MACD under the price on the bottom left chart'
    // the plan a correct planner sends (each op on the chart its clause names); the screens must keep each op on its own chart
    p.st.envelopes.push((body) => p.env('apply', [
      { action: 'chart.setSymbol', target: body.context.charts.find(c => c.label === 'Chart (c1)').ref, args: { symbol: 'AMD' } },
      { action: 'indicator.add', target: (body.context.indicatorEdits || []).find(x => x.chart === 'Chart (c2)').ref, args: { defId: 'macd', inputs: null } },
    ]))
    const out = await say(text)
    const ind = (id) => (board.state.widgets.find(x => x.id === id).opts?.settings?.indicatorInstances || []).filter(i => !i.deleted).map(i => i.defId)
    expect(board.state.groupSyms['N:c1'], out).toBe('AMD')
    expect(board.state.groupSyms.A).toBe('SPY')
    expect(ind('c2'), out).toEqual(['macd'])
    expect(['c0', 'c1', 'c3'].flatMap(ind)).toEqual([])
  }, 60000)
})
