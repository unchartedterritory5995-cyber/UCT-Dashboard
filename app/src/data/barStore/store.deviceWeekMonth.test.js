// H1 (review of #2537): A SHALLOW W / M NEVER COMES FROM THE DEVICE. The device derived them from its D window (~350
// sessions, and on a weekday no bar for today): the week in progress was dropped on every weekday, the month in
// progress on almost every day, the copy was shallow, and it still read CONTEXT + fresh, so the switch painted it
// at once and skipped the deep-history hold (hooks/useSymbolHandoff dailyHoldNeeded). Since zero-network PR 3.3 the
// device answers W / M ONLY from a whole D copy whose period in progress is known (deviceStore/resample.deriveServed,
// the copy saying so with `wholeFrom`). Through the real store (registry + reducer + persist + network) and the real
// prefetch facade, with a device that answers W and M with a fresh copy that does NOT say it is whole:
//   WM1 such a copy is never applied through any door (the switch's questions, the key press, the prepare, persist's
//       own hydrate / refresh), whatever the device was asked
//   WM2 the device rule never says it paints such a W or M key
//   WM3 a W or M switch asks the server exactly what it asks with the store OFF and gets exactly the same answers, and
//       the store ends in exactly the same state: the same route
//   WM4 the key press never makes a device entry for W or M from such a copy
//   WM5 D is still served (the gate is the timeframe, not the device)
//   WM6 a WHOLE copy (it says `wholeFrom`) of a W / M is the device's and paints (the lift, PR 3.3)
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { createBarStore } from './index'
import { createPrefetch } from './prefetch'
import { keyOf } from './types'
import { installFakeIndexedDB } from './testing/fakeIndexedDB'
import { fakeStream, fakeCandle, fakePrices } from './testing/fakeFeeds'
import { memClear } from '../../utils/barsMemCache'
import { DEVICE_WM_FROM_FULL_D } from '../deviceStore/tfs'

vi.mock('../../hooks/useTickerMeta', () => ({ prefetchTickerMeta: () => {} }))

const DAY = 86400
const dayUnix = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 1000
const MID = Date.UTC(2026, 10, 18, 16, 31)                 // Wed 2026-11-18 11:31 ET
const SAT = Date.UTC(2026, 10, 21, 17, 0)                  // Sat 2026-11-21 12:00 ET
const row = (t, i) => ({ t, o: 50 + i, h: 51 + i, l: 49 + i, c: 50.5 + i, v: 1000 + i })
/** 52 weekly bars labelled by their ISO Friday, ending LAST week (what the device derived mid-week). */
const WEEKS = Array.from({ length: 52 }, (_, i) => row(dayUnix('2026-11-13') - (51 - i) * 7 * DAY, i))
/** 14 monthly bars, ending LAST month (what the device derived on a day that is not the month's last). */
const MONTHS = Array.from({ length: 14 }, (_, i) => row(Date.UTC(2025, 8 + i, 1) / 1000, i))
const DAYS = Array.from({ length: 60 }, (_, i) => row(dayUnix('2026-11-17') - (59 - i) * DAY, i))

/** A device that answers every timeframe it is asked for, each copy complete through `through` (fresh). */
function fakeDevice(through, { whole = false } = {}) {
  const byTf = { W: WEEKS, M: MONTHS, D: DAYS }
  const hit = (s, t) => (s === 'NEWB' && byTf[t]
    ? { rows: byTf[t], through, savedAt: through * 1000, ...(whole ? { wholeFrom: byTf[t][0].t } : {}) } : null)
  return { peek: vi.fn((s, t) => hit(s, t)), read: vi.fn(async (s, t) => hit(s, t)) }
}
const askedFor = (dev, tfs) => [...dev.peek.mock.calls, ...dev.read.mock.calls].filter((c) => tfs.includes(c[1]))

