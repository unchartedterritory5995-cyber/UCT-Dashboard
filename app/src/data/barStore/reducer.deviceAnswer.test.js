// P3-L1 (review of #2554): DEVICE ROWS NEVER BECOME ANSWERED ROWS. Synthetic prices only. Every device rule needs "no server
// answer yet" (`!restSeen`), so whatever an answer leaves of the device's rows is painted as if the server had sent it,
// and persist writes it to mem / IndexedDB as a server-backed copy that comes back on later pages unmarked.
//   NA1 a terminal no_data answer on an entry holding device rows (and no answer yet): no row survives; unavailable
//   NA2 ...the same answer on an entry holding no device rows keeps what it held (the store-off behaviour, unchanged)
//   NA3 an answer whose tail LAGS the device: the device's newer closed rows and its newer forming bar go; the rows the
//       answer carries are the answer's; the device's OLDER rows (deeper than the answer, same basis) stay
//   NA4 ...but a live (push) bar newer than the answer is not the device's and stays
//   NA5 an answer that reaches the device's tail drops nothing
// P4-L3 (review of #2558): ...BUT THE DEVICE'S COMPLETE CANDLES ARE NOT A HOLE TO OPEN. A copy's `through` (the newest minute
// the device applied) vouches for every bucket that ends at or before it: those are complete minute rollups of the server's
// own minutes. Dropped, the newest candles the member was already looking at vanished until the stream or the next poll
// sent them again. Only what the stamp does not vouch for goes (NA3 is a copy with no stamp: it vouches for nothing).
//   NA6 a lagging answer on a copy complete through 11:30: its complete 11:20 and 11:25 candles stay (still LOCAL, so the
//       server's own rows replace them); its 11:30 forming bar, untouched by any tick, goes
//   NA7 ...a row whose bucket ends AFTER the stamp (closed by the clock, a minute or more short) goes; the one before stays
//   NA8 the server's next answer carrying those buckets replaces the kept candles with its own (a correction lands)
//   NA9 the stamp rides with the marker: set by a device copy, gone with an invalidate and with a no_data answer
// P6-L2 (review of #2565): A KILL TAKES THE STAMP'S WORD AWAY. If the device data is wrong, its "complete" candles are too.
//   NA10 after the kill (DEVICE_KILLED) a lagging first answer keeps NO device row newer than it; the rows stay until then
//   NA11 DEVICE_KILLED on an entry holding no device rows changes nothing (the same object)
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { reduce, initialState } from './reducer'
import { keyOf, ACTION, STATUS, DEV_SRC } from './types'
import { etUnix } from './__fixtures__/seededSeries'

const DAY = '2026-11-18'
const T = (m) => etUnix(DAY, m)
const NOW = (T(691)) * 1000                                       // 11:31:00 ET
const ctx = { nowMs: NOW, streamLive: true }
const K = keyOf({ sym: 'SIM', tf: '5' })
const bar = (m, k = 1) => ({ t: T(m), o: 100 * k, h: 101 * k, l: 99 * k, c: 100.5 * k, v: 10 })
const closedTo = (lastM, fromM = 570) => { const o = []; for (let m = fromM; m <= lastM; m += 5) o.push(bar(m)); return o }
const device = (bars, formingAt = null, through = null) => ({ type: ACTION.DEVICE_HIT, payload: { sym: 'SIM', bars, saved_at: T(691) * 1000,
  ...(formingAt != null ? { forming_t: T(formingAt) } : {}), ...(through != null ? { through } : {}) } })
const answer = (bars, extra = {}) => ({
  type: ACTION.REST_FULL, payload: {
    bars, contract: 1, grid: 'eth-clock', session: 'rth', cache_key: 'b1:SIM:5:eth-clock', series_rev: 1000, history_rev: 5,
    verified_through: T(690), tail_status: 'verified', developing: null, ...extra,
  },
})
/** The device copy at 11:31: 09:30 ... 11:25 closed, the 11:30 bucket forming (`through`: its stamp, none by default). */
const withDevice = (through = null) => reduce(initialState(K, ctx), device([...closedTo(685), bar(690, 1.01)], 690, through), ctx)

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW) })
afterEach(() => { vi.useRealTimers() })

