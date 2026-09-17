/**
 * V2-2 rails on the built option (W2-2, W2-4, W2-6, and the weekly-step half of A-28).
 *
 * ⭐ These read the ANSWER — the option object — rather than a picture, so they can
 * exercise branches a screenshot cannot reach cheaply (a log refusal, a metric with no
 * readings at all). The screenshots then cover what only a browser knows.
 */
import { describe, it, expect } from 'vitest'
import { UNIT, unitOf, ALL_METRICS, WEEKLY_METRICS, shortOf } from '../chartMetrics'
import { buildOption, logEligibility } from './chartOption'
import { panelsFor } from './panels'
import { stickyColour } from './stickyColours'

const DATES = ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04']

/** A metric of each of two different families, from the registry. */
function pickTwoFamilies() {
  const seen = new Map()
  for (const m of ALL_METRICS) if (!seen.has(unitOf(m.key))) seen.set(unitOf(m.key), m.key)
  const [a, b] = [...seen.values()]
  return [a, b]
}

describe('W2-2 · one x, one zoom, one crosshair', () => {
  const [a, b] = pickTwoFamilies()
  const vals = { [a]: [1, 2, 3, 4], [b]: [10, 20, 30, 40] }
  const opt = buildOption(DATES, vals, [a, b])

  it('gives every panel its own grid, x and y', () => {
    const n = panelsFor([a, b]).length
    expect(opt.grid.length).toBe(n)
    expect(opt.xAxis.length).toBe(n)
    expect(opt.yAxis.length).toBe(n)
  })

  it('⛔ the crosshair is LINKED across every panel', () => {
    expect(opt.axisPointer.link).toEqual([{ xAxisIndex: 'all' }])
  })

  it('⛔ every zoom drives ALL x-axes — panels must not scroll independently', () => {
    expect(opt.dataZoom.length).toBeGreaterThan(0)
    for (const z of opt.dataZoom) expect(z.xAxisIndex).toBe('all')
  })

  it('only the bottom panel shows date labels', () => {
    const shown = opt.xAxis.filter(x => x.axisLabel?.show !== false)
    expect(shown.length).toBe(1)
    expect(opt.xAxis[opt.xAxis.length - 1].axisLabel.show).not.toBe(false)
  })

  it('each series is bound to its OWN panel on both axes', () => {
    for (const s of opt.series) {
      expect(s.xAxisIndex).toBe(s.yAxisIndex)
    }
    const byId = Object.fromEntries(opt.series.map(s => [s.id, s]))
    expect(byId[a].xAxisIndex).not.toBe(byId[b].xAxisIndex)
  })

  it('a key that is not in the selection draws nothing rather than landing on panel 0', () => {
    const o = buildOption(DATES, { ...vals, ghost: [1, 1, 1, 1] }, [a, b])
    expect(o.series.map(s => s.id)).not.toContain('ghost')
  })
})

describe('W2-5 · the colours on the option are the sticky ones', () => {
  it('series colour comes from the entity map', () => {
    const [a, b] = pickTwoFamilies()
    const opt = buildOption(DATES, { [a]: [1, 2, 3, 4], [b]: [1, 2, 3, 4] }, [a, b])
    for (const s of opt.series) {
      expect(s.lineStyle.color).toBe(stickyColour(s.id))
    }
  })

  it('⛔ and they do not move when the selection is reordered', () => {
    const [a, b] = pickTwoFamilies()
    const v = { [a]: [1, 2, 3, 4], [b]: [1, 2, 3, 4] }
    const one = buildOption(DATES, v, [a, b])
    const two = buildOption(DATES, v, [b, a])
    const colourOf = o => Object.fromEntries(o.series.map(s => [s.id, s.lineStyle.color]))
    expect(colourOf(two)).toEqual(colourOf(one))
  })
})

