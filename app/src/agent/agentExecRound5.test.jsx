// EXECUTION, ROUND 5 (pl-exec) — the remaining P0s through the REAL panel (panelHarness), the model scripted where a model is asked.
//   C1-011  the timeframe keys' repeat-press cycle, said: one rung up / down the keys' own order (TF_ORDER), from the chart's own
//           timeframe; the ends are said, never wrapped
// Held-out phrasings (agentExecHeldOut5) are said as written; the TUNE ones are this file's own.
// Evidence: LOCAL native Windows Node, BROWSER-MOCK-MODEL / SIMULATED.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { setupPanel, bareSettings } from './testing/panelHarness'
import { TF_STEP_HELD_OUT } from './agentExecHeldOut5.test.js'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
registerBuiltins()
let p
beforeEach(() => { p = setupPanel() })
afterEach(() => { vi.restoreAllMocks(); cleanup() })
const one = (tf) => [[{ id: 'c', type: 'chart', x: 0, y: 0, w: 24, h: 20, color: 'N', opts: { tf, settings: bareSettings() } }], { 'N:c': 'NVDA' }]
const tfOf = (b) => b.state.widgets.find(w => w.id === 'c').opts.tf || 'D'

const TUNE = [
  { text: 'go up one timeframe', from: 'D', to: 'W' }, { text: 'next timeframe', from: '15', to: '30' },
  { text: 'previous timeframe', from: 'W', to: 'D' }, { text: 'step down a timeframe', from: '5', to: '1' },
]
describe('C1-011: one rung up or down the timeframe keys\' order', () => {
  it.each([...TUNE, ...TF_STEP_HELD_OUT].map(c => [c.text, c]))('%s: the chart moves one rung; Undo puts it back', async (_t, c) => {
    const { say, board } = p.mount(...one(c.from))
    // a phrasing no instant reader claims goes to the model, which says the step the same way
    p.st.envelopes.push((body) => p.env('apply', [{ action: 'chart.setTimeframe', target: body.context.charts[0].ref, args: { timeframe: c.to === tfStep(c.from, +1) ? 'next' : 'previous' } }]))
    const out = await say(c.text)
    expect(tfOf(board), out).toBe(c.to)
    await say('undo')
    expect(tfOf(board)).toBe(c.from)
  }, 30000)
  it.each([['go up one timeframe', 'M', /Monthly is already the longest/], ['previous timeframe', '1', /1 min.* is already the shortest|is already the shortest/]])('NEGATIVE at the end of the ladder, "%s" on %s: said, nothing changes', async (t, from, why) => {
    const { say, board } = p.mount(...one(from))
    // (an instant step that cannot run is left to the model, as every refused instant read is; its plan says the same step)
    p.st.envelopes.push((body) => p.env('apply', [{ action: 'chart.setTimeframe', target: body.context.charts[0].ref, args: { timeframe: /up/.test(t) ? 'next' : 'previous' } }]))
    expect(await say(t)).toMatch(why)
    expect(tfOf(board)).toBe(from)
  }, 30000)
})
const ORDER = ['1', '5', '15', '30', '60', 'D', 'W', 'M']
function tfStep(tf, d) { return ORDER[ORDER.indexOf(tf) + d] }
