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
    // 80 after Wave 7 shipped 25 fundamental fields WITH their text.
    const documented = Object.keys(COLUMN_DEFS).filter(k => descFor(k)).length
    expect(documented).toBeGreaterThanOrEqual(80)
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
