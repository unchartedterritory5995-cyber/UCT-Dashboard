// app/src/components/chart/engine/__tests__/secondaryLiveTail.test.jsx
//
// ─── ⭐⭐ RS RATING L11 PR 2 — A FORMING OTHER-SYMBOL SERIES IS KEPT CURRENT ─────────────────────────────
//
// The chart's newest bar reads SP:SPX's OWN session while that session is in progress
// (`otherSymbols.newestOwnPeriodOf`, decided by the cache entry's `newestBarIsForming`). The entry was
// fetched once per page and kept: fetched at 10:00 it held 10:00's row (and `forming: true`) all day;
// fetched before the open it never held today's row. `secondaryBars.refreshSecondaryTail` re-reads the
// newest rows and lays them over the held entry; `useSecondarySources` ticks it once a minute while an
// entry is forming, or while the chart's own newest bar is.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import STOCKCHART_SRC from '../../../StockChart.jsx?raw'
import {
  clearSecondaryBars, primeSecondaryBars, cachedBars, mergeTail, refreshSecondaryTail, subscribe,
  secondaryBarsUrl, TAIL_BARS, REFRESH_MIN_MS,
} from '../secondaryBars'
import { useSecondarySources, liveTailTick, LIVE_TAIL_MS } from '../useSecondarySources'
import { setDeskHidden, __resetDeskVisibility } from '../../../../lib/deskVisibility'

const days = (n, last = '2026-11-17') => {
  const out = []
  for (let t = Date.parse(`${last}T00:00:00Z`); out.length < n; t -= 86400000) {
    const wd = new Date(t).getUTCDay()
    if (wd !== 0 && wd !== 6) out.unshift(new Date(t).toISOString().slice(0, 10))
  }
  return out
}
const row = (t, c) => ({ t, o: c, h: c + 1, l: c - 1, c, v: 1 })
const HELD = days(40).map((t, i) => row(t, 100 + i))               // through 2026-11-17, settled
const flush = async () => { for (let i = 0; i < 6; i += 1) await Promise.resolve() }

beforeEach(() => { clearSecondaryBars() })
afterEach(() => { vi.useRealTimers() })

describe('mergeTail — the newest rows laid over the held ones', () => {
  it('replaces the overlapping rows and appends the new session', () => {
    const tail = [...HELD.slice(-9).map((r) => ({ ...r })), row('2026-11-18', 777)]
    tail[8] = row('2026-11-17', 555)                                 // a revised row
    const m = mergeTail(HELD, tail)
    expect(m.length).toBe(HELD.length + 1)
    expect(m[m.length - 1]).toEqual(row('2026-11-18', 777))
    expect(m[m.length - 2]).toEqual(row('2026-11-17', 555))
    expect(m.slice(0, HELD.length - 9)).toEqual(HELD.slice(0, HELD.length - 9))
  })

  it('works on numeric (index) keys as on ISO dates', () => {
    const held = [1, 2, 3, 4].map((t) => row(t * 86400, t))
    expect(mergeTail(held, [row(3 * 86400, 30), row(5 * 86400, 5)]).map((r) => r.c)).toEqual([1, 2, 30, 5])
  })

  it('⛔ a tail that does not overlap the held rows is null (the sessions between are unknown)', () => {
    expect(mergeTail(HELD, [row('2026-12-30', 1), row('2026-12-31', 2)])).toBe(null)
    expect(mergeTail([], [row('2026-11-18', 1)])).toBe(null)
  })
})

