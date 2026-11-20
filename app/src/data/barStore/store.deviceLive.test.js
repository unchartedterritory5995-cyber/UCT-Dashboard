// DURING THE SESSION a device copy current to the last closed minute (the seed's window + today's bars
// from the minute frames, data/deviceStore/live.js) is a WHOLE first paint. Contract, through the real
// store (registry + reducer + persist + network) and the real prefetch facade:
//   L1 mid-session, a never-opened symbol's device copy is displayable in the same call, CONTEXT (no
//      request), and the handoff's device rule accepts it although the lake's depth is still due
//   L2 the server's answer then changes NONE of the bars the device copy painted (same values on every
//      closed bar); it only adds what the device did not hold
//   L3 an extended view of a key both sessions share is never painted from the regular-session copy
//   L4 a device copy behind the session (yesterday's seed alone) is not; nor is a saved copy (not the
//      device's), however current
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { createBarStore } from './index'
import { createPrefetch } from './prefetch'
import { keyOf, STATUS, ACTION } from './types'
import { installFakeIndexedDB } from './testing/fakeIndexedDB'
import { fakeStream, fakeCandle, fakePrices } from './testing/fakeFeeds'
import { memClear } from '../../utils/barsMemCache'

vi.mock('../../hooks/useTickerMeta', () => ({ prefetchTickerMeta: () => {} }))

const OPEN = Date.UTC(2026, 10, 18, 14, 30) / 1000        // Wed 2026-11-18 09:30 ET
const NOW = (OPEN + 2 * 3600 + 60) * 1000                  // 11:31:00 ET: the 11:30 minute just closed
const DAY = 86400
const bar = (t, k, i) => { const o = Math.round((50 + ((i * 7) % 13) / 4) * 100) / 100 * k; return { t, o, h: o + 0.5 * k, l: o - 0.5 * k, c: o + 0.25 * k, v: 1000 + i } }
const session = (open, upto, k = 1) => { const out = []; for (let i = 0; i < 78 && open + i * 300 <= upto; i++) out.push(bar(open + i * 300, k, i)); return out }
// seed: yesterday's session; live overlay: today 09:30 ... the 11:30 bucket still forming
const DEVICE = [...session(OPEN - DAY, Infinity), ...session(OPEN, OPEN + 2 * 3600)]
const YESTERDAY = session(OPEN - DAY, Infinity)

function answer() {
  // what /api/bars sends: the same regular-session bars, the pre-market ones too (the key is shared by
  // both sessions), and the forming 11:30 bucket with the trades of the minute in progress
  const pre = [{ t: OPEN - 3600, o: 49, h: 49.5, l: 48.5, c: 49.25, v: 10 }]
  const closed = DEVICE.slice(0, -1)
  const forming = { ...DEVICE.at(-1), c: DEVICE.at(-1).c + 0.1, h: DEVICE.at(-1).h + 0.1, v: DEVICE.at(-1).v + 50 }
  const bars = [...closed.slice(0, 78), ...pre, ...closed.slice(78)]
  return {
    ticker: 'NEWB', tf: '5', bars, contract: 1, grid: 'eth-clock', session: 'rth', cache_key: 'b1:NEWB:5:eth-clock',
    series_rev: 9000, history_rev: 1, verified_through: Math.floor(NOW / 1000), complete_through: OPEN + 2 * 3600,
    tail_status: 'verified', developing: { ...forming, rev: 9001 },
  }
}

const fakeDevice = (rows, { cached = true } = {}) => ({
  peek: vi.fn((s, t) => (cached && s === 'NEWB' && t === '5' ? { rows, savedAt: null } : null)),
  read: vi.fn(async (s, t) => (s === 'NEWB' && t === '5' ? { rows, savedAt: null } : null)),
})

let fakeDb
beforeAll(() => { fakeDb = installFakeIndexedDB() })
beforeEach(() => { memClear(); fakeDb._clear(); vi.useFakeTimers(); vi.setSystemTime(NOW) })
afterEach(() => { vi.useRealTimers() })

