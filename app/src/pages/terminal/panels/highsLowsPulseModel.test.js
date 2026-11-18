// HILO's small chart, the pure half: the read, the thinning, the scale, the label spacing and the
// words. Fixtures are the shape nhnl_live.get_series returns (api/services/nhnl_live.py).
import { describe, it, expect } from 'vitest'
import {
  NHNL_SERIES_URL, PULSE_LABEL_GAP, PULSE_MAX_DRAWN, PULSE_MIN_POINTS, PULSE_SERVER_MAX_POINTS, PULSE_VIEW, clockEt, niceMax,
  pulseAltText, pulseChart, pulseRead, rateText, spreadLabels, thinPoints,
} from './highsLowsPulseModel'

const pt = (hms, hi, lo) => ({ t: `2026-11-16T${hms}.123456-05:00`, hi, lo })
const ms = (hms) => Date.parse(`2026-11-16T${hms}.123-05:00`)
const BODY = {
  window: 'rth', asof: '2026-11-16T10:31:02.123456-05:00', date: '2026-11-16', active: true, sample_secs: 2.0,
  highs_total: 124, lows_total: 76,
  series: [pt('09:45:00', 0.4, 1.2), pt('10:00:00', 1.1, 0.9), pt('10:15:00', 2.4, 0.5), pt('10:31:00', 1.8, 0.35)],
}
const coords = (d) => d.slice(1).split('L').map((s) => s.split(' ').map(Number))

describe('pulse model: the read', () => {
  it('names the route and keeps the points oldest first, as numbers', () => {
    expect(NHNL_SERIES_URL).toBe('/api/nhnl/series')
    const out = pulseRead(BODY)
    expect(out).toMatchObject({ state: 'ok', window: 'rth', active: true, bufferFull: false, highsTotal: 124, lowsTotal: 76 })
    expect(out.asOf).toBe('2026-11-16T10:31:02.123-05:00')
    expect(out.points).toEqual([
      { t: ms('09:45:00'), hi: 0.4, lo: 1.2 }, { t: ms('10:00:00'), hi: 1.1, lo: 0.9 },
      { t: ms('10:15:00'), hi: 2.4, lo: 0.5 }, { t: ms('10:31:00'), hi: 1.8, lo: 0.35 },
    ])
  })

  it('a point with no time, a missing or negative rate, or a repeated time is dropped, never drawn as 0', () => {
    const out = pulseRead({
      ...BODY,
      series: [
        pt('10:15:00', 2.4, 0.5), pt('09:45:00', 0.4, 1.2), pt('09:45:00', 9, 9), { t: 'soon', hi: 1, lo: 1 }, { hi: 1, lo: 1 },
        pt('10:00:00', null, 0.9), pt('10:05:00', 1, undefined), pt('10:06:00', -1, 2), pt('10:07:00', '3', 2), null, 'x',
        pt('10:31:00', 0, 0),
      ],
    })
    expect(out.points.map((p) => [clockEt(p.t), p.hi, p.lo])).toEqual([['9:45 AM', 0.4, 1.2], ['10:15 AM', 2.4, 0.5], ['10:31 AM', 0, 0]])
  })

  it('closed and not-running are carried as sent; a missing total is null, never 0', () => {
    const closed = pulseRead({ ...BODY, window: 'closed', active: false })
    expect(closed).toMatchObject({ state: 'ok', window: 'closed', active: false })
    expect(closed.points).toHaveLength(4) // the last session's leftovers are still in the payload
    expect(pulseRead({ ...BODY, active: 'yes' }).active).toBe(false)
    expect(pulseRead({ ...BODY, window: 'lunch' }).window).toBeNull()
    expect(pulseRead({ series: [] })).toMatchObject({ state: 'ok', points: [], highsTotal: null, lowsTotal: null, asOf: null, active: false })
  })

  it('a full server buffer is reported, so the caption can say older readings are gone', () => {
    const full = { ...BODY, series: Array.from({ length: PULSE_SERVER_MAX_POINTS }, (_, i) => ({ t: new Date(ms('09:30:00') + i * 2000).toISOString(), hi: 1, lo: 1 })) }
    expect(pulseRead(full).bufferFull).toBe(true)
    expect(pulseRead(BODY).bufferFull).toBe(false)
  })

  it('anything that is not the shape of the route is a failed read, never an empty chart', () => {
    for (const body of [undefined, null, [], 'x', {}, { series: 'none' }, { detail: 'paid plan' }, { highs_total: 3 }]) {
      expect(pulseRead(body).state, JSON.stringify(body)).toBe('failed')
    }
  })
})

