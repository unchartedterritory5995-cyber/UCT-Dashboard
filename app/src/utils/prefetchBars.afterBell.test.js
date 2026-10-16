import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// ── THE NEIGHBOUR WARM MUST LEAVE THE NEXT ROW PAINTABLE AFTER THE BELL ────────
//
// After the close the chart refuses a today-dated daily set written DURING the
// session (its close is a mid-session snapshot) and accepts one written after the
// close + settle (it holds the sealed close) — `isDailyTodayCloseProvisionalForPaint`.
// The warmers used to call both "fresh": a mid-session set was promoted to mem and
// never refreshed, so the Focus screener's next row was "warm" and still waited on
// the network. These rails pin the warmers to the chart's own rule.
//
// Tue 2026-09-22 (EDT = UTC-4). Now = 18:12 ET.

const NOW_ISO = '2026-09-22T22:12:00Z'
const MID_SESSION = new Date('2026-09-22T15:00:00Z').getTime()   // 11:00 ET
const AFTER_CLOSE = new Date('2026-09-22T21:00:00Z').getTime()   // 17:00 ET

const preload = vi.fn()
vi.mock('swr', () => ({ preload: (...a) => preload(...a) }))
const idb = vi.hoisted(() => ({ entries: new Map(), puts: [] }))
vi.mock('./barsIDB', () => ({
  idbGet: vi.fn(async (sym, tf) => idb.entries.get(`${sym}_${tf}`) ?? null),
  idbPut: vi.fn(async (sym, tf, bars) => { idb.puts.push(`${sym}_${tf}`); idb.entries.set(`${sym}_${tf}`, { bars, lastT: bars[bars.length - 1].t, savedAt: Date.now() }) }),
  mergeDelta: (a, b) => b,
}))
vi.mock('../hooks/useTickerMeta', () => ({ prefetchTickerMeta: vi.fn() }))

const todaySet = () => [{ t: '2026-09-21', o: 1, h: 2, l: 0.5, c: 1.5, v: 10 }, { t: '2026-09-22', o: 1.5, h: 2.5, l: 1, c: 2, v: 12 }]

let mod, mem
beforeEach(async () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(NOW_ISO))
  vi.resetModules()
  idb.entries.clear(); idb.puts.length = 0
  preload.mockReset()
  preload.mockImplementation(async () => ({ bars: todaySet() }))
  try { localStorage.clear(); localStorage.setItem('barspack.version', 'v1') } catch { /* ignore */ }
  mod = await import('./prefetchBars')
  mem = await import('./barsMemCache')
  mem.memClear()
  mod._noteWarmResult({ bars: [{ t: 1 }] })   // no server backoff
})
afterEach(() => { vi.useRealTimers() })
const drain = () => vi.advanceTimersByTimeAsync(3000)
const fetchedFor = (sym) => preload.mock.calls.some(c => String(c[0]).startsWith(`/api/bars/${sym}?`))

describe('warmMemFromIDB after the bell', () => {
  it('does NOT promote a today set written mid-session (the chart would refuse it)', async () => {
    idb.entries.set('MIDS_D', { bars: todaySet(), lastT: '2026-09-22', savedAt: MID_SESSION })
    mod.warmMemFromIDB(['MIDS'], ['D'])
    await drain()
    expect(mem.memHas('MIDS', 'D')).toBe(false)
  })

  it('promotes a sealed set and keeps ITS write time, not the promotion time', async () => {
    idb.entries.set('SEAL_D', { bars: todaySet(), lastT: '2026-09-22', savedAt: AFTER_CLOSE })
    mod.warmMemFromIDB(['SEAL'], ['D'])
    await drain()
    expect(mem.memHas('SEAL', 'D')).toBe(true)
    expect(mem.memPeekSavedAt('SEAL', 'D')).toBe(AFTER_CLOSE)
  })
})

describe('urgent next-row warm after the bell', () => {
  it('a mid-session set in mem is not "warm": the urgent job refetches it', async () => {
    vi.setSystemTime(MID_SESSION); mem.memPut('MIDS', 'D', todaySet()); vi.setSystemTime(new Date(NOW_ISO))
    mod.prefetchBars(['MIDS'], 'D', { urgent: true })
    await drain()
    expect(fetchedFor('MIDS')).toBe(true)
    expect(mem.memPeekSavedAt('MIDS', 'D')).toBeGreaterThan(AFTER_CLOSE)   // re-stamped by the fresh write
  })

  it('a sealed set in mem IS warm: no request', async () => {
    mem.memPut('SEAL', 'D', todaySet())   // written now, 18:12 ET
    mod.prefetchBars(['SEAL'], 'D', { urgent: true })
    await drain()
    expect(fetchedFor('SEAL')).toBe(false)
  })
})

describe('durable neighbour warm (prefetchBarsToIDB) after the bell', () => {
  it('refreshes a today set written mid-session', async () => {
    idb.entries.set('MIDS_D', { bars: todaySet(), lastT: '2026-09-22', savedAt: MID_SESSION })
    mod.prefetchBarsToIDB(['MIDS'], 'D', { priority: true, immediate: true })
    await drain()
    expect(fetchedFor('MIDS')).toBe(true)
    expect(idb.puts).toContain('MIDS_D')
    expect(mem.memHas('MIDS', 'D')).toBe(true)
  })

  it('leaves a sealed set alone (no request)', async () => {
    idb.entries.set('SEAL_D', { bars: todaySet(), lastT: '2026-09-22', savedAt: AFTER_CLOSE })
    mod.prefetchBarsToIDB(['SEAL'], 'D', { priority: true, immediate: true })
    await drain()
    expect(fetchedFor('SEAL')).toBe(false)
  })
})
