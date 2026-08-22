import { describe, it, expect } from 'vitest'
import {
  INDEX_WINDOW,
  cotIndex,
  streak,
  percentileRank,
  assetClassOf,
  computeSnapshot,
  buildRead,
} from './cotRead'

// ── fixtures ──────────────────────────────────────────────────────────────────

// n weekly rows, ascending by date; `fn(i)` supplies the per-week fields.
function mkRows(n, fn) {
  const out = []
  for (let i = 0; i < n; i++) {
    const d = new Date(Date.UTC(2020, 0, 7 + i * 7))
    out.push({
      date: d.toISOString().slice(0, 10),
      commercial_net: 0,
      large_spec_net: 0,
      small_spec_net: 0,
      open_interest: 1_000_000,
      ...fn(i),
    })
  }
  return out
}

// Snapshot literal for buildRead — only the fields the read consumes.
// `cx` / `lx` / `sx` plant the v2 per-group signal fields (index26, move6,
// weeksInZone, chg4, chg4Rank); the defaults are chosen so NO signal fires.
function mkSnap({ c = 50, l = 50, s = 50, oiIdx = 50, oiWow = 0, oiStreak = 0,
                  cStreak = 0, lStreak = 0, sStreak = 0, windowWeeks = 156,
                  cx = {}, lx = {}, sx = {} } = {}) {
  const zone = idx =>
    idx >= 90 ? 'extreme-long' : idx >= 75 ? 'long' :
    idx <= 10 ? 'extreme-short' : idx <= 25 ? 'short' : 'neutral'
  const g = (idx, st, extra) => ({
    net: 1000, wow: 10, pctOi: 0.1, index: idx, zone: zone(idx), streak: st,
    index26: idx, move6: 0, weeksInZone: 1, chg4: 0, chg4Rank: 50,
    ...extra,
  })
  return {
    date: '2026-08-11',
    windowWeeks,
    oi: { value: 2_000_000, wow: oiWow, index: oiIdx, streak: oiStreak, chg4: 0 },
    groups: {
      commercials: g(c, cStreak, cx),
      largeSpecs:  g(l, lStreak, lx),
      smallSpecs:  g(s, sStreak, sx),
    },
  }
}

// ── cotIndex ──────────────────────────────────────────────────────────────────

describe('cotIndex', () => {
  it('places the latest value inside the window range as 0..100', () => {
    expect(cotIndex([0, 100, 50])).toBe(50)
  })

  it('returns 100 when the latest value is the window max', () => {
    expect(cotIndex([10, 20, 30])).toBe(100)
  })

  it('returns 0 when the latest value is the window min', () => {
    expect(cotIndex([30, 20, 10])).toBe(0)
  })

  it('returns 50 for a flat window (no range to place within)', () => {
    expect(cotIndex([5, 5, 5])).toBe(50)
  })

  it('returns null with fewer than 2 values', () => {
    expect(cotIndex([7])).toBeNull()
    expect(cotIndex([])).toBeNull()
  })
})

// ── streak ────────────────────────────────────────────────────────────────────

describe('streak', () => {
  it('counts consecutive rising weeks as a positive streak', () => {
    const rows = mkRows(4, i => ({ commercial_net: i * 100 }))
    expect(streak(rows, 3, 'commercial_net')).toBe(3)
  })

  it('counts consecutive falling weeks as a negative streak', () => {
    const rows = mkRows(4, i => ({ commercial_net: -i * 100 }))
    expect(streak(rows, 3, 'commercial_net')).toBe(-3)
  })

  it('is 0 when the latest week did not change', () => {
    const rows = mkRows(3, i => ({ commercial_net: i < 2 ? i : 1 }))
    expect(streak(rows, 2, 'commercial_net')).toBe(0)
  })

  it('is 0 at the first row (nothing to compare against)', () => {
    const rows = mkRows(2, i => ({ commercial_net: i }))
    expect(streak(rows, 0, 'commercial_net')).toBe(0)
  })

  it('stops at a direction change', () => {
    // 0, 100, 50, 60, 70 → last two moves rise → +2
    const vals = [0, 100, 50, 60, 70]
    const rows = mkRows(5, i => ({ commercial_net: vals[i] }))
    expect(streak(rows, 4, 'commercial_net')).toBe(2)
  })
})

// ── computeSnapshot ───────────────────────────────────────────────────────────

