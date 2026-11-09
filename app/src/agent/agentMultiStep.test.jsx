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
    expect(out).toMatch(/Done \d of \d steps, then stopped at .*florbish/)
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
