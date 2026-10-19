// The honesty gap, made measurable.
//
// The 2026-08-23 competitor benchmark scored this product LAST of 13 on
// honesty and transparency, and the reason was not that our numbers are worse
// — it was that our honesty is INTERNAL (rails, receipts, refusals nobody
// sees) while Finviz ships a tooltip on all 88 filters and Zacks publishes a
// measured range on all 136 criteria. `desc` is the column that closes it, and
// `ColumnDesc` already renders it on BOTH the results header and the filter
// control.
//
// ⛔ THIS FILE IS A RATCHET, NOT A REPORT. The audit found 18 of 157 columns
// documented and NOT ONE in the fundamentals or valuation family — the family
// where a member is most likely to misread a number, because every one of them
// is a ratio whose denominator can do something surprising.
import { describe, it, expect } from 'vitest'
import { COLUMN_DEFS, descFor } from './columnDefs'

// ⛔ May only ever go UP — see 'holds the coverage ratchet' below.
const RATCHET_FLOOR = 127

// The columns whose DEFINITION is not guessable from the label, or where the
// audit measured a member-visible trap. Every one of these must carry text.
const MUST_DOCUMENT = [
  // valuation — every one has a denominator that can go negative or vanish
  'pe_ttm', 'pe_fwd', 'peg', 'ps', 'pb', 'p_fcf', 'p_ocf', 'market_cap',
  // profitability — and the two whose denominators disagree with each other
  'roe', 'roa', 'roic', 'gross_margin', 'op_margin', 'net_margin',
  // balance sheet — where a 0 means "undefined" unless corroborated
  'debt_to_equity', 'current_ratio', 'quick_ratio', 'lt_debt_to_capital',
  // growth — percentage change off a negative base
  'eps_growth', 'rev_growth',
  // Wave 7 — every one of these is a ratio whose sign or denominator surprises
  'enterprise_value', 'ev_sales', 'ev_ebitda', 'ev_fcf', 'earnings_yield',
  'fcf_yield', 'eps_ttm', 'revenue_ps', 'fcf_ps', 'book_value_ps', 'cash_ps',
  'working_capital', 'ebitda_margin', 'ebit_margin', 'roce', 'income_quality',
  'tax_rate', 'interest_coverage', 'net_debt_to_ebitda', 'cash_ratio',
  'asset_turnover', 'capex_to_revenue', 'rnd_to_revenue', 'sbc_to_revenue',
  'cash_conversion_cycle',
  // technicals a member will compare against another tool and find different
  'rsi14', 'adr_pct', 'atr_pct', 'vol_ratio',
  // bar shape — all three refuse on a bar with no range
  'candle_type', 'body_pct', 'close_position',
  // the trend gate is what makes hammer-vs-hanging-man decidable at all
  'candle_trend',
  // what the bar DID — a different question from what shape it is
  'bar_character',
  // the pattern vocabulary, dated — 38.5% of rows carry one today cannot see
  'candle_recent',
  // the same vocabulary on the weekly bar, resampled from daily
  'candle_weekly',
  'candle_monthly',
  // 2026-10-18 screener column audit — the ranking family had NO text at all,
  // and every one of these ranks a provider or a vintage a member would not
  // guess from the label (measured against the prod snapshot).
  'uct_composite', 'rs_rank', 'rs_return', 'accdis', 'blended_growth',
  'sector_rs_pct', 'rating_eps', 'rating_growth', 'rating_value',
  'rating_smr', 'sponsorship', 'inst_pct',
]