describe('computeSnapshot', () => {
  it('uses the 156-week window by default', () => {
    expect(INDEX_WINDOW).toBe(156)
  })

  it('reports the full window when enough history precedes the index', () => {
    const rows = mkRows(200, i => ({ commercial_net: i }))
    const snap = computeSnapshot(rows, 199)
    expect(snap.windowWeeks).toBe(156)
    expect(snap.date).toBe(rows[199].date)
  })

  it('truncates the window to available history near the start of the series', () => {
    const rows = mkRows(200, i => ({ commercial_net: i }))
    expect(computeSnapshot(rows, 20).windowWeeks).toBe(21)
  })

  it('computes net, week-over-week change and % of open interest per group', () => {
    const rows = mkRows(3, i => ({
      commercial_net: [-100, -200, -300][i],
      large_spec_net: [50, 60, 80][i],
      small_spec_net: [10, 20, 25][i],
      open_interest:  [1000, 1000, 2000][i],
    }))
    const snap = computeSnapshot(rows, 2)
    expect(snap.groups.commercials.net).toBe(-300)
    expect(snap.groups.commercials.wow).toBe(-100)
    expect(snap.groups.commercials.pctOi).toBeCloseTo(-15, 5)
    expect(snap.groups.largeSpecs.wow).toBe(20)
    expect(snap.groups.largeSpecs.pctOi).toBeCloseTo(4, 5)
    expect(snap.groups.smallSpecs.pctOi).toBeCloseTo(1.25, 5)
    expect(snap.oi.value).toBe(2000)
    expect(snap.oi.wow).toBe(1000)
  })

  it('has no week-over-week change at the first row', () => {
    const rows = mkRows(2, i => ({ commercial_net: i * 10 }))
    const snap = computeSnapshot(rows, 0)
    expect(snap.groups.commercials.wow).toBeNull()
    expect(snap.oi.wow).toBeNull()
  })

  it('guards % of OI when open interest is zero', () => {
    const rows = mkRows(2, () => ({ commercial_net: 100, open_interest: 0 }))
    expect(computeSnapshot(rows, 1).groups.commercials.pctOi).toBeNull()
  })

  it('scores the 3-year COT index per group and zones it', () => {
    // Commercials rise monotonically → latest is the window max → index 100 → extreme-long.
    // Large specs fall monotonically → index 0 → extreme-short. Small specs flat → 50 → neutral.
    const rows = mkRows(160, i => ({
      commercial_net: i, large_spec_net: -i, small_spec_net: 7, open_interest: 1000 + i,
    }))
    const snap = computeSnapshot(rows, 159)
    expect(snap.groups.commercials.index).toBe(100)
    expect(snap.groups.commercials.zone).toBe('extreme-long')
    expect(snap.groups.largeSpecs.index).toBe(0)
    expect(snap.groups.largeSpecs.zone).toBe('extreme-short')
    expect(snap.groups.smallSpecs.index).toBe(50)
    expect(snap.groups.smallSpecs.zone).toBe('neutral')
    expect(snap.oi.index).toBe(100)
  })

  it('scores the index over the window ending at idx, not the whole series', () => {
    // Window of 3: values 10,20,30 then a later 0 outside the window must not matter.
    const vals = [0, 10, 20, 30]
    const rows = mkRows(4, i => ({ commercial_net: vals[i] }))
    expect(computeSnapshot(rows, 3, 3).groups.commercials.index).toBe(100)
    // idx 2 with window 3 → [0,10,20] → 100 ; idx 1 → [0,10] → 100 ; idx 0 → null
    expect(computeSnapshot(rows, 0, 3).groups.commercials.index).toBeNull()
  })

  it('zones 75..89 as long and 11..25 as short', () => {
    const vals = Array.from({ length: 20 }, (_, i) => i)  // 0..19, max 19
    // last value 15 → (15-0)/19 = 78.9 → long
    const rowsL = mkRows(20, i => ({ commercial_net: i === 19 ? 15 : vals[i] }))
    expect(computeSnapshot(rowsL, 19).groups.commercials.zone).toBe('long')
    // last value 3 → 3/18 = 16.7 → short  (max is 18 now)
    const rowsS = mkRows(20, i => ({ commercial_net: i === 19 ? 3 : vals[i] }))
    expect(computeSnapshot(rowsS, 19).groups.commercials.zone).toBe('short')
  })

  it('carries the per-group streak', () => {
    const rows = mkRows(6, i => ({ commercial_net: i * 5, large_spec_net: -i }))
    const snap = computeSnapshot(rows, 5)
    expect(snap.groups.commercials.streak).toBe(5)
    expect(snap.groups.largeSpecs.streak).toBe(-5)
  })
})

