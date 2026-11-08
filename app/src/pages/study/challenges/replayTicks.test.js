// The replay within the day (2026-11-08): the forward days grow through their real 30-minute closes, slowly on the key
// days, and each day ends as the daily candle the chart draws.
import { describe, expect, it, vi, afterEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { alignTicks, closeClock, developing, dueCheck, fetchIntraday, keyDays, replayChecks } from './replayTicks'
import { useRunOnTicks } from '../../../lab/fx'

// 2024-06-03 9:30 New York (EDT, UTC-4) = 13:30 UTC
const OPEN = Date.UTC(2024, 5, 3, 13, 30) / 1000
const DAY = { t: '2024-06-03', o: 20, h: 22, l: 19, c: 21, v: 13000 }
const TICKS = [
  [OPEN, 20, 20.6, 19.9, 20.5, 1000],
  [OPEN + 1800, 20.5, 20.7, 19, 20.4, 3000],
  [OPEN + 3600, 20.4, 22, 20.3, 21.8, 4000],
  [OPEN + 5400, 21.8, 21.9, 20.9, 21, 2000],
]

describe('the replay within the day', () => {
  afterEach(() => { vi.useRealTimers() })

  it('lines the stored days up with the forward bars by date; a day with none lands whole', () => {
    const fwd = [DAY, { ...DAY, t: '2024-06-04' }]
    const out = alignTicks(fwd, { tf: 30, days: { 20240603: TICKS } })
    expect(out).toHaveLength(2)
    expect(out[0]).toHaveLength(4)
    expect(out[0][0]).toEqual({ t: OPEN, o: 20, h: 20.6, l: 19.9, c: 20.5, v: 1000 })
    expect(out[1]).toBe(null)
    expect(alignTicks(fwd, { days: {} })).toBe(null)
    expect(alignTicks(fwd, null)).toBe(null)
  })

  it('builds the day as it grew and ends on the daily candle itself', () => {
    const ticks = alignTicks([DAY], { days: { 20240603: TICKS } })[0]
    const first = developing(DAY, ticks, 0)
    expect(first).toEqual({ t: '2024-06-03', o: 20, h: 20.6, l: 19.9, c: 20.5, v: 1300 })
    const third = developing(DAY, ticks, 2)
    expect(third.h).toBe(22)
    expect(third.l).toBe(19)
    expect(third.c).toBe(21.8)
    expect(third.v).toBe(Math.round(13000 * 8000 / 10000))
    expect(developing(DAY, ticks, 3)).toBe(DAY)
  })

  it('plays the first two sessions, the targets, the stop and the best price slowly', () => {
    expect([...keyDays({ t1At: 4, t2At: 9, stoppedSession: null, bestSessions: 12 })].sort((a, b) => a - b)).toEqual([1, 2, 4, 9, 12])
    expect([...keyDays(null, { offset: 7 })].sort((a, b) => a - b)).toEqual([1, 2, 7])
  })

  it('reads the close of each bar in New York time: where the next bar starts, never past 4:00 PM', () => {
    expect(closeClock(OPEN, 30)).toBe('10:00 AM')
    expect(closeClock(OPEN + 3 * 3600, 30)).toBe('1:00 PM')
    expect(closeClock(OPEN + 6 * 3600, 60)).toBe('4:00 PM')
    // the hourly bars open with a half hour (9:30 to 10:00): the next bar's start is the close
    expect(closeClock(OPEN, 60, OPEN + 1800)).toBe('10:00 AM')
    expect(closeClock(OPEN + 1800, 60, OPEN + 1800 + 3600)).toBe('11:00 AM')
    expect(closeClock(NaN)).toBe('')
  })

  it('asks for the stored days with the attempt and falls back quietly', async () => {
    const fetcher = vi.fn().mockResolvedValue({ tf: '30', days: { 20240603: TICKS } })
    expect(await fetchIntraday({ attempt_id: 7 }, fetcher)).toEqual({ tf: 30, days: { 20240603: TICKS } })
    expect(fetcher).toHaveBeenCalledWith('/api/study/attempts/7/intraday')
    expect(await fetchIntraday({ attempt_id: 7 }, vi.fn().mockResolvedValue({ tf: null, days: {} }))).toBe(null)
    expect(await fetchIntraday({ attempt_id: 7 }, vi.fn().mockRejectedValue(new Error('x')))).toBe(null)
    expect(await fetchIntraday(null, fetcher)).toBe(null)
  })

  it('draws every close on a key day and at most four on a quick day between', () => {
    vi.useFakeTimers()
    const thirteen = Array.from({ length: 13 }, (_, i) => [OPEN + i * 1800, 20, 21, 19.5, 20 + i * 0.05, 100])
    const fwd = [DAY, { ...DAY, t: '2024-06-04' }]
    const ticks = alignTicks(fwd, { days: { 20240603: thirteen, 20240604: thirteen.map((r) => [r[0] + 86400, ...r.slice(1)]) } })
    const { result } = renderHook(() => useRunOnTicks([], fwd, 2, true, { ticks, keys: new Set([1]), develop: developing, tickSlowMs: 100, tickFastMs: 10 }))
    const seen = new Set()
    for (let i = 0; i < 60 && result.current.k < 2; i++) {
      act(() => { vi.advanceTimersByTime(result.current.k === 0 ? 100 : 10) })
      if (result.current.clock) seen.add(`${result.current.clock.session}:${result.current.clock.t}`)
    }
    const day1 = [...seen].filter((x) => x.startsWith('1:')).length
    const day2 = [...seen].filter((x) => x.startsWith('2:')).length
    expect(day1).toBe(13)
    expect(day2).toBe(4)
    expect(result.current.bars).toEqual(fwd)
  })

  it('asks the plan questions at the session each target traded, never after the stop', () => {
    const checks = [{ at: 't1', q: 'q1', choices: ['a', 'b'], answer: 0 }, { at: 't2', q: 'q2', choices: ['a', 'b'], answer: 0 }]
    expect(replayChecks({ kind: 'plan', t1At: 3, t2At: 6, stoppedSession: null, checks }).map((c) => [c.at, c.session])).toEqual([['t1', 3], ['t2', 6]])
    expect(replayChecks({ kind: 'plan', t1At: 3, t2At: 6, stoppedSession: 5, checks }).map((c) => c.at)).toEqual(['t1'])
    expect(replayChecks({ kind: 'plan', t1At: 0, t2At: null, checks })).toEqual([])         // reached on the signal day
    expect(replayChecks({ kind: 'signal', checks })).toEqual([])
    const due = replayChecks({ kind: 'plan', t1At: 3, t2At: 6, checks })
    expect(dueCheck(due, 2, new Set())).toBe(null)
    expect(dueCheck(due, 3, new Set())?.at).toBe('t1')
    expect(dueCheck(due, 7, new Set(['t1']))?.at).toBe('t2')
    expect(dueCheck(due, 7, new Set(['t1', 't2']))).toBe(null)
  })

  it('holds at a question and runs on once it is answered', () => {
    vi.useFakeTimers()
    const fwd = [DAY, { ...DAY, t: '2024-06-04' }, { ...DAY, t: '2024-06-05' }]
    let holdAt = new Set([1])
    const { result, rerender } = renderHook(() => useRunOnTicks([], fwd, 3, true, { slowMs: 10, fastMs: 10, holdAt }))
    for (let i = 0; i < 5; i++) act(() => { vi.advanceTimersByTime(10) })
    expect(result.current.k).toBe(1)                     // stopped after the first day
    holdAt = new Set()
    rerender()
    for (let i = 0; i < 5; i++) act(() => { vi.advanceTimersByTime(10) })
    expect(result.current.k).toBe(3)
  })

  it('runs a day tick by tick: slow on a key day, quick between, then the next day', () => {
    vi.useFakeTimers()
    const base = [{ t: '2024-05-31', o: 10, h: 11, l: 9, c: 10.5, v: 1 }]
    const fwd = [DAY, { ...DAY, t: '2024-06-04' }, { ...DAY, t: '2024-06-05' }]
    const ticks = alignTicks(fwd, { days: { 20240603: TICKS, 20240605: TICKS.map((r) => [r[0] + 2 * 86400, ...r.slice(1)]) } })
    const keys = new Set([1])
    const { result } = renderHook(() => useRunOnTicks(base, fwd, 3, true, { ticks, keys, develop: developing, tickSlowMs: 100, tickFastMs: 10, slowMs: 300, fastMs: 50 }))
    const step = (ms) => act(() => { vi.advanceTimersByTime(ms) })
    expect(result.current.bars).toHaveLength(1)
    expect(result.current.clock).toBe(null)
    step(99)
    expect(result.current.bars).toHaveLength(1)          // session 1 is a key day: its first tick waits the slow 100 ms
    step(1)
    expect(result.current.bars).toHaveLength(2)
    expect(result.current.bars[1].c).toBe(20.5)
    expect(result.current.clock).toEqual({ session: 1, t: OPEN, next: OPEN + 1800 })
    step(100); step(100); step(100)                       // the rest of the day's ticks
    expect(result.current.bars[1]).toBe(DAY)
    step(100)                                             // the day is whole: on to session 2
    expect(result.current.k).toBe(1)
    step(50)                                              // session 2 has no ticks and is not a key day: it lands whole
    expect(result.current.k).toBe(2)
    expect(result.current.bars).toHaveLength(3)
    expect(result.current.clock).toBe(null)
    step(10)                                              // session 3 ticks quickly
    expect(result.current.bars).toHaveLength(4)
    expect(result.current.clock?.session).toBe(3)
    step(10); step(10); step(10); step(10)
    expect(result.current.k).toBe(3)
    expect(result.current.clock).toBe(null)
    expect(result.current.bars.slice(1)).toEqual(fwd)
  })
})
