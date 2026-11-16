// The legacy chart's D/W/M "bars-history split" (Phase 5) in the BarStore: the origin answers the
// recent tail only; the deep sealed history comes from the edge-cached /api/bars-history, once per
// key, on THE URL every client and the pre-warm sweep share (so the edge object is hit). A failed,
// unsealed or disagreeing history answer turns the split off for the key: the full depth from
// /api/bars, as before.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createRegistry } from './registry'
import { createNetwork, barsHistoryUrl } from './network'
import { keyOf } from './types'
import { FIRST_PAINT_BARS, fullBarsFor } from '../../utils/barsBackfill'
import { lastSealedDate, etPeriodStartISO } from '../../utils/barsHistorySplit'

const T0 = Date.UTC(2026, 10, 10, 15, 0)   // Tue 2026-11-10 10:00 ET
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(T0); localStorage.removeItem('uct.barsHistory.enabled'); localStorage.setItem('uct.barsHistory.bucket', '5') })
afterEach(() => { vi.useRealTimers(); localStorage.removeItem('uct.barsHistory.enabled'); localStorage.removeItem('uct.barsHistory.bucket') })

/** weekday ISO dates, oldest first, ending at `last` (inclusive) */
function weekdays(n, last) {
  const out = []
  const d = new Date(`${last}T00:00:00Z`)
  while (out.length < n) {
    const wd = d.getUTCDay()
    if (wd !== 0 && wd !== 6) out.push(d.toISOString().slice(0, 10))
    d.setUTCDate(d.getUTCDate() - 1)
  }
  return out.reverse()
}
const bar = (t, c = 100) => ({ t, o: c, h: c + 1, l: c - 1, c, v: 10 })

function world({ history = 'ok', depth = fullBarsFor('D') } = {}) {
  const calls = []
  const request = vi.fn(async (url) => {
    calls.push(url)
    if (url.startsWith('/api/bars-history/')) {
      if (history === 'throw') throw Object.assign(new Error('edge down'), { status: 502 })
      if (history === 'unsealed') return { ticker: 'SIM', tf: 'D', bars: [], sealed: false }
      if (history === 'other-basis') return { ticker: 'SIM', tf: 'D', sealed: true, bars: weekdays(3000, '2026-11-09').map((t) => bar(t, 50)) }
      if (history === 'foreign') return { ticker: 'OTHER', tf: 'D', sealed: true, bars: weekdays(3000, '2026-11-09').map((t) => bar(t)) }
      return { ticker: 'SIM', tf: 'D', sealed: true, last_sealed: '2026-11-09', bars: weekdays(3000, '2026-11-09').map((t) => bar(t)) }
    }
    const n = Number(/[?&]bars=(\d+)/.exec(url)[1])
    return { ticker: 'SIM', tf: 'D', bars: weekdays(Math.min(n, 3001), '2026-11-10').map((t) => bar(t)) }
  })
  const registry = createRegistry({ ctx: () => ({ nowMs: Date.now() }) })
  const net = createNetwork({ registry, request, isHidden: () => false, onVisible: () => () => {} })
  const key = keyOf({ sym: 'SIM', tf: 'D' })
  return { calls, registry, net, key, depth }
}
const histCalls = (w) => w.calls.filter((u) => u.startsWith('/api/bars-history/'))
const tailBars = (w) => w.calls.filter((u) => u.startsWith('/api/bars/')).map((u) => Number(/[?&]bars=(\d+)/.exec(u)[1]))