describe('pulse model: thinning and the scale', () => {
  it('thinPoints keeps the first and the last, and never grows a list', () => {
    const list = Array.from({ length: 1000 }, (_, i) => ({ t: i, hi: i, lo: 0 }))
    const out = thinPoints(list, 160)
    expect(out).toHaveLength(160)
    expect(out[0]).toBe(list[0])
    expect(out.at(-1)).toBe(list.at(-1))
    expect(out.every((p, i) => i === 0 || p.t > out[i - 1].t)).toBe(true)
    expect(thinPoints(list.slice(0, 5), 160)).toHaveLength(5)
    expect(thinPoints(null)).toEqual([])
    expect(PULSE_MAX_DRAWN).toBeGreaterThan(PULSE_MIN_POINTS)
  })

  it('niceMax is a round number at or above the peak, and 1 when there is no peak', () => {
    for (const [v, want] of [[0, 1], [-3, 1], [NaN, 1], [0.03, 0.05], [0.4, 0.5], [1, 1], [1.2, 2], [2.4, 5], [7, 10], [10, 10], [14, 20], [230, 500]]) {
      expect(niceMax(v), String(v)).toBe(want)
    }
  })

  it('spreadLabels keeps two labels apart, in order, inside the box', () => {
    expect(spreadLabels(10, 60)).toEqual([10, 60])
    expect(spreadLabels(60, 10)).toEqual([60, 10])
    const [a, b] = spreadLabels(40, 44)
    expect(b - a).toBe(PULSE_LABEL_GAP)
    expect((a + b) / 2).toBe(42)
    // on a tie the first (highs) sits above
    const [h, l] = spreadLabels(50, 50)
    expect(h).toBeLessThan(l)
    // pushed against an edge, both stay inside and stay apart
    const [t1, t2] = spreadLabels(2, 3, { lo: 6, hi: 90 })
    expect(t1).toBe(6)
    expect(t2).toBe(6 + PULSE_LABEL_GAP)
    const [b1, b2] = spreadLabels(89, 90, { lo: 6, hi: 90 })
    expect(b2).toBe(90)
    expect(b1).toBe(90 - PULSE_LABEL_GAP)
    const [x1, x2] = spreadLabels(90, 89, { lo: 6, hi: 90 })
    expect(x1).toBe(90)
    expect(x2).toBe(90 - PULSE_LABEL_GAP)
  })
})

