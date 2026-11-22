// basisVerdict over a SORTED held array searches it instead of copying it whole into a Map (switch profile
// 2026-11-20: ~4 ms of a two-chart list flip, `applyLocal -> heldBasisProof`, a Map entry and an array per
// held row for at most 64 lookups). The rule this file holds: the answer is the Map's in every case.
import { describe, it, expect } from 'vitest'
import { basisVerdict } from './reducer'

const DAY = 86400
const row = (t, c, v = 1000) => ({ t, o: c * 0.99, h: c * 1.01, l: c * 0.98, c, v })
const series = (n, t0 = 1_700_000_000, f = (i) => 100 + (i % 17)) => Array.from({ length: n }, (_, i) => row(t0 + i * DAY, f(i)))
const asMap = (rows) => new Map(rows.map((r) => [r.t, r]))
const rescale = (rows, r) => rows.map((x) => ({ ...x, o: x.o * r, h: x.h * r, l: x.l * r, c: x.c * r, v: x.v / r }))

// held: what the store holds (ascending); local: the copy being judged
const held = series(3000)
const CASES = {
  'same: the copy is the newest 400 held rows': [held.slice(-400), held],
  'changed: the copy is on another basis (a 2:1 split)': [rescale(held.slice(-400), 2), held],
  'unknown: no row in common': [series(300, 1_500_000_000), held],
  'unknown: only rows that differ non-uniformly': [held.slice(-10).map((x) => ({ ...x, c: x.c * 1.3 })), held],
  'same: the overlap starts deep inside the copy': [series(3500, 1_700_000_000 - 500 * DAY), held],
  'changed: more than 64 pairs, rescaled': [rescale(held.slice(100, 400), 0.5), held],
  'same: one held row (a developing bar)': [held.slice(-3), [held[held.length - 1]]],
  'unknown: an empty held array': [held.slice(-3), []],
}

describe('basisVerdict searches a sorted held array', () => {
  for (const [name, [local, ref]] of Object.entries(CASES)) {
    it(`${name}: the same verdict as the Map`, () => {
      expect(basisVerdict(local, ref)).toBe(basisVerdict(local, asMap(ref)))
    })
  }

  it('the verdicts above are the expected ones (the equality is not two equal wrong answers)', () => {
    expect(basisVerdict(...CASES['same: the copy is the newest 400 held rows'])).toBe('same')
    expect(basisVerdict(...CASES['changed: the copy is on another basis (a 2:1 split)'])).toBe('changed')
    expect(basisVerdict(...CASES['unknown: no row in common'])).toBe('unknown')
  })

  it('finds EVERY held row: a copy sharing exactly one row (or two, rescaled) at each position of the held array', () => {
    const h = series(257)                                                     // odd length: both halves of the search
    for (let p = 0; p < h.length; p++) {
      expect(basisVerdict([h[p]], h)).toBe('same')
      if (p + 1 < h.length) expect(basisVerdict(rescale([h[p], h[p + 1]], 3), h)).toBe('changed')
    }
  })

  it('a sorted held array is never copied: nothing reads its .map (or iterates it)', () => {
    const touched = new Set()
    const trap = new Proxy(held, { get(target, key, recv) { if (typeof key === 'string' && !/^\d+$/.test(key)) touched.add(key); return Reflect.get(target, key, recv) } })
    expect(basisVerdict(held.slice(-400), trap)).toBe('same')
    expect(touched.has('map')).toBe(false)
  })

  it('an UNSORTED, duplicated or non-numeric held array keeps the Map (and its answer)', () => {
    const shuffled = [...held].reverse()                                      // descending
    const dup = [...held.slice(0, 50), held[10], ...held.slice(50)]            // t repeats: the Map keeps the later row
    const dupDiffer = [...held]; dupDiffer.splice(2999, 0, { ...held[2999], c: held[2999].c * 2, o: held[2999].o * 2, h: held[2999].h * 2, l: held[2999].l * 2 })
    const strT = held.map((x) => ({ ...x, t: String(x.t) }))
    for (const ref of [shuffled, dup, dupDiffer, strT]) {
      for (const local of [held.slice(-400), rescale(held.slice(-400), 2), held.slice(0, 80)]) {
        expect(basisVerdict(local, ref)).toBe(basisVerdict(local, asMap(ref)))
      }
    }
    // the reversed array is a real test of the fallback: a binary search over it finds nothing
    expect(basisVerdict(held.slice(-400), shuffled)).toBe('same')
  })
})