describe('refreshSecondaryTail — the held entry follows the series', () => {
  const big = () => secondaryBarsUrl('SPX', 'D', 600)
  const tailUrl = () => secondaryBarsUrl('SPX', 'D', TAIL_BARS)
  const seed = (forming) => primeSecondaryBars('SPX', 'D', 600, { bars: HELD, newest_bar_is_forming: forming })

  it('a page opened before the open gains today\'s forming row and the flag, and notifies once', async () => {
    seed(false)
    const before = cachedBars('SPX', 'D', 600)
    const fetcher = vi.fn(() => Promise.resolve({ bars: [...HELD.slice(-9), row('2026-11-18', 7400)], newest_bar_is_forming: true }))
    const heard = vi.fn()
    const unsub = subscribe(heard)
    expect(refreshSecondaryTail('SPX', 'D', 600, fetcher)).toBe(true)
    await flush()
    unsub()
    expect(fetcher).toHaveBeenCalledWith(tailUrl())
    const after = cachedBars('SPX', 'D', 600)
    expect(after).not.toBe(before)
    expect(after.bars.length).toBe(HELD.length + 1)
    expect(after.bars[after.bars.length - 1]).toEqual(row('2026-11-18', 7400))
    expect(after.newestBarIsForming).toBe(true)
    expect(heard).toHaveBeenCalledTimes(1)
  })

  it('⛔ an unchanged answer keeps the very same entry and notifies nobody (nothing recomputes)', async () => {
    seed(false)
    const before = cachedBars('SPX', 'D', 600)
    const heard = vi.fn()
    const unsub = subscribe(heard)
    refreshSecondaryTail('SPX', 'D', 600, () => Promise.resolve({ bars: HELD.slice(-10), newest_bar_is_forming: false }))
    await flush()
    unsub()
    expect(cachedBars('SPX', 'D', 600)).toBe(before)
    expect(heard).not.toHaveBeenCalled()
  })

  it('the close: the same rows with the flag turned settled IS a change', async () => {
    seed(true)
    const before = cachedBars('SPX', 'D', 600)
    refreshSecondaryTail('SPX', 'D', 600, () => Promise.resolve({ bars: HELD.slice(-10), newest_bar_is_forming: false }))
    await flush()
    const after = cachedBars('SPX', 'D', 600)
    expect(after).not.toBe(before)
    expect(after.newestBarIsForming).toBe(false)
    expect(after.bars).toEqual(HELD)
  })

  it('⛔ throttled per window: a second ask inside REFRESH_MIN_MS starts nothing', async () => {
    vi.useFakeTimers()
    seed(true)
    const fetcher = vi.fn(() => Promise.resolve({ bars: HELD.slice(-10), newest_bar_is_forming: true }))
    expect(refreshSecondaryTail('SPX', 'D', 600, fetcher)).toBe(true)
    await flush()
    expect(refreshSecondaryTail('SPX', 'D', 600, fetcher)).toBe(false)
    vi.advanceTimersByTime(REFRESH_MIN_MS + 1)
    expect(refreshSecondaryTail('SPX', 'D', 600, fetcher)).toBe(true)
  })

  it('⛔ a tail that does not overlap is a FULL refetch of the window, never a gap', async () => {
    seed(false)
    const fetcher = vi.fn((url) => Promise.resolve(url === tailUrl()
      ? { bars: [row('2026-12-30', 1), row('2026-12-31', 2)], newest_bar_is_forming: false }
      : { bars: [...HELD, row('2026-12-31', 2)], newest_bar_is_forming: false }))
    refreshSecondaryTail('SPX', 'D', 600, fetcher)
    await flush()
    await flush()
    expect(fetcher.mock.calls.map((c) => c[0])).toEqual([tailUrl(), big()])
    expect(cachedBars('SPX', 'D', 600).bars.length).toBe(HELD.length + 1)
  })

  it('⛔ nothing to follow: no held entry (or an empty one) starts no fetch', () => {
    const fetcher = vi.fn()
    expect(refreshSecondaryTail('SPX', 'D', 600, fetcher)).toBe(false)
    primeSecondaryBars('SPX', 'D', 600, { bars: [] })
    expect(refreshSecondaryTail('SPX', 'D', 600, fetcher)).toBe(false)
    expect(fetcher).not.toHaveBeenCalled()
  })
})

