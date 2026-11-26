/**
 * SMOOTHNESS PART 2, ITEM (4): A STORE DATE'S LABEL, BUILT ONCE (2026-11-26).
 *
 * Trace (local dist 4bc325e4ae, D+30 board, 5 traced switches): `adapter.legacySealed` was 5.2 ms a flip in the second
 * after both charts showed the new symbol, a Date and an ISO string per daily bar (`unixToDateLabel`) for every new bars
 * array. A store D/W/M `t` is 00:00 UTC of its date; its label never changes.
 *   L1 unixToDateLabel answers what it did (`new Date(t * 1000).toISOString().slice(0, 10)`, ed7605b405) for every day
 *      1900-2100, for seconds that are not a day's first, fractional seconds, -0, and what cannot be labelled (throws)
 *   L2 a day asked again builds no Date string (red before the change)
 */
import { describe, it, expect, vi } from 'vitest'
import { unixToDateLabel } from './types'

const ref = (t) => new Date(t * 1000).toISOString().slice(0, 10)
const answer = (fn, t) => { try { return fn(t) } catch (e) { return `throws ${e?.constructor?.name}` } }

describe('a store date\'s label, built once', () => {
  it('L1 every day 1900-2100 and odd seconds answer as before, twice', () => {
    const days = []
    for (let t = Date.UTC(1900, 0, 1) / 1000; t <= Date.UTC(2100, 11, 31) / 1000; t += 86400) days.push(t)
    expect(days.length).toBeGreaterThan(73_000)
    const odd = [1, 3600, 86399, 86401, -1, -86400, -86401, 1764028800.5, -0, 0, NaN, Infinity, -Infinity, 8.64e12, 8.64e12 + 86400, '1764028800']
    for (const pass of ['first', 'second']) {
      for (const t of [...days, ...days.slice(0, 500).map((x) => x + 43200), ...odd]) {
        const got = answer(unixToDateLabel, t), want = answer(ref, t)
        if (got !== want) expect([pass, t, got]).toEqual([pass, t, want])
      }
    }
  })

  it('L2 a day asked again builds no Date string', () => {
    const days = []
    for (let t = Date.UTC(1995, 0, 1) / 1000; t < Date.UTC(1999, 0, 1) / 1000; t += 86400) days.push(t)
    days.map(unixToDateLabel)                            // warm (twice: the bounded cache may empty once inside a pass)
    const first = days.map(unixToDateLabel)
    const spy = vi.spyOn(Date.prototype, 'toISOString')
    let n = -1, again
    try {
      again = days.map(unixToDateLabel)
      n = spy.mock.calls.length                          // read BEFORE mockRestore, which resets it
    } finally { spy.mockRestore() }
    expect(again).toEqual(first)
    expect(n).toBe(0)
  })
})
