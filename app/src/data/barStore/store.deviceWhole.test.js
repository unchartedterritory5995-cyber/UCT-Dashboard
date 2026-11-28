// A FULL-DEPTH DEVICE D COPY IS WHOLE: NO DEEP JOIN (zero-network PR 3.2), through the real store (registry + reducer +
// persist + network) and the real prefetch facade. The device's copy of a recent listing (fewer rows than one tail page)
// says it is the symbol's whole served series (source.js `wholeFrom`, from the full-depth daily pack's trailer):
//   DW1 (red first) the switch's question `deepPending` answers false once the copy landed: the D hold does not wait for
//       a history that cannot add a bar, and no /api/bars-history request is ever made for it
//   DW2 the same copy WITHOUT `wholeFrom` (a shallow pack, a `partial` symbol): deepPending true, as before
//   DW3 an entry that no longer starts at that first bar (the server's answer reset it onto another basis) is due again
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { createBarStore } from './index'
import { createPrefetch } from './prefetch'
import { keyOf, ACTION } from './types'
import { installFakeIndexedDB } from './testing/fakeIndexedDB'
import { fakeStream, fakeCandle, fakePrices } from './testing/fakeFeeds'
import { memClear } from '../../utils/barsMemCache'

vi.mock('../../hooks/useTickerMeta', () => ({ prefetchTickerMeta: () => {} }))

const DAY = 86400
const dayUnix = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 1000
const NIGHT = Date.UTC(2026, 10, 19, 2, 0)                 // Wed 2026-11-18 21:00 ET (after the build)
const row = (t, i) => ({ t, o: 50 + i, h: 51 + i, l: 49 + i, c: 50.5 + i, v: 1000 + i })
/** 80 sessions ending on the as-of day (the whole life of a recent listing). */
const weekdays = (n, lastIso) => {
  const out = []
  let t = dayUnix(lastIso)
  while (out.length < n) { const wd = new Date(t * 1000).getUTCDay(); if (wd !== 0 && wd !== 6) out.push(t); t -= DAY }
  return out.reverse()
}
const DAYS = weekdays(80, '2026-11-18').map(row)

function fakeDevice({ whole }) {
  const through = dayUnix('2026-11-19')
  const hit = (s, t) => (s === 'NEWB' && t === 'D'
    ? { rows: DAYS, n: DAYS.length, through, savedAt: through * 1000, lastT: DAYS[DAYS.length - 1].t, wholeFrom: whole ? DAYS[0].t : null }
    : null)
  return { peek: vi.fn((s, t) => hit(s, t)), read: vi.fn(async (s, t) => hit(s, t)) }
}

let fakeDb
beforeAll(() => { fakeDb = installFakeIndexedDB() })
beforeEach(() => { memClear(); fakeDb._clear(); vi.useFakeTimers(); vi.setSystemTime(NIGHT) })
afterEach(() => { vi.useRealTimers() })

function boot(device) {
  const request = vi.fn(() => new Promise(() => {}))        // the server never answers: the device copy decides
  const store = createBarStore({
    request, device, io: { idbGet: async () => null, idbGetHistoryEntry: async () => null, idbPutMonotonic: async () => {}, memPutMonotonic: () => {} },
    stream: fakeStream(), candle: fakeCandle(), prices: fakePrices(), isHidden: () => false, onVisible: () => () => {}, idle: (fn) => fn(),
    history: null,
  })
  return { store, request, pf: createPrefetch({ store, tickerMeta: () => {}, extended: () => false }) }
}
const histAsks = (request) => request.mock.calls.filter((c) => String(c[0]).startsWith('/api/bars-history/'))

describe('a whole device D copy needs no deep join', () => {
  it('DW1 (red first) deepPending false once the copy landed; no history request', async () => {
    const { store, request, pf } = boot(fakeDevice({ whole: true }))
    await pf.deviceWarm('NEWB', 'D')
    await vi.advanceTimersByTimeAsync(20)
    const key = keyOf({ sym: 'NEWB', tf: 'D' })
    expect(store.peek(key)?.source).toBe('device')
    expect(store.persist.deviceWhole(key)).toBe(true)
    expect(!!pf.deepPending('NEWB', 'D')).toBe(false)
    pf.prepareDailyForDisplay('NEWB', 'D')
    await vi.advanceTimersByTimeAsync(100)
    expect(histAsks(request)).toEqual([])
  })

  it('DW2 the same copy not known whole: deepPending true, as before', async () => {
    const { store, pf } = boot(fakeDevice({ whole: false }))
    await pf.deviceWarm('NEWB', 'D')
    await vi.advanceTimersByTimeAsync(20)
    expect(store.persist.deviceWhole(keyOf({ sym: 'NEWB', tf: 'D' }))).toBe(false)
    expect(!!pf.deepPending('NEWB', 'D')).toBe(true)
  })

  it('DW3 an entry reset off that first bar is due its history again', async () => {
    const { store, pf } = boot(fakeDevice({ whole: true }))
    await pf.deviceWarm('NEWB', 'D')
    await vi.advanceTimersByTimeAsync(20)
    const key = keyOf({ sym: 'NEWB', tf: 'D' })
    expect(!!pf.deepPending('NEWB', 'D')).toBe(false)
    // a full answer on another price basis (a 2-for-1 split since the pack: every shared row halved): the reducer's
    // split safety drops every device row and the entry is the answer's 30 rows
    const s = store.peek(key)
    const half = (b) => ({ t: new Date(b.t * 1000).toISOString().slice(0, 10), o: b.o / 2, h: b.h / 2, l: b.l / 2, c: b.c / 2, v: b.v * 2 })
    store.registry.dispatch(key, { type: ACTION.REST_FULL, key, gen: s.gen,
      payload: { ticker: 'NEWB', tf: 'D', bars: DAYS.slice(-30).map(half) } })
    const after = store.peek(key)
    expect(after.bars[0].t).toBeGreaterThan(DAYS[0].t)
    expect(store.persist.deviceWhole(key)).toBe(false)
    expect(!!pf.deepPending('NEWB', 'D')).toBe(true)
  })
})
