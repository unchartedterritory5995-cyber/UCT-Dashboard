// heldRows: the handoff's cover rule reads how many rows the store holds for the chart's key (closed rows
// plus the developing one), never building the legacy array; with `answered`, only rows the server gave in
// this life of the key count (a saved copy alone is 0).
import { describe, it, expect } from 'vitest'
import { createPrefetch } from './prefetch'

function stubStore() {
  const held = new Map()
  const answered = new Set()
  return {
    held, answered,
    peek: (key) => held.get(key) ?? null,
    network: { answered: (key) => answered.has(key) },
  }
}
const rows = (n) => Array.from({ length: n }, (_, i) => ({ t: 1_700_000_000 + i * 1800 }))

describe('prefetch.heldRows', () => {
  it('counts closed rows plus the developing one, for the key the chart would read', () => {
    const store = stubStore()
    const pf = createPrefetch({ store })
    const key = pf.keyFor('AAA', '30')
    store.held.set(key, { bars: rows(1120), developing: { t: 1 }, restSeen: true })
    expect(pf.heldRows('AAA', '30', { showExtended: true })).toBe(1121)   // an extended view draws every row
    expect(pf.heldRows('BBB', '30')).toBe(0)                    // nothing held
  })

  // (review of #2871) a REGULAR-HOURS view of a key both sessions share draws only its regular-session rows
  it('a regular-hours view of a shared key counts its regular-session rows (barTime.isRthBar), up to COVER_ROWS', async () => {
    const { isRthBar } = await import('../../components/chart/barTime')
    const { COVER_ROWS } = await import('./coverRows')
    const store = stubStore()
    const pf = createPrefetch({ store })
    const key = pf.keyFor('AAA', '30', { showExtended: false })
    expect(pf.keyFor('AAA', '30', { showExtended: true })).toBe(key)   // the same rows serve both views
    const few = rows(1120)
    store.held.set(key, { bars: few, developing: null, restSeen: true })
    const rth = few.filter((b) => isRthBar(b.t)).length
    expect(rth).toBeLessThan(COVER_ROWS)
    expect(pf.heldRows('AAA', '30', { showExtended: false })).toBe(rth)
    const many = rows(6000)
    store.held.set(key, { bars: many, developing: null, restSeen: true })
    expect(pf.heldRows('AAA', '30', { showExtended: false })).toBe(COVER_ROWS)   // counted no further than COVER_ROWS
    expect(pf.heldRows('AAA', '30', { showExtended: true })).toBe(6000)
  })

  // (owner, 2026-11-27: charts at any date) an intraday chart at a past date (the date box's anchor, a replay cutoff)
  // reads the window ending there (useBarSnapshotBars chartKeyFor): its rows are counted, never the plain key's
  it('with viewWindow: counts the window an intraday chart reads at a past date (chartKeyFor), not the plain key', async () => {
    const { chartKeyFor, viewWindowOfDate } = await import('../../components/chart/useBarSnapshotBars')
    const store = stubStore()
    const pf = createPrefetch({ store })
    const w = viewWindowOfDate('2025-03-14', '30')
    const windowed = chartKeyFor({ sym: 'AAA', resolvedTf: '30', showExtended: true, replayCutoff: null, hasOverride: false, viewWindow: w })
    const plain = pf.keyFor('AAA', '30', { showExtended: true })
    expect(windowed).not.toBe(plain)
    store.held.set(plain, { bars: rows(150), developing: null, restSeen: true })
    store.held.set(windowed, { bars: rows(900), developing: null, restSeen: true })
    expect(pf.heldRows('AAA', '30', { showExtended: true, viewWindow: w })).toBe(900)
    expect(pf.heldRows('AAA', '30', { showExtended: true })).toBe(150)      // at the present: the plain key, as before
    store.held.delete(windowed)
    expect(pf.heldRows('AAA', '30', { showExtended: true, viewWindow: w })).toBe(0)   // the window not held: nothing
  })

  it('with answered: 0 for a saved copy alone, the count once the server answered in this life', () => {
    const store = stubStore()
    const pf = createPrefetch({ store })
    const key = pf.keyFor('AAA', 'D')
    store.held.set(key, { bars: rows(3000), developing: null, restSeen: true })
    expect(pf.heldRows('AAA', 'D', { answered: true })).toBe(0)  // restSeen from an earlier life, no answer now
    store.answered.add(key)
    expect(pf.heldRows('AAA', 'D', { answered: true })).toBe(3000)
    store.held.set(key, { bars: rows(3000), developing: null, restSeen: false })
    expect(pf.heldRows('AAA', 'D', { answered: true })).toBe(0)  // a local copy, whatever `answered` says
    expect(pf.heldRows('AAA', 'D')).toBe(3000)                   // without the option: what is held
  })
})
