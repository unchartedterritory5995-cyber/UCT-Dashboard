/**
 * The Earnings row model — the table's correctness, without mounting anything.
 *
 * What these pin down: the value language (which cell gets gold, green, red or a
 * word), the row/section ordering, the estimate-vs-reported distinction, history
 * depth, the summary strip's refusal to invent placeholders, and the expansion's
 * actual-vs-estimate comparison.
 */
import { describe, it, expect } from 'vitest'
import {
  fmtEps, fmtSales, fmtPct, shortLabel,
  growthCell, surpriseCell,
  buildRows, hiddenCount, summaryFacts, expansionModel,
} from './earningsRows'

// ── fixtures ────────────────────────────────────────────────────────────────
const quarter = (fy, fq, over = {}) => ({
  fiscal_year: fy, fiscal_quarter: fq, label: `FY${fy} Q${fq}`,
  reported: true, period_end: '2026-05-28', report_date: '2026-06-25',
  eps_actual: 2.5, eps_estimate: 2.3, revenue_actual: 1.0e10, revenue_estimate: 9.5e9,
  eps_yoy_pct: 40, rev_yoy_pct: 30,
  eps_surprise_pct: 8.7, rev_surprise_pct: 5.3,
  net_margin_pct: 24.4, eps_basis: 'consensus_comparable',
  ...over,
})
const estimate = (fy, fq, over = {}) => ({
  fiscal_year: fy, fiscal_quarter: fq, label: `FY${fy} Q${fq}`,
  reported: false, eps_estimate: 3.1, revenue_estimate: 1.2e10,
  eps_yoy_pct: 24, rev_yoy_pct: 20, report_date: '2026-09-24',
  ...over,
})
const intel = (over = {}) => ({
  quarters: [quarter(2026, 3), quarter(2026, 2), quarter(2026, 1)],
  estimates: [estimate(2027, 1), estimate(2026, 4)],
  annual: { reported: [], estimates: [] },
  summary: {},
  meta: {},
  ...over,
})


describe('formatting', () => {
  it('formats EPS with a sign inside the dollar', () => {
    expect(fmtEps(24.67)).toBe('$24.67')
    expect(fmtEps(-0.4)).toBe('-$0.40')
    expect(fmtEps(null)).toBe('—')
  })

  it('scales sales to the right magnitude', () => {
    expect(fmtSales(4.146e10)).toBe('$41.46B')
    expect(fmtSales(9.3e9)).toBe('$9.30B')
    expect(fmtSales(5.21e7)).toBe('$52M')
    expect(fmtSales(null)).toBe('—')
  })

  it('compresses four-figure growth so the column never has to widen', () => {
    expect(fmtPct(1400)).toBe('+1.4K%')
    expect(fmtPct(346)).toBe('+346%')
    expect(fmtPct(-9)).toBe('−9%')
    expect(fmtPct(0)).toBe('0%')
  })

  it('drops the century for the narrow period form', () => {
    expect(shortLabel('FY2026 Q3')).toBe('FY26 Q3')
    expect(shortLabel('FY2026')).toBe('FY26')
  })
})


describe('growth cells — the approved colour language', () => {
  it('is green above zero and red below', () => {
    expect(growthCell(40, null)).toMatchObject({ text: '+40%', tone: 'up' })
    expect(growthCell(-9, null)).toMatchObject({ text: '−9%', tone: 'down' })
  })

  it('turns gold at 100% and stays gold above it', () => {
    expect(growthCell(100, null).tone).toBe('gold')
    expect(growthCell(346, null).tone).toBe('gold')
    expect(growthCell(1400, null)).toMatchObject({ text: '+1.4K%', tone: 'gold' })
  })

  it('is not gold just below the threshold', () => {
    expect(growthCell(99.9, null).tone).toBe('up')
  })

  it('renders a swing through zero as a state, not a percentage', () => {
    expect(growthCell(null, 'turned_profitable'))
      .toMatchObject({ text: 'Profitable', tone: 'up', semantic: true })
    expect(growthCell(null, 'turned_negative'))
      .toMatchObject({ text: 'To loss', tone: 'down', semantic: true })
  })

  it('a state wins even when the backend also sent a percentage', () => {
    expect(growthCell(430, 'turned_profitable').text).toBe('Profitable')
  })

  it('never golds a loss that merely narrowed', () => {
    // Both periods lost money. +100% "growth" here is a shrinking loss, not a
    // business that tripled, so it must not wear the triple-digit signal.
    const cell = growthCell(100, 'loss_narrowing')
    expect(cell.tone).toBe('up')
    expect(cell.fromLoss).toBe(true)
  })

  it('returns nothing when there is no comparison to make', () => {
    expect(growthCell(null, null)).toBeNull()
    expect(growthCell(undefined, undefined)).toBeNull()
  })
})


