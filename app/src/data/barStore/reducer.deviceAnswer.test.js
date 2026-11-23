// P3-L1 (review of #2554): DEVICE ROWS NEVER BECOME ANSWERED ROWS. Synthetic prices only. Every device rule needs "no server
// answer yet" (`!restSeen`), so whatever an answer leaves of the device's rows is painted as if the server had sent it,
// and persist writes it to mem / IndexedDB as a server-backed copy that comes back on later pages unmarked.
//   NA1 a terminal no_data answer on an entry holding device rows (and no answer yet): no row survives; unavailable
//   NA2 ...the same answer on an entry holding no device rows keeps what it held (the store-off behaviour, unchanged)
//   NA3 an answer whose tail LAGS the device: the device's newer closed rows and its newer forming bar go; the rows the
//       answer carries are the answer's; the device's OLDER rows (deeper than the answer, same basis) stay
//   NA4 ...but a live (push) bar newer than the answer is not the device's and stays
//   NA5 an answer that reaches the device's tail drops nothing
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
const device = (bars, formingAt = null) => ({ type: ACTION.DEVICE_HIT, payload: { sym: 'SIM', bars, saved_at: T(691) * 1000, ...(formingAt != null ? { forming_t: T(formingAt) } : {}) } })
const answer = (bars, extra = {}) => ({
  type: ACTION.REST_FULL, payload: {
    bars, contract: 1, grid: 'eth-clock', session: 'rth', cache_key: 'b1:SIM:5:eth-clock', series_rev: 1000, history_rev: 5,
    verified_through: T(690), tail_status: 'verified', developing: null, ...extra,
  },
})
/** The device copy at 11:31: 09:30 ... 11:25 closed, the 11:30 bucket forming. */
const withDevice = () => reduce(initialState(K, ctx), device([...closedTo(685), bar(690, 1.01)], 690), ctx)

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

  it('NA3 an answer that LAGS the device (through 11:15): the device\'s newer rows and forming bar go', () => {
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
