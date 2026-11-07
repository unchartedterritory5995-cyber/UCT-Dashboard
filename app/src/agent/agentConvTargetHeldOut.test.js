// CONVERSATIONAL TARGETING — HELD-OUT phrasings (pl-exec, exec-gen-1, owner product decision 2026-11-07). Written and committed
// BEFORE the change and never used to tune it. Each case: a board of FOUR (c0 TL SPY, c1 TR NVDA, c2 BL AMD, c3 BR TSLA); `click`
// the chart clicked before the first line; `turns` the member's lines in order, the first naming a chart; `then` an optional
// click between lines; `want` the chart the LAST line must act on, or 'ask'. Evidence class: SIMULATED (scripted model).
export const CONV_HELD_OUT = [
  // the named chart stays the target across bare follow-ups (a stale click elsewhere does not take it back)
  { id: 'h1', click: 'c0', turns: ['switch the NVDA chart to the weekly', 'and stick an RSI on it'], want: 'c1' },
  { id: 'h2', click: 'c2', turns: ['put the top-right chart on log scale', 'weekly candles please', 'add a MACD as well'], want: 'c1' },
  { id: 'h3', click: null, turns: ['TSLA chart to the hourly', 'now overlay QQQ'], want: 'c3' },
  // an explicit new reference overrides
  { id: 'h4', click: 'c0', turns: ['make the NVDA one weekly', 'now the bottom-left chart on log'], want: 'c2' },
  // a click after the naming, then "this one" or a bare follow-up: the click
  { id: 'h5', click: 'c0', turns: ['NVDA chart weekly', 'this one on log scale too'], then: 'c3', want: 'c3' },
  { id: 'h6', click: 'c0', turns: ['NVDA chart weekly', 'add an RSI'], then: 'c2', want: 'c2' },
  // "this" with only a stale click on another chart, after a named chart: ambiguous → ask
  { id: 'h7', click: 'c0', turns: ['set the NVDA chart to weekly', 'put this one on log scale'], want: 'ask' },
]

import { describe, it, expect } from 'vitest'
describe('conversational-targeting held-out set is frozen data', () => {
  it('ids are unique', () => { expect(new Set(CONV_HELD_OUT.map(c => c.id)).size).toBe(CONV_HELD_OUT.length) })
})
