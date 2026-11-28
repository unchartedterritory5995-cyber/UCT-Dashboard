// The date a member's view is anchored at (chart/viewDate.js): the contract the switch, the warms and the chart share.
import { describe, it, expect } from 'vitest'
import { noteMemberDate, memberViewDate } from './viewDate'

describe('viewDate: the member view anchor', () => {
  it('a set date is read back for that member only, frozen, with the shape the readers use', () => {
    const a = {}, b = {}
    noteMemberDate(a, { rightMs: 1_150_000_000_000, offset: 3, width: 420, tf: 15 })
    const d = memberViewDate(a)
    expect(d).toEqual({ rightMs: 1_150_000_000_000, offset: 3, width: 420, tf: '15' })
    expect(Object.isFrozen(d)).toBe(true)
    expect(memberViewDate(b)).toBe(null)
  })

  it('null clears it (Latest, Reset view, a range button): the view is at the present again', () => {
    const a = {}
    noteMemberDate(a, { rightMs: 1, width: 10, tf: 'D' })
    noteMemberDate(a, null)
    expect(memberViewDate(a)).toBe(null)
  })

  it('an unusable date or a missing member is ignored, never stored', () => {
    const a = {}
    noteMemberDate(a, { rightMs: NaN, width: 10 })
    noteMemberDate(a, { rightMs: 5, width: 0 })
    noteMemberDate(a, 'yesterday')
    expect(memberViewDate(a)).toBe(null)
    expect(() => noteMemberDate(null, { rightMs: 5, width: 10 })).not.toThrow()
    expect(memberViewDate(null)).toBe(null)
    // a missing offset reads as 0, a missing tf as null
    noteMemberDate(a, { rightMs: 5, width: 10 })
    expect(memberViewDate(a)).toEqual({ rightMs: 5, offset: 0, width: 10, tf: null })
  })
})
