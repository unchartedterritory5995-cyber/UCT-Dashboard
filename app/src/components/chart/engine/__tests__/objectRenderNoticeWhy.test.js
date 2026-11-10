// app/src/components/chart/engine/__tests__/objectRenderNoticeWhy.test.js
//
// ─── ⭐ DIV-3 r2 (review N-C) — THE STORE'S EQUALITY READS `why` ───────────────
//
// `setObjectRenderDrops` emits only on a change. With the drop count held fixed, a
// change of the withheld family's SENTENCE (`why`) is the only change there is, so
// an equality that ignored `why` would keep the member's note on the old sentence
// (mutant H3). Sequence: no-why → S1 → S2 → S2 → no-why → cleared.
import { describe, it, expect, afterEach } from 'vitest'
import {
  setObjectRenderDrops, objectRenderDropsFor, onObjectRenderDropsChange, resetObjectRenderDrops,
} from '../objectRenderNotice'

afterEach(() => { resetObjectRenderDrops() })

describe('⭐ objectRenderNotice — a sentence change is a change, a repeat is not', () => {
  it('no-why → S1 → S2 → S2 → no-why: emits on each sentence change, not on the repeat, and clears at the end', () => {
    let emits = 0
    onObjectRenderDropsChange(() => { emits += 1 })
    const S1 = 'This table is not shown: one.'
    const S2 = 'This table is not shown: two.'
    const step = (why) => { const before = emits; setObjectRenderDrops('i1', 1, 2, 's', { why }); return emits - before }

    expect(step(null)).toBe(1)
    expect(objectRenderDropsFor('i1', 's')).toEqual({ dropped: 1, held: 2 })

    expect(step({ table: S1 })).toBe(1)
    expect(objectRenderDropsFor('i1', 's')).toEqual({ dropped: 1, held: 2, why: { table: S1 } })

    expect(step({ table: S2 })).toBe(1)
    expect(objectRenderDropsFor('i1', 's')).toEqual({ dropped: 1, held: 2, why: { table: S2 } })

    // ⛔ the repeat: equal inputs emit nothing
    expect(step({ table: S2 })).toBe(0)

    expect(step(null)).toBe(1)
    expect(objectRenderDropsFor('i1', 's')).toEqual({ dropped: 1, held: 2 })

    // and it clears
    const before = emits
    setObjectRenderDrops('i1', 0, 0, 's', {})
    expect(emits - before).toBe(1)
    expect(objectRenderDropsFor('i1', 's')).toBe(null)
  })
})