let fakeDb
beforeAll(() => { fakeDb = installFakeIndexedDB() })
beforeEach(() => { memClear(); fakeDb._clear(); vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

function boot(device) {
  const request = vi.fn(() => new Promise(() => {}))        // the server never answers: only local copies decide
  const store = createBarStore({
    request, device, io: { idbGet: async () => null, idbGetHistoryEntry: async () => null, idbPutMonotonic: async () => {}, memPutMonotonic: () => {} },
    stream: fakeStream(), candle: fakeCandle(), prices: fakePrices(), isHidden: () => false, onVisible: () => () => {}, idle: (fn) => fn(),
    history: null,
  })
  return { store, request, pf: createPrefetch({ store, tickerMeta: () => {}, extended: () => false }) }
}

/** Every question a D/W/M switch asks, in the handoff's order: the key press (primeDeviceFor → deviceWarm), the
 *  same-task route (dailyHoldNeeded: holdsBars, deepPending, devicePaints), the daily prepare, the waiter's look. */
async function switchTo(pf, store, tf) {
  const key = keyOf({ sym: 'NEWB', tf })
  const out = {}
  out.prime = await pf.deviceWarm('NEWB', tf)
  out.afterPrime = store.peek(key) ? 'entry' : 'none'
  out.holds = pf.holdsBars('NEWB', tf)
  out.deep = !!pf.deepPending('NEWB', tf)
  out.paints = pf.devicePaints('NEWB', tf)
  out.verdict = pf.deviceVerdict('NEWB', tf)
  pf.prepareDailyForDisplay('NEWB', tf)
  await vi.advanceTimersByTimeAsync(50)
  out.paintsAfter = pf.devicePaints('NEWB', tf)
  const s = store.peek(key)
  out.entry = s ? { source: s.source, status: s.status, bars: s.bars.length, developing: !!s.developing, restSeen: s.restSeen } : null
  out.savedAt = store.persist.savedAtOf(key)
  out.through = store.persist.deviceThroughOf(key)
  return out
}

describe('H1 W and M never come from the device', () => {
  for (const [label, now, tf] of [['mid-week, W', MID, 'W'], ['mid-week, M', MID, 'M'], ['a Saturday, W', SAT, 'W'], ['a Saturday, M', SAT, 'M']]) {
    it(`WM1 + WM2 ${label}: a copy that is not whole is never applied through any door, and never paints`, async () => {
      vi.setSystemTime(now)
      const dev = fakeDevice(Math.floor(now / 1000) - 30)
      const { store, pf } = boot(dev)
      const key = keyOf({ sym: 'NEWB', tf })
      await switchTo(pf, store, tf)
      store.persist.hydrateMem(key)
      await store.persist.hydrate(key, { urgent: true })
      await store.persist.refreshDevice(key, { urgent: true })
      pf.peekBars('NEWB', tf)
      await vi.advanceTimersByTimeAsync(20)
      // with W / M off (tfs.DEVICE_WM_FROM_FULL_D, the parity evidence) the device is not even asked
      if (!DEVICE_WM_FROM_FULL_D) expect(askedFor(dev, ['W', 'M'])).toEqual([])
      expect(pf.deviceVerdict('NEWB', tf).paints).toBe(false)
      expect(pf.devicePaints('NEWB', tf)).toBe(false)
      expect(store.peek(key)?.source ?? null).not.toBe('device')
      expect(store.persist.deviceThroughOf(key)).toBeNull()
      store.dispose()
    })

    it(`WM3 ${label}: the same questions get the same answers as with the store OFF, and leave the same store`, async () => {
      vi.setSystemTime(now)
      const on = boot(fakeDevice(Math.floor(now / 1000) - 30))
      const withDevice = await switchTo(on.pf, on.store, tf)
      const onRequests = on.request.mock.calls.map((c) => c[0])
      on.store.dispose()
      memClear(); fakeDb._clear()
      vi.setSystemTime(now)
      const off = boot(null)
      const withoutDevice = await switchTo(off.pf, off.store, tf)
      expect(withDevice).toEqual(withoutDevice)
      expect(onRequests).toEqual(off.request.mock.calls.map((c) => c[0]))
      off.store.dispose()
    })
  }

  it('WM4 the key press makes no device entry for W or M from a copy that is not whole, and still primes D', async () => {
    vi.setSystemTime(MID)
    const dev = fakeDevice(Math.floor(MID / 1000) - 30)
    const { store, pf } = boot(dev)
    for (const tf of ['W', 'M']) {
      expect(await pf.deviceWarm('NEWB', tf)).toBe(false)
      expect(store.peek(keyOf({ sym: 'NEWB', tf }))?.source ?? null).not.toBe('device')
    }
    await pf.deviceWarm('NEWB', 'D')
    expect(store.peek(keyOf({ sym: 'NEWB', tf: 'D' }))).not.toBeNull()
    store.dispose()
  })

  it('WM5 D is still served: the same device is asked for the D key', async () => {
    vi.setSystemTime(SAT)
    const dev = fakeDevice(dayUnix('2026-11-21'))
    const { store, pf } = boot(dev)
    pf.peekBars('NEWB', 'D')
    await vi.advanceTimersByTimeAsync(5)
    expect(askedFor(dev, ['D']).length).toBeGreaterThan(0)
    expect(store.peek(keyOf({ sym: 'NEWB', tf: 'D' })).source).toBe('device')
    store.dispose()
  })

  it.skipIf(!DEVICE_WM_FROM_FULL_D)('WM6 a WHOLE W / M copy (wholeFrom) is the device copy: applied, and the device rule paints it (a Saturday)', async () => {
    vi.setSystemTime(SAT)
    for (const tf of ['W', 'M']) {
      const dev = fakeDevice(dayUnix('2026-11-21'), { whole: true })
      const { store, pf } = boot(dev)
      const key = keyOf({ sym: 'NEWB', tf })
      await pf.deviceWarm('NEWB', tf)
      await vi.advanceTimersByTimeAsync(20)
      expect(store.peek(key)?.source).toBe('device')
      expect(store.persist.deviceWhole(key)).toBe(true)
      expect(!!pf.deepPending('NEWB', tf)).toBe(false)
      expect(pf.devicePaints('NEWB', tf)).toBe(true)
      store.dispose()
    }
  })
})
