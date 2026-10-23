// Label placement and collisions (WDAY daily, 2026-10-23). The base metrics / textbook block printed at
// the right price edge, and its second line sat on top of the learned drawer's level labels ("learned swing
// H 207.67", "learned gap 197.13"), so neither could be read. Now:
//   - the metrics block sits at the TOP-LEFT of the base (above the box, or just inside it when that covers
//     fewer candles), inside the pane;
//   - right-edge pattern labels that overlap are pushed apart vertically;
//   - a learned label that would print over the metrics block or a pattern label loses its TEXT (its line
//     still draws). Pattern and metrics text always win.
// Labels only: every line, box and number is asserted unchanged. Synthetic prices.
import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import PatternOverlay, { selectDrawable, rowView } from './PatternOverlay'
import { patternLabelSpecs } from './patternLabelLayout'
import {
  placeMetricsBlock, stackLabels, droppedLearnedLabels, textBox, boxesOverlap, levelLabelPosition,
} from './patternShapes/labelLayout'
import { anchorToBarTime } from './patternTime'

const DAILY = ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16']

function makeChart(spacing = 10) {
  const index = new Map(DAILY.map((t, i) => [t, i * spacing]))
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
const draw = (detections, props = {}, spacing = 10) => render(
  <PatternOverlay chart={makeChart(spacing)} series={series} containerRef={containerRef()}
    enabled={true} tf="D" barTimes={DAILY} detections={detections} trustedOnly={true} {...props} />,
)

const TEXTBOOK = {
  buy_point: 81.98, depth_pct: 12.0, length_weeks: 5.2, stage: 2, buy_zone_top: 86.08,
  pct_from_buy_point: -0.9,
}
const DRAW = {
  pivot: 81.98, start_t: 20261012, end_t: 20261016, low: 72.14, low_t: 20261014, bars: 4,
  label: 'pivot', low_label: 'base low',
}
function base(extra = {}) {
  return {
    id: 'bc:base:SYN:20261012:20261016', pattern_id: 'bc:base', pattern_name: 'Base',
    direction: 'bullish', display_tier: 'trusted', display_layer: 'structures', confidence: null,
    category: 'base', status: 'forming', levels: { entry: 81.98 },
    geometry: {
      shape: 'base_draw',
      anchors: [{ t: 20261012, price: 81.98 }, { t: 20261016, price: 72.14 }],
      extras: { draw_base: DRAW, draw_round: 1, ...extra },
    },
  }
}
function flat(extra = {}, over = {}) {
  return {
    id: 'bc:flat-base:SYN:20261012:20261016', pattern_id: 'bc:flat-base', pattern_name: 'Flat base',
    direction: 'bullish', display_tier: 'trusted', display_layer: 'structures', confidence: null,
    category: 'base', status: 'forming', levels: { entry: 81.98 },
    geometry: {
      shape: 'base_box',
      anchors: [{ t: 20261012, price: 84 }, { t: 20261016, price: 72.14 }],
      extras: {
        top: 84, floor: 72.14, pivot: 81.98, draw_box: false,
        draw_pivot: { start_t: 20261012, end_t: 20261016, price: 81.98 }, ...extra,
      },
    },
    ...over,
  }
}
const shelf = {
  id: 'draw:shelf-pivot:SYN:20261013:20261016', pattern_id: 'draw:shelf-pivot', pattern_name: 'Shelf pivot',
  direction: 'neutral', display_tier: 'trusted', display_layer: 'structures', confidence: null,
  category: 'level', status: 'forming', levels: {},
  geometry: {
    shape: 'shelf_pivot',
    anchors: [{ t: 20261013, price: 60 }, { t: 20261016, price: 60 }],
    extras: { draw_shelf: { price: 60, start_t: 20261013, end_t: 20261016, label: 'Shelf pivot' } },
  },
}
// A learned level whose label (at the last bar + 52px) lands where the metrics block prints.
const learnedLevel = (price, label = 'swing H') => ({
  asof_t: 20261016, trendlines: [],
  horizontals: [{ price, t_from: 20261012, label, source: 'swing' }],
})

// every drawn shape's geometry, as attribute tuples: what must NOT change when labels move
function geometry(container) {
  const out = []
  for (const el of container.querySelectorAll('line, rect, circle, polyline, path')) {
    out.push([el.tagName, ...['x1', 'y1', 'x2', 'y2', 'x', 'y', 'width', 'height', 'cx', 'cy', 'r', 'points', 'd']
      .map((k) => el.getAttribute(k))].join('|'))
  }
  return out
}

describe('placeMetricsBlock', () => {
  const lines = ['Buy point 211.93 · 18% deep · 10.0 wks · stage 2', 'Buy zone to 222.53 · −0.9% from buy point']
  const box = { xL: 100, yTop: 200, yBottom: 320 }

  it('no candles: above the box top, left-aligned 2px in from the base', () => {
    const p = placeMetricsBlock({ lines, box, pane: { w: 800, h: 400 } })
    expect(p.side).toBe('above')
    expect(p.x).toBe(102)
    expect(p.y).toBe(200 - 18)
    expect(p.rect.y1).toBeLessThanOrEqual(box.yTop)
  })

  it('candles over the box top push it inside; candles inside keep it above (deterministic)', () => {
    const aboveCandles = [0, 1, 2, 3].map((i) => ({ x: 120 + i * 20, yHigh: 160, yLow: 198 }))
    const insideCandles = [0, 1, 2, 3].map((i) => ({ x: 120 + i * 20, yHigh: 202, yLow: 260 }))
    const a = placeMetricsBlock({ lines, box, candles: aboveCandles, halfW: 4 })
    const b = placeMetricsBlock({ lines, box, candles: insideCandles, halfW: 4 })
    expect(a.side).toBe('inside')
    expect(a.rect.y0).toBeGreaterThan(box.yTop)
    expect(b.side).toBe('above')
    // same input, same answer
    expect(placeMetricsBlock({ lines, box, candles: aboveCandles, halfW: 4 })).toEqual(a)
  })

  it('a box too short to hold the block is never filled from inside', () => {
    const tight = { xL: 100, yTop: 200, yBottom: 220 }
    const aboveCandles = [{ x: 120, yHigh: 150, yLow: 198 }]
    expect(placeMetricsBlock({ lines, box: tight, candles: aboveCandles }).side).toBe('above')
  })

  it('stays inside the pane: a base whose top is above the pane, or at its right edge, is clamped', () => {
    const p = placeMetricsBlock({ lines, box: { xL: 700, yTop: 10, yBottom: null }, pane: { w: 800, h: 400 } })
    expect(p.rect.y0).toBeGreaterThanOrEqual(2)
    expect(p.rect.x1).toBeLessThanOrEqual(798)
  })
})

describe('stackLabels / droppedLearnedLabels', () => {
  it('two overlapping labels get separated; a clear one keeps offset 0', () => {
    const a = textBox(100, 183, 'Pivot 81.98')
    const b = textBox(100, 185, 'Entry 81.98')
    const c = textBox(400, 184, 'far right')
    const dy = stackLabels([{ id: 'a', box: a }, { id: 'b', box: b }, { id: 'c', box: c }])
    expect(dy.a).toBeUndefined()
    expect(dy.c).toBeUndefined()
    expect(dy.b).toBeGreaterThan(0)
    const moved = { ...b, y0: b.y0 + dy.b, y1: b.y1 + dy.b }
    expect(boxesOverlap(a, moved)).toBe(false)
  })

  it('three labels on one price stack into three rows, none overlapping', () => {
    const items = ['x', 'y', 'z'].map((id) => ({ id, box: textBox(50, 100, `label ${id}`) }))
    const dy = stackLabels(items)
    const boxes = items.map(({ id, box }) => ({ ...box, y0: box.y0 + (dy[id] || 0), y1: box.y1 + (dy[id] || 0) }))
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) expect(boxesOverlap(boxes[i], boxes[j])).toBe(false)
    }
  })

  it('a learned label touching a winner is dropped; one clear of every winner is kept', () => {
    const winner = { x0: 0, x1: 300, y0: 150, y1: 176 }
    const hit = { key: 'h0', box: textBox(92, 165, 'learned · swing H 83.50') }
    const clear = { key: 'h1', box: textBox(92, 403, 'learned · gap 60.00') }
    expect([...droppedLearnedLabels([hit, clear], [winner])]).toEqual(['h0'])
  })
})