describe('pulse model: the chart', () => {
  it('too few points, or no time between them, is no chart at all', () => {
    const { points } = pulseRead(BODY)
    expect(PULSE_MIN_POINTS).toBe(3)
    expect(pulseChart([])).toBeNull()
    expect(pulseChart(points.slice(0, PULSE_MIN_POINTS - 1))).toBeNull()
    expect(pulseChart(points.slice(0, PULSE_MIN_POINTS))).not.toBeNull()
    expect(pulseChart([{ t: 5, hi: 1, lo: 1 }, { t: 5, hi: 2, lo: 1 }, { t: 5, hi: 3, lo: 1 }])).toBeNull()
    expect(pulseChart(null)).toBeNull()
  })

  it('scales time across the full width and the rate from 0 at the bottom to a round peak at the top', () => {
    const chart = pulseChart(pulseRead(BODY).points)
    expect(chart.yMax).toBe(5)
    expect(chart.drawn).toBe(4)
    expect([chart.startT, chart.endT]).toEqual([ms('09:45:00'), ms('10:31:00')])
    expect(chart.last).toEqual({ t: ms('10:31:00'), hi: 1.8, lo: 0.35 })
    const hi = coords(chart.hiPath)
    const lo = coords(chart.loPath)
    expect(hi.map((c) => c[0])).toEqual(lo.map((c) => c[0]))
    expect(hi[0][0]).toBe(0)
    expect(hi.at(-1)[0]).toBe(PULSE_VIEW.width)
    // 15 of the 46 minutes in: about a third of the way across
    expect(hi[1][0]).toBeCloseTo((15 / 46) * PULSE_VIEW.width, 0)
    // a bigger rate sits HIGHER (a smaller y); 0 would sit on the baseline
    const inner = PULSE_VIEW.height - 2 * PULSE_VIEW.pad
    const y = (v) => Math.round((PULSE_VIEW.pad + inner - (v / 5) * inner) * 10) / 10
    expect(hi.map((c) => c[1])).toEqual([y(0.4), y(1.1), y(2.4), y(1.8)])
    expect(lo.map((c) => c[1])).toEqual([y(1.2), y(0.9), y(0.5), y(0.35)])
    expect(y(2.4)).toBeLessThan(y(0.4))
    expect(y(0)).toBe(PULSE_VIEW.height - PULSE_VIEW.pad)
  })

  it('a flat zero session draws on the baseline, with the labels still apart', () => {
    const flat = pulseChart([{ t: 0, hi: 0, lo: 0 }, { t: 1000, hi: 0, lo: 0 }, { t: 2000, hi: 0, lo: 0 }])
    expect(flat.yMax).toBe(1)
    expect(coords(flat.hiPath).every((c) => c[1] === PULSE_VIEW.height - PULSE_VIEW.pad)).toBe(true)
    expect(flat.loLabelTop - flat.hiLabelTop).toBeCloseTo((PULSE_LABEL_GAP / PULSE_VIEW.height) * 100, 0)
    expect(flat.loLabelTop).toBeLessThanOrEqual(100)
  })

  it('a long series is thinned but its scale still covers a peak that was thinned out', () => {
    const many = Array.from({ length: 2000 }, (_, i) => ({ t: i * 2000, hi: i === 777 ? 42 : 1, lo: 0.5 }))
    const chart = pulseChart(many)
    expect(chart.drawn).toBe(PULSE_MAX_DRAWN)
    expect(chart.yMax).toBe(50)
    expect(coords(chart.hiPath).every((c) => c[1] >= PULSE_VIEW.pad && c[1] <= PULSE_VIEW.height - PULSE_VIEW.pad)).toBe(true)
    expect(chart.endT).toBe(1999 * 2000)
  })

  it('the end labels sit by their lines, highs above lows when highs lead, and never closer than the gap', () => {
    const chart = pulseChart(pulseRead(BODY).points)
    expect(chart.hiLabelTop).toBeLessThan(chart.loLabelTop)
    expect(((chart.loLabelTop - chart.hiLabelTop) / 100) * PULSE_VIEW.height).toBeGreaterThanOrEqual(PULSE_LABEL_GAP - 0.2)
    const lowsLead = pulseChart([{ t: 0, hi: 1, lo: 1 }, { t: 1000, hi: 1, lo: 2 }, { t: 2000, hi: 0.2, lo: 4.8 }])
    expect(lowsLead.loLabelTop).toBeLessThan(lowsLead.hiLabelTop)
    for (const c of [chart, lowsLead]) {
      for (const top of [c.hiLabelTop, c.loLabelTop]) {
        expect(top).toBeGreaterThanOrEqual(0)
        expect(top).toBeLessThanOrEqual(100)
      }
    }
  })
})

describe('pulse model: the words', () => {
  it('rateText reads a rate at the precision it carries', () => {
    expect([14.4, 1.84, 0.349, 0.04, 0, 10, 0.999].map(rateText)).toEqual(['14', '1.8', '0.35', '0.04', '0', '10', '1'])
    expect([null, undefined, NaN, '2'].map(rateText)).toEqual(['', '', '', ''])
  })

  it('clockEt is the Eastern clock, whatever zone the test runs in', () => {
    expect(clockEt(Date.parse('2026-11-16T15:31:00Z'))).toBe('10:31 AM')
    expect(clockEt(Date.parse('2026-07-01T20:05:00Z'))).toBe('4:05 PM')
    expect(clockEt(NaN)).toBe('')
  })

  it('the text alternative states the span, the latest rate of each line and the counts of stocks', () => {
    const view = pulseRead(BODY)
    const chart = pulseChart(view.points)
    expect(pulseAltText(chart, view)).toBe('New highs and new lows being set each second across the market, 9:45 AM to 10:31 AM Eastern. '
      + 'Latest reading: 1.8 new highs a second and 0.35 new lows a second. '
      + 'So far this session 124 stocks have made a new high and 76 stocks have made a new low.')
    const one = pulseAltText(chart, { ...view, highsTotal: 1, lowsTotal: 0 })
    expect(one).toContain('1 stock has made a new high and 0 stocks have made a new low.')
    // a missing total drops the sentence rather than saying 0
    expect(pulseAltText(chart, { ...view, highsTotal: null })).not.toContain('So far this session')
    expect(pulseAltText(null, view)).toBe('')
  })
})
