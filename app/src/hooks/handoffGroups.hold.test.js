// @vitest-environment node
// P4-M1 (review of #2558): A MEMBER ASKS, AT THE MOMENT OF SHOWING, WHETHER IT STILL CAN (groupReady's `holds`). The switch
// decides on a device copy and shows the chart later; a bucket ending in between makes the chart refuse that copy. So a
// member hands the round a `holds()` with its `show`, and the round asks it right before it shows anyone:
//   H1 a ready member that holds when the round would show: NOBODY shows (every chart of a group in one frame, or none);
//      when it is ready again the round shows them all in one pass
//   H2 a member with no group that holds is not shown; it shows when it calls again and no longer holds
//   H3 a round past its bound (GROUP_HANG_MS, a member that never got ready): the ready members show, except one that holds
//   H4 a holds() that throws never blocks anybody (read as "does not hold")
//   H5 no holds() at all (every member with the device store off): exactly as before
//   H6 a round that held keeps its bound: a holding member that never comes back (a defect) does not hold the rest for ever
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { groupJoin, groupReady, GROUP_HANG_MS, __resetHandoffGroupsForTests } from './handoffGroups'

beforeEach(() => { vi.useFakeTimers(); __resetHandoffGroupsForTests() })
afterEach(() => { vi.useRealTimers() })

describe('the round asks every member whether it still can show, right before it shows', () => {
  it('H1 one member holds when the round would show: nobody shows; ready again, all show in one pass', () => {
    groupJoin('g', 'B', 1); groupJoin('g', 'B', 2)
    const shown = []
    let refused = true
    groupReady('g', 'B', 1, () => shown.push(1), '1', () => refused)
    groupReady('g', 'B', 2, () => shown.push(2), '15', () => false)
    expect(shown).toEqual([])
    refused = false                                                   // its answer landed: it calls again
    groupReady('g', 'B', 1, () => shown.push(1), '1', () => refused)
    expect(shown.sort()).toEqual([1, 2])
  })

  it('H2 no group: a member that holds is not shown; it shows when it calls again and no longer holds', () => {
    const shown = []
    groupReady(null, 'B', 1, () => shown.push(1), '1', () => true)
    expect(shown).toEqual([])
    groupReady(null, 'B', 1, () => shown.push(1), '1', () => false)
    expect(shown).toEqual([1])
  })

  it('H3 past the round\'s bound the ready members show, except one that holds', () => {
    groupJoin('g', 'B', 1); groupJoin('g', 'B', 2); groupJoin('g', 'B', 3)
    const shown = []
    groupReady('g', 'B', 1, () => shown.push(1), '1', () => false)
    groupReady('g', 'B', 2, () => shown.push(2), '5', () => true)
    vi.advanceTimersByTime(GROUP_HANG_MS + 1)                          // member 3 never got ready
    expect(shown).toEqual([1])
  })

  it('H4 a holds() that throws never blocks anybody', () => {
    groupJoin('g', 'B', 1); groupJoin('g', 'B', 2)
    const shown = []
    groupReady('g', 'B', 1, () => shown.push(1), '1', () => { throw new Error('x') })
    groupReady('g', 'B', 2, () => shown.push(2), '15', () => false)
    expect(shown.sort()).toEqual([1, 2])
  })

  it('H5 no holds() at all: exactly as before', () => {
    groupJoin('g', 'B', 1); groupJoin('g', 'B', 2)
    const shown = []
    groupReady('g', 'B', 1, () => shown.push(1), '1')
    expect(shown).toEqual([])
    groupReady('g', 'B', 2, () => shown.push(2), '15', null)
    expect(shown.sort()).toEqual([1, 2])
    groupReady(null, 'C', 3, () => shown.push(3), 'D')
    expect(shown).toContain(3)
  })

  it('H6 a round that held keeps its bound: a holding member that never comes back does not hold the rest for ever', () => {
    groupJoin('g', 'B', 1); groupJoin('g', 'B', 2)
    const shown = []
    groupReady('g', 'B', 1, () => shown.push(1), '1', () => true)
    groupReady('g', 'B', 2, () => shown.push(2), '15', () => false)
    expect(shown).toEqual([])
    vi.advanceTimersByTime(GROUP_HANG_MS + 1)
    expect(shown).toEqual([2])
  })
})
