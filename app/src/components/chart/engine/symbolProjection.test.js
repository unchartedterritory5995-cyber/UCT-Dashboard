import { describe, it, expect } from 'vitest'
import { projectSymbolField, projectionFor, clearProjectionFor } from './symbolProjection'
import { interpret } from './ast/interpret'

// ─── P1.3 · EXACT-t PROJECTION, AND THE PARITY THAT KEEPS IT HONEST ─────────
//
// The rule is not new — it is `interpret.js`'s `case 'sym'`, extracted. So the
// tests that matter most are the ones proving the extraction did not change it.

const day = (t, c, v = 100) => ({ t, o: c, h: c, l: c, c, v })

describe('projectSymbolField — the rule', () => {
  it('⭐ matching timestamps project the secondary field', () => {
    const primary = [day('2026-01-02', 10), day('2026-01-05', 11), day('2026-01-06', 12)]
    const secondary = [day('2026-01-02', 500), day('2026-01-05', 510), day('2026-01-06', 520)]
    expect(projectSymbolField(secondary, 'close', primary)).toEqual([500, 510, 520])
  })

  it('⭐ volume is projected as its own field, not conflated with close', () => {
    const primary = [day('2026-01-02', 10)]
    const secondary = [day('2026-01-02', 500, 9_000_000)]
    expect(projectSymbolField(secondary, 'close', primary)).toEqual([500])
    expect(projectSymbolField(secondary, 'volume', primary)).toEqual([9_000_000])
  })

  it('⛔⛔ A MISSING SECONDARY BAR IS NaN — never forward-filled', () => {
    // A halt, or a one-sided holiday. Carrying 500 forward would present a stale
    // price as this bar's, which is worst exactly when it matters.
    const primary = [day('2026-01-02', 10), day('2026-01-05', 11), day('2026-01-06', 12)]
    const secondary = [day('2026-01-02', 500), day('2026-01-06', 520)]   // 01-05 absent
    const out = projectSymbolField(secondary, 'close', primary)
    expect(out[0]).toBe(500)
    expect(Number.isNaN(out[1])).toBe(true)
    expect(out[2]).toBe(520)
  })

  it('⛔ A SHORT SECONDARY HISTORY LEAVES A NaN PREFIX, not a clamped first value', () => {
    const primary = [day('2026-01-02', 10), day('2026-01-05', 11), day('2026-01-06', 12)]
    const secondary = [day('2026-01-06', 520)]
    const out = projectSymbolField(secondary, 'close', primary)
    expect(Number.isNaN(out[0])).toBe(true)
    expect(Number.isNaN(out[1])).toBe(true)
    expect(out[2]).toBe(520)
  })

  it('⛔ a secondary LONGER than the primary contributes only where they overlap', () => {
    const primary = [day('2026-01-05', 11)]
    const secondary = [day('2026-01-02', 500), day('2026-01-05', 510), day('2026-01-06', 520)]
    expect(projectSymbolField(secondary, 'close', primary)).toEqual([510])
  })

  it('⛔ no overlap at all is an all-NaN column, never an empty one', () => {
    const primary = [day('2026-01-02', 10), day('2026-01-05', 11)]
    const secondary = [day('2025-06-02', 500)]
    const out = projectSymbolField(secondary, 'close', primary)
    expect(out).toHaveLength(2)
    expect(out.every(Number.isNaN)).toBe(true)
  })

  it('⛔ ABSENT SECONDARY BARS NEVER FALL BACK TO THE PRIMARY', () => {
    // The defining rule of the whole lane: answering with the bars in hand would
    // answer confidently about the WRONG INSTRUMENT.
    const primary = [day('2026-01-02', 10), day('2026-01-05', 11)]
    for (const empty of [[], null, undefined]) {
      const out = projectSymbolField(empty, 'close', primary)
      expect(out).toHaveLength(2)
      expect(out.every(Number.isNaN)).toBe(true)
      expect(out).not.toEqual([10, 11])
    }
  })

  it('⛔ an unknown field is NaN, not a guess', () => {
    const primary = [day('2026-01-02', 10)]
    const secondary = [day('2026-01-02', 500)]
    expect(Number.isNaN(projectSymbolField(secondary, 'hl2', primary)[0])).toBe(true)
    expect(Number.isNaN(projectSymbolField(secondary, 'open', primary)[0])).toBe(true)
  })

  it('⛔ a duplicate secondary timestamp: FIRST WINS, matching the formula lane', () => {
    const primary = [day('2026-01-02', 10)]
    const secondary = [day('2026-01-02', 500), day('2026-01-02', 999)]
    expect(projectSymbolField(secondary, 'close', primary)).toEqual([500])
  })
})

describe('⛔⛔ THE INTRADAY DAY-KEY REGRESSION — the defect this rule exists for', () => {
  it('every 5-minute bar of a session must NOT collapse onto one secondary bar', () => {
    // Found against a 579-bar intraday corpus: an ISO-day key maps every bar of a
    // session onto the benchmark's FIRST bar of that day. If this ever passes with
    // a constant column, the extraction has reintroduced the original defect.
    const primary = [
      day('2026-01-02T14:30:00Z', 10),
      day('2026-01-02T14:35:00Z', 11),
      day('2026-01-02T14:40:00Z', 12),
    ]
    const secondary = [
      day('2026-01-02T14:30:00Z', 500),
      day('2026-01-02T14:35:00Z', 501),
      day('2026-01-02T14:40:00Z', 502),
    ]
    const out = projectSymbolField(secondary, 'close', primary)
    expect(out).toEqual([500, 501, 502])
    expect(new Set(out).size).toBe(3)          // not collapsed to one value
  })

  it('…and an intraday bar with no secondary counterpart stays NaN within the session', () => {
    const primary = [
      day('2026-01-02T14:30:00Z', 10),
      day('2026-01-02T14:35:00Z', 11),
      day('2026-01-02T14:40:00Z', 12),
    ]
    const secondary = [day('2026-01-02T14:30:00Z', 500), day('2026-01-02T14:40:00Z', 502)]
    const out = projectSymbolField(secondary, 'close', primary)
    expect(Number.isNaN(out[1])).toBe(true)
  })
})

