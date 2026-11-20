// The stream's connect burst restates closed minutes the /api/bars answer already holds (owner 2026-11-20:
// typing SPY / QQQ / IWM on 1m reached the live candle 1-4 s after paint). Measured on production: the
// last ~15 closed minutes arrive as `final` frames with a `rev`, value-identical to the answer's rows,
// which carry none. Each one re-sourced its row and bumped baseRev (a full chart rebuild) in front of
// the forming candle. A restatement is a no-op; a correction still lands. Synthetic prices only.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { reduce, initialState } from './reducer'
import { keyOf } from './types'
import { etUnix } from './__fixtures__/seededSeries'

const DAY = '2026-11-10'
const T = (min) => etUnix(DAY, min)                    // ET minute of day -> unix s
const bar = (t, o = 100, h = 101, l = 99, c = 100.5, v = 10) => ({ t, o, h, l, c, v })
const NOW = (T(16 * 60 + 31) + 20) * 1000              // 16:31:20 ET, after hours
const ctx = { nowMs: NOW, streamLive: true }
const K1 = keyOf({ sym: 'SIM', tf: '1', session: 'eth' })
const frame = (b, rev, final = true) => ({ type: final ? 'push-final' : 'push-bar', event: { bar: { ...b, t: b.t * 1000, final }, rev, final } })

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW) })
afterEach(() => { vi.useRealTimers() })

function answered() {
  const rows = []
  for (let m = 16 * 60 + 10; m <= 16 * 60 + 30; m++) rows.push(bar(T(m), 100 + (m % 7), 102 + (m % 7), 99, 101, 10 + m))
  // the production answer's shape: a contract answer whose tail is current but not complete (complete_through
  // null), so its rows are NOT sealed and a live final competes for them
  const payload = {
    bars: rows, contract: 1, grid: 'eth-clock', session: 'eth', cache_key: 'b1:SIM:1:eth-clock',
    series_rev: 1000, history_rev: 5, verified_through: T(16 * 60 + 31), complete_through: null, tail_status: 'current',
  }
  const s = reduce(initialState(K1, ctx), { type: 'rest-full', payload }, ctx)
  expect(s.sealedSpans?.length ?? 0).toBe(0)
  return { rows, s }
}

describe('stream connect burst · finals that restate held rows', () => {
  it('a burst of value-identical finals changes nothing: same snapshot, no baseRev bump', () => {
    const { rows, s } = answered()
    let cur = s
    for (const r of rows.slice(-15)) cur = reduce(cur, frame(r, 9e12 + r.t), ctx)
    expect(cur).toBe(s)
    expect(cur.baseRev).toBe(s.baseRev)
  })

  it('the forming candle after the burst is the only change', () => {
    const { rows, s } = answered()
    let cur = s
    for (const r of rows.slice(-15)) cur = reduce(cur, frame(r, 9e12 + r.t), ctx)
    const forming = bar(T(16 * 60 + 31), 101, 101.5, 100.8, 101.2, 3)
    const after = reduce(cur, frame(forming, 9e12 + forming.t, false), ctx)
    expect(after.developing?.t).toBe(forming.t)
    expect(after.baseRev).toBe(s.baseRev)
  })

  it('a final whose values differ is a correction and still replaces the row', () => {
    const { rows, s } = answered()
    const r = rows[rows.length - 2]
    const corrected = { ...r, h: r.h + 1, v: r.v + 5 }
    const after = reduce(s, frame(corrected, 9e12 + r.t), ctx)
    expect(after.baseRev).toBe(s.baseRev + 1)
    const row = after.bars.find((b) => b.t === r.t)
    expect(row.h).toBe(corrected.h)
    expect(row.v).toBe(corrected.v)
  })
})