describe('surprise cells', () => {
  it('labels a beat and a miss in plain language', () => {
    expect(surpriseCell(8.7, 0.2, true)).toMatchObject({ text: 'Beat by 8.7%', tone: 'up' })
    expect(surpriseCell(-4.1, -0.1, true)).toMatchObject({ text: 'Missed by 4.1%', tone: 'down' })
  })

  it('calls a sub-half-percent difference in line', () => {
    expect(surpriseCell(0.2, 0.01, true).text).toBe('In line')
  })

  it('falls back to an absolute amount when the estimate was near zero', () => {
    expect(surpriseCell(null, 0.02, true)).toMatchObject({ text: 'Beat by $0.02', tone: 'up' })
    expect(surpriseCell(null, 4.0e8, false)).toMatchObject({ text: 'Beat by $400M', tone: 'up' })
  })

  it('returns nothing without a comparable consensus', () => {
    expect(surpriseCell(null, null, true)).toBeNull()
  })
})


describe('buildRows — quarterly', () => {
  it('puts estimates above reported under their own sections', () => {
    const rows = buildRows(intel(), 'quarterly', 8)
    expect(rows.map(r => r.kind === 'section' ? r.title : r.label)).toEqual([
      'Estimates', 'FY2027 Q1', 'FY2026 Q4',
      'Reported', 'FY2026 Q3', 'FY2026 Q2', 'FY2026 Q1',
    ])
  })

  it('reads estimate rows off the estimate fields, reported off the actuals', () => {
    const rows = buildRows(intel(), 'quarterly', 8).filter(r => r.kind === 'row')
    const est = rows.find(r => r.label === 'FY2026 Q4')
    const rep = rows.find(r => r.label === 'FY2026 Q3')
    expect(est.estimate).toBe(true)
    expect(est.eps).toBe('$3.10')            // eps_estimate
    expect(rep.estimate).toBe(false)
    expect(rep.eps).toBe('$2.50')            // eps_actual
  })

  it('only reported rows can expand — an estimate has no actual to compare', () => {
    const rows = buildRows(intel(), 'quarterly', 8).filter(r => r.kind === 'row')
    expect(rows.find(r => r.label === 'FY2026 Q4').expandable).toBe(false)
    expect(rows.find(r => r.label === 'FY2026 Q3').expandable).toBe(true)
  })

  it('caps reported history at the limit but never caps estimates', () => {
    const many = intel({
      quarters: Array.from({ length: 12 }, (_, i) => quarter(2026, 3, { label: `Q${i}` })),
    })
    const rows = buildRows(many, 'quarterly', 8).filter(r => r.kind === 'row')
    expect(rows.filter(r => r.estimate)).toHaveLength(2)
    expect(rows.filter(r => !r.estimate)).toHaveLength(8)
  })

  it('marks a negative EPS so the level can take the down colour', () => {
    const rows = buildRows(intel({ quarters: [quarter(2026, 3, { eps_actual: -0.4 })] }),
      'quarterly', 8).filter(r => r.kind === 'row' && !r.estimate)
    expect(rows[0].epsNegative).toBe(true)
    expect(rows[0].eps).toBe('-$0.40')
  })

  it('omits a section that has no rows', () => {
    const rows = buildRows(intel({ estimates: [] }), 'quarterly', 8)
    expect(rows.some(r => r.kind === 'section' && r.title === 'Estimates')).toBe(false)
  })

  it('returns nothing for an empty payload', () => {
    expect(buildRows(null, 'quarterly', 8)).toEqual([])
    expect(buildRows({}, 'quarterly', 8)).toEqual([])
  })
})


