// @vitest-environment jsdom
// P6-L2 (review of #2565; the rollback's gap, review of #2563 "# PR 2537"): A KILL STOPS DEVICE PAINTS IN AN OPEN PAGE.
// A live kill (`uct_device_store=0` / `purge`, or `uct_chart_speed=0`) reaches an open page on the device client's visible
// beat (deviceStoreKilledNow): the worker stops, every read answers null. But the device rows ALREADY in the bar store's
// registry stayed eligible as first frames, so a fresh copy still painted at a switch until that key's answer (outside
// the session: until a reload). If a kill is pulled because the device data is wrong, that is exactly the data that must
// stop painting. Through the real store (registry + reducer + persist + network) and the real prefetch facade:
//   DK1 the ONE refusal says 'killed' for a copy holding device rows and no answer, before any other reason; not for an
//       answered entry, not for an entry with no device rows
//   DK2 before the kill a fresh device copy paints at once; once the kill is seen it does not, at any of the switch's
//       doors (the device rule, its look, the prepare), and the switch asks the server
//   DK3 at the kill the store re-asks the server for every key holding device rows (the network's kick: a chart on it
//       gets the answer now, not at its next poll) and the copy's stamp vouches for nothing any more; nothing is blanked
//   DK4 store off (no device source): a kill seen changes nothing, asks nothing
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { createBarStore } from './index'
import { createPrefetch, deviceRefusalOf } from './prefetch'
import { keyOf, ACTION } from './types'
import { installFakeIndexedDB } from './testing/fakeIndexedDB'
import { fakeStream, fakeCandle, fakePrices } from './testing/fakeFeeds'
import { memClear } from '../../utils/barsMemCache'
import * as speed from '../../lib/chartSpeed'

vi.mock('../../hooks/useTickerMeta', () => ({ prefetchTickerMeta: () => {} }))

const OPEN = Date.UTC(2026, 10, 18, 14, 30) / 1000             // Wed 2026-11-18 09:30 ET
const T = (etMin) => OPEN + (etMin - 570) * 60
const bar = (m) => ({ t: T(m), o: 50, h: 50.5, l: 49.5, c: 50.25, v: 1000 })
const closedTo = (lastM) => { const o = []; for (let m = 570; m <= lastM; m += 5) o.push(bar(m)); return o }
/** 10:07:30: complete through 10:07, the 10:05 bucket forming: fresh, paints. */
const FRESH = { rows: [...closedTo(600), bar(605)], through: T(607), savedAt: T(607) * 1000, formingT: T(605) }
const KILL = () => { document.cookie = 'uct_device_store=0; path=/'; return speed.deviceStoreKilledNow() }

let fakeDb
beforeAll(() => { fakeDb = installFakeIndexedDB() })
beforeEach(() => {
  memClear(); fakeDb._clear(); vi.useFakeTimers(); vi.setSystemTime((T(607) + 30) * 1000)
  document.cookie = 'uct_device_store=; max-age=0; path=/'
  speed.__resetChartSpeedForTests()
})
afterEach(() => {
  vi.useRealTimers()
  document.cookie = 'uct_device_store=; max-age=0; path=/'
  speed.__resetChartSpeedForTests()
})

function boot({ device = undefined, hit = FRESH } = {}) {
  const request = vi.fn(() => new Promise(() => {}))
  const dev = device !== undefined ? device
    : { peek: vi.fn((s, t) => (s === 'NEWB' && t === '5' ? hit : null)), read: vi.fn(async (s, t) => (s === 'NEWB' && t === '5' ? hit : null)) }
  const store = createBarStore({
    request, device: dev, history: null,
    io: { idbGet: async () => null, idbGetHistoryEntry: async () => null, idbPutMonotonic: async () => {}, memPutMonotonic: () => {} },
    stream: fakeStream(), candle: fakeCandle(), prices: fakePrices(), isHidden: () => false, onVisible: () => () => {}, idle: (fn) => fn(),
  })
  return { store, request, pf: createPrefetch({ store, tickerMeta: () => {}, extended: () => false }), key: keyOf({ sym: 'NEWB', tf: '5' }) }
}