// ── buildRead ─────────────────────────────────────────────────────────────────

describe('buildRead — bias', () => {
  const sym = { symbol: 'ES', name: 'S&P 500 E-Mini' }

  it('is strongly contrarian bullish when hedgers are at max long and trend money at max short', () => {
    const r = buildRead(mkSnap({ c: 95, l: 5 }), sym)
    expect(r.bias.label).toBe('Contrarian Bullish')
    expect(r.bias.strength).toBe('strong')
    expect(r.bias.tone).toBe('bull')
  })

  it('is moderately contrarian bullish on commercials alone above 75', () => {
    const r = buildRead(mkSnap({ c: 80, l: 50 }), sym)
    expect(r.bias.label).toBe('Contrarian Bullish')
    expect(r.bias.strength).toBe('moderate')
  })

  it('is strongly contrarian bearish when hedgers are at max short and the crowd is max long', () => {
    const r = buildRead(mkSnap({ c: 8, l: 92 }), sym)
    expect(r.bias.label).toBe('Contrarian Bearish')
    expect(r.bias.strength).toBe('strong')
    expect(r.bias.tone).toBe('bear')
  })

  it('is moderately contrarian bearish on commercials alone below 25', () => {
    const r = buildRead(mkSnap({ c: 20, l: 50 }), sym)
    expect(r.bias.label).toBe('Contrarian Bearish')
    expect(r.bias.strength).toBe('moderate')
  })

  it('leans contrarian bearish when only the trend crowd is at an extreme long', () => {
    const r = buildRead(mkSnap({ c: 50, l: 95 }), sym)
    expect(r.bias.label).toBe('Contrarian Bearish')
    expect(r.bias.strength).toBe('moderate')
  })

  it('is neutral when nobody is at an extreme', () => {
    const r = buildRead(mkSnap({ c: 50, l: 50 }), sym)
    expect(r.bias.label).toBe('Neutral')
    expect(r.bias.strength).toBeNull()
    expect(r.bias.tone).toBe('neutral')
  })
})

describe('buildRead — crowding', () => {
  const sym = { symbol: 'ES', name: 'S&P 500 E-Mini' }

  it('labels large specs ≥90 as crowded long with the index as the score', () => {
    const r = buildRead(mkSnap({ l: 92 }), sym)
    expect(r.crowding.label).toBe('Crowded Long')
    expect(r.crowding.index).toBe(92)
    expect(r.crowding.tone).toBe('bear')
  })

  it('labels 75..89 as leaning long', () => {
    expect(buildRead(mkSnap({ l: 80 }), sym).crowding.label).toBe('Leaning Long')
  })

  it('labels ≤10 as crowded short', () => {
    const r = buildRead(mkSnap({ l: 6 }), sym)
    expect(r.crowding.label).toBe('Crowded Short')
    expect(r.crowding.tone).toBe('bull')
  })

  it('labels 11..25 as leaning short', () => {
    expect(buildRead(mkSnap({ l: 20 }), sym).crowding.label).toBe('Leaning Short')
  })

  it('labels the middle as balanced', () => {
    const r = buildRead(mkSnap({ l: 50 }), sym)
    expect(r.crowding.label).toBe('Balanced')
    expect(r.crowding.tone).toBe('neutral')
  })
})

