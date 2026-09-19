/**
 * The colours a selection is drawn in (`assignColours`).
 *
 * ⚰️ Written from the owner's screenshot of 2026-09-18: Health and % Above 50SMA, the two
 * lines of the DEFAULT view, drew in the same blue on the same panel.
 */
import { describe, it, expect } from 'vitest'
import { assignColours, stickyColour } from './stickyColours'
import { V2_DEFAULT_SELECTED } from './defaults'
import { ALL_METRICS, toneOf, TONE_RAMP } from '../chartMetrics'

const distinct = map => new Set(Object.values(map)).size === Object.keys(map).length

describe('assignColours', () => {
  it('⚰️ the default view draws every line in its own colour', () => {
    // CONTROL: the registry map alone really does collide here — the defect is live input.
    const raw = V2_DEFAULT_SELECTED.map(stickyColour)
    expect(new Set(raw).size).toBeLessThan(raw.length)
    expect(distinct(assignColours(V2_DEFAULT_SELECTED))).toBe(true)
  })

  it('a metric that stays selected keeps its colour when another is removed', () => {
    const first = assignColours(V2_DEFAULT_SELECTED)
    const [, ...rest] = V2_DEFAULT_SELECTED
    const after = assignColours(rest, first)
    for (const k of rest) expect(after[k]).toBe(first[k])
  })

  it('a metric that stays selected keeps its colour when another is added', () => {
    const first = assignColours(V2_DEFAULT_SELECTED)
    const extra = ALL_METRICS.map(m => m.key).find(k => !V2_DEFAULT_SELECTED.includes(k))
    const after = assignColours([...V2_DEFAULT_SELECTED, extra], first)
    for (const k of V2_DEFAULT_SELECTED) expect(after[k]).toBe(first[k])
    expect(distinct(after)).toBe(true)
  })

  it('stays inside the metric\'s tone — a bearish series is never drawn in a bullish green', () => {
    const neutrals = ALL_METRICS.map(m => m.key).filter(k => toneOf(k) === 'neutral').slice(0, 6)
    const out = assignColours(neutrals)
    for (const k of neutrals) expect(TONE_RAMP.neutral).toContain(out[k])
    expect(distinct(out)).toBe(true)
  })
})
