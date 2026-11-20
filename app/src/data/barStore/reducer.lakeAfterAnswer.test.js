// LAKE DEPTH JOINED AFTER A SERVER ANSWER SURVIVES THE NEXT FULL ANSWER (2026-11-19).
// The lake's older rows join an answered entry as LOCAL rows, proven on the held basis by their
// overlap (applyLocal, restSeen branch), but they were stored WITHOUT a basis stamp. Every row the
// branch keeps is OLDER than the answer, so the next full answer of the same series shares no bar
// with them: basisVerdict said 'unknown' and a full answer that names its adj_basis dropped them all,
// the chart shrinking to the answer's window until the lake joined again ("1,000 bars, then the
// rest"). Proven rows now carry the held adj_basis; another basis still resets. Synthetic prices.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { reduce, initialState } from './reducer'
import { keyOf } from './types'
import { etUnix } from './__fixtures__/seededSeries'

const DAYS = ['2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-09']
const TODAY = '2026-11-10'
const T = (d, m) => etUnix(d, m)
const NOW = T(TODAY, 10 * 60 + 12) * 1000                 // 10:12 ET
const ctx = { nowMs: NOW, streamLive: true }
const K = keyOf({ sym: 'SIM', tf: '5' })
const bar = (t, k = 1) => ({ t, o: 100 * k, h: 101 * k, l: 99 * k, c: 100.5 * k, v: 10 })
const day = (d, k = 1) => { const o = []; for (let m = 570; m < 960; m += 5) o.push(bar(T(d, m), k)); return o }
const morning = (k = 1) => [570, 575, 580, 585].map((m) => bar(T(TODAY, m), k))
const full = (bars, x = {}) => ({ type: 'rest-full', payload: { bars, contract: 1, grid: 'session', session: 'rth',
  cache_key: 'b1:SIM:5:session', series_rev: 3000, history_rev: 5, adj_basis: 'A',
  verified_through: Math.floor(NOW / 1000) - 5, tail_status: 'verified', ...x } })
const lakeHit = (bars) => ({ type: 'lake-hit', payload: { sym: 'SIM', bars } })

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW) })
afterEach(() => { vi.useRealTimers() })

function answeredThenLake() {
  const answered = reduce(initialState(K, ctx), full([...day('2026-11-09'), ...morning()]), ctx)
  // the lake's whole depth, overlapping the answer on 11-09 (that overlap proves the basis)
  const s = reduce(answered, lakeHit(DAYS.flatMap((d) => day(d))), ctx)
  return { answered, s }
}

describe('lake depth joined after a server answer', () => {
  it('joins (older rows only) and is KEPT by the next full answer of the same basis', () => {
    const { answered, s } = answeredThenLake()
    expect(s.bars.length).toBeGreaterThan(answered.bars.length)
    expect(s.bars[0].t).toBe(T('2026-11-03', 570))
    const again = reduce(s, full([...day('2026-11-09'), ...morning()], { series_rev: 3001 }), ctx)
    expect(again.bars[0].t).toBe(T('2026-11-03', 570))                    // the depth is still there
    expect(again.bars.length).toBe(s.bars.length)
    expect(again.invalidatedFor).not.toBe('basis')
  })

  it('a full answer on ANOTHER basis still drops them (a split is never drawn as one series)', () => {
    const { s } = answeredThenLake()
    const split = reduce(s, full([...day('2026-11-09', 0.5), ...morning(0.5)], { series_rev: 3001, adj_basis: 'B' }), ctx)
    expect(split.bars[0].t).toBe(T('2026-11-09', 570))
    expect(new Set(split.bars.map((b) => b.o / 100))).toEqual(new Set([0.5]))
  })
})