describe('buildRead — narrative', () => {
  const sym = { symbol: 'ES', name: 'S&P 500 E-Mini' }

  it('returns a headline, one point per trader group plus one for open interest, and a watch line', () => {
    const r = buildRead(mkSnap(), sym)
    expect(typeof r.headline).toBe('string')
    expect(r.headline.length).toBeGreaterThan(0)
    expect(r.points).toHaveLength(4)
    r.points.forEach(p => {
      expect(p.key).toMatch(/^(commercials|largeSpecs|smallSpecs|oi)$/)
      expect(p.text.length).toBeGreaterThan(20)
    })
    expect(r.watch.length).toBeGreaterThan(20)
  })

  it('mentions a multi-week streak in that group\'s point', () => {
    const r = buildRead(mkSnap({ c: 80, cStreak: 4 }), sym)
    expect(r.points.find(p => p.key === 'commercials').text).toMatch(/4 straight weeks/)
  })

  it('does not mention a streak shorter than three weeks', () => {
    const r = buildRead(mkSnap({ c: 80, cStreak: 2 }), sym)
    expect(r.points.find(p => p.key === 'commercials').text).not.toMatch(/straight weeks/)
  })

  it('reads rising open interest as new money and falling as positions closing', () => {
    const up = buildRead(mkSnap({ oiWow: 5000, oiStreak: 3 }), sym)
    expect(up.points.find(p => p.key === 'oi').text).toMatch(/new|fresh|arriv|expand/i)
    const dn = buildRead(mkSnap({ oiWow: -5000, oiStreak: -3 }), sym)
    expect(dn.points.find(p => p.key === 'oi').text).toMatch(/clos|contract|shrink/i)
  })

  it('gives a different watch line per bias', () => {
    const bull = buildRead(mkSnap({ c: 95, l: 5 }), sym).watch
    const bear = buildRead(mkSnap({ c: 5, l: 95 }), sym).watch
    const flat = buildRead(mkSnap(), sym).watch
    expect(new Set([bull, bear, flat]).size).toBe(3)
  })

  it('flags a short history window so the index is not over-read', () => {
    const r = buildRead(mkSnap({ windowWeeks: 40 }), sym)
    expect(r.caveat).toMatch(/40 weeks/)
    expect(buildRead(mkSnap(), sym).caveat).toBeNull()
  })

  it('adds the inverted-read note for VIX only', () => {
    expect(buildRead(mkSnap(), { symbol: 'VI', name: 'VIX' }).note).toMatch(/VIX/)
    expect(buildRead(mkSnap(), sym).note).toBeNull()
  })
})

// ── percentileRank ────────────────────────────────────────────────────────────

describe('percentileRank', () => {
  it('ranks the largest value 100 and the smallest 0', () => {
    expect(percentileRank([3, -2, 7, 0, 5], 7)).toBe(100)
    expect(percentileRank([3, -2, 7, 0, 5], -2)).toBe(0)
  })

  it('ranks the median of an odd set at 50', () => {
    expect(percentileRank([1, 2, 3, 4, 5], 3)).toBe(50)
  })

  it('keeps the sign: a negative value ranks below every positive one', () => {
    expect(percentileRank([-10, -5, 1, 2, 3], -5)).toBeLessThan(percentileRank([-10, -5, 1, 2, 3], 1))
  })

  it('splits ties at the midpoint of the tied block', () => {
    // x = 2 is tied with one other 2; the others are [1, 2, 3] → (1 + 0.5) / 3
    expect(percentileRank([1, 2, 2, 3], 2)).toBeCloseTo(50, 5)
  })

  it('returns 50 for a flat set (no range to place within)', () => {
    expect(percentileRank([4, 4, 4], 4)).toBe(50)
  })

  it('returns null with fewer than 2 values', () => {
    expect(percentileRank([9], 9)).toBeNull()
    expect(percentileRank([], 1)).toBeNull()
  })
})

// ── computeSnapshot — v2 signal fields ────────────────────────────────────────

describe('computeSnapshot — index26', () => {
  it('scores the last 26 weeks only, so an outlier 27+ weeks back does not reach it', () => {
    // Row 3 is a spike of 1000; at idx 29 the 26-week window is rows 4..29 (4..29 rising).
    const rows = mkRows(30, i => ({ commercial_net: i === 3 ? 1000 : i }))
    const snap = computeSnapshot(rows, 29)
    expect(snap.groups.commercials.index26).toBe(100)      // 29 is the max of rows 4..29
    expect(snap.groups.commercials.index).toBeCloseTo(2.9, 1) // the 3-year window still sees the spike
  })

  it('differs from the 3-year index when the recent range is narrower', () => {
    // 0..29 rising, then flat at 25 → full window [0..29], 26-wk window rows 14..39 → min 14.
    const rows = mkRows(40, i => ({ commercial_net: i < 30 ? i : 25 }))
    const snap = computeSnapshot(rows, 39)
    expect(snap.groups.commercials.index).toBeCloseTo((25 / 29) * 100, 5)
    expect(snap.groups.commercials.index26).toBeCloseTo(((25 - 14) / (29 - 14)) * 100, 5)
  })

  it('is null at the first row and present on every group', () => {
    const rows = mkRows(3, i => ({ commercial_net: i, large_spec_net: -i, small_spec_net: i * 2 }))
    expect(computeSnapshot(rows, 0).groups.commercials.index26).toBeNull()
    const snap = computeSnapshot(rows, 2)
    expect(snap.groups.commercials.index26).toBe(100)
    expect(snap.groups.largeSpecs.index26).toBe(0)
    expect(snap.groups.smallSpecs.index26).toBe(100)
  })
})

