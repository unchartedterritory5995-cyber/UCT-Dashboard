// The one-time heal of compounded view locks (viewLockHeal.js). Every lock below was MEASURED on
// production, 2026-11-21 (fred_rs_axis_probe.py over PEB / KSS on /charts): what `_measureViewLock`
// stored after each price-axis drag, Fred RS off and on, before and after #2346.
import { describe, it, expect, beforeEach } from 'vitest'
import {
  viewLockIsCompounded, healedViewLock, healViewLocksOnce, _resetViewLockHealForTests,
  VIEW_LOCK_KEY, VIEW_LOCK_KEY_PREFIX, VIEW_LOCK_HEAL_FLAG,
} from '../viewLockHeal'

// [label, top, bottom] — nine axis drags that did NOT compound (15–25% of the pane each)
const NORMAL = [
  ['Fred off, before #2346: compress (PEB)', 0.2413, 0.2275],
  ['Fred off, before #2346: expand (KSS)', 0.1914, 0.1849],
  ['Fred off, before #2346: compress again (PEB)', 0.2692, 0.3879],
  ['Fred off, after #2346: compress (PEB)', 0.2413, 0.2229],
  ['Fred off, after #2346: expand (KSS)', 0.1909, 0.1742],
  ['Fred off, after #2346: compress again (PEB)', 0.2701, 0.255],
  ['Fred on, after #2346: compress (PEB)', 0.2415, 0.2234],
  ['Fred on, after #2346: expand (KSS)', 0.1918, 0.1755],
  ['Fred on, after #2346: compress again (PEB)', 0.2705, 0.256],
]
// Fred RS on, before #2346: the same three gestures, compounding
const ROUND1 = { top: 0.2415, bottom: 0.3859 }   // band 0.373, ratio 1.60: indistinguishable from a normal drag
const ROUND2 = { top: 0.2069, bottom: 0.5102 }   // band 0.283, ratio 2.47
const ROUND3_KSS = { top: 0.2419, bottom: 0.655 } // band 0.103, ratio 2.71: KSS's candles were 6.5% of the pane
const H = { anchorFrac: 1.40969, width: 616.0098, tf: 'D' }

/** A Storage stand-in with the real interface (length / key / getItem / setItem / removeItem). */
const memoryStorage = (init = {}) => {
  const m = new Map(Object.entries(init))
  return {
    get length() { return m.size },
    key: (i) => [...m.keys()][i] ?? null,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)) },
    removeItem: (k) => { m.delete(k) },
    dump: () => Object.fromEntries(m),
  }
}
const lockJSON = (v) => JSON.stringify({ ...H, ...v, hLocked: true, vLocked: true })

beforeEach(() => { _resetViewLockHealForTests() })

describe('viewLockIsCompounded — the measured locks', () => {
  it.each(NORMAL)('spares a normal drag: %s', (_l, top, bottom) => {
    expect(viewLockIsCompounded({ top, bottom })).toBe(false)
  })
  it('spares round 1 (band 0.373, ratio 1.60): mild, and inside what a normal drag produces', () => {
    expect(viewLockIsCompounded(ROUND1)).toBe(false)
  })
  it('heals round 2 (band 0.283, ratio 2.47)', () => { expect(viewLockIsCompounded(ROUND2)).toBe(true) })
  it('heals round 3, the KSS state (band 0.103, ratio 2.71)', () => { expect(viewLockIsCompounded(ROUND3_KSS)).toBe(true) })
  it('heals the clamp poison of the frame-mix defect, either side, and the 0.95 ceiling', () => {
    expect(viewLockIsCompounded({ top: 0.9, bottom: 0.02 })).toBe(true)
    expect(viewLockIsCompounded({ top: 0.02, bottom: 0.9 })).toBe(true)
    expect(viewLockIsCompounded({ top: 0.89, bottom: 0 })).toBe(true)
    expect(viewLockIsCompounded({ top: 0.475, bottom: 0.475 })).toBe(true)   // sum 0.95, symmetric
  })
  it('spares a deliberate SYMMETRIC hard compress (small band, ratio < 2)', () => {
    expect(viewLockIsCompounded({ top: 0.4, bottom: 0.42 })).toBe(false)     // band 0.18
  })
  it('spares an asymmetric but WIDE band (a pinned scale panned off-centre: ratio 3.5, band 0.55)', () => {
    expect(viewLockIsCompounded({ top: 0.1, bottom: 0.35 })).toBe(false)
  })
  it('a lock with no vertical half is never compounded', () => {
    expect(viewLockIsCompounded({ ...H, top: null, bottom: null })).toBe(false)
    expect(viewLockIsCompounded(null)).toBe(false)
    expect(viewLockIsCompounded({ top: 0.2, bottom: 'x' })).toBe(false)
  })
})

