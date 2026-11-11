import { describe, it, expect } from 'vitest'
import { POINTER, calloutLook, hardCallouts } from './callout'

describe('the round-21 pointer', () => {
  it('points at the signal candle in the verdict colour and marks the culmination in gold without a ring', () => {
    expect(hardCallouts({ index: 89, label: 'Last candle' })).toEqual([{ index: 89, text: 'Last candle', ...POINTER.ask }])
    const two = hardCallouts({ index: 60, label: 'Oops Reversal', tone: 'ok', peak: { index: 74, text: '+12.0% in 14 sessions' } })
    expect(two).toHaveLength(2)
    expect(two[0]).toMatchObject({ index: 60, color: POINTER.ok.color })
    expect(two[1]).toMatchObject({ index: 74, color: POINTER.peak.color, ring: false })
  })
  it('draws nothing without a candle or a label, and no peak on the signal candle itself', () => {
    expect(hardCallouts({ index: -1, label: 'x' })).toEqual([])
    expect(hardCallouts({ index: 3, label: '' })).toEqual([])
    expect(hardCallouts({ index: 3, label: 'x', peak: { index: 3, text: 'y' } })).toHaveLength(1)
  })
  it('keeps the label further off the candle on a desktop than on a phone, both with a ring and an arrowhead', () => {
    const d = calloutLook(false)
    const p = calloutLook(true)
    expect(d.distances[0]).toBeGreaterThan(p.distances[0])
    expect(d.ring && d.arrow && p.ring && p.arrow && d.pill).toBe(true)
  })
})
