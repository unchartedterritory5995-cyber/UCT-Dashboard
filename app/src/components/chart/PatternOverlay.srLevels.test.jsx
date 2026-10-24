// Textbook support / resistance (`levels_sr`, drawing round r2, AUTO_STRUCTURES_SR_ENABLED): zones as thin bands
// labelled "Support a-b" / "Resistance a-b", trendlines as dashed lines, in a style unlike the pattern drawings,
// and labels that yield to pattern / metrics labels instead of printing over them. Asserted by what RENDERS.
// Synthetic prices.
import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import PatternOverlay, { SHELF_PIVOT_COLOR } from './PatternOverlay'
import { SR_SUPPORT_COLOR, SR_RESISTANCE_COLOR, SR_EXTEND_PX, srLevelsGeometry } from './patternShapes/srLevelsGeometry'
import { stackLabelsAround, textBox, boxesOverlap } from './patternShapes/labelLayout'
import { computeLabelLayout } from './patternLabelLayout'
import { levelsSrAvailable } from './autoStructuresGate'

const DAILY = ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16']

function makeDailyChart(barTimes) {
  const index = new Map(barTimes.map((t, i) => [t, i * 10]))
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
const draw = (detections, props = {}) => render(
  <PatternOverlay chart={makeDailyChart(DAILY)} series={series} containerRef={containerRef()}
    enabled={true} tf="D" barTimes={DAILY} detections={detections} {...props} />,
)

const SR = {
  round: 'r2', asof_t: 20261016, atr: 0.9,
  zones: [
    { role: 'Resistance', bot: 18.0, top: 18.45, label: 'Resistance 18.00-18.45', touches: 4, first_t: 20261012,
      last_t: 20261015, broken_retested: false },
    { role: 'Support', bot: 15.0, top: 15.5, label: 'Support 15.00-15.50', touches: 3, first_t: 20261013,
      last_t: 20261015, broken_retested: true },
  ],
  trendlines: [
    { side: 'support', t1: 20261012, p1: 10.0, t2: 20261016, p2: 12.0, slope_per_bar: 0.5,
      label: 'Uptrend line (support)', touches: 3, last_touch_t: 20261015 },
  ],
}

const SHELF = { price: 15.7, start_t: 20261013, end_t: 20261016, label: 'Shelf pivot', cleared: false, tooltip: 't' }
const shelfRow = {
  id: 'draw:shelf-pivot:SYN:20261013:20261016', pattern_id: 'draw:shelf-pivot', pattern_name: 'Shelf pivot',
  direction: 'neutral', display_tier: 'trusted', display_layer: 'structures', confidence: null,
  category: 'level', status: 'forming', levels: {},
  geometry: { shape: 'shelf_pivot', anchors: [{ t: 20261013, price: 15.7 }, { t: 20261016, price: 15.7 }],
    extras: { draw_shelf: SHELF, draw_round: 'r4' } },
}

describe('the textbook S/R layer draws zones as thin labelled bands', () => {
  it('draws each zone as a band from its first bar to just past the as-of bar, at its own bounds', () => {
    const { container } = draw([], { levelsSr: SR })
    const bands = container.querySelectorAll('[data-role="sr-zone-band"]')
    expect(bands.length).toBe(2)
    const sup = container.querySelector('[data-sr-role="Support"] [data-role="sr-zone-band"]')
    // 20261013 is x 10; the as-of bar 20261016 is x 40; the band runs SR_EXTEND_PX past it
    expect(Number(sup.getAttribute('x'))).toBe(10)
    expect(Number(sup.getAttribute('width'))).toBe(40 + SR_EXTEND_PX - 10)
    // top 15.5 -> y 845, bot 15.0 -> y 850: a thin band exactly the zone's height
    expect([Number(sup.getAttribute('y')), Number(sup.getAttribute('height'))]).toEqual([845, 5])
    expect(sup.getAttribute('fill')).toBe(SR_SUPPORT_COLOR)
    const res = container.querySelector('[data-sr-role="Resistance"] [data-role="sr-zone-band"]')
    expect(res.getAttribute('fill')).toBe(SR_RESISTANCE_COLOR)
  })

  it('labels them "Support a-b" / "Resistance a-b" to the right of the band', () => {
    const { container } = draw([], { levelsSr: SR })
    const labels = [...container.querySelectorAll('[data-role="sr-zone-label"]')].map((t) => t.textContent)
    expect(labels).toEqual(['Resistance 18.00-18.45', 'Support 15.00-15.50'])
    const t = container.querySelector('[data-sr-role="Support"] [data-role="sr-zone-label"]')
    expect(Number(t.getAttribute('x'))).toBe(40 + SR_EXTEND_PX + 4)
    expect(t.getAttribute('fill')).toBe(SR_SUPPORT_COLOR)
  })

  it('draws a trendline as a dashed line through the as-of bar and a little past it, labelled', () => {
    const { container } = draw([], { levelsSr: SR })
    const l = container.querySelector('[data-role="sr-trendline"] line')
    expect([l.getAttribute('x1'), l.getAttribute('y1')]).toEqual(['0', '900'])
    // the as-of point is (40, 880); extended SR_EXTEND_PX at the same pixel slope (-0.5 px/px)
    expect(Number(l.getAttribute('x2'))).toBe(40 + SR_EXTEND_PX)
    expect(Number(l.getAttribute('y2'))).toBe(880 - 0.5 * SR_EXTEND_PX)
    expect(l.getAttribute('stroke-dasharray')).toBe('6 4')
    expect(container.querySelector('[data-role="sr-trendline-label"]').textContent).toBe('Uptrend line (support)')
  })

  it('is a style unlike the pattern drawings: dotted band edge, no level segments, not the shelf purple', () => {
    const { container } = draw([], { levelsSr: SR })
    const band = container.querySelector('[data-role="sr-zone-band"]')
    expect(band.getAttribute('stroke-dasharray')).toBe('2 3')
    expect(Number(band.getAttribute('fill-opacity'))).toBeLessThan(0.3)
    expect(container.querySelectorAll('[data-shape="level-segment"]').length).toBe(0)
    for (const el of container.querySelectorAll('[data-role="sr-levels"] [fill], [data-role="sr-levels"] [stroke]')) {
      expect(el.getAttribute('fill')).not.toBe(SHELF_PIVOT_COLOR)
    }
  })

  it('draws with no pattern rows at all (the layer stands on its own)', () => {
    const { container } = draw([], { levelsSr: SR })
    expect(container.querySelector('[data-role="sr-levels"]')).not.toBeNull()
  })

  it('draws nothing when absent, empty, or turned off by the toggle hook', () => {
    expect(draw([], { levelsSr: null }).container.querySelector('[data-role="sr-levels"]')).toBeNull()
    expect(draw([], { levelsSr: { ...SR, zones: [], trendlines: [] } }).container.querySelector('svg')).toBeNull()
    expect(draw([], { levelsSr: SR, showLevelsSr: false }).container.querySelector('[data-role="sr-levels"]')).toBeNull()
    expect(draw([shelfRow], { levelsSr: SR, showLevelsSr: false }).container.querySelector('[data-role="shelf-pivot"]'))
      .not.toBeNull()
  })

  it('leaves out an item it cannot place instead of guessing', () => {
    const g = srLevelsGeometry({ ...SR, zones: [{ ...SR.zones[0], top: Number.NaN }], asof_t: 20261016 },
      (t) => (t === 20261016 ? 40 : null), (p) => 1000 - p * 10)
    expect(g.zones).toEqual([])
  })

  it('the pending-acquisition notice replaces it like every other drawing', () => {
    const { container } = draw([], { levelsSr: SR, dealStatus: { pending: true, label: 'Pending' } })
    expect(container.querySelector('[data-role="sr-levels"]')).toBeNull()
  })
})

describe('S/R labels never print over a pattern or metrics label', () => {
  it('moves the S/R label off the shelf pivot label; the pattern label does not move', () => {
    const plain = draw([shelfRow]).container
    const shelfY = Number(plain.querySelector('[data-role="shelf-pivot-label"]').getAttribute('y'))
    const { container } = draw([shelfRow], { levelsSr: SR })
    const shelfLabel = container.querySelector('[data-role="shelf-pivot-label"]')
    expect(Number(shelfLabel.getAttribute('y'))).toBe(shelfY)            // patterns win: never pushed
    const sr = container.querySelector('[data-sr-role="Support"] [data-role="sr-zone-label"]')
    const a = textBox(Number(shelfLabel.getAttribute('x')), Number(shelfLabel.getAttribute('y')), shelfLabel.textContent)
    const b = textBox(Number(sr.getAttribute('x')), Number(sr.getAttribute('y')), sr.textContent)
    expect(boxesOverlap(a, b)).toBe(false)
    expect(Number(sr.getAttribute('y'))).toBeGreaterThan(845 + 2.5 + 3)    // it moved (down, clear of the shelf label)
  })

  it('computeLabelLayout returns srDy only for S/R labels that collide', () => {
    const tToX = (t) => ({ 20261012: 0, 20261013: 10, 20261016: 40 }[t] ?? null)
    const priceToY = (p) => 1000 - p * 10
    const none = computeLabelLayout({ views: [], drawn: null, tToX, priceToY, levelsSr: SR })
    expect(none.srDy).toEqual({})
    const off = computeLabelLayout({ views: [], drawn: null, tToX, priceToY })
    expect(off.srDy).toEqual({})
  })

  it('stackLabelsAround never moves a fixed box and clears every collision', () => {
    const fixed = [textBox(84, 846, 'Shelf pivot 15.70')]
    const items = [{ id: 'a', box: textBox(84, 850.5, 'Support 15.00-15.50') },
      { id: 'b', box: textBox(84, 851, 'Uptrend line (support)') }]
    const dy = stackLabelsAround(items, fixed)
    const moved = items.map(({ id, box }) => ({ ...box, y0: box.y0 + (dy[id] || 0), y1: box.y1 + (dy[id] || 0) }))
    expect(boxesOverlap(moved[0], fixed[0])).toBe(false)
    expect(boxesOverlap(moved[1], fixed[0])).toBe(false)
    expect(boxesOverlap(moved[0], moved[1])).toBe(false)
    expect(stackLabelsAround([{ id: 'c', box: textBox(84, 500, 'x') }], fixed)).toEqual({})
  })
})

describe('the one client signal', () => {
  it('levelsSrAvailable needs a structures scope AND the server key', () => {
    const member = { user: { role: 'member' }, isPaid: true, autoStructuresMembersEnabled: true }
    const admin = { user: { role: 'admin' }, autoStructuresEnabled: true }
    expect(levelsSrAvailable({ ...member, levelsSrEnabled: true })).toBe(true)
    expect(levelsSrAvailable({ ...admin, levelsSrEnabled: true })).toBe(true)
    expect(levelsSrAvailable(member)).toBe(false)
    expect(levelsSrAvailable({ ...member, levelsSrEnabled: 'true' })).toBe(false)
    expect(levelsSrAvailable({ ...member, autoStructuresMembersEnabled: false, levelsSrEnabled: true })).toBe(false)
    expect(levelsSrAvailable({ ...member, isPaid: false, levelsSrEnabled: true })).toBe(false)
    expect(levelsSrAvailable(null)).toBe(false)
  })
})