describe('healedViewLock — only the vertical half goes', () => {
  it('keeps anchorFrac / width / tf and nulls top / bottom', () => {
    const out = healedViewLock({ ...H, ...ROUND3_KSS, hLocked: true, vLocked: true })
    expect(out).toMatchObject({ anchorFrac: H.anchorFrac, width: H.width, tf: 'D', top: null, bottom: null, vLocked: false, hLocked: true })
  })
  it('returns null (remove the key) when no horizontal half is left', () => {
    expect(healedViewLock({ ...ROUND3_KSS })).toBeNull()
    expect(healedViewLock({ anchorFrac: 1, width: 0, ...ROUND3_KSS })).toBeNull()
  })
})

describe('healViewLocksOnce — the sweep, once per device', () => {
  const seeded = () => memoryStorage({
    [VIEW_LOCK_KEY]: lockJSON(ROUND2),                                  // the bare key
    [`${VIEW_LOCK_KEY_PREFIX}c1`]: lockJSON(ROUND3_KSS),                // compounded, horizontal kept
    [`${VIEW_LOCK_KEY_PREFIX}c2`]: JSON.stringify({ ...ROUND3_KSS }),   // compounded, nothing left → removed
    [`${VIEW_LOCK_KEY_PREFIX}ok`]: lockJSON({ top: NORMAL[5][1], bottom: NORMAL[5][2] }),
    [`${VIEW_LOCK_KEY_PREFIX}bad`]: '{not json',
    'uct.other.setting': lockJSON(ROUND3_KSS),                          // not a view lock
  })

  it('heals exactly the compounded locks, keeps every other key byte-identical, and counts them in the flag', () => {
    const s = seeded(); const before = s.dump()
    const done = healViewLocksOnce(s, () => '2026-11-21T13:30:00Z')
    expect(done).toEqual({ healed: 3, at: '2026-11-21T13:30:00Z' })
    const after = s.dump()
    expect(JSON.parse(after[VIEW_LOCK_KEY])).toMatchObject({ top: null, bottom: null, anchorFrac: H.anchorFrac, width: H.width, tf: 'D' })
    expect(JSON.parse(after[`${VIEW_LOCK_KEY_PREFIX}c1`])).toMatchObject({ top: null, bottom: null, anchorFrac: H.anchorFrac })
    expect(`${VIEW_LOCK_KEY_PREFIX}c2` in after).toBe(false)
    for (const k of [`${VIEW_LOCK_KEY_PREFIX}ok`, `${VIEW_LOCK_KEY_PREFIX}bad`, 'uct.other.setting']) expect(after[k]).toBe(before[k])
    expect(JSON.parse(after[VIEW_LOCK_HEAL_FLAG])).toEqual({ healed: 3, at: '2026-11-21T13:30:00Z' })
  })

  it('RUNS ONCE: with the flag present a later load touches nothing, even a compounded lock', () => {
    const s = seeded()
    healViewLocksOnce(s, () => 'first')
    _resetViewLockHealForTests()                                        // a new page load
    s.setItem(`${VIEW_LOCK_KEY_PREFIX}late`, lockJSON(ROUND3_KSS))
    expect(healViewLocksOnce(s, () => 'second')).toBeNull()
    expect(JSON.parse(s.getItem(`${VIEW_LOCK_KEY_PREFIX}late`)).bottom).toBe(ROUND3_KSS.bottom)
    expect(JSON.parse(s.getItem(VIEW_LOCK_HEAL_FLAG)).at).toBe('first')
  })

  it('ONE CHECK PER PAGE: a second call on the same page does not even read the flag', () => {
    const s = seeded(); let reads = 0
    const counting = { ...s, get length() { return s.length }, getItem: (k) => { reads += 1; return s.getItem(k) } }
    healViewLocksOnce(counting); const r1 = reads
    expect(healViewLocksOnce(counting)).toBeNull()
    expect(reads).toBe(r1)
  })

  it('a device with nothing compounded still writes the flag (healed: 0), and its flag is not taken for a lock', () => {
    const s = memoryStorage({ [`${VIEW_LOCK_KEY_PREFIX}ok`]: lockJSON({ top: 0.24, bottom: 0.22 }) })
    expect(healViewLocksOnce(s, () => 't')).toEqual({ healed: 0, at: 't' })
    expect(VIEW_LOCK_HEAL_FLAG.startsWith(VIEW_LOCK_KEY_PREFIX)).toBe(false)
  })

  it('never throws when storage does, and leaves no flag (it tries again on the next load)', () => {
    const broken = { get length() { throw new Error('denied') }, key: () => null, getItem: () => null, setItem: () => { throw new Error('x') }, removeItem: () => {} }
    expect(healViewLocksOnce(broken)).toBeNull()
    _resetViewLockHealForTests()
    expect(healViewLocksOnce(null)).toBeNull()
  })
})
