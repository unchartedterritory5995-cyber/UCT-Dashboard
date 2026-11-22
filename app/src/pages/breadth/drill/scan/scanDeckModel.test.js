import { describe, it, expect } from 'vitest'
import {
  SCAN_FILTERS, availableFilters, applyFilters, composition, UNCLASSIFIED,
  dayContext, stepDate, barDate, dayFacts,
  reviewKey, readReview, writeReview, REVIEW_LS, REVIEW_MAX_LISTS, fmtCap, fmtPct,
} from './scanDeckModel'

const rows = [
  { sym: 'AAA', pct: 12, mcap: 5e9, rvol: 3, price: 40, dcr: 90, repeat: 0 },
  { sym: 'BBB', pct: 6, mcap: 4e8, rvol: 1.2, price: 8, dcr: 40, repeat: 2 },
  { sym: 'CCC', pct: 5, mcap: 2e9, rvol: null, price: 15, dcr: 75, repeat: 0 },
]

describe('filters', () => {
  it('no active filter returns the rows untouched', () => {
    expect(applyFilters(rows, new Set())).toBe(rows)
  })
  it('active filters AND together', () => {
    const out = applyFilters(rows, new Set(['mcap1b', 'price10']))
    expect(out.map(r => r.sym)).toEqual(['AAA', 'CCC'])
  })
  it('⛔ a row missing the field an active filter reads is dropped, never assumed to pass', () => {
    expect(applyFilters(rows, new Set(['rvol2'])).map(r => r.sym)).toEqual(['AAA'])
  })
  it('strong close flips with the list direction', () => {
    const dn = [{ sym: 'X', dcr: 10 }, { sym: 'Y', dcr: 90 }]
    expect(applyFilters(dn, new Set(['dcrStrong']), { dir: -1 }).map(r => r.sym)).toEqual(['X'])
    expect(applyFilters(dn, new Set(['dcrStrong']), { dir: 1 }).map(r => r.sym)).toEqual(['Y'])
  })
  it('⛔ an UNAVAILABLE filter is ignored rather than emptying the list', () => {
    const noDcr = rows.map(r => Object.fromEntries(Object.entries(r).filter(([k]) => k !== 'dcr')))
    const avail = availableFilters(noDcr)
    expect(avail.has('dcrStrong')).toBe(false)
    expect(applyFilters(noDcr, new Set(['dcrStrong']), { available: avail })).toHaveLength(3)
  })
  it('every filter declares the field it reads', () => {
    for (const f of SCAN_FILTERS) expect(typeof f.field).toBe('string')
  })
})

describe('composition', () => {
  const items = [
    { sym: 'A', pct: 10, s: 'Tech' }, { sym: 'B', pct: 6, s: 'Tech' },
    { sym: 'C', pct: 4, s: null }, { sym: 'D', pct: 8, s: 'Energy' },
    { sym: 'E', pct: 5, s: null }, { sym: 'F', pct: 5, s: null },
  ]
  const g = composition(items, r => r.s)
  it('counts, shares and averages each group', () => {
    const tech = g.find(x => x.key === 'Tech')
    expect(tech.count).toBe(2)
    expect(tech.share).toBeCloseTo(2 / 6)
    expect(tech.avgPct).toBeCloseTo(8)
    expect(tech.syms).toEqual(['A', 'B'])
  })
  it('Unclassified sorts LAST even when it is the biggest bucket', () => {
    expect(g[g.length - 1].key).toBe(UNCLASSIFIED)
    expect(g[g.length - 1].count).toBe(3)
    expect(g[0].key).toBe('Tech')
  })
})

