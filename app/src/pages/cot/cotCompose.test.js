import { describe, it, expect } from 'vitest'
import { composeWeek } from './cotCompose'
import { INDEX_WINDOW } from './cotRead'
import { MIN_EPISODES, alignPrice } from './cotAnalogs'

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

// Trending fixture: the trend crowd and open interest grow every week while
// the hedgers keep selling. Paired with mkBars (price +1 a week) the only
// divergence rule that can fire is 'trend-confirmed', and it fires at every
// week with thirteen weeks of price behind it. Hedgers sit at a 3-year max
// short (index 0) → Contrarian Bearish, strong.
const trendRows = n => mkRows(n, i => ({
  commercial_net: -i * 10,
  large_spec_net: i * 10,
  open_interest: 1_000_000 + i * 100,
}))

// Anchor fixture (see cotAnalogs.test.js): a ±100 print every fourth week pins
// every 156-week window's range, so zones are predictable. k = i % 4:
//   k=1 → commercials extreme-long / specs extreme-short (the signature under test)
// At idx=197 (k=1) the earlier k=1 weeks from 157..193 are ten one-week precedents.
const anchorRows = n => mkRows(n, i => {
  const k = i % 4
  const c = k === 0 ? -100 : k === 1 ? 100 : 0
  return { commercial_net: c, large_spec_net: -c }
})

const SYM = { symbol: 'ES', name: 'S&P 500 E-mini' }

// ── composeWeek ───────────────────────────────────────────────────────────────

