// Round 7 of the plain base: when its buy line moved under a one-session spike high, the server stamps the old high
// (`draw_base.ceiling_high`) with `top_label: 'base top'`, and the chart draws it as a FAINT reference line,
// "Base top X" -- never a buy point, quieter than the buy-point line. Its buy zone (`draw_base.zone`) is measured
// against the round-7 buy point, which prints AT the line (no +$0.10). Synthetic prices.
import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import PatternOverlay, { baseDrawing, selectDrawable, rowView, textbookMetricsLines } from './PatternOverlay'
import { patternLabelSpecs } from './patternLabelLayout'
import { levelLabelPosition } from './patternShapes/labelLayout'
import { anchorToBarTime } from './patternTime'

const DAILY = ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16']

function makeChart() {
  const index = new Map(DAILY.map((t, i) => [t, i * 10]))
  return {
    timeScale: () => ({
      timeToCoordinate: (t) => (index.has(t) ? index.get(t) : null),
      subscribeVisibleTimeRangeChange: vi.fn(),
      subscribeVisibleLogicalRangeChange: vi.fn(),
      unsubscribeVisibleTimeRangeChange: vi.fn(),
      unsubscribeVisibleLogicalRangeChange: vi.fn(),
      options: () => ({ barSpacing: 8 }),
    }),
  }
}
const series = { priceToCoordinate: (p) => 1000 - p * 10 }
const containerRef = () => ({ current: { clientWidth: 800, clientHeight: 400 } })
const draw = (detections) => render(
  <PatternOverlay chart={makeChart()} series={series} containerRef={containerRef()}
    enabled={true} tf="D" barTimes={DAILY} detections={detections} trustedOnly={true} />,
)

// the round-7 line 50.00 (buy point 50.00, no dime), the spike high 52.40 above it
const TEXTBOOK = {
  buy_point: 50.0, base_high: 52.4, line: 50.0, asof_t: 20261016, depth_pct: 12.2, length_weeks: 1.8,
  buy_zone_top: 52.5, pct_from_buy_point: 1.2, extended: false, stage: 1,
}
const DRAW = {
  pivot: 50.0, start_t: 20261012, end_t: 20261016, low: 46.0, low_t: 20261014, bars: 4,
  label: 'pivot', low_label: 'base low', plain_round: 7, stage: 1,
  ceiling_high: 52.4, top_label: 'base top', zone: 'buy_zone', breakout_t: 20261016,
}

function base(drawExtra = {}, extra = { metrics_textbook: TEXTBOOK }) {
  return {
    id: 'bc:base:SYN:20261012:20261016', pattern_id: 'bc:base', pattern_name: 'Base',
    direction: 'bullish', display_tier: 'trusted', display_layer: 'structures', confidence: null,
    category: 'base', status: 'forming', levels: { entry: 50.0 },
    geometry: {
      shape: 'base_draw',
      anchors: [{ t: 20261012, price: 50.0 }, { t: 20261016, price: 46.0 }],
      extras: { draw_base: { ...DRAW, ...drawExtra }, draw_round: 5, ...extra },
    },
  }
}

describe('baseDrawing: the faint base top of a round-7 plain base', () => {
  it('carries the old high as "Base top X" beside the buy-point line', () => {
    const b = baseDrawing(base())
    expect(b.pivot).toBe(50.0)
    expect(b.label).toBe('Buy point 50.00')
    expect(b.top).toBe(52.4)
    expect(b.topLabel).toBe('Base top 52.40')
  })

  it('draws no base top without the server label, or when the high is not above the drawn line', () => {
    for (const ex of [{ top_label: undefined }, { ceiling_high: 50.0 }, { ceiling_high: 49.0 },
      { ceiling_high: null }, { ceiling_high: 'x' }]) {
      const b = baseDrawing(base(ex))
      expect(b.top).toBeUndefined()
      expect(b.topLabel).toBeUndefined()
    }
  })

  it('a base STATE row never draws one', () => {
    const b = baseDrawing(base({ state: 'breakout', state_round: 1, base_end_t: 20261015 }))
    expect(b.top).toBeUndefined()
  })
})

describe('the rendered chart: base top secondary to the buy point', () => {
  it('draws a faint, thin, sparse-dash line labelled "Base top 52.40"; the buy-point line stays solid', () => {
    const { container } = draw([base()])
    const top = container.querySelector('[data-role="base-top"]')
    expect(top).not.toBeNull()
    const tl = top.querySelector('line')
    expect(Number(tl.getAttribute('y1'))).toBe(1000 - 52.4 * 10)
    expect(tl.getAttribute('stroke-dasharray')).toBe('2,4')
    expect(top.querySelector('text').textContent).toBe('Base top 52.40')
    const piv = container.querySelector('[data-role="base-pivot"]')
    const pl = piv.querySelector('line')
    expect(piv.querySelector('text').textContent).toBe('Buy point 50.00')
    expect(pl.getAttribute('stroke-dasharray')).toBeNull()
    expect(Number(tl.getAttribute('opacity'))).toBeLessThan(Number(pl.getAttribute('opacity')))
    expect(Number(tl.getAttribute('stroke-width'))).toBeLessThan(Number(pl.getAttribute('stroke-width')))
    // a reference, not a level: it does not run past the base like the buy-point line does
    expect(Number(tl.getAttribute('x2'))).toBeLessThan(Number(pl.getAttribute('x2')))
  })

  it('a round-6 row (no base top stamp) draws no base-top line', () => {
    const { container } = draw([base({ ceiling_high: undefined, top_label: undefined, plain_round: 6 })])
    expect(container.querySelector('[data-role="base-top"]')).toBeNull()
  })

  it('the label specs mirror the rendered labels, base top included', () => {
    const rows = [base()]
    const tToX = (t) => {
      const ct = anchorToBarTime(t, 'D', DAILY)
      return ct == null ? null : DAILY.indexOf(ct) * 10
    }
    const priceToY = (p) => series.priceToCoordinate(p)
    const views = selectDrawable(rows, { tf: 'D', trustedOnly: true }).map(rowView)
    const expected = views.flatMap(patternLabelSpecs).map((s) => {
      const pos = levelLabelPosition({ geometry: { anchors: s.anchors, label: s.label } }, tToX, priceToY, s.ext)
      return `${pos.x}|${pos.label}`
    }).sort()
    const { container } = draw(rows)
    const rendered = [...container.querySelectorAll('[data-shape="level-segment"] text')]
      .map((t) => `${Number(t.getAttribute('x'))}|${t.textContent}`).sort()
    expect(rendered).toContain(expected.find((e) => e.endsWith('|Base top 52.40')))
    expect(rendered).toEqual(expected)
  })
})

describe('the round-7 buy zone in the printed numbers', () => {
  it('says "in buy zone" for a close 0-5% over the round-7 buy point', () => {
    expect(textbookMetricsLines(base())[1]).toBe('Buy zone to 52.50 · +1.2% from buy point · in buy zone')
  })

  it('says "extended" past it, never both', () => {
    const lines = textbookMetricsLines(base({ zone: 'extended' },
      { metrics_textbook: { ...TEXTBOOK, pct_from_buy_point: 6.4, extended: true } }))
    expect(lines[1]).toBe('Buy zone to 52.50 · +6.4% from buy point · extended')
  })

  it('a row without a zone (round 6, or under the buy point) prints neither', () => {
    for (const z of [undefined, 'below']) {
      expect(textbookMetricsLines(base({ zone: z }))[1]).toBe('Buy zone to 52.50 · +1.2% from buy point')
    }
  })
})