describe('dayContext', () => {
  // newest first, as Breadth.jsx holds them
  const hist = Array.from({ length: 40 }, (_, i) => ({ date: `2026-09-${String(40 - i).padStart(2, '0')}`, up: i, breadth_score: 50 }))
  hist[0].up = 1000 // the newest day is the biggest
  it('ranks the day against the window it opens', () => {
    const ctx = dayContext(hist, 'up', hist[0].date)
    expect(ctx.value).toBe(1000)
    expect(ctx.pctile).toBeGreaterThanOrEqual(97)
    expect(ctx.health).toBe(50)
  })
  it('sparkline is oldest first and ends on the day', () => {
    const ctx = dayContext(hist, 'up', hist[0].date, { spark: 10 })
    expect(ctx.series).toHaveLength(10)
    expect(ctx.series[ctx.series.length - 1]).toBe(1000)
  })
  it('a past day ranks against sessions up to it, not after it', () => {
    const ctx = dayContext(hist, 'up', hist[5].date, { spark: 5 })
    expect(ctx.series[ctx.series.length - 1]).toBe(5)
    expect(ctx.series).not.toContain(1000)
  })
  it('too little history gives no percentile rather than a made-up one', () => {
    expect(dayContext(hist.slice(0, 10), 'up', hist[0].date).pctile).toBeNull()
  })
  it('the live row is shown but never ranked against itself as settled history', () => {
    const withLive = [{ _live: true, date: '2026-10-01', up: 2000, breadth_score: 70 }, ...hist]
    const ctx = dayContext(withLive, 'up', null, { live: true, spark: 5 })
    expect(ctx.value).toBe(2000)
    expect(ctx.health).toBe(70)
    expect(ctx.series[ctx.series.length - 1]).toBe(2000)
    expect(ctx.sample).toBe(40)
  })
  it('an unknown date returns null', () => {
    expect(dayContext(hist, 'up', '1999-01-01')).toBeNull()
  })
})

describe('stepDate', () => {
  const r = [{ _live: true, date: '2026-11-07' }, { date: '2026-11-06' }, { date: '2026-11-05' }, { date: '2026-11-04' }]
  it('back from a settled day goes one session older', () => {
    expect(stepDate(r, '2026-11-05', false, -1)).toEqual({ date: '2026-11-04', live: false })
  })
  it('forward from the newest settled day reaches the live row', () => {
    expect(stepDate(r, '2026-11-06', false, 1)).toEqual({ date: null, live: true })
  })
  it('back from live lands on the newest settled day; forward from live is nothing', () => {
    expect(stepDate(r, null, true, -1)).toEqual({ date: '2026-11-06', live: false })
    expect(stepDate(r, null, true, 1)).toBeNull()
  })
  it('the oldest loaded day has nowhere further back', () => {
    expect(stepDate(r, '2026-11-04', false, -1)).toBeNull()
  })
  it('with no live row, the newest settled day has no next', () => {
    expect(stepDate(r.slice(1), '2026-11-06', false, 1)).toBeNull()
  })
})

describe('barDate', () => {
  it('reads every shape the bars pipeline has used', () => {
    expect(barDate('2026-11-06')).toBe('2026-11-06')
    expect(barDate('2026-11-06T00:00:00Z')).toBe('2026-11-06')
    expect(barDate(20261106)).toBe('2026-11-06')
    expect(barDate('20261106')).toBe('2026-11-06')
    expect(barDate(Date.UTC(2026, 10, 6) / 1000)).toBe('2026-11-06')
    expect(barDate(Date.UTC(2026, 10, 6))).toBe('2026-11-06')
    expect(barDate({ year: 2026, month: 11, day: 6 })).toBe('2026-11-06')
  })
  it('garbage is null, not a guess', () => {
    expect(barDate(null)).toBeNull()
    expect(barDate('yesterday')).toBeNull()
    expect(barDate(NaN)).toBeNull()
  })
})

