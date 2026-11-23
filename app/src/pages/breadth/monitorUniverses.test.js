import { describe, it, expect } from 'vitest'
import {
  MONITOR_UNIVERSES, MONITOR_LS_KEYS, parseUniverse, universeParam, universeLabel,
  universeColumnNote, universeCellOverride, withMarketWide, MARKET_WIDE_COLS, UNAVAILABLE_COLS, columnTagFor,
} from './monitorUniverses'
import { cutoffsFor, shadeFor, SHADE_CUTOFFS, SHADE_CUTOFFS_BY_UNIVERSE } from './shading'

describe('the Monitor universes', () => {
  it('UCT first (the default), then U.S. stocks / Nasdaq / NYSE', () => {
    expect(MONITOR_UNIVERSES.map(u => [u.id, u.label])).toEqual([
      ['uct', 'UCT'], ['us', 'U.S. stocks'], ['nasdaq', 'Nasdaq'], ['nyse', 'NYSE'],
    ])
  })

  it('an unknown ?universe= is UCT on the page (and never reaches the API)', () => {
    expect(parseUniverse('nasdaq')).toBe('nasdaq')
    expect(parseUniverse(' NYSE ')).toBe('nyse')
    expect(parseUniverse('nasdac')).toBe('uct')
    expect(parseUniverse(null)).toBe('uct')
  })

  it('UCT URLs carry no param at all; the others carry exactly one', () => {
    expect(universeParam('uct')).toBe('')
    expect(universeParam('us')).toBe('&universe=us')
    expect(universeParam('nyse', '?')).toBe('?universe=nyse')
    expect(universeLabel('nope')).toBe('UCT')
  })

  it('localStorage keys are EXACT names, UCT unchanged, one pair per universe', () => {
    expect(MONITOR_LS_KEYS).toEqual({
      uct: { dates: 'uct.breadth.dates.v1', recent: 'uct.breadth.recent.v1' },
      us: { dates: 'uct.breadth.dates.v1.us', recent: 'uct.breadth.recent.v1.us' },
      nasdaq: { dates: 'uct.breadth.dates.v1.nasdaq', recent: 'uct.breadth.recent.v1.nasdaq' },
      nyse: { dates: 'uct.breadth.dates.v1.nyse', recent: 'uct.breadth.recent.v1.nyse' },
    })
    const all = Object.values(MONITOR_LS_KEYS).flatMap(k => [k.dates, k.recent])
    expect(new Set(all).size).toBe(all.length)
  })

  it('UCT columns carry no universe note and no override (the UCT sheet is unchanged)', () => {
    for (const k of ['breadth_score', 'up_vol_ratio', 'vix', 'mcclellan_osc']) {
      expect(universeColumnNote(k, 'uct')).toBeNull()
      expect(universeCellOverride(k, 'uct')).toBeNull()
    }
  })

  it('off UCT: Health scored with its own bands, the Phase 3 columns n/a, market-wide and ratio-adjusted notes', () => {
    expect(universeCellOverride('breadth_score', 'nasdaq')).toBeNull()
    expect(universeColumnNote('breadth_score', 'nasdaq')).toMatch(/Nasdaq’s own bands/)
    expect(universeCellOverride('new_ath', 'us', { new_ath: 4 })).toBe('n/a')   // never off UCT
    expect(universeColumnNote('new_ath', 'us')).toBe('Not available for this universe yet.')
    for (const k of ['up_vol_ratio', 'hvc_52w', 'atr_ext_7']) {
      // rebuilt per universe: a value shows, a session the series lacks reads n/a
      expect(universeCellOverride(k, 'us', { [k]: 3 })).toBeNull()
      expect(universeCellOverride(k, 'us', { [k]: null })).toBe('n/a')
      expect(universeColumnNote(k, 'us')).toMatch(/own list for each session/)
    }
    expect(universeColumnNote('vix', 'nyse')).toMatch(/Market-wide/)
    expect(universeColumnNote('mcclellan_osc', 'nyse')).toMatch(/Ratio-adjusted on NYSE.*UCT’s raw/)
    expect(universeColumnNote('pct_above_50sma', 'nyse')).toBeNull()
    expect(universeCellOverride('pct_above_50sma', 'nyse')).toBeNull()
  })

  it("today's universe row takes UCT's live market-wide readings, never its per-universe ones", () => {
    const uni = { date: '2026-11-19', pct_above_50sma: 41, universe_count: 2900, vix: null, _live: true }
    const uct = { date: '2026-11-19', pct_above_50sma: 55, universe_count: 3700, vix: 18, naaim: 70,
                  cnn_fear_greed: 33, cnn_fear_greed_asof: '2026-11-18' }
    const out = withMarketWide(uni, uct)
    expect(out.pct_above_50sma).toBe(41)
    expect(out.universe_count).toBe(2900)
    expect(out.vix).toBe(18)
    expect(out.naaim).toBe(70)
    expect(out.cnn_fear_greed_asof).toBe('2026-11-18')
    expect(withMarketWide(null, uct)).toBeNull()
  })
})