describe('on the chart', () => {
  it('a learned label colliding with the metrics block loses its text; its line still draws', () => {
    // metrics block: x 2..~300, y ~152..176; the learned label (x 92, baseline 168) sits inside it
    const { container } = draw([base({ metrics_textbook: TEXTBOOK })], { drawn: learnedLevel(83.5) })
    const lvl = container.querySelector('[data-shape="learned-level"]')
    expect(lvl).not.toBeNull()
    expect(lvl.querySelector('line')).not.toBeNull()
    expect(lvl.querySelector('text')).toBeNull()
    expect(lvl.getAttribute('data-label-dropped')).toBe('1')
    // the metrics block itself is untouched and still readable
    expect(container.querySelector('[data-role="base-metrics"]').textContent).toContain('Buy point 81.98')
  })

  it('control: the same learned level without a metrics block keeps its text', () => {
    const { container } = draw([base()], { drawn: learnedLevel(83.5) })
    const lvl = container.querySelector('[data-shape="learned-level"]')
    expect(lvl.querySelector('text')?.textContent).toBe('learned · swing H 83.50')
    expect(lvl.getAttribute('data-label-dropped')).toBeNull()
  })

  it('a learned label printing over a pattern label loses its text; the pattern label wins', () => {
    // learned level ON the pivot price: its label (x 92) overlaps "pivot" (x 84, same baseline)
    const { container } = draw([base()], { drawn: learnedLevel(81.98, 'flip') })
    expect(container.querySelector('[data-shape="learned-level"] text')).toBeNull()
    expect(container.querySelector('[data-role="base-pivot"] text').textContent).toBe('pivot')
  })

  it('two pattern labels on one price are stacked apart (the second moves down), lines unmoved', () => {
    const { container } = draw([flat({}, { draw_entry: true })])
    const pivotText = container.querySelector('[data-role="pivot"] text')
    const entryG = [...container.querySelectorAll('[data-shape="level-segment"]')]
      .find((g) => g.querySelector('text')?.textContent === 'Entry 81.98')
    const entryText = entryG.querySelector('text')
    expect(pivotText.getAttribute('data-label-dy')).toBeNull()
    expect(Number(entryText.getAttribute('data-label-dy'))).toBeGreaterThan(0)
    const pb = textBox(Number(pivotText.getAttribute('x')), Number(pivotText.getAttribute('y')), pivotText.textContent)
    const eb = textBox(Number(entryText.getAttribute('x')), Number(entryText.getAttribute('y')), entryText.textContent)
    expect(boxesOverlap(pb, eb)).toBe(false)
    // both LINES stay exactly on the price (y = 1000 - 819.8)
    for (const g of [container.querySelector('[data-role="pivot"]'), entryG]) {
      expect(Number(g.querySelector('line').getAttribute('y1'))).toBeCloseTo(180.2, 6)
      expect(Number(g.querySelector('line').getAttribute('y2'))).toBeCloseTo(180.2, 6)
    }
  })

  it('the metrics block is never at the right price edge: it starts at the base\'s left edge', () => {
    // a wide base (bars 80px apart): the pivot line ends at x 320 + 40, the block starts at x 2
    const { container } = draw([base({ metrics_textbook: TEXTBOOK })], {}, 80)
    const t = container.querySelector('[data-role="base-metrics"]')
    expect(t.getAttribute('text-anchor')).toBe('start')
    expect(Number(t.getAttribute('x'))).toBe(2)
  })

  it('candles crowding the space above the box move the block just inside it', () => {
    // candles at x 0..320 whose bodies fill y 150..175 (prices 85..82.5): the above slot is covered
    const candles = DAILY.map((time) => ({ time, open: 83, high: 85, low: 82.5, close: 84 }))
    const { container } = draw([base({ metrics_textbook: TEXTBOOK })], { candles }, 80)
    const t = container.querySelector('[data-role="base-metrics"]')
    expect(t.getAttribute('data-metrics-side')).toBe('inside')
    expect(Number(t.getAttribute('y'))).toBeGreaterThan(180.2)
    // control: no candles -> above
    const plain = draw([base({ metrics_textbook: TEXTBOOK })], {}, 80).container
    expect(plain.querySelector('[data-role="base-metrics"]').getAttribute('data-metrics-side')).toBe('above')
  })

  it('geometry is unchanged by the label pass: every line/box/dot is identical with or without collisions', () => {
    const rows = (m) => [base(m ? { metrics_textbook: TEXTBOOK } : {}), flat({}, { draw_entry: true }), shelf]
    const colliding = draw(rows(true), { drawn: learnedLevel(83.5) }).container
    const quiet = draw(rows(false), { drawn: learnedLevel(83.5) }).container
    expect(geometry(colliding)).toEqual(geometry(quiet))
    expect(geometry(colliding).length).toBeGreaterThan(4)
    // and the numbers printed are the server's, untouched
    expect(colliding.querySelector('[data-role="base-metrics"]').textContent)
      .toContain('Buy zone to 86.08 · −0.9% from buy point')
  })
})