describe('computeSnapshot — move6 (Movement Index)', () => {
  // A wandering series so the index actually moves week to week.
  const rows = mkRows(60, i => ({ commercial_net: (i * 37) % 101, large_spec_net: -((i * 53) % 89) }))

  it('equals the 3-year index now minus the 3-year index six weeks ago, each over its own trailing window', () => {
    for (const idx of [7, 20, 45, 59]) {
      const now  = computeSnapshot(rows, idx)
      const then = computeSnapshot(rows, idx - 6)
      expect(then.groups.commercials.index).not.toBeNull()
      expect(now.groups.commercials.move6).toBeCloseTo(now.groups.commercials.index - then.groups.commercials.index, 8)
      expect(now.groups.largeSpecs.move6).toBeCloseTo(now.groups.largeSpecs.index - then.groups.largeSpecs.index, 8)
    }
  })

  it('is null before six weeks of history exist, or when the six-weeks-ago index is itself null', () => {
    expect(computeSnapshot(rows, 5).groups.commercials.move6).toBeNull()
    expect(computeSnapshot(rows, 0).groups.commercials.move6).toBeNull()
    // idx 6 looks back to row 0, whose window holds a single value → no index there → no move.
    expect(computeSnapshot(rows, 0).groups.commercials.index).toBeNull()
    expect(computeSnapshot(rows, 6).groups.commercials.move6).toBeNull()
  })

  it('respects a custom window for both ends of the comparison', () => {
    const idx = 40, w = 10
    const now  = computeSnapshot(rows, idx, w)
    const then = computeSnapshot(rows, idx - 6, w)
    expect(now.groups.commercials.move6).toBeCloseTo(now.groups.commercials.index - then.groups.commercials.index, 8)
  })
})

describe('computeSnapshot — weeksInZone', () => {
  it('counts the run of consecutive weeks in the current zone, inclusive', () => {
    // Rising 0..39: every idx ≥ 1 is the window max → extreme-long. idx 0 has no index → neutral.
    const rows = mkRows(40, i => ({ commercial_net: i }))
    const snap = computeSnapshot(rows, 39)
    expect(snap.groups.commercials.zone).toBe('extreme-long')
    expect(snap.groups.commercials.weeksInZone).toBe(39)
  })

  it('resets to 1 the week a new zone is entered and counts up from there', () => {
    // 0..39 rising, then 20, 19 → (20/39)=51% and (19/39)=49% → neutral for two weeks.
    const vals = [...Array.from({ length: 40 }, (_, i) => i), 20, 19]
    const rows = mkRows(42, i => ({ commercial_net: vals[i] }))
    expect(computeSnapshot(rows, 40).groups.commercials.zone).toBe('neutral')
    expect(computeSnapshot(rows, 40).groups.commercials.weeksInZone).toBe(1)
    expect(computeSnapshot(rows, 41).groups.commercials.weeksInZone).toBe(2)
  })

  it('is 1 at the first row', () => {
    const rows = mkRows(2, i => ({ commercial_net: i }))
    expect(computeSnapshot(rows, 0).groups.commercials.weeksInZone).toBe(1)
  })
})

