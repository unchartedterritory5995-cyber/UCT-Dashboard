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
// 127 → 144 on 2026-11-06: the seventeen UCT Relative Strength columns landed WITH their text.
// 144 → 147 on 2026-11-07: the three Phase 3 RS columns (unit 3-11) landed WITH theirs.
// 147 → 149 on 2026-11-18: the two short-interest columns got theirs when their source moved.
// 149 → 157 on 2026-11-21: the eight fundamental trend columns landed WITH their text.
// 157 → 168 on 2026-11-23: the six volume & volatility and five beats, insiders & funds columns
// landed WITH theirs.
// 168 → 179 on 2026-11-23: the eleven held-store columns (IV rank, industry group rank, short interest
// change, ex-dividend dates, estimate revisions) landed WITH theirs.
const RATCHET_FLOOR = 179

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
  // 2026-11-18 short interest — a twice-a-month FINRA figure on a table that is
  // rebuilt every night: a member would read it as last night's without the text.
  // (Listed here, before the RS family, because the two slices below are cut
  // from this array by position.)
  'short_float_pct', 'short_ratio',
  // 2026-11-21 fundamental trends — SEC filings, point in time, filed days after
  // the earnings release; a blank is "cannot be worked out", never a 0. (Also
  // before the RS family, for the same reason as the short-interest pair.)
  'rev_accel_q', 'eps_streak_25', 'eps_growth_min_2q', 'eps_growth_min_3q',
  'eps_growth_min_4q', 'net_margin_chg_1y', 'gross_margin_chg_1y', 'shares_chg_1y',
  // 2026-11-23 volume & volatility — each is a definition another tool computes
  // differently (sample vs population volatility, the 0.2% move, which down days a
  // pocket pivot must beat), so each names whose definition it is. (Before the RS
  // family, for the same reason as the short-interest pair.)
  'hv_20', 'hv_60', 'ad_net_25', 'pocket_pivots_20', 'days_since_pocket_pivot', 'corr_rel_last',
  // 2026-11-23 beats, insiders & funds — three held stores with three different
  // clocks (a report date, a filing date, a quarterly fund report).
  'eps_surprise_last', 'eps_beat_streak', 'insider_buys_30d', 'insider_buy_value_30d', 'fund_net_adds',
  // 2026-11-23 held-store columns — each read from a store with its own population and clock (the options
  // log, GRPS's industries, the FINRA list, a two-week dividend window, a tracked subset of stocks).
  'iv_rank', 'iv_percentile', 'group_rank', 'group_rank_of', 'group_rank_chg_4w', 'short_interest_chg_pct',
  'next_ex_div_date', 'days_to_ex_div', 'eps_rev_up_30d', 'eps_rev_down_30d', 'eps_rev_net_30d',
  // 2026-11-06 UCT Relative Strength (Phase 2a, 2a-08) — every one is daily-bar
  // based where a chart reader may be on another timeframe, Mansfield is a DAILY
  // 200 where the textbook is a weekly 52, and the rating is IBD-STYLE, ours,
  // not MarketSurge's number.
  'rs_new_high', 'rs_nh_before_price', 'rs_nh_red_day', 'rs_nh_bars_ago',
  'green_on_red_20', 'rs_line_above_ma', 'rs_cross_up_bars_ago', 'mansfield',
  'mansfield_cross_bars_ago', 'rs_benchmark_agree', 'rs_rating_ibd',
  'rs_rating_chg_5', 'rs_rating_chg_20', 'rs_rating_1m', 'rs_rating_3m',
  'rs_rating_6m', 'rs_rating_9m', 'rs_rating_12m',
  // 2026-11-07 UCT RS Phase 3 (unit 3-11) — each says whose formula it follows
  // ("-style"), because a member will compare it with StockCharts, Clenow's book
  // or OANDA and find a different number.
  'rrg_quadrant', 'clenow_score', 'vars_state',
]
const RS_COLUMNS = MUST_DOCUMENT.slice(MUST_DOCUMENT.indexOf('rs_new_high'),
  MUST_DOCUMENT.indexOf('rrg_quadrant'))