describe('the label specs mirror what the overlay renders', () => {
  it('every rendered right-edge pattern label has a spec at the same x, and vice versa', () => {
    const rows = [base(), flat({}, { draw_entry: true }), shelf]
    const tToX = (t) => {
      const ct = anchorToBarTime(t, 'D', DAILY)
      return ct == null ? null : DAILY.indexOf(ct) * 10
    }
    const priceToY = (p) => series.priceToCoordinate(p)
    const views = selectDrawable(rows, { tf: 'D', trustedOnly: true }).map(rowView)
    const expected = views.flatMap(patternLabelSpecs).map((s) => {
      const pos = s.shelf
        ? { x: Math.max(tToX(s.anchors[0].t), tToX(s.anchors[1].t)) + s.ext + 4, label: s.label }
        : levelLabelPosition({ geometry: { anchors: s.anchors, label: s.label } }, tToX, priceToY, s.ext)
      return `${pos.x}|${pos.label}`
    }).sort()
    const { container } = draw(rows)
    const rendered = [
      ...container.querySelectorAll('[data-shape="level-segment"] text'),
      ...container.querySelectorAll('[data-role="shelf-pivot-label"]'),
    ].map((t) => `${Number(t.getAttribute('x'))}|${t.textContent}`).sort()
    expect(rendered.length).toBeGreaterThan(3)
    expect(rendered).toEqual(expected)
  })
})