describe('liveTailTick — which entries a tick re-reads', () => {
  it('a forming entry; a settled one only while the chart\'s own newest bar is forming', async () => {
    primeSecondaryBars('SPX', 'D', 600, { bars: HELD, newest_bar_is_forming: true })
    primeSecondaryBars('QQQ', 'D', 600, { bars: HELD, newest_bar_is_forming: false })
    const fetcher = vi.fn(() => new Promise(() => {}))
    expect(liveTailTick(['SPX', 'QQQ'], 'D', 600, fetcher, false)).toBe(1)
    await flush()                                                   // the fetch is asked in a microtask
    expect(fetcher.mock.calls.map((c) => c[0])).toEqual([secondaryBarsUrl('SPX', 'D', TAIL_BARS)])
    clearSecondaryBars()
    primeSecondaryBars('QQQ', 'D', 600, { bars: HELD, newest_bar_is_forming: false })
    expect(liveTailTick(['QQQ'], 'D', 600, fetcher, true)).toBe(1)
  })

  it('⛔ a hidden tab re-reads nothing', () => {
    primeSecondaryBars('SPX', 'D', 600, { bars: HELD, newest_bar_is_forming: true })
    const spy = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    const fetcher = vi.fn()
    expect(liveTailTick(['SPX'], 'D', 600, fetcher, true)).toBe(0)
    expect(fetcher).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it('⛔ a hidden DESK re-reads nothing, though the page still reports visible (speed rule 6)', () => {
    // the desktop shell keeps a minimized window `visible`; `deskVisibility.isAppVisible` folds the desk in
    primeSecondaryBars('SPX', 'D', 600, { bars: HELD, newest_bar_is_forming: true })
    expect(document.visibilityState).not.toBe('hidden')
    const fetcher = vi.fn()
    setDeskHidden(true)
    try {
      expect(liveTailTick(['SPX'], 'D', 600, fetcher, true)).toBe(0)
      expect(fetcher).not.toHaveBeenCalled()
    } finally { __resetDeskVisibility() }
    expect(liveTailTick(['SPX'], 'D', 600, fetcher, true)).toBe(1)      // CONTROL: the desk back, it re-reads
  })
})

describe('the chart runs the tick', () => {
  const SPY_TREE = { type: 'op', name: '/', args: [{ type: 'series', name: 'close' },
    { type: 'sym', value: 'SPY', args: [{ type: 'series', name: 'close' }] }] }
  const DEF = { id: 'u_bbbbbbbbbbbb', meta: {}, compute: { kind: 'ast', ast: SPY_TREE } }

  it('useSecondarySources re-reads a forming entry every LIVE_TAIL_MS, and stops on unmount', async () => {
    vi.useFakeTimers()
    primeSecondaryBars('SPY', 'D', 600, { bars: HELD, newest_bar_is_forming: true })
    const fetcher = vi.fn(() => Promise.resolve({ bars: HELD.slice(-10), newest_bar_is_forming: true }))
    const hook = renderHook(() => useSecondarySources(() => [{ instanceId: `inst:${DEF.id}:1`, defId: DEF.id }],
      (id) => (id === DEF.id ? DEF : null), 'D', 600, fetcher, null, () => false))
    expect(hook.result.current.get('SPY').newestBarIsForming).toBe(true)
    expect(fetcher).not.toHaveBeenCalled()
    vi.advanceTimersByTime(LIVE_TAIL_MS)
    await flush()
    expect(fetcher).toHaveBeenCalledWith(secondaryBarsUrl('SPY', 'D', TAIL_BARS))
    vi.advanceTimersByTime(LIVE_TAIL_MS)                            // every minute, not once
    await flush()
    expect(fetcher).toHaveBeenCalledTimes(2)
    hook.unmount()
    await flush()
    vi.advanceTimersByTime(LIVE_TAIL_MS * 3)
    await flush()
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('StockChart hands the hook its own forming flag through a stable getter written from the bars payload', () => {
    const src = STOCKCHART_SRC
    // ⭐ RS RATING L12 PR 2 — and the chart's symbol last (its own daily rows, for a run that reads them)
    // (the 4th argument is the held span, `heldSpanFor(_heldLoaded, barCount)`: railed in heldSpanFollowsChart.test.js)
    expect(src).toMatch(/useSecondarySources\(\s*_storedInstances, _defOf, resolvedTf, _heldSpan, instFetcher, _otherSymbolsRevalidate, _chartFormingOf, sym, symbolMeta,\s*_heldSessions\)/)
    expect(src).toMatch(/const _chartFormingOf = useCallback\(\(\) => _chartFormingRef\.current, \[\]\)/)
    expect(src).toMatch(/_chartFormingRef\.current = data\?\.newest_bar_is_forming === true/)
  })
})
