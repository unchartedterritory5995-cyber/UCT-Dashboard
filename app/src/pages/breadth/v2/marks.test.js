/**
 * A-28 rails — how each metric is DRAWN, and that the registry is the one authority.
 *
 * A-28, verbatim (`01-audit.md:245`):
 *   *"Registry `mark`: bars for `adv_decline` and `hvc_52w`, steps for AAII/NAAIM and
 *   distribution days, lines elsewhere."*
 */
import { describe, it, expect } from 'vitest'
import {
  markOf, MARK, WEEKLY_METRICS, ALL_METRICS, unitOf,
} from '../chartMetrics'
import { buildOption } from './chartOption'

const D = ['2026-09-01', '2026-09-02', '2026-09-03']

describe('A-28 · the mark the audit specifies', () => {
  it('⛔ a signed daily NET draws as BARS, not a line', () => {
    // A line through a signed net implies continuity between two independent days.
    expect(markOf('adv_decline')).toBe(MARK.BARS)
  })

  it('⛔ a sparse spike count draws as BARS', () => {
    // hvc_52w has 26 distinct values across the history; a curve through it invents a
    // shape that was never measured.
    expect(markOf('hvc_52w')).toBe(MARK.BARS)
  })

  it('every WEEKLY survey draws as STEPS — derived from cadence, not listed', () => {
    // ⭐ The steps half is DERIVED. Re-listing AAII/NAAIM here would be a second
    // authority over "is this weekly", and the two would drift the first time a
    // survey's cadence changed.
    expect(WEEKLY_METRICS.size).toBeGreaterThan(0)
    for (const k of WEEKLY_METRICS) {
      if (k === 'adv_decline' || k === 'hvc_52w') continue   // explicit overrides win
      expect(markOf(k), `${k} is weekly and must step`).toBe(MARK.STEP)
    }
  })

  it('everything else is a line', () => {
    const plain = ALL_METRICS.map(m => m.key).find(
      k => !WEEKLY_METRICS.has(k) && k !== 'adv_decline' && k !== 'hvc_52w')
    expect(markOf(plain)).toBe(MARK.LINE)
  })

  it('an unknown key is a line rather than undefined', () => {
    expect(markOf('not_a_metric')).toBe(MARK.LINE)
  })
})

describe('A-28 · the option carries the mark through', () => {
  it('a bars metric becomes an ECharts bar series', () => {
    const opt = buildOption(D, { adv_decline: [-5, 2, 7] }, ['adv_decline'])
    expect(opt.series[0].type).toBe('bar')
    expect(opt.series[0].step).toBe(false)
  })

  it('a weekly metric stays a stepped LINE, not a bar', () => {
    const weekly = [...WEEKLY_METRICS].find(k => k !== 'adv_decline' && k !== 'hvc_52w')
    const opt = buildOption(D, { [weekly]: [1, null, 3] }, [weekly])
    expect(opt.series[0].type).toBe('line')
    expect(opt.series[0].step).toBe('end')
  })

  it('⭐ CONTROL — the three marks really do produce different options', () => {
    // If they all rendered identically the rails above would be checking a label that
    // changes nothing on screen.
    const weekly = [...WEEKLY_METRICS].find(k => k !== 'adv_decline' && k !== 'hvc_52w')
    const plain = ALL_METRICS.map(m => m.key).find(
      k => !WEEKLY_METRICS.has(k) && k !== 'adv_decline' && k !== 'hvc_52w')
    const shape = key => {
      const o = buildOption(D, { [key]: [1, 2, 3] }, [key])
      return `${o.series[0].type}/${o.series[0].step}`
    }
    const shapes = new Set([shape('adv_decline'), shape(weekly), shape(plain)])
    expect(shapes.size, `all three marks render the same: ${[...shapes]}`).toBe(3)
  })

  it('bars are bounded so adjacent marks stay separate quantities', () => {
    const opt = buildOption(D, { adv_decline: [-5, 2, 7] }, ['adv_decline'])
    expect(opt.series[0].barMaxWidth).toBeGreaterThan(0)
  })

  it('a line series carries no bar width', () => {
    const plain = ALL_METRICS.map(m => m.key).find(
      k => !WEEKLY_METRICS.has(k) && k !== 'adv_decline' && k !== 'hvc_52w')
    const opt = buildOption(D, { [plain]: [1, 2, 3] }, [plain])
    expect(opt.series[0].barMaxWidth).toBeUndefined()
  })

  it('a bars metric still lands in its own unit panel', () => {
    // The mark must not quietly change which family a metric belongs to.
    const opt = buildOption(D, { adv_decline: [1, 2, 3], breadth_score: [1, 2, 3] },
      ['adv_decline', 'breadth_score'])
    const byId = Object.fromEntries(opt.series.map(s => [s.id, s]))
    expect(unitOf('adv_decline')).not.toBe(unitOf('breadth_score'))
    expect(byId.adv_decline.yAxisIndex).not.toBe(byId.breadth_score.yAxisIndex)
  })
})