describe('BarStore D/W/M split: tail from the origin, deep sealed history from the edge', () => {
  it('a deep daily ask: the tail is capped at first paint and the rest comes from THE history URL', async () => {
    const w = world()
    w.net.fetchOnce(w.key, { depth: w.depth })
    await vi.advanceTimersByTimeAsync(50)
    expect(tailBars(w)).toEqual([FIRST_PAINT_BARS])
    expect(histCalls(w)).toEqual([`/api/bars-history/SIM?tf=D&bars=${fullBarsFor('D')}&d=2026-11-09`])
    const s = w.registry.getSnapshot(w.key)
    expect(s.depth).toBe(3000)                          // every sealed bar, once (today is the developing bar)
    expect(new Date(s.bars.at(-1).t * 1000).toISOString().slice(0, 10)).toBe('2026-11-09')
    expect(new Date(s.developing.t * 1000).toISOString().slice(0, 10)).toBe('2026-11-10')
    expect(new Date(s.bars[0].t * 1000).toISOString().slice(0, 10)).toBe(weekdays(3000, '2026-11-09')[0])
  })

  it('the history URL is the one the legacy chart builds (same cache object at the edge)', () => {
    expect(barsHistoryUrl('BRK.B', 'D', '2026-11-09')).toBe(`/api/bars-history/BRK.B?tf=D&bars=${fullBarsFor('D')}&d=2026-11-09`)
    expect(barsHistoryUrl('A B', 'W')).toBe(`/api/bars-history/A%20B?tf=W&bars=${fullBarsFor('W')}`)
  })

  it('asked once per key: later polls and asks do not repeat it', async () => {
    const w = world()
    w.net.start(w.key, { depth: w.depth })
    await vi.advanceTimersByTimeAsync(50)
    expect(w.registry.getSnapshot(w.key).depth).toBe(3000)
    w.net.fetchOnce(w.key, { depth: w.depth })
    await vi.advanceTimersByTimeAsync(20 * 60_000)
    expect(histCalls(w).length).toBe(1)
    expect(tailBars(w).length).toBeGreaterThan(2)                          // the 5-minute polls ran ...
    expect(tailBars(w).every((n) => n === FIRST_PAINT_BARS)).toBe(true)  // ... small
    expect(w.registry.getSnapshot(w.key).depth).toBe(3000)               // and never shrank the deep history
  })

  it('no deeper ask than first paint: no history request', async () => {
    const w = world()
    w.net.fetchOnce(w.key)
    await vi.advanceTimersByTimeAsync(50)
    expect(histCalls(w)).toEqual([])
    expect(tailBars(w)).toEqual([FIRST_PAINT_BARS])
  })

  it('the switch off (per browser): one full-depth /api/bars, as before', async () => {
    localStorage.setItem('uct.barsHistory.enabled', '0')
    const w = world()
    w.net.fetchOnce(w.key, { depth: w.depth })
    await vi.advanceTimersByTimeAsync(50)
    expect(histCalls(w)).toEqual([])
    expect(tailBars(w)).toEqual([w.depth])
  })

  for (const mode of ['throw', 'unsealed', 'other-basis', 'foreign']) {
    it(`a history answer that is ${mode}: the full depth from /api/bars instead, and the edge not asked again`, async () => {
      const w = world({ history: mode })
      w.net.start(w.key, { depth: w.depth })
      await vi.advanceTimersByTimeAsync(100)
      expect(histCalls(w).length).toBe(1)
      expect(tailBars(w)).toEqual([FIRST_PAINT_BARS, w.depth])
      const s = w.registry.getSnapshot(w.key)
      expect(s.bars.every((b) => b.c === 100)).toBe(true)          // nothing from the refused answer landed
      await vi.advanceTimersByTimeAsync(20 * 60_000)
      expect(histCalls(w).length).toBe(1)
    })
  }

  it('intraday and dated keys are never split', async () => {
    const w = world()
    w.net.fetchOnce(keyOf({ sym: 'SIM', tf: '5' }), { depth: 20000 })
    w.net.fetchOnce(`${w.key}@to=${Date.UTC(2020, 0, 15) / 1000}`, { depth: w.depth })
    await vi.advanceTimersByTimeAsync(100)
    expect(histCalls(w)).toEqual([])
  })

  it('the sealed date is the newest held bar before the current period, per timeframe', () => {
    const now = T0
    expect(etPeriodStartISO('D', now)).toBe('2026-11-10')
    expect(etPeriodStartISO('W', now)).toBe('2026-11-09')               // Monday of this week
    expect(etPeriodStartISO('M', now)).toBe('2026-11-01')
    const held = ['2026-10-30', '2026-11-06', '2026-11-09', '2026-11-10']
    expect(lastSealedDate(held, 'D', now)).toBe('2026-11-09')
    expect(lastSealedDate(held, 'W', now)).toBe('2026-11-06')
    expect(lastSealedDate(held, 'M', now)).toBe('2026-10-30')
    expect(lastSealedDate(['2026-11-10'], 'D', now)).toBe('')              // nothing sealed held: no d (short cache)
    expect(lastSealedDate([...held].reverse(), 'D', now)).toBe('2026-11-09')   // order does not matter
    // 20:30 ET on Tuesday is still Tuesday (not UTC's Wednesday)
    expect(etPeriodStartISO('D', Date.UTC(2026, 10, 11, 1, 30))).toBe('2026-11-10')
  })
})