describe('composeWeek', () => {
  it('returns the whole composition for one week: snap → read → analogs → divergences → facts', () => {
    const rows = trendRows(200)
    const out = composeWeek(rows, 199, SYM)
    expect(Object.keys(out).sort()).toEqual(['analogs', 'divergences', 'facts', 'isLatest', 'read', 'snap'])
    expect(out.snap.date).toBe(rows[199].date)
    expect(out.snap.idx).toBe(199)
    expect(out.snap.windowWeeks).toBe(INDEX_WINDOW)
    expect(out.read.bias).toEqual({ label: 'Contrarian Bearish', tone: 'bear', strength: 'strong' })
    expect(typeof out.read.headline).toBe('string')
    expect(out.read.headline.length).toBeGreaterThan(0)
    expect(out.isLatest).toBe(true)
  })

  it('runs the analog search in the direction of the read (the rail passes read.bias.tone)', () => {
    const rows = trendRows(200)
    const out = composeWeek(rows, 199, SYM)
    expect(out.analogs.direction).toBe(out.read.bias.tone)
    expect(out.analogs.direction).toBe('bear')
  })

  it('flags isLatest only for the last row', () => {
    const rows = trendRows(200)
    expect(composeWeek(rows, 199, SYM).isLatest).toBe(true)
    expect(composeWeek(rows, 198, SYM).isLatest).toBe(false)
    expect(composeWeek(rows, 0, SYM).isLatest).toBe(false)
  })

  it('builds facts for EVERY week, stamped with that week’s report date', () => {
    const rows = trendRows(200)
    for (const idx of [0, 17, 155, 198, 199]) {
      const { facts } = composeWeek(rows, idx, SYM)
      expect(facts.report_date).toBe(rows[idx].date)
      expect(facts.symbol).toBe('ES')
      expect(facts.name).toBe('S&P 500 E-mini')
      expect(typeof facts.groups.commercials.index_3y === 'number' || facts.groups.commercials.index_3y === null).toBe(true)
    }
    expect(composeWeek(rows, 199, SYM).facts.groups.commercials.index_3y).toBe(0)
  })

  it('returns no divergences when there is no price at all', () => {
    const rows = trendRows(200)
    const out = composeWeek(rows, 199, SYM)
    expect(out.divergences).toEqual([])
    expect(out.facts.price_check).toEqual([])
    expect(out.analogs.reason).not.toBeNull() // a lone run at a monotonic extreme → no precedents
  })

  it('derives priceAligned from bars when the caller passes bars only', () => {
    const rows = trendRows(200)
    const bars = mkBars(200)
    const out = composeWeek(rows, 199, { ...SYM, bars })
    expect(out.divergences.map(d => d.key)).toEqual(['trend-confirmed'])
    expect(out.facts.price_check).toEqual(['Trend confirmed'])
  })

  it('prefers a caller-supplied priceAligned over deriving one from bars', () => {
    const rows = trendRows(200)
    const bars = mkBars(200)
    // An all-null alignment means "price unknown" at every week → no tells,
    // even though the bars alone would have produced one.
    const blank = new Array(rows.length).fill(null)
    expect(composeWeek(rows, 199, { ...SYM, bars, priceAligned: blank }).divergences).toEqual([])
    // And the real alignment, passed explicitly, reproduces the bars path.
    const aligned = alignPrice(rows, bars)
    expect(composeWeek(rows, 199, { ...SYM, priceAligned: aligned }).divergences.map(d => d.key))
      .toEqual(['trend-confirmed'])
  })

  it('feeds precedents (with the proxy ticker) into facts when enough episodes exist', () => {
    const rows = anchorRows(200)
    const bars = mkBars(200)
    const out = composeWeek(rows, 197, { ...SYM, bars, proxy: { ticker: 'SPY', note: 'via SPY' } })
    expect(out.read.bias.tone).toBe('bull')
    expect(out.analogs.n).toBe(10)
    expect(out.analogs.n).toBeGreaterThanOrEqual(MIN_EPISODES)
    expect(out.facts.precedents).not.toBeNull()
    expect(out.facts.precedents.proxy).toBe('SPY')
    expect(out.facts.precedents.episodes).toBe(10)
    expect(out.facts.precedents.direction).toBe('bull')
    expect(out.facts.precedents.horizons['4w'].n).toBe(10)
  })

  it('leaves precedents.proxy null when no proxy is given', () => {
    const rows = anchorRows(200)
    const out = composeWeek(rows, 197, { ...SYM, bars: mkBars(200) })
    expect(out.facts.precedents.proxy).toBeNull()
  })

  it('reuses a shared snapshots memo across calls instead of recomputing', () => {
    const rows = anchorRows(200)
    const memo = []
    const first = composeWeek(rows, 197, { ...SYM, snapshots: memo })
    const filled = memo.filter(Boolean).length
    // The analog search walks every week from window−1 to idx through the memo.
    expect(filled).toBe(197 - (INDEX_WINDOW - 1) + 1)

    const second = composeWeek(rows, 197, { ...SYM, snapshots: memo })
    expect(second.analogs).toEqual(first.analogs)
    expect(memo.filter(Boolean).length).toBe(filled) // nothing new computed

    // The memo is the one actually READ, not a copy: tamper with this week's
    // entry and the analog signature follows it — while the week's own
    // snapshot (computed independently, as the rail does) is untouched.
    const g = memo[197].groups
    memo[197] = { ...memo[197], groups: {
      ...g,
      commercials: { ...g.commercials, zone: 'neutral' },
      largeSpecs:  { ...g.largeSpecs,  zone: 'neutral' },
    } }
    const third = composeWeek(rows, 197, { ...SYM, snapshots: memo })
    expect(third.analogs.reason).toBe('neutral')
    expect(third.snap.groups.commercials.zone).toBe('extreme-long')
  })

  it('throws a plain Error for empty rows or an out-of-range idx', () => {
    const rows = trendRows(10)
    expect(() => composeWeek([], 0, SYM)).toThrow(Error)
    expect(() => composeWeek([], 0, SYM)).toThrow(/rows/)
    expect(() => composeWeek(null, 0, SYM)).toThrow(/rows/)
    expect(() => composeWeek(rows, 10, SYM)).toThrow(/idx 10/)
    expect(() => composeWeek(rows, -1, SYM)).toThrow(/idx -1/)
    expect(() => composeWeek(rows, 1.5, SYM)).toThrow(/idx/)
    expect(() => composeWeek(rows, undefined, SYM)).toThrow(/idx/)
  })

  it('works with no options at all', () => {
    const rows = trendRows(20)
    const out = composeWeek(rows, 19)
    expect(out.facts.report_date).toBe(rows[19].date)
    expect(out.facts.symbol).toBeUndefined()
    expect(out.divergences).toEqual([])
  })
})