describe('computeSnapshot — chg4 and chg4Rank', () => {
  it('reports the 4-week change in net and in open interest', () => {
    const rows = mkRows(8, i => ({ commercial_net: i * 10, large_spec_net: -i * 3, open_interest: 1000 + i * 100 }))
    const snap = computeSnapshot(rows, 7)
    expect(snap.groups.commercials.chg4).toBe(40)
    expect(snap.groups.largeSpecs.chg4).toBe(-12)
    expect(snap.oi.chg4).toBe(400)
  })

  it('has no 4-week change before four weeks of history exist', () => {
    const rows = mkRows(8, i => ({ commercial_net: i * 10 }))
    expect(computeSnapshot(rows, 3).groups.commercials.chg4).toBeNull()
    expect(computeSnapshot(rows, 3).oi.chg4).toBeNull()
    expect(computeSnapshot(rows, 4).groups.commercials.chg4).toBe(40)
  })

  it('ranks the largest 4-week increase in the window at 100 and the largest decrease at 0', () => {
    const up = mkRows(20, i => ({ commercial_net: i === 19 ? 50 : 0 }))
    expect(computeSnapshot(up, 19).groups.commercials.chg4Rank).toBe(100)
    const dn = mkRows(20, i => ({ commercial_net: i === 19 ? -50 : 0 }))
    expect(computeSnapshot(dn, 19).groups.commercials.chg4Rank).toBe(0)
  })

  it('is null when fewer than 8 four-week changes exist in the window', () => {
    const rows = mkRows(12, i => ({ commercial_net: i === 11 ? 50 : 0 }))
    expect(computeSnapshot(rows, 10).groups.commercials.chg4Rank).toBeNull()  // window 11 → 7 changes
    expect(computeSnapshot(rows, 11).groups.commercials.chg4Rank).toBe(100)   // window 12 → 8 changes
  })

  it('only counts changes inside the trailing window', () => {
    // A 1000 spike at row 5 creates ±1000 changes that sit OUTSIDE a 12-week window at idx 29.
    const rows = mkRows(30, i => ({ commercial_net: i === 5 ? 1000 : i === 29 ? 10 : 0 }))
    expect(computeSnapshot(rows, 29, 12).groups.commercials.chg4Rank).toBe(100)
    expect(computeSnapshot(rows, 29).groups.commercials.chg4Rank).toBeLessThan(100)
  })
})

// ── assetClassOf ──────────────────────────────────────────────────────────────

describe('assetClassOf', () => {
  it('maps one symbol from every class', () => {
    expect(assetClassOf('ES')).toBe('index')
    expect(assetClassOf('VI')).toBe('vol')
    expect(assetClassOf('GC')).toBe('metals')
    expect(assetClassOf('CL')).toBe('energy')
    expect(assetClassOf('ZC')).toBe('grains')
    expect(assetClassOf('KC')).toBe('softs')
    expect(assetClassOf('LE')).toBe('livestock')
    expect(assetClassOf('ZN')).toBe('rates')
    expect(assetClassOf('SR3')).toBe('rates')
    expect(assetClassOf('E6')).toBe('fx')
    expect(assetClassOf('BTC')).toBe('crypto')
  })

  it('falls back to other for an unknown or missing symbol', () => {
    expect(assetClassOf('XYZ')).toBe('other')
    expect(assetClassOf(undefined)).toBe('other')
    expect(assetClassOf('')).toBe('other')
  })
})

// ── buildRead — classNote ─────────────────────────────────────────────────────

describe('buildRead — classNote', () => {
  it('explains who the commercials are for the symbol\'s asset class, and differs between index and grains', () => {
    const idx = buildRead(mkSnap(), { symbol: 'ES', name: 'S&P 500 E-Mini' }).classNote
    const grn = buildRead(mkSnap(), { symbol: 'ZC', name: 'Corn' }).classNote
    expect(typeof idx).toBe('string')
    expect(idx.length).toBeGreaterThan(40)
    expect(grn.length).toBeGreaterThan(40)
    expect(idx).not.toBe(grn)
    expect(idx).toMatch(/dealer|asset manager/i)
    expect(grn).toMatch(/farmer|miller|elevator|crop/i)
  })

  it('keeps the VIX note AND adds a vol classNote', () => {
    const r = buildRead(mkSnap(), { symbol: 'VI', name: 'VIX' })
    expect(r.note).toMatch(/VIX/)
    expect(r.classNote).toMatch(/volatility/i)
  })

  it('gives a generic line for an unknown symbol', () => {
    const r = buildRead(mkSnap(), { symbol: 'XYZ', name: 'Mystery' })
    expect(typeof r.classNote).toBe('string')
    expect(r.classNote.length).toBeGreaterThan(40)
  })
})

// ── buildRead — signals ───────────────────────────────────────────────────────

