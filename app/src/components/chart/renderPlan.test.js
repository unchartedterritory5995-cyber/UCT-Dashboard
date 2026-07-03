import { describe, it, expect } from 'vitest'
import { barsRenderPlan, seriesSig } from './renderPlan'

// A tiny bar factory. Bars are {t,o,h,l,c,v}; intraday t is unix seconds,
// daily t is an ISO string — the planner must treat t as an opaque key either way.
const bar = (t, c, over = {}) => ({ t, o: c, h: c + 1, l: c - 1, c, v: 100, ...over })

describe('barsRenderPlan', () => {
  it('full when there is no previous paint (first paint)', () => {
    const next = [bar(1, 10), bar(2, 11)]
    expect(barsRenderPlan(null, next).mode).toBe('full')
    expect(barsRenderPlan([], next).mode).toBe('full')
  })

  it('full when next is empty (clear)', () => {
    expect(barsRenderPlan([bar(1, 10)], []).mode).toBe('full')
    expect(barsRenderPlan([bar(1, 10)], null).mode).toBe('full')
  })

  it('noop when arrays are structurally identical', () => {
    const prev = [bar(1, 10), bar(2, 11)]
    const next = [bar(1, 10), bar(2, 11)]
    expect(barsRenderPlan(prev, next).mode).toBe('noop')
  })

  it('incremental when ONLY the last bar OHLCV changed (developing-bar tick)', () => {
    const prev = [bar(1, 10), bar(2, 11)]
    const next = [bar(1, 10), bar(2, 11.5, { h: 12, v: 250 })]
    const plan = barsRenderPlan(prev, next)
    expect(plan.mode).toBe('incremental')
    expect(plan.lastBar).toEqual(next[1])
  })

  it('full when the length changed (new bar appended)', () => {
    const prev = [bar(1, 10), bar(2, 11)]
    const next = [bar(1, 10), bar(2, 11), bar(3, 12)]
    expect(barsRenderPlan(prev, next).mode).toBe('full')
  })

  it('full when the length shrank (deep backfill replaces window / trim)', () => {
    const prev = [bar(1, 10), bar(2, 11), bar(3, 12)]
    const next = [bar(2, 11), bar(3, 12)]
    expect(barsRenderPlan(prev, next).mode).toBe('full')
  })

  it('full when an INTERIOR/historical bar changed (reconciliation correction)', () => {
    // Same length + same last bar, but an earlier bar was corrected. This MUST
    // be a full repaint — an incremental last-bar update would leave the wrong
    // interior candle on screen (the exact class of bug we are guarding against).
    const prev = [bar(1, 10), bar(2, 11), bar(3, 12)]
    const next = [bar(1, 10), bar(2, 99, { h: 100 }), bar(3, 12)]
    expect(barsRenderPlan(prev, next).mode).toBe('full')
  })

  it('full when the last bar TIMESTAMP changed at equal length (bar rolled over)', () => {
    // Equal length but last t differs → the series shifted; a plain update()
    // targeting the new time would create a phantom, so force full.
    const prev = [bar(1, 10), bar(2, 11)]
    const next = [bar(1, 10), bar(3, 11)]
    expect(barsRenderPlan(prev, next).mode).toBe('full')
  })

  it('incremental detects a change in any single OHLCV field of the last bar', () => {
    const prev = [bar(1, 10), bar(2, 11)]
    for (const field of ['o', 'h', 'l', 'c', 'v']) {
      const next = [bar(1, 10), { ...bar(2, 11), [field]: 999 }]
      expect(barsRenderPlan(prev, next).mode).toBe('incremental')
    }
  })

  it('single-bar series: identical → noop, changed → incremental, new → full', () => {
    expect(barsRenderPlan([bar(1, 10)], [bar(1, 10)]).mode).toBe('noop')
    expect(barsRenderPlan([bar(1, 10)], [bar(1, 12)]).mode).toBe('incremental')
    expect(barsRenderPlan([bar(1, 10)], [bar(1, 10), bar(2, 11)]).mode).toBe('full')
  })
})

describe('seriesSig', () => {
  const pt = (time, value) => ({ time, value })

  it('is stable for identical data + extra', () => {
    const a = [pt(1, 5), pt(2, 6), pt(3, 7)]
    const b = [pt(1, 5), pt(2, 6), pt(3, 7)]
    expect(seriesSig(a, 'x')).toBe(seriesSig(b, 'x'))
  })

  it('changes when the last value changes (developing point)', () => {
    const a = [pt(1, 5), pt(2, 6), pt(3, 7)]
    const b = [pt(1, 5), pt(2, 6), pt(3, 7.5)]
    expect(seriesSig(a)).not.toBe(seriesSig(b))
  })

  it('changes when length changes', () => {
    const a = [pt(1, 5), pt(2, 6)]
    const b = [pt(1, 5), pt(2, 6), pt(3, 7)]
    expect(seriesSig(a)).not.toBe(seriesSig(b))
  })

  it('changes when a sampled midpoint changes', () => {
    const a = [pt(1, 5), pt(2, 6), pt(3, 7), pt(4, 8), pt(5, 9)]
    const b = [pt(1, 5), pt(2, 6), pt(3, 99), pt(4, 8), pt(5, 9)]
    expect(seriesSig(a)).not.toBe(seriesSig(b))
  })

  it('changes when the extra (settings) token changes', () => {
    const a = [pt(1, 5), pt(2, 6)]
    expect(seriesSig(a, 'ma50')).not.toBe(seriesSig(a, 'ma200'))
  })

  it('handles empty series without throwing', () => {
    expect(() => seriesSig([])).not.toThrow()
    expect(seriesSig([])).toBe(seriesSig([]))
  })
})
