import { describe, it, expect } from 'vitest'
import { classifyLiveBar } from './liveBarClassify'
import { computeBarTime } from './barTime'

// A weekday-session UTC second (Mon 2026-06-15 ~14:00 ET = 18:00 UTC).
const MON_1400_ET = Math.floor(Date.UTC(2026, 5, 15, 18, 0, 0) / 1000)

describe('classifyLiveBar — intraday (timestamp-driven)', () => {
  it('new bar when the tick crosses into the IMMEDIATE next period', () => {
    const last = { time: computeBarTime('60', MON_1400_ET), close: 7.0 }
    const d = classifyLiveBar({ tf: '60', last, live: {}, tickSec: MON_1400_ET + 3600 })
    expect(d.kind).toBe('new')
    expect(typeof d.time).toBe('number')
  })

  it('new bar for the immediate next 5m bucket (contiguous rollover)', () => {
    const last = { time: computeBarTime('5', MON_1400_ET), close: 390 }
    const d = classifyLiveBar({ tf: '5', last, live: {}, tickSec: MON_1400_ET + 5 * 60 })
    expect(d.kind).toBe('new')
  })

  it('SKIP a timestamped tick that jumps MORE than one interval past a stale/holed tail', () => {
    // last bar is 1h stale on a 5m chart; a live tick at "now" (12 buckets ahead)
    // must NOT plant a lone candle detached over the hole — that advances the
    // newest-bar time and masks the stale tail from the freshness gate, so the
    // delta poll never backfills the missing bars. SKIP → the full refetch fills
    // the gap, then the next tick plants contiguously.
    const last = { time: computeBarTime('5', MON_1400_ET), close: 390 }
    const d = classifyLiveBar({ tf: '5', last, live: {}, tickSec: MON_1400_ET + 60 * 60 })
    expect(d.kind).toBe('skip')
  })

  it('update when the tick is in the same period', () => {
    const last = { time: computeBarTime('60', MON_1400_ET), close: 7.0 }
    const d = classifyLiveBar({ tf: '60', last, live: {}, tickSec: MON_1400_ET + 5 })
    expect(d.kind).toBe('update')
  })

  it('update (never new) when the tick has no timestamp AND no nowSec', () => {
    const last = { time: computeBarTime('5', MON_1400_ET), close: 7.0 }
    const d = classifyLiveBar({ tf: '5', last, live: {}, tickSec: undefined })
    expect(d.kind).toBe('update')
  })

  it('no-timestamp tick folds into last when last IS the current bucket', () => {
    // REST floor (no tickSec) but the last bar is the current 5m bucket → update.
    const last = { time: computeBarTime('5', MON_1400_ET), close: 7.0 }
    const d = classifyLiveBar({ tf: '5', last, live: {}, tickSec: undefined, nowSec: MON_1400_ET + 30 })
    expect(d.kind).toBe('update')
  })

  it('SKIP a no-timestamp tick when now is past the stale last bucket (no giant candle)', () => {
    // last bar is ~90 min stale; a REST tick (no timestamp) must NOT fold the
    // current price onto it (that fuses the whole gap into one giant candle).
    const last = { time: computeBarTime('5', MON_1400_ET), close: 390 }
    const d = classifyLiveBar({ tf: '5', last, live: {}, tickSec: undefined, nowSec: MON_1400_ET + 90 * 60 })
    expect(d.kind).toBe('skip')
  })
})

describe('classifyLiveBar — daily, SSE healthy (timestamp present)', () => {
  it('new daily bar when a newer session is confirmed by day_open', () => {
    const last = { time: '2026-06-12', close: 6.75 }
    const d = classifyLiveBar({
      tf: 'D', last, live: { day_open: 7.03, prev_close: 6.75 }, tickSec: MON_1400_ET,
    })
    expect(d).toEqual({ kind: 'new', time: '2026-06-15' })
  })

  it('skip (do NOT corrupt yesterday) on a new day with no session yet', () => {
    const last = { time: '2026-06-12', close: 6.75 }
    const d = classifyLiveBar({
      tf: 'D', last, live: { day_open: 0, prev_close: 6.75 }, tickSec: MON_1400_ET,
    })
    expect(d.kind).toBe('skip')
  })

  it('update the same-session bar (tick within today)', () => {
    const last = { time: '2026-06-15', close: 7.0 }
    const d = classifyLiveBar({
      tf: 'D', last, live: { day_open: 7.03, prev_close: 6.75 }, tickSec: MON_1400_ET,
    })
    expect(d.kind).toBe('update')
  })
})

describe('classifyLiveBar — daily, REST floor (no timestamp = Frankenstein case)', () => {
  it('THE BUG: recovers a new daily bar from the snapshot when last==prev_close', () => {
    // PAYO 2026-06-15: cache stuck on Fri 6/12 (close 6.75); live snapshot has
    // day_open 7.03 + prev_close 6.75 but NO updated_at. Must start a NEW 6/15
    // bar, not fuse 7.03 onto the 6/12 candle.
    const last = { time: '2026-06-12', close: 6.75 }
    const nowSec = MON_1400_ET
    const d = classifyLiveBar({
      tf: 'D', last, live: { day_open: 7.03, prev_close: 6.75, day_high: 7.05, day_low: 6.99 },
      tickSec: undefined, nowSec,
    })
    expect(d).toEqual({ kind: 'new', time: '2026-06-15' })
  })

  it('weekend-safe: prior-close two sessions back does NOT match → no phantom', () => {
    // Saturday: chart last bar is Friday's close; snapshot prev_close is
    // Thursday's (the session before Friday). No match → update only, the
    // identical-price weekend tick is a harmless no-op (never a Sat candle).
    const last = { time: '2026-06-12', close: 6.75 }   // Friday bar
    const sat = Math.floor(Date.UTC(2026, 5, 13, 16, 0, 0) / 1000)
    const d = classifyLiveBar({
      tf: 'D', last, live: { day_open: 6.70, prev_close: 6.40 /* Thu */ }, tickSec: undefined, nowSec: sat,
    })
    expect(d.kind).toBe('update')
  })

  it('same-session fresh cache: no prior-close match → update (no spurious bar)', () => {
    // Cache already has today's bar (last.close = current price, not prev_close).
    const last = { time: '2026-06-15', close: 7.02 }
    const d = classifyLiveBar({
      tf: 'D', last, live: { day_open: 7.03, prev_close: 6.75 }, tickSec: undefined, nowSec: MON_1400_ET,
    })
    expect(d.kind).toBe('update')
  })

  it('no prev_close in snapshot → cannot confirm → update (safe default)', () => {
    const last = { time: '2026-06-12', close: 6.75 }
    const d = classifyLiveBar({
      tf: 'D', last, live: { day_open: 7.03 }, tickSec: undefined, nowSec: MON_1400_ET,
    })
    expect(d.kind).toBe('update')
  })
})

describe('classifyLiveBar — guards', () => {
  it('skip when there is no last bar', () => {
    expect(classifyLiveBar({ tf: 'D', last: null, live: {}, tickSec: MON_1400_ET }).kind).toBe('skip')
  })
})