describe('the Columns menu tags (ColumnsMenu columnTag)', () => {
  it('none on UCT; Market-wide / n/a for <universe> elsewhere', () => {
    expect(columnTagFor('vix', 'uct')).toBeNull()
    expect(columnTagFor('breadth_score', 'uct')).toBeNull()
    expect(columnTagFor('vix', 'nasdaq')).toMatchObject({ label: 'Market-wide' })
    expect(columnTagFor('up_vol_ratio', 'nasdaq')).toBeNull()
    expect(columnTagFor('new_ath', 'nasdaq')).toMatchObject({ label: 'n/a for Nasdaq', na: true })
    expect(columnTagFor('breadth_score', 'nyse')).toBeNull()
    expect(columnTagFor('pct_above_50sma', 'us')).toBeNull()
  })
})

describe('shading per universe', () => {
  it('the cutoffs file holds one entry per universe, UCT kept as the historical shape', () => {
    expect(Object.keys(SHADE_CUTOFFS_BY_UNIVERSE).filter(k => k !== '_doc').sort())
      .toEqual(['nasdaq', 'nyse', 'uct', 'us'])
    expect(SHADE_CUTOFFS).toBe(SHADE_CUTOFFS_BY_UNIVERSE.uct)
    for (const u of ['us', 'nasdaq', 'nyse']) {
      const c = SHADE_CUTOFFS_BY_UNIVERSE[u]
      expect(c.grid).toEqual(SHADE_CUTOFFS.grid)
      // calibrated over the universe's own full history, per-universe columns only
      expect(c.sessions).toBeGreaterThan(1000)
      for (const k of MARKET_WIDE_COLS) expect(c.cols[k]).toBeUndefined()
      for (const k of UNAVAILABLE_COLS) expect(c.cols[k]).toBeUndefined()
      expect(c.cols.pct_above_50sma).toBeDefined()
    }
  })

  it('the window rule: every universe calibrated over ALL of its point-in-time history, nothing before 2008', () => {
    const start = { uct: '2008-01-02', us: '2008-01-02', nasdaq: '2008-01-02', nyse: '2009-06-11' }
    for (const [u, from] of Object.entries(start)) {
      const c = SHADE_CUTOFFS_BY_UNIVERSE[u]
      expect(c.from).toBe(from)
      expect(c.sessions).toBeGreaterThan(4000)
      expect(c.per).toEqual(['universe_count'])
    }
  })

  it('a per-universe column uses its universe; a market-wide column always uses UCT', () => {
    expect(cutoffsFor('uct', 'pct_above_50sma')).toBe(SHADE_CUTOFFS_BY_UNIVERSE.uct)
    expect(cutoffsFor('nasdaq', 'pct_above_50sma')).toBe(SHADE_CUTOFFS_BY_UNIVERSE.nasdaq)
    expect(cutoffsFor('nyse', 'vix')).toBe(SHADE_CUTOFFS_BY_UNIVERSE.uct)
    expect(cutoffsFor('nyse', 'sp500_close')).toBe(SHADE_CUTOFFS_BY_UNIVERSE.uct)
    expect(cutoffsFor('mars', 'pct_above_50sma')).toBeNull()
  })

  it('shadeFor picks the cutoffs by universe', () => {
    const spec = { pcts: { notable: 25, strong: 10, extreme: 3 }, cols: { x: { bull: 'high', sides: 'both' } } }
    const grid = [0.5, 1, 2, 3, 4, 5, 7.5, 10, 12.5, 15, 20, 25, 30]
    const mk = (hi) => ({ grid, cols: { x: { n: 100, mid: 0, lo: grid.map(() => -hi), hi: grid.map(() => hi) } } })
    const row = { x: 50 }
    // shaded against a narrow distribution, unshaded against a wide one
    expect(shadeFor('x', row, { specIn: spec, cut: mk(10) })).toEqual({ tone: 'bull', level: 3 })
    expect(shadeFor('x', row, { specIn: spec, cut: mk(100) })).toBeNull()
    // a universe with no cutoffs leaves the cell unshaded rather than borrowing UCT's
    expect(shadeFor('x', row, { specIn: spec, universe: 'mars' })).toBeNull()
  })
})
