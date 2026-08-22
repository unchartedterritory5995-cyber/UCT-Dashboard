import { describe, it, expect } from 'vitest'
import { INDEX_WINDOW } from './cotRead'
import {
  HORIZONS,
  MIN_EPISODES,
  alignPrice,
  findEpisodes,
  computeAnalogs,
} from './cotAnalogs'

// ── fixtures ──────────────────────────────────────────────────────────────────

// n weekly COT rows (Tuesdays from 2020-01-07), ascending; `fn(i)` supplies fields.
function mkRows(n, fn = () => ({})) {
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

// n weekly price bars (Fridays from 2020-01-10 — the Friday of row i's week), ascending.
function mkBars(n, fn = () => ({})) {
  const out = []
  for (let i = 0; i < n; i++) {
    const d = new Date(Date.UTC(2020, 0, 10 + i * 7))
    const c = 100 + i
    out.push({ t: d.toISOString().slice(0, 10), o: c, h: c, l: c, c, v: 1000, ...fn(i) })
  }
  return out
}

// Anchor series. Every 4th week the hedgers print −100 (k=0) then +100 (k=1); the
// other two weeks are 0. Specs mirror. With an 8-week window every window holds
// both anchors, so the index range is pinned to [−100, 100] and the zones are
// fully predictable:
//   k=0 → commercials extreme-short / specs extreme-long
//   k=1 → commercials extreme-long  / specs extreme-short   ← the signature under test
//   k=2,3 → both neutral (value 0 sits at index 50)
// `plant` overrides commercial_net at chosen weeks (specs still mirror) so a run of
// consecutive signature weeks can be built without disturbing the anchors.
const W = 8
function anchorRows(n, plant = {}) {
  return mkRows(n, i => {
    const k = i % 4
    let c = k === 0 ? -100 : k === 1 ? 100 : 0
    if (plant[i] != null) c = plant[i]
    return { commercial_net: c, large_spec_net: -c }
  })
}

const pct = (from, to) => ((to - from) / from) * 100

// ── constants ─────────────────────────────────────────────────────────────────

describe('constants', () => {
  it('looks 4, 8 and 13 weeks ahead and needs three precedents', () => {
    expect(HORIZONS).toEqual([4, 8, 13])
    expect(MIN_EPISODES).toBe(3)
  })
})

// ── alignPrice ────────────────────────────────────────────────────────────────

describe('alignPrice', () => {
  it('picks the close of the first bar dated on or after each report Tuesday (that week\'s Friday)', () => {
    const rows = mkRows(3)
    const bars = mkBars(3, i => ({ c: [10, 20, 30][i] }))
    expect(alignPrice(rows, bars)).toEqual([10, 20, 30])
  })

  it('returns null for rows beyond the last bar', () => {
    const rows = mkRows(5)
    const bars = mkBars(3, i => ({ c: [10, 20, 30][i] }))
    expect(alignPrice(rows, bars)).toEqual([10, 20, 30, null, null])
  })

  it('returns all null when bars are empty or undefined', () => {
    const rows = mkRows(4)
    expect(alignPrice(rows, [])).toEqual([null, null, null, null])
    expect(alignPrice(rows, undefined)).toEqual([null, null, null, null])
    expect(alignPrice([], mkBars(3))).toEqual([])
  })

  it('accepts a bar dated exactly on the report date', () => {
    const rows = mkRows(1)
    const bars = [{ t: rows[0].date, c: 42 }]
    expect(alignPrice(rows, bars)).toEqual([42])
  })

  it('does not let a later week\'s bar stand in for a missing one', () => {
    // Week 1 has no bar; the next bar is 10 days after week 1's Tuesday — that is
    // week 2's close, not week 1's. Bleeding it backwards would fabricate a 0% move.
    const rows = mkRows(4)
    const all = mkBars(4, i => ({ c: [10, 20, 30, 40][i] }))
    const bars = [all[0], all[2], all[3]]
    expect(alignPrice(rows, bars)).toEqual([10, null, 30, 40])
  })

  it('leaves rows before the proxy\'s history began as null (BITO starts years after BTC COT)', () => {
    const rows = mkRows(5)
    const bars = mkBars(5, i => ({ c: [10, 20, 30, 40, 50][i] })).slice(3)
    expect(alignPrice(rows, bars)).toEqual([null, null, null, 40, 50])
  })

  it('treats a missing or non-numeric close as null', () => {
    const rows = mkRows(2)
    const bars = mkBars(2, i => (i === 0 ? { c: null } : { c: 'x' }))
    expect(alignPrice(rows, bars)).toEqual([null, null])
  })
})

// ── findEpisodes ──────────────────────────────────────────────────────────────

describe('findEpisodes', () => {
  it('reports the signature of the week under analysis', () => {
    const rows = anchorRows(30)
    const { signature } = findEpisodes(rows, 29, { window: W })
    expect(signature).toEqual({ commercials: 'extreme-long', largeSpecs: 'extreme-short' })
  })

  it('clusters consecutive matching weeks into one episode dated at its first week', () => {
    // Plant weeks 18 and 19 so 17–19 is a three-week stretch of the signature.
    const rows = anchorRows(30, { 18: 100, 19: 100 })
    const { episodes } = findEpisodes(rows, 29, { window: W })
    expect(episodes.map(e => e.idx)).toEqual([9, 13, 17, 21, 25])
    expect(episodes.map(e => e.len)).toEqual([1, 1, 3, 1, 1])
    expect(episodes[2].date).toBe(rows[17].date)
  })

  it('excludes the run that contains the week under analysis — it is "now", not a precedent', () => {
    const rows = anchorRows(30, { 18: 100, 19: 100 })
    const { episodes } = findEpisodes(rows, 19, { window: W })
    expect(episodes.map(e => e.idx)).toEqual([9, 13])
  })

  it('only matches weeks with a full index window behind them', () => {
    // Weeks 1 and 5 carry the signature zone-for-zone on a truncated window, but a
    // truncated index is not comparable — they must not count.
    const rows = anchorRows(30)
    const { episodes } = findEpisodes(rows, 13, { window: W })
    expect(episodes.map(e => e.idx)).toEqual([9])
  })

  it('returns no episodes when nothing before idx matches', () => {
    const rows = anchorRows(12)
    expect(findEpisodes(rows, 9, { window: W }).episodes).toEqual([])
  })

  it('consults the caller\'s snapshot memo and fills it in', () => {
    const rows = anchorRows(30)
    const snapshots = []
    const fresh = findEpisodes(rows, 29, { window: W, snapshots })
    expect(fresh.episodes.map(e => e.idx)).toEqual([9, 13, 17, 21, 25])
    // Every eligible week got memoised…
    for (let j = W - 1; j <= 29; j++) expect(snapshots[j]).toBeDefined()
    // …and the memo is read, not just written: poison week 13 and it drops out.
    snapshots[13] = { groups: { commercials: { zone: 'neutral' }, largeSpecs: { zone: 'neutral' } } }
    const memoised = findEpisodes(rows, 29, { window: W, snapshots })
    expect(memoised.episodes.map(e => e.idx)).toEqual([9, 17, 21, 25])
  })
})

// ── computeAnalogs ────────────────────────────────────────────────────────────

describe('computeAnalogs — forward returns', () => {
  it('measures each horizon from the aligned close at the episode\'s first week', () => {
    const rows = anchorRows(30)
    const bars = mkBars(30)            // close = 100 + i
    const r = computeAnalogs(rows, bars, 29, { direction: 'bull', window: W })
    const ep = r.episodes.find(e => e.idx === 9)
    expect(ep.fwd[4]).toBeCloseTo(pct(109, 113), 6)
    expect(ep.fwd[8]).toBeCloseTo(pct(109, 117), 6)
    expect(ep.fwd[13]).toBeCloseTo(pct(109, 122), 6)
  })

  it('never looks past the week being analysed, even when later bars exist', () => {
    const rows = anchorRows(30)
    const bars = mkBars(30)            // bars run to week 29 — but idx is 13
    const r = computeAnalogs(rows, bars, 13, { direction: 'bull', window: W })
    expect(r.episodes.map(e => e.idx)).toEqual([9])
    const ep = r.episodes[0]
    expect(ep.fwd[4]).toBeCloseTo(pct(109, 113), 6)   // 9 + 4 = 13 → knowable
    expect(ep.fwd[8]).toBeNull()                        // 9 + 8 = 17 > 13 → not yet
    expect(ep.fwd[13]).toBeNull()
  })

  it('is null when either end of the horizon has no aligned price', () => {
    const rows = anchorRows(30)
    const bars = mkBars(30).filter((_, i) => i !== 13)   // week 13 has no bar
    const r = computeAnalogs(rows, bars, 29, { direction: 'bull', window: W })
    const ep9 = r.episodes.find(e => e.idx === 9)
    expect(ep9.fwd[4]).toBeNull()                      // lands on the missing week
    expect(ep9.fwd[8]).toBeCloseTo(pct(109, 117), 6)
    const ep13 = r.episodes.find(e => e.idx === 13)
    expect(ep13.fwd[4]).toBeNull()                     // starts on the missing week
    expect(ep13.fwd[8]).toBeNull()
    expect(ep13.fwd[13]).toBeNull()
  })
})

describe('computeAnalogs — hits and stats', () => {
  // Close rises 100→120 through week 20, then falls 2/week: the first three
  // precedents resolve up at 4 weeks, the last two resolve down.
  const close = i => (i <= 20 ? 100 + i : 120 - 2 * (i - 20))
  const rows = anchorRows(30)
  const bars = mkBars(30, i => ({ c: close(i) }))

  it('counts a hit as a positive return for a bull read', () => {
    const r = computeAnalogs(rows, bars, 29, { direction: 'bull', window: W })
    expect(r.n).toBe(5)
    expect(r.stats[4]).toMatchObject({ n: 5, hits: 3, hitRate: 60 })
    expect(r.stats[8]).toMatchObject({ n: 4, hits: 2, hitRate: 50 })
    expect(r.stats[13]).toMatchObject({ n: 2, hits: 1, hitRate: 50 })
  })

  it('counts a hit as a negative return for a bear read', () => {
    const r = computeAnalogs(rows, bars, 29, { direction: 'bear', window: W })
    expect(r.stats[4]).toMatchObject({ n: 5, hits: 2, hitRate: 40 })
    expect(r.stats[8]).toMatchObject({ n: 4, hits: 2, hitRate: 50 })
  })

  it('has no hit count for a neutral read but still reports the distribution', () => {
    const r = computeAnalogs(rows, bars, 29, { direction: 'neutral', window: W })
    expect(r.stats[4].hits).toBeNull()
    expect(r.stats[4].hitRate).toBeNull()
    expect(r.stats[4].n).toBe(5)
    expect(r.stats[4].median).toBeCloseTo(pct(117, 118), 6)
  })

  it('reports median, best and worst over the resolved precedents', () => {
    const r = computeAnalogs(rows, bars, 29, { direction: 'bull', window: W })
    // h=4 returns: +3.67, +3.54, +0.85, −6.78, −7.27
    expect(r.stats[4].median).toBeCloseTo(pct(117, 118), 6)
    expect(r.stats[4].best).toBeCloseTo(pct(109, 113), 6)
    expect(r.stats[4].worst).toBeCloseTo(pct(110, 102), 6)
    // h=8 (even count → mean of the middle two): +7.34, +4.42, −5.98, −13.56
    expect(r.stats[8].median).toBeCloseTo((pct(113, 118) + pct(117, 110)) / 2, 6)
    expect(r.stats[8].best).toBeCloseTo(pct(109, 117), 6)
    expect(r.stats[8].worst).toBeCloseTo(pct(118, 102), 6)
    // h=13: +6.42, −4.42
    expect(r.stats[13].median).toBeCloseTo((pct(109, 116) + pct(113, 108)) / 2, 6)
  })

  it('returns all-null stats for a horizon with no resolved precedent', () => {
    const r = computeAnalogs(rows, bars, 13, { direction: 'bull', window: W })
    expect(r.stats[8]).toEqual({ n: 0, hits: null, hitRate: null, median: null, best: null, worst: null })
  })

  it('carries the signature and direction and leaves proxy for the caller', () => {
    const r = computeAnalogs(rows, bars, 29, { direction: 'bull', window: W })
    expect(r.signature).toEqual({ commercials: 'extreme-long', largeSpecs: 'extreme-short' })
    expect(r.direction).toBe('bull')
    expect(r.proxy).toBeNull()
    expect(r.reason).toBeNull()
  })
})

describe('computeAnalogs — reasons', () => {
  it('is "neutral" when both zones are neutral and does not search', () => {
    const rows = anchorRows(30)
    const r = computeAnalogs(rows, mkBars(30), 26, { direction: 'neutral', window: W })  // k=2 → both neutral
    expect(r.reason).toBe('neutral')
    expect(r.signature).toEqual({ commercials: 'neutral', largeSpecs: 'neutral' })
    expect(r.episodes).toEqual([])
    expect(r.n).toBe(0)
    expect(r.stats[4].n).toBe(0)
    expect(r.stats[4].hitRate).toBeNull()
  })

  it('is "no-price" without bars but still lists the precedent dates', () => {
    const rows = anchorRows(30)
    for (const bars of [undefined, []]) {
      const r = computeAnalogs(rows, bars, 29, { direction: 'bull', window: W })
      expect(r.reason).toBe('no-price')
      expect(r.episodes.map(e => e.idx)).toEqual([9, 13, 17, 21, 25])
      expect(r.n).toBe(5)
      r.episodes.forEach(e => expect(e.fwd).toEqual({ 4: null, 8: null, 13: null }))
      expect(r.stats[4]).toMatchObject({ n: 0, hitRate: null, median: null })
    }
  })

  it('is "too-few" under the minimum episode count', () => {
    // The 17–19 stretch is "now", leaving only weeks 9 and 13 as precedents.
    const rows = anchorRows(30, { 18: 100, 19: 100 })
    const r = computeAnalogs(rows, mkBars(30), 19, { direction: 'bull', window: W })
    expect(r.n).toBe(2)
    expect(r.n).toBeLessThan(MIN_EPISODES)
    expect(r.reason).toBe('too-few')
  })
})

describe('computeAnalogs — synthetic 400-week series', () => {
  // Anchor baseline at the production window (156) with a four-week stretch of the
  // signature planted at weeks 300–303. idx 397 is a baseline signature week.
  const rows = anchorRows(400, { 300: 100, 301: 100, 302: 100, 303: 100 })
  const bars = mkBars(400, i => ({ c: 100 + Math.sin(i / 7) * 10 + i / 20 }))

  it('is deterministic and finds the planted stretch as one episode', () => {
    const a = computeAnalogs(rows, bars, 397, { direction: 'bull' })
    const b = computeAnalogs(rows, bars, 397, { direction: 'bull' })
    expect(a).toEqual(b)
    expect(a.reason).toBeNull()
    // Baseline signature weeks: every k=1 week from 157 (first with a full window)
    // through 393 — except 301, which is absorbed into the planted run starting at 300.
    const expected = []
    for (let j = 157; j <= 393; j += 4) expected.push(j === 301 ? 300 : j)
    expect(a.episodes.map(e => e.idx)).toEqual(expected)
    expect(a.n).toBe(60)
    const planted = a.episodes.find(e => e.idx === 300)
    expect(planted.len).toBe(4)
    expect(planted.date).toBe(rows[300].date)
    // Every precedent resolves at 4 weeks; the lookahead guard drops the newest
    // ones at 8 weeks (393+8 > 397) and 13 weeks (385, 389, 393).
    expect(a.stats[4].n).toBe(60)
    expect(a.stats[8].n).toBe(59)
    expect(a.stats[13].n).toBe(57)
    expect(a.stats[4].hits).toBeLessThanOrEqual(a.stats[4].n)
    expect(a.stats[4].hitRate).toBeGreaterThanOrEqual(0)
    expect(a.stats[4].hitRate).toBeLessThanOrEqual(100)
    expect(a.stats[4].best).toBeGreaterThanOrEqual(a.stats[4].median)
    expect(a.stats[4].worst).toBeLessThanOrEqual(a.stats[4].median)
  })

  it('uses the production window by default', () => {
    const r = computeAnalogs(rows, bars, 397, { direction: 'bull' })
    // With INDEX_WINDOW=156 the first eligible week is 155; 157 is the first k=1 week after it.
    expect(INDEX_WINDOW).toBe(156)
    expect(r.episodes[0].idx).toBe(157)
  })
})
