// INDICATOR SETTINGS AND APPEARANCE THROUGH METADATA — HELD-OUT phrasings (pl-exec round 8, family 3; branch
// agent/pl/r8-indicator-style). Written and committed BEFORE the family's tests and any change, never used to tune. Board ONE.
// `add`: the indicator put on first; `text`: the member's words; `check`: what its instance must read afterwards.
// Evidence class: SIMULATED (the instant path, or a scripted model).
export const STYLE_HELD_OUT = [
  { id: 'i1', add: 'rsi', text: 'set the rsi length to 21', check: { input: ['period', 21] } },
  { id: 'i2', add: 'stoch', text: 'turn the %D line of the stochastic blue', check: { colorOf: 'dColor' } },
  { id: 'i3', add: 'macd', text: 'make the macd histogram up bars green', check: { changed: true } },
  { id: 'i4', add: 'bb', text: 'change the bollinger bands deviation to 2.5', check: { input: ['stdDev', 2.5] } },
  { id: 'i5', add: 'movingAverage', text: 'switch the moving average to an exponential one', check: { input: ['maType', 'ema'] } },
  { id: 'i6', add: 'macd', text: 'hide the macd', check: { hidden: true } },
]

import { describe, it, expect } from 'vitest'
describe('indicator style held-out set is frozen data', () => {
  it('ids are unique', () => { expect(new Set(STYLE_HELD_OUT.map(c => c.id)).size).toBe(STYLE_HELD_OUT.length) })
})
