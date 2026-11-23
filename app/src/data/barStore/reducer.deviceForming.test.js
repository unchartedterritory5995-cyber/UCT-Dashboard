// M1 (review of #2537): A BUCKET THE DEVICE CANNOT VOUCH FOR IS NEVER A CLOSED BAR. Synthetic prices only.
// The device copy may end with the bucket in progress, relative to the newest minute it applied (forming.js, live.js);
// just after that bucket's END, before its last minute's frame lands (~7-10 s), the wall clock alone said "ended" and
// the reducer filed it CLOSED, one minute short; the server's answer then changed the candle. Now:
//   F1 a device copy whose payload names its last row as forming (`forming_t`) puts that row in the developing bar,
//      whatever the clock says; a copy that names none keeps the clock rule (a complete bucket is a closed row)
//   F2 the marker is the device's: no other copy's payload is read for it
// ...and the other half of the same roll (pre-existing, made more frequent by F1): the device's OWN earlier forming bar
// (a LOCAL developing bar) is superseded by the device's newer copy, never merged over the complete bucket it brings:
//   S1 a newer copy that holds the bucket complete and the next one forming: the complete values win
//   S2 a newer copy of complete buckets only: the same
//   S3 a LIVE developing bar (push) is not the device's: a device copy never drops it
//   S4 ...nor one a TICK touched (the tick fallback keeps the bar LOCAL and marks it `ticked`: a live observation, the
//      distinction applyRest makes too; review of #2549 P2-L1)
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { reduce, initialState } from './reducer'
import { keyOf, ACTION, DEV_SRC } from './types'
import { etUnix } from './__fixtures__/seededSeries'

const DAY = '2026-11-18'
const T = (m) => etUnix(DAY, m)                                // ET minute of day → unix s
const at = (m, s = 0) => (T(m) + s) * 1000                     // ...→ ms, for ctx.nowMs
const K = keyOf({ sym: 'SIM', tf: '5' })
const bar = (m, k = 1) => ({ t: T(m), o: 100 * k, h: 101 * k, l: 99 * k, c: 100.5 * k, v: 10 * k })
const closedTo = (lastM) => { const o = []; for (let m = 570; m <= lastM; m += 5) o.push(bar(m)); return o }
const device = (bars, { through, formingAt = null } = {}) => ({
  type: ACTION.DEVICE_HIT, payload: { sym: 'SIM', bars, saved_at: through * 1000, ...(formingAt != null ? { forming_t: T(formingAt) } : {}) },
})
const ctxAt = (ms) => ({ nowMs: ms, streamLive: true })
const row = (s, m) => s.bars.find((b) => b.t === T(m))
const ohlcv = (b) => b && [b.o, b.h, b.l, b.c, b.v]

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }) })
afterEach(() => { vi.useRealTimers() })

describe('M1 the bucket roll: a bucket the device cannot vouch for is never filed closed', () => {
  // 10:05:05 ET: the 10:00 bucket ended five seconds ago; the device has applied minutes through 10:03 (through 10:04:00)
  const NOW = at(605, 5)
  const SHORT = { ...bar(600, 1.01), c: 100.7 }                // the 10:00 bucket without its 10:04 minute

  it('F1 named forming: the developing bar, after the bucket\'s end too; the closed rows stop before it', () => {
    vi.setSystemTime(NOW)
    const s = reduce(initialState(K, ctxAt(NOW)), device([...closedTo(595), SHORT], { through: T(604), formingAt: 600 }), ctxAt(NOW))
    expect(s.developing?.t).toBe(T(600))
    expect(s.developing.src).toBe(DEV_SRC.LOCAL)
    expect([s.developing.o, s.developing.h, s.developing.l, s.developing.c, s.developing.v]).toEqual(ohlcv(SHORT))
    expect(s.bars.at(-1).t).toBe(T(595))
    expect(row(s, 600)).toBeUndefined()
  })

  it('F1 named none (a copy of complete buckets): the clock rule, as before', () => {
    vi.setSystemTime(NOW)
    const s = reduce(initialState(K, ctxAt(NOW)), device([...closedTo(600)], { through: T(605) }), ctxAt(NOW))
    expect(s.bars.at(-1).t).toBe(T(600))
    expect(s.developing).toBeNull()
  })

  it('F2 the marker is the device\'s: a saved copy\'s payload is never read for it', () => {
    vi.setSystemTime(NOW)
    const saved = { type: ACTION.IDB_HIT, payload: { bars: [...closedTo(595), SHORT], forming_t: T(600) } }
    const s = reduce(initialState(K, ctxAt(NOW)), saved, ctxAt(NOW))
    expect(s.bars.at(-1).t).toBe(T(600))
    expect(s.developing).toBeNull()
  })
})

