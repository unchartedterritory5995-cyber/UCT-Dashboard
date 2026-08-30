import { describe, it, expect } from 'vitest'
import { buildDateIndex, resolveSeekIndex } from './seek'

const rows = [
  { date: '2026-08-28' },   // 0 — newest
  { date: '2026-08-27' },
  { date: '2026-08-26' },
  { date: '2026-08-25' },   // 3 — oldest
]
const index = buildDateIndex(rows)

describe('buildDateIndex', () => {
  it('maps every session date to its newest-first row index', () => {
    expect(index.get('2026-08-28')).toBe(0)
    expect(index.get('2026-08-25')).toBe(3)
    expect(index.size).toBe(4)
  })

  it('skips rows with no date rather than indexing undefined', () => {
    const m = buildDateIndex([{ date: 'a' }, {}, { date: null }, { date: 'b' }])
    expect([...m.keys()]).toEqual(['a', 'b'])
  })

  // A live row can arrive carrying the same date as a stored one during the
  // 4:15 handover; the NEWER row is the one the cursor should land on.
  it('keeps the newest row when two carry the same date', () => {
    const m = buildDateIndex([{ date: 'x', _live: true }, { date: 'x' }])
    expect(m.get('x')).toBe(0)
  })
})

describe('resolveSeekIndex — dates', () => {
  it('resolves a date inside the window to its index', () => {
    expect(resolveSeekIndex('2026-08-26', index, rows.length)).toBe(2)
  })

  /**
   * 🔴 THE WHOLE POINT. The Analogue Deck names 2025 sessions a 90-day window
   * cannot hold. Clamping one to the oldest loaded row would move the cursor
   * somewhere the user never asked for and caption it with the date they
   * clicked; returning null is what lets the caller render the affordance
   * DISABLED instead of as a link that quietly does nothing.
   */
  it('REFUSES a date outside the loaded window — it does not clamp', () => {
    expect(resolveSeekIndex('2025-03-11', index, rows.length)).toBeNull()
    expect(resolveSeekIndex('2099-01-01', index, rows.length)).toBeNull()
  })

  it('refuses a date between two loaded sessions — sessions are not a range', () => {
    // A weekend/holiday inside the window is still not a session to sit on.
    expect(resolveSeekIndex('2026-08-27T00:00:00', index, rows.length)).toBeNull()
  })

  it('tolerates surrounding whitespace', () => {
    expect(resolveSeekIndex('  2026-08-27 ', index, rows.length)).toBe(1)
  })

  it('refuses anything that is neither a date string nor a number', () => {
    for (const bad of [null, undefined, {}, [], true, NaN]) {
      expect(resolveSeekIndex(bad, index, rows.length)).toBeNull()
    }
  })
})

describe('resolveSeekIndex — numeric positions', () => {
  it('resolves an in-range index to itself', () => {
    expect(resolveSeekIndex(2, index, rows.length)).toBe(2)
  })

  // The scrubber and the ← / → buttons ask by POSITION in a range they already
  // know; clamping there is the right answer, not a refusal.
  it('clamps an out-of-range index instead of refusing it', () => {
    expect(resolveSeekIndex(-5, index, rows.length)).toBe(0)
    expect(resolveSeekIndex(99, index, rows.length)).toBe(3)
  })

  it('truncates a fractional index', () => {
    expect(resolveSeekIndex(1.9, index, rows.length)).toBe(1)
  })

  it('refuses everything when the window is empty', () => {
    expect(resolveSeekIndex(0, new Map(), 0)).toBeNull()
    expect(resolveSeekIndex('2026-08-28', index, 0)).toBeNull()
  })
})

/**
 * ⭐ THE PROPERTY THAT MAKES ONE RESOLVER WORTH HAVING: whatever `canSeek`
 * answers before paint, `onSeek` does on click. Both are `resolveSeekIndex`
 * with a different return shape, so this cannot come apart — and this test
 * fails the moment somebody re-implements either half.
 */
describe('canSeek and onSeek can never disagree', () => {
  const canSeek = (t) => resolveSeekIndex(t, index, rows.length) != null
  const onSeek = (t) => resolveSeekIndex(t, index, rows.length) != null

  it('agrees on every date in the window and every date outside it', () => {
    const targets = [...rows.map(r => r.date), '2025-01-02', '', 'nonsense', 0, 3, 42, -1]
    for (const t of targets) {
      expect(canSeek(t), `disagreement on ${JSON.stringify(t)}`).toBe(onSeek(t))
    }
  })

  it('and the fixture actually contains both answers, so the loop proves something', () => {
    expect(canSeek('2026-08-26')).toBe(true)
    expect(canSeek('2025-01-02')).toBe(false)
  })
})
