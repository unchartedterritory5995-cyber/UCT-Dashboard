// No seal held (prod: 5m live-store names, 60m and D/W/M answer complete_through: null):
// polls are `since = tail − MUTABLE_WINDOW_S` deltas, never a full re-download per poll.
// A correction inside the mutable window lands through the delta; one outside it arrives
// only with a history_rev change, which forces the full read.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createRegistry } from './registry'
import { createNetwork, MUTABLE_WINDOW_S, deltaStartFor } from './network'
import { keyOf, ACTION } from './types'
import { INTRADAY_POLL_MS, TAIL_CATCHUP_MAX_TRIES } from '../../utils/intradayTailPoll'

const T0 = Date.UTC(2026, 10, 10, 15, 0)   // Tue 10:00 ET
const HOUR = 3600_000
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(T0) })
afterEach(() => { vi.useRealTimers() })

/** A store-backed 5m series that never seals: 24 h of rows up to now, editable. */
function server({ lagS = 0 } = {}) {
  const rows = new Map()
  const st = { hist: 1, rev: 1 }
  const sync = () => {
    const now = Math.floor(Date.now() / 1000)
    for (let t = Math.floor((now - 86400) / 300) * 300; t <= now; t += 300) {
      if (!rows.has(t)) rows.set(t, { t, o: 100, h: 101, l: 99, c: 100.5, v: 10 })
    }
  }
  const answer = (url) => {
    sync()
    st.rev++
    const m = /since=(\d+)/.exec(url)
    const since = m ? Number(m[1]) : null
    const now = Math.floor(Date.now() / 1000)
    const bars = [...rows.values()].filter((b) => (since == null || b.t > since) && b.t <= now - lagS).sort((a, b) => a.t - b.t)
    return {
      bars, contract: 1, grid: 'eth-clock', session: 'rth', cache_key: 'b1:SIM:5:eth-clock',
      series_rev: st.rev, history_rev: st.hist, verified_through: now, sealed_through: null,
      complete_through: null, developing: null, tail_status: 'verified',
    }
  }
  return { rows, st, answer, sync }
}