describe('P3-L1 device rows never become answered rows', () => {
  it('NA1 terminal no_data on a device-rows entry: no row survives, unavailable', () => {
    const s0 = withDevice()
    expect(s0.deviceRows).toBe(true)
    const s = reduce(s0, { type: ACTION.REST_ERROR, payload: { error: 'no_data' } }, ctx)
    expect(s.restSeen).toBe(true)
    expect(s.bars).toEqual([])
    expect(s.developing).toBeNull()
    expect(s.status).toBe(STATUS.UNAVAILABLE)
    expect(s.deviceRows).toBeFalsy()
  })

  it('NA2 ...on an entry with no device rows, the same answer keeps what it held (unchanged)', () => {
    const s0 = reduce(initialState(K, ctx), { type: ACTION.IDB_HIT, payload: { bars: closedTo(685) } }, ctx)
    const s = reduce(s0, { type: ACTION.REST_ERROR, payload: { error: 'no_data' } }, ctx)
    expect(s.restSeen).toBe(true)
    expect(s.bars.length).toBe(closedTo(685).length)
  })

  it('NA3 an answer that LAGS a copy with no stamp (through 11:15): the device\'s newer rows and forming bar go', () => {
    const s = reduce(withDevice(), answer(closedTo(675, 600)), ctx)
    expect(s.restSeen).toBe(true)
    expect(s.bars.at(-1).t).toBe(T(675))                            // nothing newer than the answer's tail
    expect(s.bars.some((b) => b.t > T(675))).toBe(false)
    expect(s.developing).toBeNull()                                 // the device's 11:30 forming bar went too
    expect(s.bars[0].t).toBe(T(570))                                // the deeper device rows stay (proven basis)
    expect(s.bars.filter((b) => b.t >= T(600)).every((b) => b.src === 'rest')).toBe(true)
  })

  it('NA4 ...a live (push) bar newer than the answer is not the device\'s: it stays', () => {
    const s1 = reduce(withDevice(), { type: ACTION.PUSH_BAR, event: { sym: 'SIM', t: T(690), o: 101, h: 102, l: 100.5, c: 101.5, v: 30, rev: 7 } }, ctx)
    expect(s1.developing?.src).toBe(DEV_SRC.PUSH)
    const s = reduce(s1, answer(closedTo(675, 600)), ctx)
    expect(s.bars.some((b) => b.t > T(675) && b.src === 'local')).toBe(false)
    expect(s.developing?.t).toBe(T(690))
    expect(s.developing.src).not.toBe(DEV_SRC.LOCAL)
  })

  it('NA5 an answer that reaches the device\'s tail (its forming bar included) drops nothing', () => {
    const s = reduce(withDevice(), answer(closedTo(685, 600), { developing: { ...bar(690, 1.01), rev: 1001 } }), ctx)
    expect(s.bars.at(-1).t).toBe(T(685))
    expect(s.developing?.t).toBe(T(690))
    expect(s.bars[0].t).toBe(T(570))
  })
})

describe('P4-L3 the device\'s complete candles are kept, what its stamp does not vouch for goes', () => {
  it('NA6 a lagging answer on a copy complete through 11:30: its 11:20 and 11:25 candles stay, its forming bar goes', () => {
    const s0 = withDevice(T(690))
    expect(s0.deviceThrough).toBe(T(690))
    const s = reduce(s0, answer(closedTo(675, 600)), ctx)
    expect(s.restSeen).toBe(true)
    expect(s.bars.filter((b) => b.t > T(675)).map((b) => [b.t, b.src])).toEqual([[T(680), 'local'], [T(685), 'local']])
    expect(s.developing).toBeNull()                                 // the 11:30 bucket was forming: not complete
    expect(s.bars.filter((b) => b.t >= T(600) && b.t <= T(675)).every((b) => b.src === 'rest')).toBe(true)
  })

  it('NA7 ...a row whose bucket ends after the stamp goes; the one before it stays', () => {
    // through 11:28: the 11:20 bucket (ends 11:25) is complete; the 11:25 one (ends 11:30) is not, whatever the clock says
    const s0 = reduce(initialState(K, ctx), device(closedTo(685), null, T(688)), ctx)
    expect(s0.bars.at(-1).t).toBe(T(685))
    const s = reduce(s0, answer(closedTo(675, 600)), ctx)
    expect(s.bars.filter((b) => b.t > T(675)).map((b) => b.t)).toEqual([T(680)])
  })

  it('NA8 the server\'s next answer carrying those buckets replaces the kept candles with its own', () => {
    const s1 = reduce(withDevice(T(690)), answer(closedTo(675, 600)), ctx)
    const corrected = [...closedTo(675, 600), bar(680, 1.002), bar(685, 1.003)]
    const s = reduce(s1, answer(corrected, { series_rev: 1001 }), ctx)
    const at = (t) => s.bars.find((b) => b.t === t)
    expect([at(T(680)).src, at(T(680)).c]).toEqual(['rest', bar(680, 1.002).c])
    expect([at(T(685)).src, at(T(685)).c]).toEqual(['rest', bar(685, 1.003).c])
  })

  it('NA9 the stamp rides with the marker: set by a device copy, gone with an invalidate and with no_data', () => {
    const s0 = withDevice(T(690))
    expect([s0.deviceRows, s0.deviceThrough]).toEqual([true, T(690)])
    const inv = reduce(s0, { type: ACTION.INVALIDATE, reason: 'test' }, ctx)
    expect(inv.deviceThrough ?? null).toBeNull()
    const nd = reduce(withDevice(T(690)), { type: ACTION.REST_ERROR, payload: { error: 'no_data' } }, ctx)
    expect(nd.deviceThrough ?? null).toBeNull()
  })
})

describe('P6-L2 the kill takes the stamp\'s word away', () => {
  it('NA10 after the kill a lagging first answer keeps no device row newer than it; until then nothing moves', () => {
    const s0 = withDevice(T(690))
    const k = reduce(s0, { type: ACTION.DEVICE_KILLED }, ctx)
    expect(k.bars).toEqual(s0.bars)                                 // nothing blanked by the kill itself
    expect(k.deviceRows).toBe(true)                                 // still the device's rows: the refusal keys on it
    expect(k.deviceThrough ?? null).toBeNull()
    const s = reduce(k, answer(closedTo(675, 600)), ctx)
    expect(s.bars.some((b) => b.t > T(675))).toBe(false)
    expect(s.developing).toBeNull()
  })

  it('NA11 on an entry holding no device rows it changes nothing', () => {
    const s0 = reduce(initialState(K, ctx), { type: ACTION.IDB_HIT, payload: { bars: closedTo(685) } }, ctx)
    expect(reduce(s0, { type: ACTION.DEVICE_KILLED }, ctx)).toBe(s0)
  })
})
