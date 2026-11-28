// The date warmed digit by digit (zero-network plan PR 1.2, 2026-11-28): chart/dateWarm.js over a stub store facade.
import { describe, it, expect, vi } from 'vitest'
import { createDateWarm, DATE_WARM_NEIGHBORS } from './dateWarm'
import { parseDate } from './dateText'
import { viewKeyFor } from '../../data/barStore/prefetch'
import { viewWindowOfDate } from './viewWindow'

const NOW = Date.UTC(2026, 10, 27, 17)   // Fri 2026-11-27, midday ET
function rig({ touch = false } = {}) {
  const calls = []
  const store = { primeLake: vi.fn((key, o) => calls.push({ key, signal: o?.signal })) }
  const dw = createDateWarm({ store: () => store, enabled: true, touch: () => touch, now: () => NOW })
  return { dw, calls, store }
}
const ms = (iso) => Date.parse(`${iso}T00:00:00Z`)
const ctx = { sym: 'AAA', neighbors: ['BBB', 'CCC', 'DDD'], tfs: ['5', '15', 'D'], showExtended: false }

describe('createDateWarm', () => {
  it('a whole date primes the window keys of the front symbol and its next row each side, on every intraday tf', () => {
    const { dw, calls } = rig()
    const keys = dw.draft(ms('2006-03-14'), ctx)
    const want = []
    for (const tf of ['5', '15']) for (const s of ['AAA', 'BBB', 'CCC']) want.push(viewKeyFor(s, tf, { showExtended: false, window: viewWindowOfDate('2006-03-14', tf) }))
    expect(DATE_WARM_NEIGHBORS).toBe(2)
    expect(keys).toEqual(want)
    expect(calls.map((c) => c.key)).toEqual(want)
    expect(keys.every((k) => k.includes('@to='))).toBe(true)
    expect(calls.every((c) => c.signal && !c.signal.aborted)).toBe(true)
  })

  it('a newer text aborts the older; the same date again keeps it and asks nothing', () => {
    const { dw, calls } = rig()
    dw.draft(ms('2006-03-14'), ctx)
    const first = calls.slice()
    expect(dw.draft(ms('2006-03-14'), ctx)).toEqual([])
    expect(first.every((c) => !c.signal.aborted)).toBe(true)
    dw.draft(ms('2006-03-15'), ctx)
    expect(first.every((c) => c.signal.aborted), 'the older date given up').toBe(true)
    expect(calls.slice(first.length).every((c) => !c.signal.aborted)).toBe(true)
    dw.draft(null, ctx)   // the text is no date any more
    expect(calls.every((c) => c.signal.aborted)).toBe(true)
  })

  it('nothing on the touch tier, at or past the present, on D/W/M only, or with no symbol', () => {
    expect(rig({ touch: true }).dw.draft(ms('2006-03-14'), ctx)).toEqual([])
    const { dw, store } = rig()
    expect(dw.draft(ms('2026-11-27'), ctx)).toEqual([])
    expect(dw.draft(ms('2027-01-04'), ctx)).toEqual([])
    expect(dw.draft(ms('2006-03-14'), { ...ctx, tfs: ['D', 'W'] })).toEqual([])
    expect(dw.draft(ms('2006-03-14'), { ...ctx, sym: '' })).toEqual([])
    expect(store.primeLake).not.toHaveBeenCalled()
  })
})

describe('parseDate (the one parser: Enter and the warm agree)', () => {
  it('a draft is a date once its year is 2 or 4 digits; it is the date Enter parses', () => {
    expect(parseDate('3/14/2006', { whole: true })).toBe(ms('2006-03-14'))
    expect(parseDate('3/14/06', { whole: true }), 'Enter goes to 2006: the warm warms it').toBe(ms('2006-03-14'))
    for (const t of ['', '3', '3/1', '3/14/', '3/14/2', '3/14/200', '13/1/2006']) expect(parseDate(t, { whole: true }), t).toBe(null)
    for (const t of ['3/14/06', '3/14/2006', '12/1/2016', '2/30/2006']) expect(parseDate(t, { whole: true }), t).toBe(parseDate(t))
  })
})
