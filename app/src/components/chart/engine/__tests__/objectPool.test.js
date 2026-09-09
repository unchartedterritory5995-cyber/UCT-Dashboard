// app/src/components/chart/engine/__tests__/objectPool.test.js
//
// ─── R0.2 — THE DRAWING QUOTA, ITS FIFO EVICTION, AND WHAT COUNTS ────────────
//
// ⭐ THE LIMIT TABLE IS PARSED OUT OF THE SPEC, NOT RETYPED HERE. Three numbers
// per kind × four kinds is twelve chances to introduce a second authority over
// one value. §3.1 of `docs/pine/pine-presentation-spec.md` owns the caps and
// `docs/pine/pine-version-evolution.md` owns the version each type arrived in;
// both are read, with a control asserting the parse found all four rows so a
// regex that matched nothing cannot pass as agreement.
//
// ⭐ AND THE BEHAVIOUR CLAIMS ARE RAILED AS SENTENCES. "Silent, oldest-first, no
// runtime error", "four independent pools", and "the limit is approximate" are
// the three statements this module is built on. If the spec is ever corrected,
// this file goes red rather than the code quietly outliving its own premise.

import { describe, it, expect, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import {
  POOL_LIMITS,
  OBJECT_KINDS,
  NOT_FIFO,
  DRAWINGS_SINCE_VERSION,
  POLYLINE_MAX_POINTS,
  resolveCapacity,
  createObjectPool,
  createPoolSet,
} from '../objectPool'

const SRC = path.resolve(__dirname, '../../../..')                 // app/src
const REPO = path.resolve(SRC, '../..')                            // repo root
const SPEC = path.join(REPO, 'docs/pine/pine-presentation-spec.md')
const EVOLUTION = path.join(REPO, 'docs/pine/pine-version-evolution.md')
const MODULE = path.join(SRC, 'components/chart/engine/objectPool.js')

const spec = fs.readFileSync(SPEC, 'utf8')
const evolution = fs.readFileSync(EVOLUTION, 'utf8')

/** §3.1's row for one kind: `| \`line\` | \`max_lines_count\` | **~50** … | **500** …` */
function specRow(kind) {
  const rx = new RegExp(
    `\\|\\s*\`${kind}\`\\s*\\|\\s*\`(max_\\w+)\`\\s*\\|\\s*\\*\\*~?(\\d+)\\*\\*[^|]*\\|\\s*\\*\\*(\\d+)\\*\\*`,
  )
  const m = rx.exec(spec)
  return m ? { param: m[1], fallback: Number(m[2]), ceiling: Number(m[3]) } : null
}

/** The evolution doc's availability row: `| **\`polyline\`** | **v5** | …` */
function firstVersion(kind) {
  const m = new RegExp(`\\|\\s*\\*\\*\`${kind}\`\\*\\*\\s*\\|\\s*\\*\\*v(\\d)\\*\\*`).exec(evolution)
  return m ? Number(m[1]) : null
}

// ─────────────────────────────────────────────────────────────────────────────
describe('the quota table is derived from the docs, not typed in the module', () => {
  it('the spec still carries a §3.1 row for all four pools', () => {
    // ⭐ THE NON-VACUITY CONTROL for every comparison below.
    expect(OBJECT_KINDS).toEqual(['line', 'label', 'box', 'polyline'])
    for (const kind of OBJECT_KINDS) expect(specRow(kind), `§3.1 row for ${kind}`).not.toBeNull()
  })

  it.each(['line', 'label', 'box', 'polyline'])('%s: param, default and ceiling match the spec', (kind) => {
    const row = specRow(kind)
    expect(POOL_LIMITS[kind].param).toBe(row.param)
    expect(POOL_LIMITS[kind].fallback).toBe(row.fallback)
    expect(POOL_LIMITS[kind].ceiling).toBe(row.ceiling)
  })

  it('polyline has a tighter ceiling than the other three', () => {
    // If this ever coincides, the per-kind ceiling is dead weight — say so aloud
    // rather than discover it while debugging a truncated drawing.
    expect(POOL_LIMITS.polyline.ceiling).toBeLessThan(POOL_LIMITS.label.ceiling)
  })

  it('the evolution doc still records when each type arrived', () => {
    for (const kind of OBJECT_KINDS) expect(firstVersion(kind), `version row for ${kind}`).not.toBeNull()
    for (const kind of OBJECT_KINDS) expect(POOL_LIMITS[kind].since).toBe(firstVersion(kind))
    expect(DRAWINGS_SINCE_VERSION).toBe(Math.min(...OBJECT_KINDS.map((k) => POOL_LIMITS[k].since)))
  })

  it('the three behaviour claims this module is built on are still in the spec', () => {
    // C152 — four independent pools
    expect(spec).toMatch(/four \*\*independent\*\* FIFO pools/)
    // C156 — silent, oldest-first, no runtime error
    expect(spec).toMatch(/the \*\*oldest\*\* object is deleted automatically, silently, with \*\*no\s*\n?\s*runtime error\*\*/)
    // §3.2 — the limit is approximate, so it is a floor and not a ceiling, plus
    // the observation that made it concrete (54 labels under the ~50 default).
    expect(spec).toMatch(/is approximate; the script might display more drawings than specified/)
    expect(spec).toMatch(/\*\*54\*\* labels displayed under the ~50 default/)
    expect(spec).toMatch(/must \*\*not\*\* assert `count <= max_\*_count`/)
  })

  it('one polyline is one slot however many points it carries', () => {
    expect(spec).toMatch(/one ID per polyline regardless of point count/)
    expect(POLYLINE_MAX_POINTS).toBe(10000)
  })

  it('the module names its provenance, so the numbers can be re-checked', () => {
    const src = fs.readFileSync(MODULE, 'utf8')
    expect(src).toContain('pine-presentation-spec.md')
    expect(src).toContain('pine-version-evolution.md')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('FIFO eviction', () => {
  it('overflow drops the oldest and keeps the newest', () => {
    const pool = createObjectPool('label', { capacity: 3 })
    const ids = ['a', 'b', 'c', 'd', 'e'].map((p) => pool.add(p))

    expect(pool.size).toBe(3)
    expect(pool.evictedCount).toBe(2)
    expect(pool.values()).toEqual(['c', 'd', 'e'])
    expect(pool.has(ids[0])).toBe(false)
    expect(pool.has(ids[1])).toBe(false)
    expect(pool.has(ids[4])).toBe(true)
  })

  it('index 0 of all() is the next victim, exactly as Pine documents .all', () => {
    const pool = createObjectPool('box', { capacity: 3 })
    'abc'.split('').forEach((p) => pool.add(p))

    const victim = pool.all()[0]
    pool.add('d')
    expect(pool.has(victim)).toBe(false)
    expect(pool.all()[0]).not.toBe(victim)
  })

  it('all() is oldest-first and a copy the caller cannot corrupt', () => {
    const pool = createObjectPool('line', { capacity: 5 })
    const ids = 'abc'.split('').map((p) => pool.add(p))
    expect(pool.all()).toEqual(ids)

    pool.all().reverse().push(999)
    expect(pool.all()).toEqual(ids)
  })

  it('evicts silently — no throw, and the eviction is reported for the demo', () => {
    const onEvict = vi.fn()
    const pool = createObjectPool('label', { capacity: 2, onEvict })

    expect(() => { for (let i = 0; i < 10; i += 1) pool.add(`p${i}`) }).not.toThrow()
    expect(pool.size).toBe(2)
    expect(pool.evictedCount).toBe(8)
    expect(onEvict).toHaveBeenCalledTimes(8)
    expect(onEvict.mock.calls[0]).toEqual([1, 'p0'])   // (id, payload), oldest first
  })

  it('a capacity of 1 keeps exactly the newest object', () => {
    const pool = createObjectPool('label', { capacity: 1 })
    pool.add('old')
    pool.add('new')
    expect(pool.values()).toEqual(['new'])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('what counts toward the quota', () => {
  it('objects that draw nothing still consume a slot', () => {
    // Pine, verbatim: an `x = na` label's *"ID still exists and thus contributes
    // to a script's drawing totals"*; a zero-length line and a zero-area box the
    // same; `box.new(na, na, na, na)` is a documented live-but-invisible idiom.
    const pool = createObjectPool('box', { capacity: 4 })
    pool.add({ left: NaN, right: NaN, top: NaN, bottom: NaN })   // all-na box
    pool.add({ left: 5, right: 5, top: 1, bottom: 1 })           // zero area
    pool.add(null)
    pool.add(undefined)
    expect(pool.size).toBe(4)

    pool.add({ left: 1, right: 2, top: 3, bottom: 4 })
    expect(pool.size).toBe(4)
    expect(pool.evictedCount).toBe(1)
  })

  it('THE CONTROL: the pool never reads a payload, so it cannot mis-judge one', () => {
    // ⭐ A payload that throws the moment anything touches it. This is what makes
    // "counts IDs, not visible objects" a structural property rather than a
    // promise — an implementation that peeked at coordinates to decide whether an
    // object is "empty" would fail here immediately.
    const landmine = new Proxy({}, { get() { throw new Error('the pool read the payload') } })
    const pool = createObjectPool('label', { capacity: 2 })

    expect(() => {
      pool.add(landmine)
      pool.add(landmine)
      pool.add(landmine)      // forces an eviction of a landmine
      pool.all()
      pool.has(1)
      pool.delete(2)
    }).not.toThrow()
    expect(pool.evictedCount).toBe(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('copy() is a new object in a new slot', () => {
  it('allocates a fresh id and charges a slot', () => {
    const pool = createObjectPool('box', { capacity: 5 })
    const a = pool.add({ text: 'original' })
    const b = pool.copy(a)

    expect(b).not.toBe(a)
    expect(pool.size).toBe(2)
  })

  it('the copy is independent of the original', () => {
    // *"Any changes to the copied box do not affect the original."*
    const pool = createObjectPool('box', { capacity: 5 })
    const a = pool.add({ text: 'original' })
    const b = pool.copy(a)

    pool.get(b).text = 'changed'
    expect(pool.get(a).text).toBe('original')
  })

  it('copying at capacity evicts the oldest, like any other allocation', () => {
    const pool = createObjectPool('label', { capacity: 2 })
    const a = pool.add('a')
    pool.add('b')
    pool.copy(a)

    expect(pool.size).toBe(2)
    expect(pool.has(a)).toBe(false)
    expect(pool.values()).toEqual(['b', 'a'])
  })

  it('copying a dead id costs nothing and returns null', () => {
    const pool = createObjectPool('line', { capacity: 5 })
    const a = pool.add('a')
    pool.delete(a)

    expect(pool.copy(a)).toBeNull()
    expect(pool.copy(9999)).toBeNull()
    expect(pool.size).toBe(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('delete() frees the slot and is idempotent', () => {
  it('a freed slot means the next add does not evict', () => {
    const pool = createObjectPool('label', { capacity: 2 })
    const a = pool.add('a')
    pool.add('b')

    expect(pool.delete(a)).toBe(true)
    pool.add('c')
    expect(pool.evictedCount).toBe(0)
    expect(pool.values()).toEqual(['b', 'c'])
  })

  it('a second delete does nothing and raises nothing', () => {
    // *"If it has already been deleted, does nothing"* — no error on double-delete.
    const pool = createObjectPool('line', { capacity: 5 })
    const a = pool.add('a')

    expect(pool.delete(a)).toBe(true)
    expect(pool.delete(a)).toBe(false)
    expect(() => pool.delete(a)).not.toThrow()
    expect(pool.delete(123456)).toBe(false)
  })

  it('an explicit delete notifies dependents but is not counted as an eviction', () => {
    // The linefill layer cascades off onEvict; the eviction COUNT is a fidelity
    // metric about the quota, and a deliberate delete is not a quota event.
    const onEvict = vi.fn()
    const pool = createObjectPool('line', { capacity: 5, onEvict })
    const a = pool.add('a')
    pool.delete(a)

    expect(onEvict).toHaveBeenCalledWith(a, 'a')
    expect(pool.evictedCount).toBe(0)
  })

  it('never reuses an id', () => {
    // ⛔ A recycled id lets a stale handle resurrect a deleted object as whatever
    // now occupies its slot.
    const pool = createObjectPool('label', { capacity: 2 })
    const a = pool.add('a')
    pool.delete(a)
    const b = pool.add('b')

    expect(b).not.toBe(a)
    expect(pool.has(a)).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('the four pools are independent (C152)', () => {
  it('overflowing one kind never evicts from another', () => {
    const pools = createPoolSet({ max_labels_count: 2, max_lines_count: 2 })
    const line = pools.line.add('the only line')
    for (let i = 0; i < 50; i += 1) pools.label.add(`label ${i}`)

    expect(pools.label.evictedCount).toBe(48)
    expect(pools.line.evictedCount).toBe(0)
    expect(pools.line.has(line)).toBe(true)
  })

  it('two instances of the same kind do not share a budget', () => {
    const a = createObjectPool('label', { capacity: 2 })
    const b = createObjectPool('label', { capacity: 2 })
    a.add('a1'); a.add('a2'); a.add('a3')

    expect(a.evictedCount).toBe(1)
    expect(b.size).toBe(0)
    expect(b.evictedCount).toBe(0)
  })

  it('createPoolSet sizes each pool from its own Pine parameter name', () => {
    const pools = createPoolSet({ max_labels_count: 200, max_polylines_count: 7 })
    expect(pools.label.capacity).toBe(200)
    expect(pools.polyline.capacity).toBe(7)
    expect(pools.line.capacity).toBe(POOL_LIMITS.line.fallback)
    expect(pools.box.capacity).toBe(POOL_LIMITS.box.fallback)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('resolveCapacity', () => {
  it('falls back to the documented default when the script asks for nothing', () => {
    for (const kind of OBJECT_KINDS) {
      const r = resolveCapacity(kind, undefined)
      expect(r.capacity).toBe(POOL_LIMITS[kind].fallback)
      expect(r.clamped).toBe(false)
      expect(r.param).toBe(POOL_LIMITS[kind].param)
    }
    expect(resolveCapacity('label', null).capacity).toBe(POOL_LIMITS.label.fallback)
  })

  it('clamps above the ceiling and says it clamped', () => {
    expect(resolveCapacity('label', 600)).toMatchObject({ capacity: 500, clamped: true })
    expect(resolveCapacity('polyline', 200)).toMatchObject({ capacity: 100, clamped: true })
    // At the ceiling exactly, nothing was clamped.
    expect(resolveCapacity('label', 500)).toMatchObject({ capacity: 500, clamped: false })
  })

  it('clamps below 1 and says it clamped', () => {
    // Pine states "Possible values: 1-500", so 0 is not a request for nothing.
    expect(resolveCapacity('box', 0)).toMatchObject({ capacity: 1, clamped: true })
    expect(resolveCapacity('box', -5)).toMatchObject({ capacity: 1, clamped: true })
  })

  it('truncates a float and falls back on a non-number', () => {
    expect(resolveCapacity('line', 12.9)).toMatchObject({ capacity: 12, clamped: true })
    expect(resolveCapacity('line', 'many')).toMatchObject({
      capacity: POOL_LIMITS.line.fallback, clamped: true,
    })
  })

  it('a clamp is visible on the pool it produced', () => {
    expect(createObjectPool('polyline', { capacity: 500 }).capacityClamped).toBe(true)
    expect(createObjectPool('polyline', { capacity: 50 }).capacityClamped).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('version gating', () => {
  it('refuses a polyline pool for a script that predates polylines', () => {
    expect(() => createObjectPool('polyline', { pineVersion: 4 })).toThrow(/polyline.*v4.*v5/)
    expect(() => createObjectPool('polyline', { pineVersion: 5 })).not.toThrow()
  })

  it('refuses every drawing pool below v4, naming why', () => {
    for (const kind of OBJECT_KINDS) {
      expect(() => createObjectPool(kind, { pineVersion: 3 }))
        .toThrow(/no drawing objects at all/)
    }
  })

  it('omits a kind the version cannot have, rather than handing back an empty pool', () => {
    // ⛔ An empty polyline pool would accept polylines and draw them onto a chart
    // no v4 script could have produced. `undefined` fails at the call site.
    const v4 = createPoolSet({}, { pineVersion: 4 })
    expect(Object.keys(v4).sort()).toEqual(['box', 'label', 'line'])
    expect(v4.polyline).toBeUndefined()

    const v6 = createPoolSet({}, { pineVersion: 6 })
    expect(Object.keys(v6).sort()).toEqual(['box', 'label', 'line', 'polyline'])
  })

  it('refuses tables and linefills by name, with the reason', () => {
    // Neither is FIFO-budgeted; pooling them would evict what Pine keeps.
    expect(() => createObjectPool('table')).toThrow(/position\.\* anchor/)
    expect(() => createObjectPool('linefill')).toThrow(/tied to its two lines/)
    expect(Object.keys(NOT_FIFO).sort()).toEqual(['linefill', 'table'])
  })

  it('names an unknown kind', () => {
    expect(() => createObjectPool('sparkline')).toThrow(/sparkline/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('slack — the knob for TradingView\'s approximate enforcement', () => {
  it('defaults to zero, so we evict at exactly capacity', () => {
    // ⚠️ Deliberate, documented divergence: TradingView showed 54 labels under
    // the ~50 default. We show 50. Missing the oldest beats inventing drawings.
    const pool = createObjectPool('label', { capacity: 3 })
    'abcde'.split('').forEach((p) => pool.add(p))
    expect(pool.size).toBe(3)
    expect(pool.retain).toBe(3)
  })

  it('retains capacity + slack when a measurement is eventually supplied', () => {
    const pool = createObjectPool('label', { capacity: 3, slack: 4 })
    'abcdefg'.split('').forEach((p) => pool.add(p))

    expect(pool.retain).toBe(7)
    expect(pool.size).toBe(7)
    expect(pool.evictedCount).toBe(0)
    // ⭐ THE CONTROL: the same fixture at slack 0 does evict, so the assertion
    // above is not passing because seven items fit in three slots.
    const tight = createObjectPool('label', { capacity: 3 })
    'abcdefg'.split('').forEach((p) => tight.add(p))
    expect(tight.evictedCount).toBe(4)
  })

  it('capacity stays the reported retention floor even with slack', () => {
    const pool = createObjectPool('label', { capacity: 3, slack: 4 })
    expect(pool.capacity).toBe(3)
    expect(pool.retain).toBe(7)
  })

  it('ignores a nonsensical slack instead of shrinking the pool', () => {
    expect(createObjectPool('label', { capacity: 3, slack: -9 }).retain).toBe(3)
    expect(createObjectPool('label', { capacity: 3, slack: 'lots' }).retain).toBe(3)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('teardown', () => {
  it('clear() drops everything without firing the dependent cascade', () => {
    // Pine has no bulk delete — clear() is for tearing an instance down, and a
    // cascade there would fire linefill deletions for a chart that is going away.
    const onEvict = vi.fn()
    const pool = createObjectPool('line', { capacity: 5, onEvict })
    'abc'.split('').forEach((p) => pool.add(p))

    pool.clear()
    expect(pool.size).toBe(0)
    expect(onEvict).not.toHaveBeenCalled()
  })
})
