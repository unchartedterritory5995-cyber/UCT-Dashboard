import { describe, it, expect } from 'vitest'
import { _streamSafe } from './useRealtimePrices'

// The SSE stream's own session fields are UNTRUSTED: its change/change_pct come
// from an unseeded baseline (measured 2026-08-21 during RTH: ORCL streamed
// +0.20% while the true day move was +3.78%), and a null field in a stream
// entry clobbers a real REST value in a spread. Any moment REST is absent
// (first render, hidden-tab wake, REST blip), the raw spread painted that
// garbage % on every holdings row. The merge must take ONLY the stream's
// trusted contribution: price / volume / timestamps.

describe('_streamSafe', () => {
  it('strips the stream day-% so it can never render when REST is absent', () => {
    const merged = { ..._streamSafe({ price: 147.43, change_pct: 0.1971, change: 0.29, volume: 5 }) }
    expect(merged.price).toBe(147.43)
    expect(merged.volume).toBe(5)
    expect(merged.change_pct).toBeUndefined()   // blank beats confidently wrong
    expect(merged.change).toBeUndefined()
  })

  it('a null stream field never clobbers a real REST value', () => {
    const rest = { price: 15.0, prev_close: 14.07, change_pct: 7.75, day_open: 14.2 }
    const merged = { ...rest, ..._streamSafe({ price: 15.16, change_pct: null, prev_close: null, day_open: null }) }
    expect(merged.price).toBe(15.16)            // stream owns the tick
    expect(merged.prev_close).toBe(14.07)       // REST owns the session
    expect(merged.change_pct).toBe(7.75)
    expect(merged.day_open).toBe(14.2)
  })

  it('passes falsy/absent stream entries through untouched', () => {
    expect(_streamSafe(undefined)).toBeUndefined()
    expect(_streamSafe(null)).toBeNull()
  })
})