describe('A-10 / A-28 · a weekly survey is drawn as STEPS', () => {
  it('a weekly metric steps and a daily one does not', () => {
    const weekly = [...WEEKLY_METRICS][0]
    const daily = ALL_METRICS.map(m => m.key).find(k => !WEEKLY_METRICS.has(k))
    expect(weekly, 'the registry declares no weekly metric').toBeTruthy()
    const opt = buildOption(DATES, { [weekly]: [1, null, null, 2], [daily]: [1, 2, 3, 4] },
      [weekly, daily])
    const byId = Object.fromEntries(opt.series.map(s => [s.id, s]))
    expect(byId[weekly].step, 'a weekly survey interpolated as a daily line invents readings')
      .toBe('end')
    expect(byId[daily].step).toBe(false)
  })

  it('⛔ nulls are never bridged — an absent reading is not a straight line', () => {
    const [a] = pickTwoFamilies()
    const opt = buildOption(DATES, { [a]: [1, null, null, 4] }, [a])
    expect(opt.series[0].connectNulls).toBe(false)
  })
})

describe('W2-4 · the log toggle refuses rather than lying', () => {
  it('⛔⛔ a panel containing a value <= 0 is REFUSED, with a reason naming the metric', () => {
    // ECharts does not error on a log axis with a zero — it DROPS the point and draws a
    // confident line through what is left. Silent data loss is the failure mode.
    const signed = ALL_METRICS.map(m => m.key).find(k => unitOf(k) === UNIT.COUNT)
    const panel = panelsFor([signed])[0]
    const e = logEligibility(panel, { [signed]: [5, 0, 7, 9] })
    expect(e.ok).toBe(false)
    expect(e.reason).toContain(shortOf(signed))
  })

  it('a strictly positive panel is allowed', () => {
    const [a] = pickTwoFamilies()
    expect(logEligibility(panelsFor([a])[0], { [a]: [1, 2, 3, 4] }).ok).toBe(true)
  })

  it('a refused panel stays LINEAR and the refusal is reported, not swallowed', () => {
    const [a] = pickTwoFamilies()
    const opt = buildOption(DATES, { [a]: [1, 0, 3, 4] }, [a],
      { logPanels: new Set([unitOf(a)]) })
    expect(opt.yAxis[0].type).toBe('value')
    expect(opt.__refusals.length).toBe(1)
    expect(opt.__refusals[0].reason).toMatch(/above zero/)
  })

  it('an allowed panel actually becomes log — so the refusal test is not vacuous', () => {
    const [a] = pickTwoFamilies()
    const opt = buildOption(DATES, { [a]: [1, 2, 3, 4] }, [a],
      { logPanels: new Set([unitOf(a)]) })
    expect(opt.yAxis[0].type).toBe('log')
    expect(opt.__refusals).toEqual([])
  })
})

describe('W2-6 · end labels', () => {
  it('labels the series END, never every point', () => {
    const [a] = pickTwoFamilies()
    const opt = buildOption(DATES, { [a]: [1, 2, 3, 4] }, [a])
    expect(opt.series[0].endLabel.show).toBe(true)
    expect(opt.series[0].showSymbol).toBe(false)
    expect(opt.series[0].label?.show).toBeFalsy()
  })

  it('a series with NO readings gets no end label — there is nothing to label', () => {
    const [a] = pickTwoFamilies()
    const opt = buildOption(DATES, { [a]: [null, null, null, null] }, [a])
    expect(opt.series[0].endLabel.show).toBe(false)
  })

  it('end labels can be turned off wholesale', () => {
    const [a] = pickTwoFamilies()
    const opt = buildOption(DATES, { [a]: [1, 2, 3, 4] }, [a], { endLabels: false })
    expect(opt.series[0].endLabel.show).toBe(false)
  })
})

describe('the option survives the empty and the odd', () => {
  it('an empty selection builds an empty, non-throwing option', () => {
    const opt = buildOption(DATES, {}, [])
    expect(opt.series).toEqual([])
    expect(opt.grid).toEqual([])
  })

  it('a selected key with no data array at all does not throw', () => {
    const [a] = pickTwoFamilies()
    expect(() => buildOption(DATES, {}, [a])).not.toThrow()
  })
})