describe('M1 the device\'s own earlier forming bar is superseded by its newer copy', () => {
  // 10:02:10: the copy ends with the 10:00 bucket, two minutes into it (the clock says forming)
  const EARLY = at(602, 10)
  const A = { ...bar(600, 1.02), c: 101.9, v: 4 }
  const first = () => reduce(initialState(K, ctxAt(EARLY)), device([...closedTo(595), A], { through: T(602) }), ctxAt(EARLY))
  const B = { ...bar(600, 1.03), h: 104.5, c: 103.1, v: 11 }  // the 10:00 bucket COMPLETE, as the device has it at 10:07

  it('S1 a newer copy holding the bucket complete and the next forming: the complete bucket is the closed row', () => {
    const s0 = first()
    expect(s0.developing?.t).toBe(T(600))
    const LATER = at(607, 10)
    vi.setSystemTime(LATER)
    const NEXT = bar(605, 1.04)
    const s = reduce(s0, device([...closedTo(595), B, NEXT], { through: T(607), formingAt: 605 }), ctxAt(LATER))
    expect(ohlcv(row(s, 600))).toEqual(ohlcv(B))
    expect(s.developing?.t).toBe(T(605))
    expect(s.developing.c).toBe(NEXT.c)
  })

  it('S2 a newer copy of complete buckets only: the same', () => {
    const s0 = first()
    const LATER = at(610, 5)
    vi.setSystemTime(LATER)
    const s = reduce(s0, device([...closedTo(595), B, bar(605, 1.04)], { through: T(610) }), ctxAt(LATER))
    expect(ohlcv(row(s, 600))).toEqual(ohlcv(B))
    expect(s.developing).toBeNull()
  })

  it('S3 a live (push) developing bar is not the device\'s: the device copy never drops it', () => {
    const s0 = first()
    const PUSHED = at(603, 2)
    vi.setSystemTime(PUSHED)
    const live = { sym: 'SIM', t: T(600), o: A.o, h: 106, l: A.l, c: 105.5, v: 40, rev: 7 }
    const s1 = reduce(s0, { type: ACTION.PUSH_BAR, event: live }, ctxAt(PUSHED))
    expect(s1.developing?.src).toBe(DEV_SRC.PUSH)
    const pushed = ohlcv(s1.developing)
    const s = reduce(s1, device([...closedTo(595), { ...A, c: 102.2, v: 6 }], { through: T(603), formingAt: 600 }), ctxAt(PUSHED))
    expect(s.developing?.src).toBe(DEV_SRC.PUSH)
    expect(ohlcv(s.developing)).toEqual(pushed)
  })

  it('S4 a tick-touched device bar is not the device's to drop: the tick's high and close survive a newer copy', () => {
    const s0 = first()
    const TICKED = at(602, 40)
    vi.setSystemTime(TICKED)
    const down = { nowMs: TICKED, streamLive: false }                // the push stream is not delivering: ticks fold in
    const s1 = reduce(s0, { type: ACTION.TICK_FALLBACK, event: { price: 104.4, ts: T(602) + 40 } }, down)
    expect(s1.developing?.ticked).toBe(true)
    expect(s1.developing.src).toBe(DEV_SRC.LOCAL)                     // (still LOCAL: what made the supersede drop it)
    const ticked = ohlcv(s1.developing)
    expect(ticked[1]).toBe(104.4)
    const NEWER = at(603, 5)
    vi.setSystemTime(NEWER)
    const s = reduce(s1, device([...closedTo(595), { ...A, c: 102.2, v: 6 }], { through: T(603), formingAt: 600 }), { nowMs: NEWER, streamLive: false })
    expect(s.developing?.ticked).toBe(true)
    expect(ohlcv(s.developing)).toEqual(ticked)
  })
})
