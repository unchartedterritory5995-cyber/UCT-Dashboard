import { describe, it, expect } from 'vitest'
import { scanEvents, zweigEma } from './breadthEvents'

const base = { date: '2026-08-01', advancing: 2000, declining: 2000, up_vol_ratio: 1.0,
               mcclellan_osc: 0, hvc_52w: 5, atr_ext_7: 5, new_52w_lows: 10, is_ftd: 0 }
const mkRows = (n, over = () => ({})) =>
  Array.from({ length: n }, (_, i) => ({ ...base, date: `2026-08-${String(n - i).padStart(2, '0')}`, ...over(i) }))

const find = (events, key) => events.find(e => e.key === key)

describe('90% volume days', () => {
  // The pair that makes this fixture discriminate: 9.5 is a real 90% up day
  // (share 0.905); 0.95 is an ordinary session (share 0.487). A detector that
  // read the ratio as a share would get both of these backwards.
  it('fires on a ratio of 9.5 and not on 0.95', () => {
    const hot = scanEvents(mkRows(30, i => (i === 0 ? { up_vol_ratio: 9.5 } : {})))
    expect(find(hot, 'vol90up').firedToday).toBe(true)

    const cold = scanEvents(mkRows(30, i => (i === 0 ? { up_vol_ratio: 0.95 } : {})))
    expect(find(cold, 'vol90up').firedToday).toBe(false)
  })

  it('fires the down side at a ratio of 0.1', () => {
    const dn = scanEvents(mkRows(30, i => (i === 0 ? { up_vol_ratio: 0.1 } : {})))
    expect(find(dn, 'vol90dn').firedToday).toBe(true)
  })
})

describe('follow-through day', () => {
  it('reads the collected flag rather than re-deriving it', () => {
    const rows = mkRows(30, i => (i === 4 ? { is_ftd: 1 } : {}))
    const ftd = find(scanEvents(rows), 'ftd')
    expect(ftd.firedToday).toBe(false)
    expect(ftd.sessionsAgo).toBe(4)
  })
})

describe('Zweig breadth thrust', () => {
  it('fires when the 10-day EMA climbs from below 0.40 to above 0.615', () => {
    // oldest 12 sessions deeply negative, then a sharp run of all-advancing days
    const rows = mkRows(40, i => (i < 12
      ? { advancing: 4500, declining: 500 }    // newest 12 = thrust
      : { advancing: 200, declining: 4800 }))  // older = washed out
    expect(find(scanEvents(rows), 'zweig').firedToday).toBe(true)
  })

  it('refuses when advance/decline coverage is missing rather than guessing', () => {
    const rows = mkRows(40, () => ({ advancing: null, declining: null }))
    const z = find(scanEvents(rows), 'zweig')
    expect(z.firedToday).toBe(false)
    expect(z.unavailable).toMatch(/advance\/decline/i)
  })
})

describe('tier-based events', () => {
  it('defers to the metric own getTier instead of a fresh threshold', () => {
    // atr_ext_7 getTier returns 'g3' above 50 — the registry owns that number.
    const rows = mkRows(30, i => (i === 0 ? { atr_ext_7: 60 } : {}))
    expect(find(scanEvents(rows), 'atrFroth').firedToday).toBe(true)
    const mild = mkRows(30, i => (i === 0 ? { atr_ext_7: 20 } : {}))
    expect(find(scanEvents(mild), 'atrFroth').firedToday).toBe(false)
  })
})

describe('percentile events', () => {
  // The window must VARY, or the 95th-percentile cut lands on the same value
  // every ordinary session carries and the event fires every day — a fixture
  // that cannot tell a washout from a Tuesday proves nothing.
  const varied = (spike) => mkRows(60, i => ({ new_52w_lows: i === 0 ? spike : 10 + (i % 40) }))

  it('fires on a spike above the window top 5%', () => {
    const w = find(scanEvents(varied(900)), 'lowWashout')
    expect(w.firedToday).toBe(true)
    expect(w.basis).toBe('percentile')
    expect(w.note).toMatch(/top 5%/i)
  })

  it('does not fire on an ordinary reading inside the same window', () => {
    expect(find(scanEvents(varied(12)), 'lowWashout').firedToday).toBe(false)
  })
})

describe('zweigEma', () => {
  it('returns null for sessions before the seed window', () => {
    expect(zweigEma([0.5, 0.5, 0.5])[0]).toBeNull()
  })
})
