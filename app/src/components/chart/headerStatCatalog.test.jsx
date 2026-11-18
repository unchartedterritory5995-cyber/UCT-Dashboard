// app/src/components/chart/headerStatCatalog.test.js — the chart header's info-row stat library (owner 11-16).
// Synthetic values only (never a real quote).
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import {
  HEADER_STATS, HEADER_STAT_GROUPS, HEADER_STAT_BY_KEY, STAT_LABEL_MAX,
  headerStatKeys, statLabelsOf, withStatLabel, cleanStatLabel, headerStatTogglePatch, movedHeaderStats,
  statNeedsQuote, statFactFields, resolveHeaderStat, headerStatItems,
} from './headerStatCatalog'
import { HEADER_FIELDS, headerFieldKeys } from './headerFields'
import { COLUMN_GROUPS, LIVE_COLUMNS, FACT_COLUMNS } from '../../pages/watchlist/watchlistColumnCatalog'
import { mergeChartSettings } from './chartDefaults'
import { applyAppearance } from './chartAppearance'
import ChartMetaRow from './pane/ChartMetaRow'

describe('the catalog', () => {
  it('is the 22 header fields + every Watchlist live and snapshot column, each once, in a known group', () => {
    const expected = HEADER_FIELDS.length + Object.keys(LIVE_COLUMNS).length + Object.keys(FACT_COLUMNS).length
    expect(HEADER_STATS.length).toBe(expected)
    expect(new Set(HEADER_STATS.map((s) => s.key)).size).toBe(expected)
    const groups = new Set(COLUMN_GROUPS.map((g) => g.key))
    for (const s of HEADER_STATS) {
      expect(groups.has(s.group), s.key).toBe(true)
      expect(s.label, s.key).toBeTruthy()
      expect(s.short, s.key).toBeTruthy()
      expect(s.colorKey, s.key).toBeTruthy()
    }
    // groups follow the Watchlist library's order and none is empty
    const order = COLUMN_GROUPS.map((g) => g.key).filter((k) => HEADER_STAT_GROUPS.some((g) => g.key === k))
    expect(HEADER_STAT_GROUPS.map((g) => g.key)).toEqual(order)
    expect(HEADER_STAT_GROUPS.every((g) => g.stats.length > 0)).toBe(true)
  })

  it('keeps the original fields\' colour keys (a stored colour is not lost)', () => {
    for (const f of HEADER_FIELDS) expect(HEADER_STAT_BY_KEY[f.key].colorKey).toBe(f.colorKey)
  })
})

describe('sanitiser: chosen keys', () => {
  it('a blob with no `fields` reads as today\'s row (Market Cap · Next Earnings; UCT Rating retired 11-17)', () => {
    expect(headerStatKeys({})).toEqual(['mcap', 'earn'])
    expect(headerStatKeys(undefined)).toEqual(['mcap', 'earn'])
    expect(headerStatKeys(mergeChartSettings(null).header)).toEqual(['mcap', 'earn'])
    // the legacy show* flags still migrate exactly as before
    const legacy = { showMarketCap: false, showNextEarnings: true, showUctRating: false }
    expect(headerStatKeys(legacy)).toEqual(headerFieldKeys(legacy))
  })

  it('an old `fields` blob of the original fields reads unchanged, in its order', () => {
    expect(headerStatKeys({ fields: ['price', 'chg', 'rvol', 'mcap'] })).toEqual(['price', 'chg', 'rvol', 'mcap'])
  })

  it('drops unknown ids, non-strings and duplicates (first one wins)', () => {
    expect(headerStatKeys({ fields: ['pe', 'nope', 42, null, 'mcap', 'pe', 'gap', '__proto__', 'constructor'] })).toEqual(['pe', 'mcap', 'gap'])
    expect(statLabelsOf(JSON.parse('{"statLabels":{"__proto__":"x","toString":"y","pe":"PE"}}'))).toEqual({ pe: 'PE' })
  })

  it('an empty list is a real choice (no stats)', () => {
    expect(headerStatKeys({ fields: [] })).toEqual([])
  })
})