const RS_PHASE3_COLUMNS = MUST_DOCUMENT.slice(MUST_DOCUMENT.indexOf('rrg_quadrant'))

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

  it('the RS family says it is daily-bar based, and the rating says whose number it is not', () => {
    expect(RS_COLUMNS).toHaveLength(18) // 17 -> 18 on 2026-11-10: rs_rating_9m (S1)
    for (const key of RS_COLUMNS) expect(descFor(key), key).toMatch(/daily/i)
    expect(descFor('rs_rating_ibd')).toMatch(/IBD-style/)
    expect(descFor('rs_rating_ibd')).toMatch(/our own calculation, not MarketSurge/)
    expect(descFor('mansfield')).toMatch(/200 daily bars/)
    expect(descFor('rs_benchmark_agree')).toMatch(/SPY and against equal-weight RSP/)
    // the rating renders as a 1-99 integer on the RS cell, like RS Rank beside it
    expect(COLUMN_DEFS.rs_rating_ibd.fmt(94)).toBe('94')
    expect(COLUMN_DEFS.rs_rating_ibd.cell).toBe('rs')
    // a flag is "Yes" or an em dash; an age is "today" or "n bars ago"; Mansfield is a signed 2-dp percent
    expect(COLUMN_DEFS.rs_new_high.fmt(1)).toBe('Yes')
    expect(COLUMN_DEFS.rs_new_high.fmt(0)).toBe('—')
    expect(COLUMN_DEFS.rs_new_high.fmt(null)).toBe('—')
    expect(COLUMN_DEFS.rs_nh_bars_ago.fmt(0)).toBe('today')
    expect(COLUMN_DEFS.rs_nh_bars_ago.fmt(1)).toBe('1 bar ago')
    expect(COLUMN_DEFS.rs_nh_bars_ago.fmt(7)).toBe('7 bars ago')
    expect(COLUMN_DEFS.mansfield.fmt(3.214)).toBe('+3.21%')
    expect(COLUMN_DEFS.mansfield.fmt(-0.5)).toBe('-0.50%')
    expect(COLUMN_DEFS.rs_rating_chg_5.fmt(6)).toBe('+6')
    expect(COLUMN_DEFS.rs_rating_chg_5.fmt(-4)).toBe('-4')
    expect(COLUMN_DEFS.rs_rating_chg_5.fmt(0)).toBe('0')
  })

  it('the Phase 3 RS columns name their timeframe and whose formula they follow', () => {
    expect(RS_PHASE3_COLUMNS).toEqual(['rrg_quadrant', 'clenow_score', 'vars_state'])
    expect(descFor('rrg_quadrant')).toMatch(/weekly bars/)
    expect(descFor('rrg_quadrant')).toMatch(/RRG-style, UCT's own formula/)
    for (const q of ['Leading', 'Weakening', 'Lagging', 'Improving']) expect(descFor('rrg_quadrant')).toMatch(q)
    expect(descFor('clenow_score')).toMatch(/Clenow-style/)
    expect(descFor('clenow_score')).toMatch(/90 daily closes/)
    expect(descFor('vars_state')).toMatch(/VARS-style/)
    expect(descFor('vars_state')).toMatch(/daily bars/)
    for (const key of RS_PHASE3_COLUMNS) expect(descFor(key), key).not.toMatch(/\b(buy|sell)\b/i)
    // the text columns print the writer's name as it is; a NULL is an em dash
    expect(COLUMN_DEFS.rrg_quadrant.fmt('Improving')).toBe('Improving')
    expect(COLUMN_DEFS.rrg_quadrant.fmt(null)).toBe('—')
    expect(COLUMN_DEFS.vars_state.fmt('Strong, fading')).toBe('Strong, fading')
    expect(COLUMN_DEFS.vars_state.fmt(null)).toBe('—')
    // the Clenow score is a FRACTION: 2 places, never a percent sign
    expect(COLUMN_DEFS.clenow_score.fmt(0.8512)).toBe('0.85')
    expect(COLUMN_DEFS.clenow_score.fmt(-0.1234)).toBe('-0.12')
    expect(COLUMN_DEFS.clenow_score.fmt(null)).toBe('—')
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

  it('says where the two short-interest columns come from and how often they change', () => {
    // The table is rebuilt nightly; these two are not. The text is the only
    // place a member is told the figure is as of a twice-a-month report.
    for (const key of ['short_float_pct', 'short_ratio']) {
      const d = descFor(key)
      expect(d, key).toMatch(/FINRA short interest/)
      expect(d, key).toMatch(/twice a month/)
      expect(d, key).toMatch(/not every night/)
      expect(d, key).toMatch(/nightly data export instead/)
      expect(d, key).toMatch(/Blank means not known, never zero/)
    }
    expect(descFor('short_float_pct')).toMatch(/percent of the float/)
    expect(descFor('short_ratio')).toMatch(/average daily volume/)
    // units did not move: a percent with one decimal, a plain day count
    expect(COLUMN_DEFS.short_float_pct.fmt(30)).toBe('30.0%')
    expect(COLUMN_DEFS.short_ratio.fmt(6)).toBe('6.0')
    expect(COLUMN_DEFS.short_float_pct.label).toBe('Short%')
    expect(COLUMN_DEFS.short_ratio.label).toBe('Days2Cvr')
  })

  it('says where each volume & volatility column comes from, and prints counts, ages and ratios plainly', () => {
    const VV = MUST_DOCUMENT.slice(MUST_DOCUMENT.indexOf('hv_20'), MUST_DOCUMENT.indexOf('corr_rel_last') + 1)
    expect(VV).toHaveLength(6)
    for (const key of VV) {
      expect(descFor(key), key).toMatch(/daily bars/)
      expect(descFor(key), key).toMatch(/Blank/)
    }
    // whose definition each one is
    for (const key of ['hv_20', 'hv_60']) expect(descFor(key), key).toMatch(/same number STAT prints/)
    for (const key of ['ad_net_25', 'pocket_pivots_20', 'days_since_pocket_pivot']) {
      expect(descFor(key), key).toMatch(/as VFP (counts|finds) them/)
    }
    expect(descFor('corr_rel_last')).toMatch(/as MKTH finds them/)
    expect(descFor('ad_net_25')).toMatch(/Not the Acc\/Dis grade/)
    expect(COLUMN_DEFS.hv_20.fmt(45.3)).toBe('45.3%')
    expect(COLUMN_DEFS.hv_60.fmt(null)).toBe('—')
    expect(COLUMN_DEFS.ad_net_25.fmt(5)).toBe('+5')
    expect(COLUMN_DEFS.ad_net_25.fmt(-3)).toBe('-3')
    expect(COLUMN_DEFS.ad_net_25.fmt(0)).toBe('0')
    expect(COLUMN_DEFS.pocket_pivots_20.fmt(2)).toBe('2')
    expect(COLUMN_DEFS.pocket_pivots_20.fmt(null)).toBe('—')
    expect(COLUMN_DEFS.days_since_pocket_pivot.fmt(0)).toBe('today')
    expect(COLUMN_DEFS.days_since_pocket_pivot.fmt(27)).toBe('27 bars ago')
    expect(COLUMN_DEFS.corr_rel_last.fmt(0.625)).toBe('0.63×')
    expect(COLUMN_DEFS.corr_rel_last.fmt(0)).toBe('0.00×')
    expect(COLUMN_DEFS.corr_rel_last.fmt(null)).toBe('—')
  })

  it('says each beats, insiders & funds column\'s store and clock, and never prints a missing value as 0', () => {
    const BIF = MUST_DOCUMENT.slice(MUST_DOCUMENT.indexOf('eps_surprise_last'), MUST_DOCUMENT.indexOf('fund_net_adds') + 1)
    expect(BIF).toHaveLength(5)
    for (const key of BIF) expect(descFor(key), key).toMatch(/Blank/)
    expect(descFor('eps_beat_streak')).toMatch(/same rule as the earnings season view/)
    expect(descFor('insider_buys_30d')).toMatch(/0 means none was filed/)
    expect(descFor('insider_buys_30d')).toMatch(/sales are not counted/)
    expect(descFor('insider_buy_value_30d')).toMatch(/never valued at \$0/)
    expect(descFor('fund_net_adds')).toMatch(/N-PORT/)
    expect(COLUMN_DEFS.eps_surprise_last.fmt(8.33)).toBe('+8.3%')
    expect(COLUMN_DEFS.eps_surprise_last.fmt(-2.5)).toBe('-2.5%')
    expect(COLUMN_DEFS.eps_beat_streak.fmt(1)).toBe('1 qtr')
    expect(COLUMN_DEFS.eps_beat_streak.fmt(4)).toBe('4 qtrs')
    expect(COLUMN_DEFS.insider_buys_30d.fmt(0)).toBe('0')
    expect(COLUMN_DEFS.insider_buy_value_30d.fmt(1250000)).toBe('$1M')
    expect(COLUMN_DEFS.insider_buy_value_30d.fmt(null)).toBe('—')
    expect(COLUMN_DEFS.fund_net_adds.fmt(12)).toBe('+12')
    expect(COLUMN_DEFS.fund_net_adds.fmt(-4)).toBe('-4')
    expect(COLUMN_DEFS.fund_net_adds.fmt(null)).toBe('—')
  })

  it('says each held-store column\'s source and population, and prints a blank as a dash', () => {
    const HS = MUST_DOCUMENT.slice(MUST_DOCUMENT.indexOf('iv_rank'), MUST_DOCUMENT.indexOf('eps_rev_net_30d') + 1)
    expect(HS).toHaveLength(11)
    for (const key of HS) expect(descFor(key), key).toMatch(/Blank|blank/)
    for (const key of ['iv_rank', 'iv_percentile']) {
      expect(descFor(key), key).toMatch(/same number OSCR and IVH print/)
      expect(descFor(key), key).toMatch(/data placeholder/)
    }
    expect(descFor('group_rank')).toMatch(/as GRPS ranks them/)
    expect(descFor('group_rank')).toMatch(/can spell an industry differently from the Industry column/)
    expect(descFor('short_interest_chg_pct')).toMatch(/No floor/)
    for (const key of ['next_ex_div_date', 'days_to_ex_div']) expect(descFor(key), key).toMatch(/never no dividend|never that the stock pays no dividend/)
    for (const key of ['eps_rev_up_30d', 'eps_rev_down_30d', 'eps_rev_net_30d']) {
      expect(descFor(key), key).toMatch(/as EEHSC counts it/)
      expect(descFor(key), key).toMatch(/S&P 500 plus any stock a member opened EEH for/)
    }
    expect(COLUMN_DEFS.iv_rank.fmt(87.4)).toBe('87')
    expect(COLUMN_DEFS.iv_percentile.fmt(null)).toBe('—')
    expect(COLUMN_DEFS.group_rank.fmt(12)).toBe('12')
    expect(COLUMN_DEFS.group_rank_chg_4w.fmt(5)).toBe('+5')
    expect(COLUMN_DEFS.group_rank_chg_4w.fmt(-3)).toBe('-3')
    expect(COLUMN_DEFS.group_rank_chg_4w.fmt(null)).toBe('—')
    expect(COLUMN_DEFS.short_interest_chg_pct.fmt(25.04)).toBe('+25.0%')
    expect(COLUMN_DEFS.short_interest_chg_pct.fmt(-12.5)).toBe('-12.5%')
    expect(COLUMN_DEFS.next_ex_div_date.fmt('2026-12-04')).toBe('12-04')
    expect(COLUMN_DEFS.next_ex_div_date.fmt(null)).toBe('—')
    expect(COLUMN_DEFS.next_earnings_date.fmt('2026-12-04')).toBe('12-04')
    expect(COLUMN_DEFS.days_to_ex_div.fmt(0)).toBe('0')
    expect(COLUMN_DEFS.eps_rev_up_30d.fmt(1)).toBe('1')
    expect(COLUMN_DEFS.eps_rev_down_30d.fmt(0)).toBe('0')
    expect(COLUMN_DEFS.eps_rev_net_30d.fmt(-1)).toBe('-1')
    expect(COLUMN_DEFS.eps_rev_net_30d.fmt(0)).toBe('0')
    expect(COLUMN_DEFS.eps_rev_net_30d.fmt(null)).toBe('—')
  })

  it('says the fundamental trend columns come from SEC filings, and prints counts and points plainly', () => {
    const TRENDS = MUST_DOCUMENT.slice(MUST_DOCUMENT.indexOf('rev_accel_q'),
      MUST_DOCUMENT.indexOf('shares_chg_1y') + 1)
    expect(TRENDS).toHaveLength(8)
    for (const key of TRENDS) {
      const d = descFor(key)
      expect(d, key).toMatch(/SEC filings/)
      expect(d, key).toMatch(/blank/i)
      expect(d, key).not.toMatch(/\b(buy|sell)\b/i)
    }
    // the negative prior-year EPS treatment is stated wherever EPS growth is counted
    for (const key of ['eps_streak_25', 'eps_growth_min_2q', 'eps_growth_min_3q', 'eps_growth_min_4q']) {
      expect(descFor(key), key).toMatch(/year-earlier EPS (was zero or negative|of zero or less)/)
    }
    expect(descFor('eps_streak_25')).toMatch(/turnaround from a loss never counts/)
    expect(descFor('shares_chg_1y')).toMatch(/net buybacks/)
    expect(descFor('shares_chg_1y')).toMatch(/dilution/)
    expect(descFor('net_margin_chg_1y')).toMatch(/percentage points/)
    // a count of quarters; a change in points, never a percent; a growth floor as a signed percent
    expect(COLUMN_DEFS.rev_accel_q.fmt(0)).toBe('0 qtrs')
    expect(COLUMN_DEFS.rev_accel_q.fmt(1)).toBe('1 qtr')
    expect(COLUMN_DEFS.eps_streak_25.fmt(3)).toBe('3 qtrs')
    expect(COLUMN_DEFS.rev_accel_q.fmt(null)).toBe('—')
    expect(COLUMN_DEFS.net_margin_chg_1y.fmt(2.04)).toBe('+2.0 pts')
    expect(COLUMN_DEFS.net_margin_chg_1y.fmt(-1.26)).toBe('-1.3 pts')
    expect(COLUMN_DEFS.net_margin_chg_1y.fmt(-0.04)).toBe('0.0 pts')
    expect(COLUMN_DEFS.gross_margin_chg_1y.fmt(null)).toBe('—')
    expect(COLUMN_DEFS.eps_growth_min_3q.fmt(31.25)).toBe('+31.3%')
    expect(COLUMN_DEFS.shares_chg_1y.fmt(-3.1)).toBe('-3.1%')
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