function boot({ device, request = vi.fn(() => new Promise(() => {})) }) {
  const store = createBarStore({
    request, device, io: { idbGet: async () => null, idbGetHistoryEntry: async () => null, idbPutMonotonic: async () => {}, memPutMonotonic: () => {} },
    stream: fakeStream(), candle: fakeCandle(), prices: fakePrices(), isHidden: () => false, onVisible: () => () => {}, idle: (fn) => fn(),
    // a lake that carries the key: its whole depth is DUE for a never-opened symbol
    history: { olderBars: vi.fn(() => new Promise(() => {})), prime: vi.fn(), hasSymbol: vi.fn(async () => true) },
  })
  return { store, request, pf: createPrefetch({ store, tickerMeta: () => {}, extended: () => false }), key: keyOf({ sym: 'NEWB', tf: '5' }) }
}

describe('a device copy current to the last closed minute', () => {
  it('L1 is displayable at once, CONTEXT, and the device rule paints it with the lake depth still due', () => {
    const { store, pf, key, request } = boot({ device: fakeDevice(DEVICE) })
    expect(pf.peekDisplayable('NEWB', '5')).toBe(true)
    const s = store.peek(key)
    expect(s.source).toBe('device')
    expect(s.status).toBe(STATUS.CONTEXT)
    expect(s.developing?.t).toBe(OPEN + 2 * 3600)                     // the 11:30 bucket, forming
    expect(pf.lakePending('NEWB', '5')).toBe(true)
    expect(pf.devicePaints('NEWB', '5', { showExtended: false })).toBe(true)
    expect(request).not.toHaveBeenCalled()
    store.dispose()
  })

  it('L2 the server\'s answer changes none of the bars the device copy painted', async () => {
    let release
    const request = vi.fn(() => new Promise((r) => { release = () => r(answer()) }))
    const { store, key } = boot({ device: fakeDevice(DEVICE), request })
    const off = store.subscribe(key, () => {})
    await vi.advanceTimersByTimeAsync(1)
    const painted = store.getSnapshot(key).bars.map((b) => [b.t, b.o, b.h, b.l, b.c, b.v])
    expect(painted.length).toBe(DEVICE.length - 1)                    // every closed bar (the newest forms)
    release()
    await vi.advanceTimersByTimeAsync(20)
    const s = store.getSnapshot(key)
    expect(s.restSeen).toBe(true)
    const byT = new Map(s.bars.map((b) => [b.t, [b.t, b.o, b.h, b.l, b.c, b.v]]))
    for (const row of painted) expect(byT.get(row[0])).toEqual(row)  // value for value
    expect(byT.has(OPEN - 3600)).toBe(true)                           // the pre-market bar is only ADDED
    off()
    store.dispose()
  })

  it('L3 an extended view of the shared 5m key is never painted from the regular-session copy', () => {
    const { pf } = boot({ device: fakeDevice(DEVICE) })
    expect(pf.peekDisplayable('NEWB', '5', { showExtended: true })).toBe(true)
    expect(pf.devicePaints('NEWB', '5', { showExtended: true })).toBe(false)
  })

  it('L4 behind the session (yesterday alone), or a saved copy however current: not the device rule', () => {
    const a = boot({ device: fakeDevice(YESTERDAY) })
    expect(a.pf.peekDisplayable('NEWB', '5')).toBe(false)
    expect(a.store.peek(a.key).status).toBe(STATUS.PROVISIONAL)
    expect(a.pf.devicePaints('NEWB', '5')).toBe(false)
    a.store.dispose()
    const b = boot({ device: null })
    b.store.registry.acquire(b.key)
    b.store.registry.dispatch(b.key, { type: ACTION.IDB_HIT, key: b.key, payload: { bars: DEVICE } })
    expect(b.store.peek(b.key).status).toBe(STATUS.CONTEXT)
    expect(b.pf.devicePaints('NEWB', '5')).toBe(false)
    b.store.dispose()
  })
})
