// ⚠️ THE PERFORMANCE RAIL THE LAST ONE OF THESE WAS MISSING.
//
// Phase 5 put a catalogue rebuild on `/api/bars`' hot path and paid 404 µs per
// ordinary ticker to answer "no" — a cost nothing measured until it was profiled by
// hand. This search runs ON EVERY KEYSTROKE over the whole published library, so the
// same class of mistake here is felt directly by a member typing.
//
// ⛔ THESE ARE BUDGETS, NOT BENCHMARKS. The numbers are deliberately loose — a CI box
// under load is slower than this one — because the failure being railed is an
// ALGORITHMIC regression (re-upper-casing every row per keystroke, rebuilding the
// index, an accidental O(n²)), not a few hundred microseconds of drift.
import { describe, it, expect } from 'vitest'

import CATALOG from './__fixtures__/breadthLibraryRows.json'
import { searchLibrary, buildIndex, browseFamilies } from './breadthLibrary'

const ROWS = CATALOG.rows
const METRIC_ORDER = new Map(CATALOG.metric_order.map((m, i) => [m, i]))

/** What a member's typing actually looks like: one search per character. */
const KEYSTROKES = (s) => Array.from({ length: s.length }, (_, i) => s.slice(0, i + 1))

const timed = (fn, n) => {
  fn() // warm, so the first-call index build is not charged to the average
  const t0 = performance.now()
  for (let i = 0; i < n; i++) fn()
  return (performance.now() - t0) / n
}

describe('discovery stays cheap at the size the library actually is', () => {
  it('the catalogue is big enough for this rail to mean something', () => {
    expect(ROWS.length).toBeGreaterThan(150)
  })

  it('⭐ the index is built ONCE per payload, not once per query', () => {
    const a = buildIndex(ROWS)
    const b = buildIndex(ROWS)
    expect(b).toBe(a)                       // same array identity → same index
    expect(buildIndex(ROWS.slice())).not.toBe(a)  // a NEW payload rebuilds
  })

  it('a full typed query costs well under a frame, per keystroke', () => {
    for (const q of ['% of stocks above 50-day', 'nasdaq new lows', 'NASDAQ:A50']) {
      const strokes = KEYSTROKES(q)
      const per = timed(() => {
        for (const s of strokes) searchLibrary(ROWS, s, { limit: 40, metricOrder: METRIC_ORDER })
      }, 20) / strokes.length
      expect(per, q).toBeLessThan(4)        // ms per keystroke
    }
  })

  it('⛔ the WIDEST query — a bare universe, every metric — is not the slow path', () => {
    const per = timed(
      () => searchLibrary(ROWS, 'NASDAQ', { limit: 200, metricOrder: METRIC_ORDER }), 50)
    expect(per).toBeLessThan(4)
  })

  it('a query that matches NOTHING is cheap too', () => {
    // The member who typed a plain ticker pays this on every keystroke as well.
    const per = timed(() => searchLibrary(ROWS, 'AAPL', { limit: 40, metricOrder: METRIC_ORDER }), 50)
    expect(per).toBeLessThan(4)
  })

  it('browse is linear in the catalogue, cheap enough to build on open', () => {
    expect(timed(() => browseFamilies(ROWS), 20)).toBeLessThan(12)
  })
})