describe('dayFacts', () => {
  const bars = []
  for (let i = 1; i <= 25; i++) bars.push({ t: 20261000 + i, o: 10, h: 11, l: 10, c: 10.5, v: 1000 })
  bars.push({ t: 20261026, o: 11, h: 13, l: 10.5, c: 12.5, v: 5000 })
  it('DCR, gap, ADR and $ volume for the dated bar', () => {
    const f = dayFacts(bars, '2026-10-26')
    expect(f.dcr).toBeCloseTo(80)
    expect(f.gap).toBeCloseTo(((11 - 10.5) / 10.5) * 100)
    expect(f.dolvol).toBe(12.5 * 5000)
    // 19 bars at 10% range + one at (13/10.5-1)
    expect(f.adr).toBeCloseTo((19 * 10 + (13 / 10.5 - 1) * 100) / 20)
  })
  it('null date means the newest bar (a live drill)', () => {
    expect(dayFacts(bars, null).close).toBe(12.5)
  })
  it('a day not in the bars is null, never the nearest bar', () => {
    expect(dayFacts(bars, '2026-12-01')).toBeNull()
  })
  it('accepts long-form field names', () => {
    const long = [{ time: '2026-01-02', open: 1, high: 2, low: 1, close: 1.5, volume: 10 }]
    expect(dayFacts(long, '2026-01-02').dcr).toBeCloseTo(50)
    expect(dayFacts(long, '2026-01-02').gap).toBeNull()
  })
})

describe('reviewed store', () => {
  const mem = () => { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), m } }
  it('round-trips seen and skipped per list', () => {
    const s = mem()
    const k = reviewKey('up_4pct_today', '2026-11-06', false)
    writeReview(s, k, { seen: new Set(['A', 'B']), skipped: new Set(['B']) })
    const r = readReview(s, k)
    expect([...r.seen]).toEqual(['A', 'B'])
    expect([...r.skipped]).toEqual(['B'])
    expect(readReview(s, reviewKey('up_4pct_today', '2026-11-05', false)).seen.size).toBe(0)
  })
  it('live lists key separately from any date', () => {
    expect(reviewKey('x', '2026-11-06', true)).toBe('x|live')
  })
  it('keeps only the newest lists', () => {
    const s = mem()
    for (let i = 0; i < REVIEW_MAX_LISTS + 5; i++) writeReview(s, `k${i}`, { seen: new Set(['A']), skipped: new Set() }, 1000 + i)
    const all = JSON.parse(s.getItem(REVIEW_LS))
    expect(Object.keys(all)).toHaveLength(REVIEW_MAX_LISTS)
    expect(all.k0).toBeUndefined()
    expect(all[`k${REVIEW_MAX_LISTS + 4}`]).toBeDefined()
  })
  it('a broken or throwing store degrades to empty, never throws', () => {
    const bad = { getItem: () => '{not json', setItem: () => { throw new Error('quota') } }
    expect(readReview(bad, 'k').seen.size).toBe(0)
    expect(writeReview(bad, 'k', { seen: new Set(), skipped: new Set() })).toBe(false)
    expect(readReview(null, 'k').seen.size).toBe(0)
  })
})

describe('format', () => {
  it('caps and percents', () => {
    expect(fmtCap(2.5e9)).toBe('$2.5B')
    expect(fmtCap(4.2e8)).toBe('$420M')
    expect(fmtCap(null)).toBe('—')
    expect(fmtPct(3.21)).toBe('+3.2%')
    expect(fmtPct(-1)).toBe('-1.0%')
    expect(fmtPct(undefined)).toBe('—')
  })
})

describe('mergeHistory (the count chart’s 6M / 1Y ranges)', () => {
  it('adds older settled sessions under the page window, newest first, live row on top', async () => {
    const { mergeHistory } = await import('../longHistory')
    const page = [{ _live: true, date: '2026-11-09' }, { date: '2026-11-06' }, { date: '2026-11-05' }]
    const long = [{ date: '2026-11-06' }, { date: '2026-11-05' }, { date: '2026-11-04' }, { date: '2026-11-03' }]
    const out = mergeHistory(page, long)
    expect(out.map(r => r.date)).toEqual(['2026-11-09', '2026-11-06', '2026-11-05', '2026-11-04', '2026-11-03'])
    expect(out[0]._live).toBe(true)
    // The page's own rows win (same objects), never the long copy.
    expect(out[1]).toBe(page[1])
  })
  it('no long history: the page rows come back untouched', async () => {
    const { mergeHistory } = await import('../longHistory')
    const page = [{ date: '2026-11-06' }]
    expect(mergeHistory(page, null)).toBe(page)
  })
})