describe('sanitiser: renames', () => {
  it('known ids only, trimmed, whitespace collapsed, capped at 16, empties dropped', () => {
    const out = statLabelsOf({ statLabels: { mcap: '  Cap  ', pe: 'Price   to earnings ratio long', bogus: 'x', earn: '   ', rating: 7 } })
    expect(out).toEqual({ mcap: 'Cap', pe: 'Price to earning' })
    expect(out.pe.length).toBe(STAT_LABEL_MAX)
  })

  it('a malformed map reads as no renames', () => {
    expect(statLabelsOf({ statLabels: ['a'] })).toEqual({})
    expect(statLabelsOf({ statLabels: 'x' })).toEqual({})
    expect(statLabelsOf({})).toEqual({})
  })

  it('withStatLabel sets, clears on empty and clears on the stat\'s own name', () => {
    expect(withStatLabel({}, 'mcap', 'Cap')).toEqual({ mcap: 'Cap' })
    expect(withStatLabel({ statLabels: { mcap: 'Cap' } }, 'mcap', '  ')).toEqual({})
    expect(withStatLabel({ statLabels: { mcap: 'Cap' } }, 'mcap', 'Market Cap')).toEqual({})
    expect(withStatLabel({}, 'nope', 'X')).toEqual({})
    expect(cleanStatLabel('a'.repeat(40))).toHaveLength(STAT_LABEL_MAX)
  })
})

describe('writers', () => {
  it('toggle appends a pick and removes an unpick together with its rename', () => {
    expect(headerStatTogglePatch({}, 'pe')).toEqual({ fields: ['mcap', 'earn', 'pe'] })
    expect(headerStatTogglePatch({ fields: ['mcap', 'pe'], statLabels: { pe: 'PE', mcap: 'Cap' } }, 'pe'))
      .toEqual({ fields: ['mcap'], statLabels: { mcap: 'Cap' } })
    expect(headerStatTogglePatch({}, 'nope')).toEqual({})
  })

  it('move reorders and clamps', () => {
    const h = { fields: ['a1', 'mcap', 'earn', 'pe'].filter((k) => HEADER_STAT_BY_KEY[k]) }
    expect(movedHeaderStats(h, 0, 2)).toEqual(['earn', 'pe', 'mcap'])
    expect(movedHeaderStats(h, 2, -5)).toEqual(['pe', 'mcap', 'earn'])
    expect(movedHeaderStats(h, 9, 0)).toEqual(['mcap', 'earn', 'pe'])
  })
})

describe('data needs', () => {
  it('asks the snapshot only for the chosen fact stats, plus the close when one is price-relative', () => {
    expect(statFactFields(['mcap', 'price'])).toEqual([])
    expect(statFactFields(['pe'])).toEqual(['pe_ttm'])
    expect(statFactFields(['ytd', 'pe']).sort()).toEqual(['chg_pct_ytd', 'pe_ttm', 'price'])
  })
  it('a price-relative stat reads the live quote; a static one does not', () => {
    expect(statNeedsQuote('gap')).toBe(true)
    expect(statNeedsQuote('ytd')).toBe(true)
    expect(statNeedsQuote('pe')).toBe(false)
    expect(statNeedsQuote('dte')).toBe(false)
  })
})

describe('values (synthetic)', () => {
  const quote = { price: 110, day_open: 105, prev_close: 100, day_high: 120, day_low: 100, volume: 1000 }
  const facts = { pe_ttm: 21.5, chg_pct_ytd: 10, price: 100, country: 'Testland', dist_52w_high_pct: -20 }

  it('header fields resolve as before; live and snapshot stats resolve through the Watchlist paths', () => {
    expect(resolveHeaderStat('price', { quote }).value).toBe('110.00')
    expect(resolveHeaderStat('gap', { quote })).toMatchObject({ value: '+5.00%', sign: 'pos' })
    expect(resolveHeaderStat('country', { facts }).value).toBe('Testland')
    // YTD re-based on the live price: (1.10 × 110/100 − 1) = +21.0%
    expect(resolveHeaderStat('ytd', { facts, quote })).toMatchObject({ value: '+21.0%', sign: 'pos' })
    expect(resolveHeaderStat('pe', { facts }).value).toBeTruthy()
  })

  it('unknown or missing values are null, never a throw', () => {
    expect(resolveHeaderStat('pe', {}).value).toBeNull()
    expect(resolveHeaderStat('gap', {}).value).toBeNull()
    expect(resolveHeaderStat('nope', {}).value).toBeNull()
    expect(resolveHeaderStat('ytd', { facts: { chg_pct_ytd: 'x' } }).value).toBeNull()
    expect(resolveHeaderStat('dte', { fund: { next_earnings: 'garbage' } }).value).toBeNull()
  })

  it('company-only stats read "—" on an ETF / index (like Market Cap today)', () => {
    expect(resolveHeaderStat('pe', { facts, isFundLike: true }).value).toBeNull()
    expect(resolveHeaderStat('gap', { quote, isFundLike: true }).value).toBe('+5.00%')
  })
})

