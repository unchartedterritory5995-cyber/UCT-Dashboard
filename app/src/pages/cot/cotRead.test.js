import { describe, it, expect } from 'vitest'
import {
  INDEX_WINDOW,
  cotIndex,
  streak,
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
function mkSnap({ c = 50, l = 50, s = 50, oiIdx = 50, oiWow = 0, oiStreak = 0,
                  cStreak = 0, lStreak = 0, sStreak = 0, windowWeeks = 156 } = {}) {
  const zone = idx =>
    idx >= 90 ? 'extreme-long' : idx >= 75 ? 'long' :
    idx <= 10 ? 'extreme-short' : idx <= 25 ? 'short' : 'neutral'
  const g = (idx, st) => ({ net: 1000, wow: 10, pctOi: 0.1, index: idx, zone: zone(idx), streak: st })
  return {
    date: '2026-08-11',
    windowWeeks,
    oi: { value: 2_000_000, wow: oiWow, index: oiIdx, streak: oiStreak },
    groups: {
      commercials: g(c, cStreak),
      largeSpecs:  g(l, lStreak),
      smallSpecs:  g(s, sStreak),
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