describe('buildRows — annual uses the same architecture', () => {
  const annualIntel = intel({
    annual: {
      estimates: [
        { fiscal_year: 2027, label: 'FY2027', estimate: true, eps: 12, revenue: 5e10, eps_yoy_pct: 20, yoy_basis: 'vs_estimate' },
        { fiscal_year: 2026, label: 'FY2026', estimate: true, eps: 10, revenue: 4e10, eps_yoy_pct: 150, yoy_basis: 'vs_actual' },
      ],
      reported: [
        { fiscal_year: 2025, label: 'FY2025', estimate: false, eps: 4, revenue: 3e10, eps_yoy_pct: 100 },
        { fiscal_year: 2024, label: 'FY2024', estimate: false, eps: 2, revenue: 2e10, eps_yoy_pct: -20 },
      ],
    },
  })

  it('produces the same row shape as quarterly', () => {
    const rows = buildRows(annualIntel, 'annual', 8).filter(r => r.kind === 'row')
    const r = rows[0]
    expect(Object.keys(r)).toEqual(expect.arrayContaining(
      ['label', 'estimate', 'eps', 'epsGrowth', 'sales', 'salesGrowth', 'expandable']))
    expect(r.label).toBe('FY2027')
    expect(r.sales).toBe('$50.00B')
  })

  it('keeps the estimates-then-reported order', () => {
    const rows = buildRows(annualIntel, 'annual', 8)
    expect(rows.map(r => r.kind === 'section' ? r.title : r.label)).toEqual([
      'Estimates', 'FY2027', 'FY2026', 'Reported', 'FY2025', 'FY2024',
    ])
  })

  it('flags an estimate whose growth is measured against another estimate', () => {
    const rows = buildRows(annualIntel, 'annual', 8).filter(r => r.kind === 'row')
    expect(rows.find(r => r.label === 'FY2027').projectedGrowth).toBe(true)
    expect(rows.find(r => r.label === 'FY2026').projectedGrowth).toBe(false)
  })

  it('applies the same gold threshold', () => {
    const rows = buildRows(annualIntel, 'annual', 8).filter(r => r.kind === 'row')
    expect(rows.find(r => r.label === 'FY2025').epsGrowth.tone).toBe('gold')
    expect(rows.find(r => r.label === 'FY2024').epsGrowth.tone).toBe('down')
  })
})


describe('history depth', () => {
  it('counts what is hidden beyond the limit', () => {
    const many = intel({ quarters: Array.from({ length: 12 }, () => quarter(2026, 3)) })
    expect(hiddenCount(many, 'quarterly', 8)).toBe(4)
    expect(hiddenCount(many, 'quarterly', 12)).toBe(0)
  })

  it('is zero when there is nothing more to show', () => {
    expect(hiddenCount(intel(), 'quarterly', 8)).toBe(0)
    expect(hiddenCount(null, 'quarterly', 8)).toBe(0)
  })
})