describe('the info row', () => {
  const ctx = { quote: { price: 110, day_open: 105, prev_close: 100 }, facts: { pe_ttm: 21.5 }, fund: { metrics: { market_cap: '12.3B' } } }

  it('renders the chosen stats in order with the custom labels; a missing value prints —', () => {
    const items = headerStatItems(['pe', 'mcap', 'nope', 'roe', 'gap'], { mcap: 'Cap' }, {}, ctx)
    expect(items.map((i) => i.key)).toEqual(['pe', 'mcap', 'roe', 'gap'])
    expect(items[1]).toMatchObject({ label: 'Cap', short: 'Cap', title: 'Market Cap', value: '12.3B' })
    expect(items[2].value).toBeNull()
    const styles = { chartMeta: 'm', chartMetaItem: 'i', chartMetaLabel: 'l', chartMetaVal: 'v' }
    const { container } = render(<ChartMetaRow items={items} styles={styles} />)
    const labels = [...container.querySelectorAll('.l')].map((n) => n.textContent)
    expect(labels).toEqual(['P/E', 'Cap', 'ROE', 'Gap %'])
    const vals = [...container.querySelectorAll('.v')].map((n) => n.textContent)
    expect(vals[2]).toBe('—')
    expect(screen.getByTitle('Market Cap').textContent).toBe('Cap')
  })

  it('narrow mode keeps the rename (it is already short)', () => {
    const items = headerStatItems(['mcap'], { mcap: 'Cap' }, {}, ctx)
    const styles = { chartMeta: 'm', chartMetaItem: 'i', chartMetaLabel: 'l', chartMetaVal: 'v' }
    const { container } = render(<ChartMetaRow items={items} abbrev styles={styles} />)
    expect(container.querySelector('.l').textContent).toBe('Cap')
  })

  it('colour: a signed stat takes its pos/neg override; others their own override or white', () => {
    const items = headerStatItems(['gap', 'pe'], {}, { 'gap:pos': '#010203', pe: '#0a0b0c' }, ctx)
    expect(items[0].color).toBe('#010203')
    expect(items[1].color).toBe('#0a0b0c')
    expect(headerStatItems(['pe'], {}, {}, ctx)[0].color).toBeNull()
  })

  it('default settings → today\'s exact row (keys, labels)', () => {
    const h = mergeChartSettings(null).header
    const items = headerStatItems(headerStatKeys(h), statLabelsOf(h), h.colors, {})
    expect(items.map((i) => [i.key, i.label])).toEqual([['mcap', 'Market Cap'], ['earn', 'Next Earnings']])
  })
})

describe('persistence', () => {
  it('the merge keeps `fields` and `statLabels` only when stored (absent stays absent)', () => {
    const d = mergeChartSettings(null)
    expect('fields' in d.header).toBe(false)
    expect('statLabels' in d.header).toBe(false)
    const m = mergeChartSettings(JSON.stringify({ header: { fields: ['pe', 'mcap'], statLabels: { pe: 'PE' } } }))
    expect(m.header.fields).toEqual(['pe', 'mcap'])
    expect(m.header.statLabels).toEqual({ pe: 'PE' })
  })

  it('Apply to all charts copies the selection, order and renames (header is appearance)', () => {
    const src = mergeChartSettings(JSON.stringify({ header: { fields: ['pe', 'gap'], statLabels: { gap: 'Gap' }, timeframes: ['D'] } }))
    const tgt = mergeChartSettings(JSON.stringify({ header: { fields: ['mcap'], timeframes: ['5'] } }))
    const out = applyAppearance(tgt, src)
    expect(out.header.fields).toEqual(['pe', 'gap'])
    expect(out.header.statLabels).toEqual({ gap: 'Gap' })
    expect(out.header.timeframes, 'timeframe favourites stay per chart').toEqual(['5'])
  })
})
