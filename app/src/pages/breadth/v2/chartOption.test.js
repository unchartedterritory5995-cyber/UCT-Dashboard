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

  it('⛔⛔ two series converging on the same panel ask ECharts to shift their end labels apart — a real defect found live at Max scale (e.g. "Up 4%+" and "Up 20%/5d" stacking on each other)', () => {
    // Same unit family (COUNT), so both land in one panel — the exact shape
    // that collided: two lines ending at the SAME value on the SAME axis.
    const [countKey] = ALL_METRICS.filter(m => unitOf(m.key) === UNIT.COUNT).map(m => m.key)
    const other = ALL_METRICS.map(m => m.key).find(k => unitOf(k) === UNIT.COUNT && k !== countKey)
    const opt = buildOption(DATES, { [countKey]: [1, 2, 3, 4], [other]: [4, 3, 2, 4] }, [countKey, other])
    for (const s of opt.series) {
      // ⭐ Delegated to ECharts' own label-layout pass (D-053's principle,
      // applied here) rather than hand-rolled collision math — this is a
      // DIFFERENT axis from panels.js's legend-clipping fix (that one is
      // horizontal margin; this one is vertical stacking).
      expect(s.labelLayout).toEqual({ moveOverlap: 'shiftY' })
    }
  })
})

describe('D-053 · LTTB is delegated to ECharts\' own `sampling` option', () => {
  const longDates = Array.from({ length: 1501 }, (_, i) => `d${String(i).padStart(6, '0')}`)
  const shortDates = longDates.slice(0, 1500)

  it('a series past the threshold gets `sampling: "lttb"` when EXPLICITLY allowed', () => {
    const [a] = pickTwoFamilies()
    const opt = buildOption(longDates, { [a]: longDates.map((_, i) => i) }, [a],
      { allowSampling: true })
    expect(opt.series[0].sampling).toBe('lttb')
  })

  it('⛔⛔ FAILS CLOSED — `allowSampling` defaults FALSE regardless of point count', () => {
    // Caught by a rail after shipping the wrong default once: `shouldSample` alone knows
    // nothing about v22/v23, so a v22-only view with a long series would otherwise be
    // silently downsampled by a V2-3 capability nobody turned on.
    const [a] = pickTwoFamilies()
    const opt = buildOption(longDates, { [a]: longDates.map((_, i) => i) }, [a])
    expect(opt.series[0].sampling).toBeUndefined()
  })

  it('`allowSampling: false` explicitly also refuses, even past the threshold', () => {
    const [a] = pickTwoFamilies()
    const opt = buildOption(longDates, { [a]: longDates.map((_, i) => i) }, [a],
      { allowSampling: false })
    expect(opt.series[0].sampling).toBeUndefined()
  })

  it('⭐ CONTROL — a series AT the threshold does NOT get it', () => {
    const [a] = pickTwoFamilies()
    const opt = buildOption(shortDates, { [a]: shortDates.map((_, i) => i) }, [a])
    expect(opt.series[0].sampling).toBeUndefined()
  })

  it('⛔ a BARS metric (A-28) also gets native sampling — not line-only', () => {
    // adv_decline is drawn as bars (MARK.BARS); ECharts registers the same `dataSample`
    // processor for bar series, so this must not be silently line-only.
    const opt = buildOption(longDates, { adv_decline: longDates.map((_, i) => i - 750) },
      ['adv_decline'], { allowSampling: true })
    expect(opt.series[0].type).toBe('bar')
    expect(opt.series[0].sampling).toBe('lttb')
  })

  it('⛔ NEVER touches xAxis.data — that is the whole point of delegating', () => {
    // The shared category axis must stay the FULL length regardless of any series'
    // sampling — ECharts downsamples the series' own render data internally, never the
    // axis. A reslice here would break the "one shared x-axis" invariant (W2-2).
    const [a] = pickTwoFamilies()
    const opt = buildOption(longDates, { [a]: longDates.map((_, i) => i) }, [a])
    expect(opt.xAxis[0].data.length).toBe(longDates.length)
    expect(opt.series[0].data.length).toBe(longDates.length)
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

// ── 2026-09-19 · the presentation layer V2 shipped without ─────────────────────
describe('the tooltip and crosshair a member actually reads', () => {
  const [a, b] = pickTwoFamilies()
  const vals = { [a]: [1, 2, 3, 4], [b]: [1500, 2500, 3500, 4500] }
  const opt = buildOption(DATES, vals, [a, b])
  const params = [
    { seriesId: a, seriesName: shortOf(a), color: '#111', axisValue: DATES[1], value: 2 },
    { seriesId: b, seriesName: shortOf(b), color: '#222', axisValue: DATES[1], value: 2500 },
  ]

  it('⚰️ prints the date ONCE for the whole stack, not once per panel', () => {
    const html = opt.tooltip.formatter(params)
    expect(html.match(/Wed, Sep 2, 2026/g)).toHaveLength(1)
    expect(html).not.toContain(DATES[1])            // the raw ISO string never reaches a member
  })

  it('puts the value first, thousands-separated', () => {
    const html = opt.tooltip.formatter(params)
    expect(html).toContain('2,500')
    expect(html.indexOf('2,500')).toBeLessThan(html.indexOf(shortOf(b)))
  })

  it('escapes a series name rather than interpolating it as HTML', () => {
    const html = opt.tooltip.formatter([{ ...params[0], seriesName: '<img src=x>' }])
    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;img src=x&gt;')
  })

  it('⚰️ is a vertical hairline, never a cross — a cross left a stale y reading on the other panel', () => {
    expect(opt.tooltip.axisPointer.type).toBe('line')
  })
})

describe('lines that belong to one panel stay on that panel', () => {
  const pct = ALL_METRICS.find(m => unitOf(m.key) === UNIT.PCT).key
  const cnt = ALL_METRICS.find(m => unitOf(m.key) === UNIT.COUNT).key
  const vals = { [pct]: [10, 50, 90, 60], [cnt]: [5, 50, 500, 60] }

  it('the MA extremes draw on the percentage panel only', () => {
    const opt = buildOption(DATES, vals, [pct, cnt], { extremes: true })
    const byId = Object.fromEntries(opt.series.map(s => [s.id, s]))
    expect(byId[pct].markLine.data.map(d => d.yAxis)).toEqual(expect.arrayContaining([90, 10]))
    expect(byId[cnt].markLine).toBeUndefined()
  })

  it('⭐ CONTROL — with extremes off the percentage panel carries none', () => {
    const opt = buildOption(DATES, vals, [pct, cnt])
    expect(opt.series.find(s => s.id === pct).markLine).toBeUndefined()
  })

  it('a reference line lands on the panel of its own unit', () => {
    const opt = buildOption(DATES, vals, [pct, cnt], { refLines: [{ unit: UNIT.COUNT, at: 100, label: 'x' }] })
    const byId = Object.fromEntries(opt.series.map(s => [s.id, s]))
    expect(byId[cnt].markLine.data).toEqual([expect.objectContaining({ yAxis: 100 })])
    expect(byId[pct].markLine).toBeUndefined()
  })

  it('the LIVE rule crosses every panel but is labelled once', () => {
    const opt = buildOption(DATES, vals, [pct, cnt], { live: { index: 3, clock: '2:47 PM' } })
    const rules = opt.series.map(s => s.markLine.data.find(d => d.xAxis === DATES[3]))
    expect(rules.every(Boolean)).toBe(true)
    expect(rules.filter(r => r.label.show !== false)).toHaveLength(1)
    expect(opt.series.every(s => s.showSymbol === true)).toBe(true)
  })
})

describe('reader choices survive a rebuild', () => {
  const [a, b] = pickTwoFamilies()
  const vals = { [a]: [1, 2, 3, 4], [b]: [10, 20, 30, 40] }

  it('a series hidden in the readout stays hidden in the rebuilt option', () => {
    const opt = buildOption(DATES, vals, [a, b], { hidden: new Set([a]) })
    expect(opt.legend.selected).toEqual({ [shortOf(a)]: false, [shortOf(b)]: true })
  })

  it('with no end labels (phone) the plot runs to the edge instead of an empty gutter', () => {
    const withLabels = buildOption(DATES, vals, [a, b])
    const without = buildOption(DATES, vals, [a, b], { endLabels: false })
    for (let i = 0; i < without.grid.length; i += 1) {
      expect(without.grid[i].right).toBeLessThan(withLabels.grid[i].right)
    }
  })

  it('with no slider (phone) there is still an inside zoom', () => {
    const opt = buildOption(DATES, vals, [a, b], { slider: false })
    expect(opt.dataZoom.map(z => z.type)).toEqual(['inside'])
  })
})

describe('⚰️ the reconstructed band is drawn once per PANEL, never once per line', () => {
  it('three lines in one panel carry one band between them, not three stacked', () => {
    const pcts = ALL_METRICS.filter(m => unitOf(m.key) === UNIT.PCT).slice(0, 3).map(m => m.key)
    const vals = Object.fromEntries(pcts.map(k => [k, [1, 2, 3, 4]]))
    const coverage = { regions: {}, runs: [{ fromIndex: 0, toIndex: 2 }] }
    const opt = buildOption(DATES, vals, pcts, { coverage })
    const withBand = opt.series.filter(s => s.markArea?.data?.length)
    expect(withBand).toHaveLength(1)
  })
})

describe('follow-through days', () => {
  const pct = ALL_METRICS.find(m => unitOf(m.key) === UNIT.PCT).key
  const cnt = ALL_METRICS.find(m => unitOf(m.key) === UNIT.COUNT).key
  const vals = { [pct]: [10, 50, 90, 60], [cnt]: [5, 50, 500, 60] }
  const ftd = [{ date: DATES[1], label: true }, { date: DATES[2], label: false }]

  it('rule through EVERY panel, labelled on the top panel only, first of a cluster only', () => {
    const opt = buildOption(DATES, vals, [pct, cnt], { ftd })
    const rulesByPanel = opt.series.map(s => (s.markLine?.data ?? []).filter(d => ftd.some(f => f.date === d.xAxis)))
    expect(rulesByPanel.map(r => r.length)).toEqual([2, 2])
    const labelled = rulesByPanel.flat().filter(r => r.label.show)
    expect(labelled).toHaveLength(1)
    expect(labelled[0]).toMatchObject({ xAxis: DATES[1], label: { formatter: 'FTD' } })
  })

  it('⭐ CONTROL — no markers asked for, no rules drawn', () => {
    const opt = buildOption(DATES, vals, [pct, cnt])
    expect(opt.series.every(s => s.markLine === undefined)).toBe(true)
  })
})
