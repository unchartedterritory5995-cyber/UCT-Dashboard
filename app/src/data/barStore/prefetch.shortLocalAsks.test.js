// B9 (2026-11-28 cold-coverage run, COV-zo-m1-typed: a 1m + 15m board zoomed out to ~791 bars, CRAI typed, Enter). The
// linked 15m chart held the previous symbol for 4,094 ms, the HANDOFF_HANG_MS guard: its 15m tail was never asked during
// the switch (the 1m tail left at +30 ms, the 15m lake pieces by +425 ms, the first /api/bars?tf=15 at +4,110 ms, after
// the guard committed). The branch: the 15m key held the DEVICE copy (~300 newest rows, complete through the close), which
// the view's paint rule accepts (_localPaints), so the prepare took its "legacy: no request" branch, waited for the lake's
// join and reported 'current'. The lake added nothing (an illiquid name's lake rows share no bar with the device copy), so
// the held rows stayed short of the zoomed-out view, and the handoff (never a short page, useSymbolHandoff) refused the
// report and waited for rows that cover the view: rows only a server answer brings, which nothing had asked for.
// Now a prepare that knows its view's need (`need`) asks the server, at once, for a local copy short of it, and reports
// on that answer when the lake leaves the copy short. A local copy that covers the view still paints with no request.
// Through the real store (registry + reducer + persist + network) and the real prefetch facade.
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { createBarStore } from './index'
import { createPrefetch } from './prefetch'
import { keyOf } from './types'
import { installFakeIndexedDB } from './testing/fakeIndexedDB'
import { fakeStream, fakeCandle, fakePrices } from './testing/fakeFeeds'
import { memClear } from '../../utils/barsMemCache'

vi.mock('../../hooks/useTickerMeta', () => ({ prefetchTickerMeta: () => {} }))

const OPEN = Date.UTC(2026, 10, 18, 14, 30) / 1000        // Wed 2026-11-18 09:30 ET
const CLOSE = OPEN + 390 * 60                               // 16:00 ET
const NOW = CLOSE + 2 * 3600                                // 18:00 ET: after the close, the measured case
const DAY = 86400
const bar = (t, i) => { const o = Math.round((50 + ((i * 7) % 13) / 4) * 100) / 100; return { t, o, h: o + 0.5, l: o - 0.5, c: o + 0.25, v: 1000 + i } }
/** `days` regular sessions of 15m rows ending with today's (26 a day, the last 15:45). */
function sessions(days, { endDay = 0 } = {}) {
  const out = []
  for (let d = days - 1 + endDay; d >= endDay; d--) {
    const open = OPEN - d * DAY
    for (let i = 0; i < 26; i++) out.push(bar(open + i * 900, out.length))
  }
  return out
}
const DEVICE = sessions(12).slice(-300)                     // the device seed's 300 newest 15m rows, through the close
/** The lake: older sessions that END well before the device copy's oldest row (no bar in common: never joined). */
const LAKE = sessions(10, { endDay: 30 })

function answer() {
  const rows = sessions(45).slice(-1152)
  return {
    ticker: 'ILQ', tf: '15', bars: rows, contract: 1, grid: 'eth-clock', session: 'rth',
    cache_key: 'b1:ILQ:15:eth-clock', series_rev: 9000, history_rev: 1, verified_through: CLOSE, complete_through: CLOSE,
    tail_status: 'verified', developing: null,
  }
}

function fakeDevice(rows) {
  const hit = { rows, through: CLOSE, savedAt: CLOSE * 1000, formingT: null }
  return {
    peek: vi.fn((s, t) => (s === 'ILQ' && t === '15' ? hit : null)),
    read: vi.fn(async (s, t) => (s === 'ILQ' && t === '15' ? hit : null)),
  }
}
const lakeOf = (rows) => ({
  olderBars: vi.fn((key, beforeT) => Promise.resolve({ bars: rows.filter((b) => b.t < beforeT) })),
  prime: vi.fn(),
  hasSymbol: vi.fn(async () => true),
})

let fakeDb
beforeAll(() => { fakeDb = installFakeIndexedDB() })
beforeEach(() => { memClear(); fakeDb._clear(); vi.useFakeTimers(); vi.setSystemTime(NOW * 1000) })
afterEach(() => { vi.useRealTimers() })

function boot() {
  const releases = []
  const request = vi.fn(() => new Promise((r) => { releases.push(() => r(answer())) }))
  const store = createBarStore({
    request, device: fakeDevice(DEVICE), history: lakeOf(LAKE),
    io: { idbGet: async () => null, idbGetHistoryEntry: async () => null, idbPutMonotonic: async () => {}, memPutMonotonic: () => {} },
    stream: fakeStream(), candle: fakeCandle(), prices: fakePrices(), isHidden: () => false, onVisible: () => () => {}, idle: (fn) => fn(),
  })
  const pf = createPrefetch({ store, tickerMeta: () => {}, extended: () => false })
  const key = keyOf({ sym: 'ILQ', tf: '15' })
  const tails = () => request.mock.calls.filter(([u]) => /\/api\/bars\/ILQ\?/.test(String(u)) && /[?&]tf=15(&|$)/.test(String(u)))
  return { store, pf, request, key, tails, release: () => { while (releases.length) releases.shift()() } }
}
const settled = (p) => { let v = 'PENDING'; p.then((x) => { v = x }, () => { v = 'REJECTED' }); return () => v }

describe('B9: a local copy short of the view is asked for at once', () => {
  it('(setup) the device copy is what the key holds, and the view paint rule accepts it', async () => {
    const w = boot()
    await w.pf.deviceWarm('ILQ', '15')
    await vi.advanceTimersByTimeAsync(1)
    const s = w.store.peek(w.key)
    expect(s.restSeen).toBeFalsy()
    expect(s.bars.length).toBe(300)
    expect(w.pf.devicePaints('ILQ', '15')).toBe(true)
  })

  it('a prepare whose view needs more rows than the device copy holds asks the 15m tail at once, and reports on its answer', async () => {
    const w = boot()
    await w.pf.deviceWarm('ILQ', '15')
    const state = settled(w.pf.prepareForDisplay('ILQ', '15', { need: 1000 }))
    await vi.advanceTimersByTimeAsync(30)
    expect(w.tails().length).toBe(1)                          // asked during the switch, not after the hang guard
    await vi.advanceTimersByTimeAsync(1000)                   // the lake settled (it added nothing)
    expect(w.store.peek(w.key).bars.length).toBe(300)
    expect(state()).toBe('PENDING')                           // never 'current' on rows short of the view
    w.release()
    await vi.advanceTimersByTimeAsync(10)
    expect(state()).toBe('current')
    const s = w.store.peek(w.key)
    expect(s.restSeen).toBe(true)
    expect(s.bars.length).toBeGreaterThanOrEqual(1000)
  })

  it('control: a device copy that covers the view still paints with no request', async () => {
    const w = boot()
    await w.pf.deviceWarm('ILQ', '15')
    await expect(w.pf.prepareForDisplay('ILQ', '15', { need: 250 })).resolves.toBe('current')
    expect(w.tails().length).toBe(0)
  })

  it('control: a prepare that names no need keeps the legacy rule (no request)', async () => {
    const w = boot()
    await w.pf.deviceWarm('ILQ', '15')
    await expect(w.pf.prepareForDisplay('ILQ', '15')).resolves.toBe('current')
    expect(w.tails().length).toBe(0)
  })
})