describe('no seal held → mutable-window since= deltas', () => {
  it('an hour of polls on a never-sealed 5m key: one full read, then deltas from tail − 8 h; corrections inside the window land; outside it only via history_rev → full read', async () => {
    const key = keyOf({ sym: 'SIM', tf: '5' })
    const srv = server()
    const calls = []
    const registry = createRegistry({ ctx: () => ({ nowMs: Date.now() }) })
    const net = createNetwork({
      registry, isHidden: () => false, onVisible: () => () => {},
      request: async (url) => { calls.push(url); return srv.answer(url) },
    })
    net.start(key)
    await vi.advanceTimersByTimeAsync(HOUR)

    // (1) one full read, then only deltas — on the cadence, within budget
    expect(calls[0]).not.toMatch(/since=/)
    expect(calls.slice(1).length).toBeGreaterThan(HOUR / INTRADAY_POLL_MS - 3)
    expect(calls.slice(1).every((u) => /since=/.test(u))).toBe(true)
    expect(calls.length).toBeLessThanOrEqual(HOUR / INTRADAY_POLL_MS + TAIL_CATCHUP_MAX_TRIES)
    const s = registry.getSnapshot(key)
    expect(s.sealedSpans.length).toBe(0)
    const tail = s.bars[s.bars.length - 1].t
    expect(deltaStartFor(s)).toBe(tail - MUTABLE_WINDOW_S)
    const since = Number(/since=(\d+)/.exec(calls.at(-1))[1])
    expect(since).toBeGreaterThanOrEqual(tail - 300 - MUTABLE_WINDOW_S - 1)
    expect(since).toBeLessThanOrEqual(tail - MUTABLE_WINDOW_S - 1)

    // (2) a correction INSIDE the mutable window lands with the next delta
    const inside = tail - 3600
    srv.rows.set(inside, { ...srv.rows.get(inside), c: 100.9, h: 101.2 })
    await vi.advanceTimersByTimeAsync(INTRADAY_POLL_MS + 10)
    expect(registry.getSnapshot(key).bars.find((b) => b.t === inside).c).toBe(100.9)

    // (3) a correction OUTSIDE it is not re-read by the delta…
    const outside = tail - MUTABLE_WINDOW_S - 3600
    expect(registry.getSnapshot(key).bars.find((b) => b.t === outside)).toBeTruthy()
    srv.rows.set(outside, { ...srv.rows.get(outside), c: 99.1, l: 98.8 })
    await vi.advanceTimersByTimeAsync(INTRADAY_POLL_MS + 10)
    expect(registry.getSnapshot(key).bars.find((b) => b.t === outside).c).toBe(100.5)
    // …it arrives with its history_rev (P1: a change to stored history), which forces the full read
    srv.st.hist = 2
    const n = calls.length
    await vi.advanceTimersByTimeAsync(INTRADAY_POLL_MS + 10)
    expect(calls[n]).toMatch(/since=/)            // the delta that saw the new history
    expect(calls[n + 1]).not.toMatch(/since=/)    // → the full read, at once
    const after = registry.getSnapshot(key)
    expect(after.historyRev).toBe(2)
    expect(after.bars.find((b) => b.t === outside).c).toBe(99.1)
    await vi.advanceTimersByTimeAsync(INTRADAY_POLL_MS + 10)
    expect(calls.at(-1)).toMatch(/since=/)        // and back to deltas
  })

  it('#1125: the window is measured from the SERVER tail — a push developing bar N buckets ahead never hides a correction at the server floor edge', async () => {
    const N = 6
    const key = keyOf({ sym: 'SIM', tf: '5' })
    const srv = server({ lagS: N * 300 })              // the server's stored tail lags N buckets
    const calls = []
    const registry = createRegistry({ ctx: () => ({ nowMs: Date.now(), streamLive: true }) })
    const net = createNetwork({
      registry, isHidden: () => false, onVisible: () => () => {},
      request: async (url) => { calls.push(url); return srv.answer(url) },
    })
    net.start(key)
    await vi.advanceTimersByTimeAsync(10)
    const srvTail = registry.getSnapshot(key).bars.at(-1).t
    // The push stream runs ahead: N closed buckets + a developing one past the server tail.
    const px = { o: 100, h: 101, l: 99, c: 100.5, v: 10 }
    for (let i = 1; i <= N; i++) {
      registry.dispatch(key, { type: ACTION.PUSH_FINAL, key, event: { t: srvTail + i * 300, ...px, rev: Date.now() + i, final: true } })
    }
    registry.dispatch(key, { type: ACTION.PUSH_BAR, key, event: { t: srvTail + (N + 1) * 300, ...px, rev: Date.now() + 99 } })
    const s = registry.getSnapshot(key)
    const heldTail = s.developing ? s.developing.t : s.bars.at(-1).t
    expect(heldTail).toBeGreaterThan(srvTail)                       // the push really is ahead
    expect(deltaStartFor(s)).toBe(srvTail - MUTABLE_WINDOW_S)
    // A correction exactly at the server's floor edge.
    const edge = srvTail - MUTABLE_WINDOW_S
    expect(s.bars.find((b) => b.t === edge)).toBeTruthy()
    srv.rows.set(edge, { ...srv.rows.get(edge), c: 100.9, h: 101.3 })
    await vi.advanceTimersByTimeAsync(INTRADAY_POLL_MS + 10)
    const since = Number(/since=(\d+)/.exec(calls.at(-1))[1])
    expect(since).toBeLessThan(edge)
    expect(registry.getSnapshot(key).bars.find((b) => b.t === edge).c).toBe(100.9)
    net.stop(key)
  })

  it('full reads only where they belong: first load, needsFull, D/W/M, windowed keys', () => {
    const k5 = keyOf({ sym: 'SIM', tf: '5' })
    const base = { key: k5, sealedSpans: [], deltaFrom: null, needsFull: false, restSeen: true, developing: null, bars: [{ t: 1_700_000_000, src: 'rest' }] }
    expect(deltaStartFor({ ...base, restSeen: false })).toBe(null)
    expect(deltaStartFor({ ...base, needsFull: true })).toBe(null)
    expect(deltaStartFor({ ...base, key: keyOf({ sym: 'SIM', tf: 'D' }) })).toBe(null)
    expect(deltaStartFor({ ...base, key: keyOf({ sym: 'SIM', tf: '5', window: { to: 1_700_000_000 } }) })).toBe(null)
    expect(deltaStartFor(base)).toBe(1_700_000_000 - MUTABLE_WINDOW_S)
  })
})
