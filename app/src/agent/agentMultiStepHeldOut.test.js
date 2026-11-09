// MULTI-STEP EXECUTION — HELD-OUT phrasings (pl-exec round 8, family 1; branch agent/pl/r8-multistep). Written and committed BEFORE
// any change of this family and never used to tune it. Evidence class: SIMULATED (scripted model, or no model at all).
// Board ONE (one chart, SPY daily) unless `board` says FOUR (c0 TL SPY clicked, c1 TR QQQ, c2 BL AMD, c3 BR TSLA).
// `want`: what the chart shows after the sequence; `done` / `notDone`: the steps a receipt must say were / were not done.
export const SEQ_HELD_OUT = [
  { id: 'q1', text: 'change the chart to AMD, put it on the daily, add a MACD, then log scale', want: { symbol: 'AMD', tf: 'D', ind: ['macd'], log: true } },
  { id: 'q2', text: 'go to TSLA then weekly then add a 20 EMA', want: { symbol: 'TSLA', tf: 'W', ind: ['ema'] } },
  { id: 'q3', board: 'FOUR', text: 'set this chart to QQQ and hourly, then add RSI', want: { chart: 'c0', symbol: 'QQQ', tf: '60', ind: ['rsi'] } },
]
// honest partial failure: the steps before the one that cannot run are done and said; the rest are said as not done
export const PARTIAL_HELD_OUT = [
  { id: 'p1', text: 'switch to NVDA, make it weekly, then add the zorkblat indicator', want: { symbol: 'NVDA', tf: 'W', ind: [] }, notDone: /zorkblat/i },
]
// Undo of the whole sequence, in the member's words
export const UNDO_SEQ_HELD_OUT = [
  { id: 'u1', seq: 'go to TSLA then weekly then add a 20 EMA', undo: 'undo all of that', want: { symbol: 'SPY', tf: 'D', ind: [] } },
  { id: 'u2', seq: 'change the chart to AMD, put it on the daily, add a MACD, then log scale', undo: 'take back everything you just did', want: { symbol: 'SPY', tf: 'D', ind: [], log: false } },
]

import { describe, it, expect } from 'vitest'
describe('multi-step held-out sets are frozen data', () => {
  it('ids are unique', () => {
    const all = [...SEQ_HELD_OUT, ...PARTIAL_HELD_OUT, ...UNDO_SEQ_HELD_OUT]
    expect(new Set(all.map(c => c.id)).size).toBe(all.length)
  })
})