describe('summary strip — only real facts, in plain language', () => {
  it('reads the next report and the estimate', () => {
    const facts = summaryFacts(intel({
      summary: { next_report_date: '2026-11-19', next_eps_estimate: 3.1 },
    }))
    expect(facts.map(f => [f.label, f.value])).toEqual([
      ['Next report', 'Nov 19'], ['EPS estimate', '$3.10'],
    ])
  })

  it('spells acceleration out instead of "EPS accel ×4"', () => {
    const facts = summaryFacts(intel({
      summary: { eps_accel_quarters: 4, eps_trend: 'accelerating' },
    }))
    expect(facts[0]).toMatchObject({ label: 'EPS accelerating', value: '4 qtrs', accent: true })
  })

  it('says slowing rather than accelerating when the trend is down', () => {
    const facts = summaryFacts(intel({
      summary: { eps_accel_quarters: 2, eps_trend: 'decelerating' },
    }))
    expect(facts[0]).toMatchObject({ label: 'EPS slowing', value: '2 qtrs', accent: false })
  })

  it('singularises one quarter', () => {
    const facts = summaryFacts(intel({
      summary: { eps_accel_quarters: 1, eps_trend: 'accelerating' },
    }))
    expect(facts[0].value).toBe('1 qtr')
  })

  it('describes the beat streak without cryptic notation', () => {
    const facts = summaryFacts(intel({ summary: { double_beat_streak: 6 } }))
    expect(facts[0]).toMatchObject({ label: 'Beat both', value: '6 qtrs' })
  })

  it('returns nothing rather than placeholders when nothing is known', () => {
    expect(summaryFacts(intel({ summary: {} }))).toEqual([])
    expect(summaryFacts(null)).toEqual([])
  })

  it('omits only the missing facts, keeping the rest', () => {
    const facts = summaryFacts(intel({
      summary: { next_report_date: '2026-11-19', double_beat_streak: 3 },
    }))
    expect(facts.map(f => f.key)).toEqual(['next', 'streak'])
  })
})


describe('row expansion — a comparison, not a restatement', () => {
  it('pairs each actual with its estimate and the resulting surprise', () => {
    const m = expansionModel(quarter(2026, 3))
    expect(m.groups.map(g => g.title)).toEqual(['EPS', 'Revenue'])
    expect(m.groups[0]).toMatchObject({ actual: '$2.50', estimate: '$2.30' })
    expect(m.groups[0].surprise.text).toBe('Beat by 8.7%')
    expect(m.groups[1]).toMatchObject({ actual: '$10.00B', estimate: '$9.50B' })
  })

  it('carries margin and the two dates as facts', () => {
    const m = expansionModel(quarter(2026, 3))
    expect(m.facts).toEqual([
      { k: 'Net margin', v: '24.4%' },
      { k: 'Period ended', v: 'May 28, 2026' },
      { k: 'Reported', v: 'June 25, 2026' },
    ])
  })

  it('omits a fact rather than padding with an em dash', () => {
    const m = expansionModel(quarter(2026, 3, { net_margin_pct: null, report_date: null }))
    expect(m.facts.map(f => f.k)).toEqual(['Period ended'])
  })

  it('explains why a surprise is absent on a GAAP-only quarter', () => {
    const m = expansionModel(quarter(2026, 3, {
      eps_estimate: null, revenue_estimate: null,
      eps_surprise_pct: null, rev_surprise_pct: null,
      eps_surprise_note: 'no_comparable_estimate', eps_basis: 'gaap_diluted',
    }))
    expect(m.groups[0].surprise).toBeNull()
    expect(m.notes[0]).toMatch(/GAAP diluted EPS as reported/)
  })

  it('explains a near-zero-estimate surprise', () => {
    const m = expansionModel(quarter(2026, 3, {
      eps_surprise_pct: null, eps_surprise_abs: 0.02,
      eps_surprise_note: 'near_zero_estimate',
    }))
    expect(m.groups[0].surprise.text).toBe('Beat by $0.02')
    expect(m.notes.join(' ')).toMatch(/close to zero/)
  })

  it('explains a loss-to-loss comparison so +75% is not read as profit growth', () => {
    const m = expansionModel(quarter(2026, 3, {
      eps_yoy_pct: 75, eps_yoy_note: 'loss_narrowing',
    }))
    expect(m.notes.join(' ')).toMatch(/negative in both/)
  })

  it('handles a quarter with nothing to expand into', () => {
    const m = expansionModel({ fiscal_year: 2026, fiscal_quarter: 3 })
    expect(m.groups).toEqual([])
    expect(m.facts).toEqual([])
  })

  it('returns nothing for a missing quarter', () => {
    expect(expansionModel(null)).toBeNull()
  })
})
