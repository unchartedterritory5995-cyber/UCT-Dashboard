// EXECUTION FAMILIES, ROUND 3 — HELD-OUT phrasings (pl-exec, exec-gen-1). Written and committed BEFORE any round 3 change and never
// used to change it; the tune phrasings live in the round 3 tests themselves. Evidence class: SIMULATED (LOCAL native Windows
// Node, scripted/no model). Boards: FOUR = SPY (top-left c0), QQQ (top-right c1), NVDA (bottom-left c2), TSLA (bottom-right c3).

// ── A sentence that names one chart and points at the clicked one: each clause's change on its own clause's chart ──
export const CLAUSE_HELD_OUT = [
  { text: 'set the TSLA chart to weekly and make this one log', clicked: 'c0', ops: [['c3', 'chart.setTimeframe', { timeframe: 'W' }], ['c0', 'chart.setScale', { scale: 'log' }]] },
  { text: 'log scale here and weekly on the SPY chart', clicked: 'c2', ops: [['c2', 'chart.setScale', { scale: 'log' }], ['c0', 'chart.setTimeframe', { timeframe: 'W' }]] },
  { text: 'put the QQQ chart on monthly, this one on weekly', clicked: 'c3', ops: [['c1', 'chart.setTimeframe', { timeframe: 'M' }], ['c3', 'chart.setTimeframe', { timeframe: 'W' }]] },
  { text: 'this chart weekly, the NVDA one log', clicked: 'c1', ops: [['c1', 'chart.setTimeframe', { timeframe: 'W' }], ['c2', 'chart.setScale', { scale: 'log' }]] },
]

// ── Scoped undo: the most recent change of the KIND named, not the newest change ──
export const UNDO_HELD_OUT = [
  { text: 'undo the timeframe bit', kind: 'timeframe' },
  { text: 'take back only the weekly change', kind: 'timeframe' },
  { text: 'revert just the rsi I added', kind: 'indicator' },
  { text: 'undo the symbol switch', kind: 'symbol' },
]

// ── An indicator alert's threshold inside the indicator's own range ──
export const RANGE_HELD_OUT = [
  { text: 'alert me when RSI goes above 150', indicator: 'rsi', threshold: 150, ok: false },
  { text: 'rsi alert under -5', indicator: 'rsi', threshold: -5, ok: false },
  { text: 'ping me if the RSI crosses 70', indicator: 'rsi', threshold: 70, ok: true },
]

// ── Rename or delete a theme set, through the tracker's own set menu ──
export const SET_HELD_OUT = [
  { text: 'rename my Mine theme set to Growth', op: 'rename', item: 'Mine', name: 'Growth' },
  { text: 'call the Mine preset in the theme tracker Leaders', op: 'rename', item: 'Mine', name: 'Leaders' },
  { text: 'delete the Mine set in the theme tracker', op: 'delete', item: 'Mine' },
]

import { describe, it, expect } from 'vitest'
describe('round 3 held-out sets are frozen data', () => {
  it('no phrasing appears twice', () => {
    const all = [...CLAUSE_HELD_OUT, ...UNDO_HELD_OUT, ...RANGE_HELD_OUT, ...SET_HELD_OUT]
    expect(new Set(all.map(c => c.text)).size).toBe(all.length)
  })
})