describe('⭐⭐ PARITY WITH THE FORMULA LANE — one rule, two callers', () => {
  // The extraction's whole justification. If these ever disagree, there are two
  // spellings of one fact again and one of them is wrong.
  const cases = [
    ['aligned', [day('2026-01-02', 10), day('2026-01-05', 11)], [day('2026-01-02', 500), day('2026-01-05', 510)]],
    ['a gap', [day('2026-01-02', 10), day('2026-01-05', 11)], [day('2026-01-02', 500)]],
    ['short history', [day('2026-01-02', 10), day('2026-01-05', 11)], [day('2026-01-05', 510)]],
    ['no overlap', [day('2026-01-02', 10)], [day('2025-01-02', 500)]],
  ]

  it.each(cases)('%s — projectSymbolField agrees with interpret\'s sym node', (_name, primary, secondary) => {
    const mine = projectSymbolField(secondary, 'close', primary)
    // ⚠️ THE NODE IS BUILT, NOT PARSED. `sym` is not member-facing formula
    // syntax — it is what the Pine translator emits for `request.security`, so
    // `parseFormula` rightly refuses it. The canonical shape is what the two
    // lanes share, and it is what this parity claim is about.
    const node = { type: 'sym', value: 'QQQ', args: [{ type: 'series', name: 'close' }] }
    const theirs = interpret(node, primary, {}, undefined, undefined, {
      symbols: { QQQ: secondary },
    })
    const asArray = Array.from(theirs)
    expect(asArray).toHaveLength(mine.length)
    for (let i = 0; i < mine.length; i++) {
      if (Number.isNaN(mine[i])) expect(Number.isNaN(asArray[i])).toBe(true)
      else expect(asArray[i]).toBeCloseTo(mine[i], 10)
    }
  })
})

describe('projectionFor — stable array identity', () => {
  it('⭐⭐ UNCHANGED INPUTS RETURN THE SAME ARRAY — this is the memo contract', () => {
    // `binder.js` stamps `__srcId` on a source column and folds it into the memo
    // signature. A new array on every paint would silently recompute every consumer.
    const primary = [day('2026-01-02', 10)]
    const secondary = [day('2026-01-02', 500)]
    const a = projectionFor(secondary, 'close', primary)
    const b = projectionFor(secondary, 'close', primary)
    expect(b).toBe(a)
  })

  it('⭐⭐ TWO SYMBOLS DO NOT EVICT EACH OTHER', () => {
    // A single cache slot would thrash here: QQQ's projection evicted while
    // computing SPY's, so neither is ever stable across a pass — the memo would
    // miss every paint while the numbers stayed correct.
    const primary = [day('2026-01-02', 10)]
    const qqq = [day('2026-01-02', 500)]
    const spy = [day('2026-01-02', 600)]
    const q1 = projectionFor(qqq, 'close', primary)
    const s1 = projectionFor(spy, 'close', primary)
    expect(projectionFor(qqq, 'close', primary)).toBe(q1)
    expect(projectionFor(spy, 'close', primary)).toBe(s1)
    expect(q1).not.toBe(s1)
  })

  it('⭐ two FIELDS of one symbol are cached separately and both stay stable', () => {
    const primary = [day('2026-01-02', 10)]
    const secondary = [day('2026-01-02', 500, 9_000)]
    const c1 = projectionFor(secondary, 'close', primary)
    const v1 = projectionFor(secondary, 'volume', primary)
    expect(projectionFor(secondary, 'close', primary)).toBe(c1)
    expect(projectionFor(secondary, 'volume', primary)).toBe(v1)
    expect(c1).not.toBe(v1)
  })

  it('⛔ NEW SECONDARY BARS MINT A NEW COLUMN — the cache misses when numbers change', () => {
    const primary = [day('2026-01-02', 10)]
    const before = projectionFor([day('2026-01-02', 500)], 'close', primary)
    const after = projectionFor([day('2026-01-02', 501)], 'close', primary)
    expect(after).not.toBe(before)
    expect(after).toEqual([501])
  })

  it('⛔ NEW PRIMARY BARS MINT A NEW COLUMN — the timeline is part of the projection', () => {
    const secondary = [day('2026-01-02', 500), day('2026-01-05', 510)]
    const a = projectionFor(secondary, 'close', [day('2026-01-02', 10)])
    const b = projectionFor(secondary, 'close', [day('2026-01-02', 10), day('2026-01-05', 11)])
    expect(b).not.toBe(a)
    expect(b).toHaveLength(2)
  })

  it('⛔ the cache never mutates the bars it was given', () => {
    const primary = [day('2026-01-02', 10)]
    const secondary = [day('2026-01-02', 500)]
    const snapshot = JSON.stringify({ primary, secondary })
    projectionFor(secondary, 'close', primary)
    projectionFor(secondary, 'volume', primary)
    expect(JSON.stringify({ primary, secondary })).toBe(snapshot)
    clearProjectionFor(secondary)
  })
})