describe('P6-L2 a kill seen on an open page stops device paints', () => {
  it('DK1 the one refusal says killed for device rows with no answer, first; never for an answered entry or one without', () => {
    const { store, pf, key } = boot()
    pf.peekDisplayable('NEWB', '5')
    const s = store.peek(key)
    expect(s.deviceRows).toBe(true)
    const nowMs = Date.now()
    expect(deviceRefusalOf(s, { through: T(607), nowMs })).toBeNull()                     // (the control: fresh)
    expect(deviceRefusalOf(s, { through: T(607), nowMs, killed: true })).toBe('killed')
    expect(deviceRefusalOf(s, { through: T(600), nowMs, extended: true, killed: true })).toBe('killed')
    expect(deviceRefusalOf({ ...s, restSeen: true }, { through: T(607), nowMs, killed: true })).toBeNull()
    expect(deviceRefusalOf({ ...s, deviceRows: false }, { through: T(607), nowMs, killed: true })).toBeNull()
    store.dispose()
  })

  it('DK2 before the kill the copy paints at once; once it is seen, no door paints it and the switch asks the server', async () => {
    const { store, request, pf } = boot()
    expect(pf.peekDisplayable('NEWB', '5')).toBe(true)
    expect(pf.deviceVerdict('NEWB', '5', { showExtended: false })).toMatchObject({ paints: true, reason: 'paints' })
    expect(KILL()).toBe(true)                                        // the client's beat reads the jar fresh
    expect(pf.deviceVerdict('NEWB', '5', { showExtended: false })).toMatchObject({ paints: false, reason: 'killed', held: 'device' })
    expect(pf.peekDisplayable('NEWB', '5')).toBe(false)
    expect(pf.devicePaints('NEWB', '5')).toBe(false)
    let outcome = null
    pf.prepareForDisplay('NEWB', '5').then((o) => { outcome = o })
    await vi.advanceTimersByTimeAsync(200)
    expect(outcome).toBeNull()                                       // not 'current' on the device copy...
    expect(request.mock.calls.some((c) => String(c[0]).includes('/api/bars/NEWB'))).toBe(true)   // ...the server is asked
    store.dispose()
  })

  it('DK3 at the kill: every key holding device rows is re-asked now, its stamp vouches for nothing, nothing is blanked', () => {
    const { store, pf, key } = boot()
    pf.peekDisplayable('NEWB', '5')
    const other = keyOf({ sym: 'OTHR', tf: '5' })
    store.registry.dispatch(other, { type: ACTION.MEM_HIT, key: other, payload: { sym: 'OTHR', bars: closedTo(600) } })
    const before = store.peek(key)
    expect(store.persist.deviceThroughOf(key)).toBe(T(607))
    expect(before.deviceThrough).toBe(T(607))
    const kick = vi.spyOn(store.network, 'kick')
    KILL()
    expect(kick.mock.calls.map((c) => c[0])).toEqual([key])           // the device-rows key, and only it
    const s = store.peek(key)
    expect(s.deviceThrough ?? null).toBeNull()
    expect(s.bars).toEqual(before.bars)                              // nothing blanked
    expect(s.developing).toEqual(before.developing)
    KILL()                                                           // a later beat: nothing again
    expect(kick).toHaveBeenCalledTimes(1)
    store.dispose()
  })

  it('DK4 store off (no device source): a kill seen changes nothing and asks nothing', () => {
    const { store, request, key } = boot({ device: null })
    store.registry.dispatch(key, { type: ACTION.MEM_HIT, key, payload: { sym: 'NEWB', bars: closedTo(600) } })
    const before = store.peek(key)
    const kick = vi.spyOn(store.network, 'kick')
    KILL()
    expect(store.peek(key)).toBe(before)
    expect(kick).not.toHaveBeenCalled()
    expect(request).not.toHaveBeenCalled()
    store.dispose()
  })
})
