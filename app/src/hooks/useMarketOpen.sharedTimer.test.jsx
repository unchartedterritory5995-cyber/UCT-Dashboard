// useMarketOpen: ONE timer for every consumer, on the wall-clock minute boundary (2026-11-27, chart speed; ruling 4c).
// Every chart pane, header clock and session badge mounted its own 60 s setInterval (about 1.5 ms of each chart mount
// on the owner's board), each on the phase of its own mount: after 09:30 one badge could read "open" while another read
// "pre" for up to a minute. Now one timer fires at each minute boundary and every consumer reads the new minute's state
// in the same commit (the session changes only on a minute boundary: 04:00, 09:30, 16:00 or the 13:00 early close, 20:00).
//   T1 (red first) ten consumers start no interval and hold at most one timer between them
//   T2 (red first) consumers mounted at different seconds before 09:30 all flip at 09:30:00.000, in the same commit
//   T3 the 16:00:00 close and the half-day 13:00:00 close flip at the boundary too
//   T4 every consumer still renders once per minute (a clock reading the time in its render keeps ticking)
//   T5 when the last consumer unmounts no timer is left
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, act } from '@testing-library/react'

let useMarketOpen
beforeEach(async () => {
  vi.resetModules()
  useMarketOpen = (await import('./useMarketOpen')).default
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

const et = (iso) => new Date(iso)   // the instants below are written in UTC; ET = UTC-5 in winter

function Consumer({ name, log }) {
  const s = useMarketOpen()
  log.push({ name, at: Date.now(), open: s.isOpen, pre: s.isPremarket, ext: s.isExtended })
  return null
}
const lastOf = (log, name) => [...log].reverse().find((r) => r.name === name)

describe('useMarketOpen: one timer on the minute boundary', () => {
  it('T1 (red first) ten consumers start no interval and hold at most one timer', () => {
    vi.useFakeTimers()
    vi.setSystemTime(et('2026-01-15T15:00:05Z'))   // a regular Thursday, 10:00:05 ET
    const intervals = vi.spyOn(globalThis, 'setInterval')
    const log = []
    render(<>{Array.from({ length: 10 }, (_, i) => <Consumer key={i} name={`c${i}`} log={log} />)}</>)
    expect(intervals, 'a consumer started its own interval').not.toHaveBeenCalled()
    expect(vi.getTimerCount(), 'timers held by ten consumers').toBeLessThanOrEqual(1)
  })

  it('T2 (red first) consumers mounted at different seconds all flip at 09:30:00.000 in one commit', () => {
    vi.useFakeTimers()
    vi.setSystemTime(et('2026-01-15T14:29:10Z'))   // 09:29:10 ET, pre-market
    const log = []
    const a = render(<Consumer name="a" log={log} />)
    act(() => { vi.advanceTimersByTime(30_000) })   // 09:29:40
    const b = render(<Consumer name="b" log={log} />)
    act(() => { vi.advanceTimersByTime(19_999) })   // 09:29:59.999
    expect(lastOf(log, 'a').open || lastOf(log, 'b').open).toBe(false)
    act(() => { vi.advanceTimersByTime(1) })        // 09:30:00.000
    const ra = lastOf(log, 'a')
    const rb = lastOf(log, 'b')
    expect(ra.open, 'the consumer mounted at 09:29:10 still reads pre at 09:30:00').toBe(true)
    expect(rb.open, 'the consumer mounted at 09:29:40 still reads pre at 09:30:00').toBe(true)
    expect(ra.at).toBe(Date.parse('2026-01-15T14:30:00Z'))
    expect(rb.at).toBe(ra.at)
    a.unmount(); b.unmount()
  })

  it('T3 the 16:00:00 close and the half-day 13:00:00 close flip at the boundary', () => {
    vi.useFakeTimers()
    const log = []
    vi.setSystemTime(et('2026-01-15T20:59:20Z'))   // 15:59:20 ET, a regular day
    const r = render(<Consumer name="close" log={log} />)
    act(() => { vi.advanceTimersByTime(39_999) })
    expect(lastOf(log, 'close').open).toBe(true)
    act(() => { vi.advanceTimersByTime(1) })        // 16:00:00
    expect(lastOf(log, 'close')).toMatchObject({ open: false, ext: true })
    r.unmount()
    vi.setSystemTime(et('2026-11-27T17:59:20Z'))   // 12:59:20 ET on the day after Thanksgiving (13:00 close)
    const h = render(<Consumer name="half" log={log} />)
    act(() => { vi.advanceTimersByTime(39_999) })
    expect(lastOf(log, 'half').open).toBe(true)
    act(() => { vi.advanceTimersByTime(1) })        // 13:00:00
    expect(lastOf(log, 'half')).toMatchObject({ open: false, ext: true })
    h.unmount()
  })

  it('T4 every consumer still renders once per minute', () => {
    vi.useFakeTimers()
    vi.setSystemTime(et('2026-01-15T15:00:05Z'))
    const log = []
    const r = render(<><Consumer name="x" log={log} /><Consumer name="y" log={log} /></>)
    const n0 = log.filter((e) => e.name === 'x').length
    // one act per minute: updates inside one act are batched into one render
    for (let m = 0; m < 3; m++) act(() => { vi.advanceTimersByTime(60_000) })
    expect(log.filter((e) => e.name === 'x').length - n0, 'renders of one consumer over three minutes').toBe(3)
    expect(log.filter((e) => e.name === 'y').length - n0).toBe(3)
    r.unmount()
  })

  it('T5 when the last consumer unmounts no timer is left', () => {
    vi.useFakeTimers()
    vi.setSystemTime(et('2026-01-15T15:00:05Z'))
    const log = []
    const r1 = render(<Consumer name="p" log={log} />)
    const r2 = render(<Consumer name="q" log={log} />)
    r1.unmount()
    expect(vi.getTimerCount()).toBe(1)
    r2.unmount()
    expect(vi.getTimerCount(), 'a timer outlived every consumer').toBe(0)
  })
})