describe('member-facing column descriptions', () => {
  it.each(MUST_DOCUMENT)('%s explains itself to a member', key => {
    expect(COLUMN_DEFS[key], `${key} is not a defined column`).toBeTruthy()
    const d = descFor(key)
    expect(d, `${key} has no desc — see the ratchet note in this file`).toBeTruthy()
    // A one-liner that just restates the label is not a description.
    expect(d.length).toBeGreaterThan(60)
  })

  it('never names a column that does not exist', () => {
    const unknown = MUST_DOCUMENT.filter(k => !COLUMN_DEFS[k])
    expect(unknown).toEqual([])
  })

  it('holds the coverage ratchet', () => {
    // ⛔ This number may only ever go UP. If a change drops it, the change
    // deleted a member-facing explanation — restore it rather than lowering
    // the floor. 32 at the start of 2026-08-24, 55 after the accuracy wave,
    // 80 after Wave 7 shipped 25 fundamental fields WITH their text; +12 on
    // 2026-10-18 when the ranking family and Inst% got theirs.
    const documented = Object.keys(COLUMN_DEFS).filter(k => descFor(k)).length
    expect(documented).toBeGreaterThanOrEqual(RATCHET_FLOOR)
  })

  it('says EPS Gr and Rev Gr are QUARTERLY, because that is what they measure', () => {
    // 🔴 Both said "trailing twelve months against the prior twelve". The
    // values are yfinance earningsGrowth / revenueGrowth — the latest quarter
    // against the year-ago quarter — and measured against FMP statements they
    // match that on 30/34 and 35/44 sampled names, TTM on 4/34 and 10/44.
    for (const key of ['eps_growth', 'rev_growth']) {
      const d = descFor(key)
      expect(d).toMatch(/same quarter a year earlier/)
      expect(d).toMatch(/not trailing-twelve-month growth/)
    }
  })

  it('names the different provider wherever a rating ranks one', () => {
    // Measured on the prod snapshot: Val Rt vs the PEG column Spearman -0.33,
    // Spons vs Inst% 0.86, SMR vs Op Mgn 0.67 — each ranks Yahoo's input.
    expect(descFor('rating_value')).toMatch(/NOT the PEG column/)
    expect(descFor('sponsorship')).toMatch(/not the Inst% column/)
    expect(descFor('rating_smr')).toMatch(/not the Op Mgn and ROE columns/)
    expect(descFor('inst_pct')).toMatch(/DIFFERENT provider/)
  })

  it('states the two definitions that disagree, on BOTH columns', () => {
    // roe divides by a four-quarter AVERAGE equity, roa by ENDING assets. A
    // member comparing them is comparing two different balance sheets, and the
    // audit proved neither column said so anywhere.
    expect(descFor('roe')).toMatch(/AVERAGE/)
    expect(descFor('roa')).toMatch(/ENDING/)
  })

  it('warns that ADR and ATR are not the same measure', () => {
    expect(descFor('adr_pct')).toMatch(/NOT ATR/)
    expect(descFor('atr_pct')).toMatch(/gap/i)
  })

  it('tells a member their saved RSI scan changed meaning', () => {
    // The screener moved from Cutler's RSI to Wilder's on 2026-08-24, which
    // moved hundreds of rows across the 70/30 lines. A member whose saved scan
    // now returns a different set is owed the reason in the product, not in a
    // commit message.
    const d = descFor('rsi14')
    expect(d).toMatch(/Wilder/)
    expect(d).toMatch(/2026-08-24/)
  })
})

describe('a formatter must not read a column its view never selects', () => {
  // 🔴 CAUGHT ON THE REAL SCREEN, NOT BY A TEST. Every candle formatter reads
  // `row.<col>_label` and falls back to the raw key, so with the companion
  // unselected the member saw `last-engulfing-top` instead of
  // "Last Engulfing Top (Long White) +1". Tests were blind because a formatter
  // handed a row that HAS the companion renders it perfectly.
  it('every _label companion a candle formatter reads is defined', () => {
    const companions = ['candle_label', 'bar_character_label',
      'candle_recent_label', 'candle_weekly_label', 'candle_monthly_label']
    for (const key of ['candle_type', 'bar_character', 'candle_recent',
      'candle_weekly', 'candle_monthly']) {
      const def = COLUMN_DEFS[key]
      expect(def, `${key} has no column def`).toBeTruthy()
      const src = def.fmt.toString()
      const read = companions.filter(c => src.includes(c))
      // the formatter reads exactly its own companion, and that companion
      // must itself be a real snapshot column name (checked backend-side)
      expect(read.length, `${key} formatter reads ${read}`).toBe(1)
    }
  })

  it('every column a view can show has a def, so no raw KEY reaches a header', () => {
    // the header falls back to the raw column name when a def is missing —
    // `candle_recent_bars_ago` rendered as "CANDLE_RECENT_BARS_AGO" and
    // collided with its neighbours.
    for (const key of ['candle_recent_bars_ago', 'candle_trend', 'candle_weekly',
      'candle_monthly', 'bar_character', 'candle_recent']) {
      expect(COLUMN_DEFS[key], `${key} has no def — its header renders as the raw key`).toBeTruthy()
      expect(typeof COLUMN_DEFS[key].label).toBe('string')
    }
  })
})
