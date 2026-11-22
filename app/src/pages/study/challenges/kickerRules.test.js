/** Spot the Kicker rails: the owner's three rules measured from bars, and the look-alikes found by the same rules. */
import { describe, it, expect } from 'vitest'
import { candidates, findTraps, rules } from './kickerRules'

const bar = (t, o, h, l, c) => ({ t, o, h, l, c, v: 100 })
// day 0..1 quiet, day 2 a REAL red day (down 2%, weak close), day 3 a Kicker: gaps over day 2's close, closes above its high
const kicker = [
  bar('2025-03-01', 10, 10.2, 9.9, 10), bar('2025-03-02', 10, 10.1, 9.9, 10),
  bar('2025-03-03', 10, 10.05, 9.7, 9.8), bar('2025-03-04', 9.95, 10.6, 9.9, 10.5),
]

describe('kicker rules', () => {
  it('ticks all three rules on a real Kicker and prints the measured values', () => {
    const rs = rules(kicker, 3)
    expect(rs.map((r) => r.k)).toEqual(['red', 'gap', 'close'])
    expect(rs.every((r) => r.ok)).toBe(true)
    expect(rs[0].value).toMatch(/-2\.0%/)
    expect(rs[1].value).toBe('open 9.95 vs close 9.80')
  })

  it('crosses the red-day rule on a baby red (too small) and the close rule on a weak close', () => {
    const baby = [...kicker]; baby[2] = bar('2025-03-03', 10, 10.05, 9.9, 9.95)   // down 0.5%
    expect(rules(baby, 3)[0].ok).toBe(false)
    const weak = [...kicker]; weak[3] = bar('2025-03-04', 9.95, 10.3, 9.9, 10.0)  // gapped over the close, finished under the red high
    expect(rules(weak, 3)[2].ok).toBe(false)
  })

  it('findTraps returns at most one baby red and one weak close inside the view, newest first; candidates sorts them with the real one last', () => {
    const bars = [
      ...kicker.slice(0, 2),
      bar('2025-03-03', 10, 10.05, 9.9, 9.95), bar('2025-03-04', 9.97, 10.6, 9.9, 10.5),     // baby red + strong close
      bar('2025-03-05', 10.5, 10.6, 10.3, 10.4), bar('2025-03-06', 10.4, 10.5, 10.0, 10.1),   // a real red day
      bar('2025-03-07', 10.15, 10.3, 10.1, 10.2),                                               // weak close
      bar('2025-03-08', 10.2, 10.3, 10.1, 10.2), bar('2025-03-09', 10.2, 10.25, 9.9, 9.95),     // a real red day
      bar('2025-03-10', 10.0, 10.7, 9.95, 10.6),                                                // the Kicker
    ]
    const traps = findTraps(bars, bars.length, 60)
    expect(traps.map((x) => x.kind)).toEqual(['weak', 'baby'])
    const cs = candidates(bars, 60)
    expect(cs.map((x) => x.kind)).toEqual(['baby', 'weak', 'real'])
    expect(cs[2].i).toBe(bars.length - 1)
  })

  it('needs three bars; two candidates at least are the challenge\'s own filter, not this helper\'s', () => {
    expect(candidates(kicker.slice(0, 2), 60)).toEqual([])
    expect(candidates(kicker, 60).map((x) => x.kind)).toEqual(['real'])
  })
})
