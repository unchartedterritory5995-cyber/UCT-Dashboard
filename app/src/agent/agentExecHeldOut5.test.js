// EXECUTION FAMILIES, ROUND 5 — HELD-OUT phrasings (pl-exec, exec-gen-1). Written and committed BEFORE any round 5 change and never
// used to change it; the tune phrasings live in the round 5 tests. Evidence class: SIMULATED (scripted model).

// ── C1-011: the timeframe keys' repeat-press cycle, said: one rung up or down the same order the keys walk ──
export const TF_STEP_HELD_OUT = [
  { text: 'bump this chart up one timeframe', from: 'D', to: 'W' },
  { text: 'drop down a timeframe', from: '60', to: '30' },
  { text: 'next timeframe up please', from: '5', to: '15' },
  { text: 'one timeframe lower on this chart', from: 'W', to: 'D' },
]

// ── C2-092: an alert on the member's own yes/no signal, with its trigger policy ──
export const SIGNAL_HELD_OUT = [
  { text: 'tell me when my Bullish Trend flips on', trigger: 'becomes_true' },
  { text: 'alert when Bullish Trend switches off', trigger: 'becomes_false' },
  { text: 'notify me while my Bullish Trend is true', trigger: 'is_true' },
]

// ── C3-107: a preset scan on the Scanner widget; C3-150: when a stock reports, asked from Charts ──
export const SCAN_HELD_OUT = [{ text: 'put the highest volume in a year scan on the scanner' }]
export const REPORTS_HELD_OUT = [{ text: 'whens AMD next reporting' }, { text: 'what date are NVDA earnings' }]

import { describe, it, expect } from 'vitest'
describe('round 5 held-out sets are frozen data', () => {
  it('no phrasing appears twice', () => {
    const all = [...TF_STEP_HELD_OUT, ...SIGNAL_HELD_OUT, ...SCAN_HELD_OUT, ...REPORTS_HELD_OUT]
    expect(new Set(all.map(c => c.text)).size).toBe(all.length)
  })
})