describe('buildRead — signals', () => {
  const sym = { symbol: 'ES', name: 'S&P 500 E-Mini' }
  const keys = r => r.signals.map(s => s.key)

  it('is an empty list when nothing fires', () => {
    expect(buildRead(mkSnap(), sym).signals).toEqual([])
  })

  it('tolerates a snapshot without the v2 fields (older callers)', () => {
    const snap = mkSnap()
    for (const g of Object.values(snap.groups)) {
      delete g.index26; delete g.move6; delete g.weeksInZone; delete g.chg4; delete g.chg4Rank
    }
    delete snap.oi.chg4
    const r = buildRead(snap, sym)
    expect(r.signals).toEqual([])
    expect(r.points).toHaveLength(4)
  })

  it('fires the Movement Index on a 40-point six-week swing, bull for commercials buying', () => {
    const r = buildRead(mkSnap({ c: 80, cx: { move6: 44 } }), sym)
    const s = r.signals.find(x => x.key === 'movement-commercials')
    expect(s).toBeTruthy()
    expect(s.tone).toBe('bull')
    expect(s.label).toMatch(/^Movement Index \+44 · Commercials$/)
    expect(s.text).toMatch(/six weeks/i)
    expect(s.text).toMatch(/40/)
  })

  it('reads the Movement Index in reverse for the speculator groups', () => {
    expect(buildRead(mkSnap({ lx: { move6: 41 } }), sym).signals.find(x => x.key === 'movement-largeSpecs').tone).toBe('bear')
    expect(buildRead(mkSnap({ lx: { move6: -41 } }), sym).signals.find(x => x.key === 'movement-largeSpecs').tone).toBe('bull')
    expect(buildRead(mkSnap({ sx: { move6: 52 } }), sym).signals.find(x => x.key === 'movement-smallSpecs').tone).toBe('bear')
    expect(buildRead(mkSnap({ cx: { move6: -40 } }), sym).signals.find(x => x.key === 'movement-commercials').tone).toBe('bear')
  })

  it('does not fire the Movement Index under 40 points', () => {
    expect(keys(buildRead(mkSnap({ cx: { move6: 39 } }), sym))).not.toContain('movement-commercials')
    expect(keys(buildRead(mkSnap({ cx: { move6: -39 } }), sym))).not.toContain('movement-commercials')
    expect(keys(buildRead(mkSnap({ cx: { move6: null } }), sym))).not.toContain('movement-commercials')
  })

  it('folds the Movement Index clause into that group\'s narrative point', () => {
    const on  = buildRead(mkSnap({ c: 80, cx: { move6: 44 } }), sym)
    expect(on.points.find(p => p.key === 'commercials').text).toMatch(/6-week swing of \+44 points/)
    expect(on.points.find(p => p.key === 'commercials').text).toMatch(/Movement Index/)
    expect(on.points.find(p => p.key === 'largeSpecs').text).not.toMatch(/Movement Index/)
    const off = buildRead(mkSnap({ c: 80, cx: { move6: 12 } }), sym)
    expect(off.points.find(p => p.key === 'commercials').text).not.toMatch(/Movement Index/)
  })

  it('counts weeks at a 3-year extreme once the run is at least two weeks', () => {
    const r = buildRead(mkSnap({ c: 95, cx: { weeksInZone: 5 } }), sym)
    const s = r.signals.find(x => x.key === 'extreme-weeks-commercials')
    expect(s).toBeTruthy()
    expect(s.tone).toBe('neutral')
    expect(s.label).toBe('5 wks at a 3-year extreme · Commercials')
    expect(s.text).toMatch(/5/)
    expect(s.text).toMatch(/persist/i)
  })

  it('does not count extreme weeks on a fresh extreme or a non-extreme zone', () => {
    expect(keys(buildRead(mkSnap({ c: 95, cx: { weeksInZone: 1 } }), sym))).not.toContain('extreme-weeks-commercials')
    expect(keys(buildRead(mkSnap({ c: 80, cx: { weeksInZone: 6 } }), sym))).not.toContain('extreme-weeks-commercials')
    expect(keys(buildRead(mkSnap({ l: 5, lx: { weeksInZone: 3 } }), sym))).toContain('extreme-weeks-largeSpecs')
  })

  it('flags the fastest 4-week buying or selling in three years per group', () => {
    const buy = buildRead(mkSnap({ cx: { chg4Rank: 97 } }), sym).signals.find(x => x.key === 'fastest-commercials')
    expect(buy.label).toBe('Fastest commercial buying in 3 years')
    expect(buy.tone).toBe('bull')
    const sell = buildRead(mkSnap({ lx: { chg4Rank: 3 } }), sym).signals.find(x => x.key === 'fastest-largeSpecs')
    expect(sell.label).toBe('Fastest large-spec selling in 3 years')
    expect(sell.tone).toBe('bull')
    const small = buildRead(mkSnap({ sx: { chg4Rank: 95 } }), sym).signals.find(x => x.key === 'fastest-smallSpecs')
    expect(small.label).toBe('Fastest small-trader buying in 3 years')
    expect(small.tone).toBe('bear')
    const cSell = buildRead(mkSnap({ cx: { chg4Rank: 5 } }), sym).signals.find(x => x.key === 'fastest-commercials')
    expect(cSell.label).toBe('Fastest commercial selling in 3 years')
    expect(cSell.tone).toBe('bear')
  })

  it('does not flag a 4-week change inside the 5..95 band or with no rank', () => {
    expect(keys(buildRead(mkSnap({ cx: { chg4Rank: 94 } }), sym))).not.toContain('fastest-commercials')
    expect(keys(buildRead(mkSnap({ cx: { chg4Rank: 6 } }), sym))).not.toContain('fastest-commercials')
    expect(keys(buildRead(mkSnap({ cx: { chg4Rank: null } }), sym))).not.toContain('fastest-commercials')
  })

  it('flags a long-term extreme the short-term window is fading or building', () => {
    const fade = buildRead(mkSnap({ c: 80, cx: { index26: 20 } }), sym).signals.find(x => x.key === 'short-vs-long-commercials')
    expect(fade).toBeTruthy()
    expect(fade.tone).toBe('neutral')
    expect(fade.label).toMatch(/^Long-term extreme, short-term fading/)
    expect(fade.text).toMatch(/26/)
    expect(fade.text).toMatch(/timing/i)
    const build = buildRead(mkSnap({ l: 20, lx: { index26: 80 } }), sym).signals.find(x => x.key === 'short-vs-long-largeSpecs')
    expect(build.label).toMatch(/^Long-term extreme, short-term building/)
  })

  it('does not flag the two windows when they agree or when the 26-week index is missing', () => {
    expect(keys(buildRead(mkSnap({ c: 80, cx: { index26: 80 } }), sym))).not.toContain('short-vs-long-commercials')
    expect(keys(buildRead(mkSnap({ c: 50, cx: { index26: 10 } }), sym))).not.toContain('short-vs-long-commercials')
    expect(keys(buildRead(mkSnap({ c: 80, cx: { index26: null } }), sym))).not.toContain('short-vs-long-commercials')
  })

  it('caps the list at four, most important first', () => {
    const everything = { move6: 44, weeksInZone: 5, chg4Rank: 97, index26: 20 }
    const r = buildRead(mkSnap({ c: 95, cx: everything, l: 95, lx: everything, s: 95, sx: everything }), sym)
    expect(r.signals).toHaveLength(4)
    r.signals.forEach(s => {
      expect(typeof s.key).toBe('string')
      expect(['bull', 'bear', 'neutral']).toContain(s.tone)
      expect(s.label.length).toBeGreaterThan(5)
      expect(s.text.length).toBeGreaterThan(40)
    })
    // The classic Movement Index trigger on the hedgers outranks a weeks-at-extreme count.
    expect(r.signals[0].key).toBe('movement-commercials')
    expect(keys(r).indexOf('movement-commercials')).toBeLessThan(
      Math.max(keys(r).indexOf('extreme-weeks-commercials'), 99)
    )
  })

  it('keeps the rest of the read shape unchanged', () => {
    const r = buildRead(mkSnap({ c: 95, cx: { move6: 44 } }), sym)
    expect(r.points.map(p => p.key)).toEqual(['commercials', 'largeSpecs', 'smallSpecs', 'oi'])
    expect(r.bias.label).toBe('Contrarian Bullish')
    expect(typeof r.headline).toBe('string')
    expect(typeof r.watch).toBe('string')
    expect(r.caveat).toBeNull()
    expect(r.note).toBeNull()
  })
})
