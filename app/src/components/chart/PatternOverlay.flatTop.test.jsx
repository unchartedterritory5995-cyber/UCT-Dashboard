// uct_flat_top_breakout's member drawing (lab flattop_draw_v2, two blind packets passed AS DRAWN):
// ONE solid line labelled "flat top" at the base's top cluster, from the first touch on to the right
// edge, plus a hollow circle on each touch group's high -- and NOTHING else of that row: no candle
// mark, no ceiling/stop secondary levels. Asserted by what RENDERS. Synthetic prices only.
//
// Every OTHER row renders byte-for-byte as before: a mixed set of rows (confirmed and flagging bull
// flags, an unstamped flat-top fire as an admin sees it, a flat-top stamp on the wrong pattern, a
// plain level, a stale row) is pinned against a capture taken from the overlay BEFORE the drawing
// existed (__fixtures__/flatTopBaselineMarkup.json; regenerate only from that code, with
// CAPTURE_FLAT_TOP_BASELINE=1).
import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import PatternOverlay, { flatTopDrawing } from './PatternOverlay'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const BASELINE = path.join(HERE, '__fixtures__', 'flatTopBaselineMarkup.json')

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
    enabled={true} tf="D" barTimes={DAILY} detections={detections} trustedOnly={true} {...props} />,
)

const DRAW = {
  price: 50, start_t: 20261012, end_t: 20261016, label: 'flat top', variant: 'breakout',
  touches: [{ t: 20261012, price: 50.1 }, { t: 20261013, price: 49.9 }, { t: 20261015, price: 50 }],
}

function flatTop(extras = { draw_flat_top: DRAW, draw_round: 2 }, over = {}) {
  return {
    id: 'ft', pattern_id: 'uct_flat_top_breakout', pattern_name: 'UCT Flat-Top Breakout',
    direction: 'bullish', display_tier: 'trusted', display_layer: 'structures', confidence: 80,
    geometry: {
      shape: 'candle_mark',
      anchors: [{ t: 20261012, price: 50.1 }, { t: 20261016, price: 47 }],
      anchor_roles: ['ceiling', 'session_low'],
      extras,
      secondary: [
        { shape: 'horizontal_line', role: 'ceiling', label: 'Flat ceiling 50.10',
          anchors: [{ t: 20261012, price: 50.1 }, { t: 20261016, price: 50.1 }] },
        { shape: 'horizontal_line', role: 'stop', label: 'Session low 47.00',
          anchors: [{ t: 20261016, price: 47 }, { t: 20261016, price: 47 }] },
      ],
    },
    ...over,
  }
}

describe('uct_flat_top_breakout draws its "flat top" ceiling', () => {
  it('draws ONE solid line labelled "flat top" at the drawn price, from the first touch', () => {
    const { container } = draw([flatTop()])
    const lines = [...container.querySelectorAll('[data-shape="level-segment"]')]
    expect(lines).toHaveLength(1)
    expect(lines[0].getAttribute('data-role')).toBe('flat-top-line')
    expect(lines[0].textContent).toBe('flat top')
    const ln = lines[0].querySelector('line')
    expect(ln.getAttribute('stroke-dasharray')).toBeNull()
    // y = 1000 - 10 * 50; x from 2026-10-12 (0) to 2026-10-16 (40) + 40 px into the next slot
    expect([ln.getAttribute('x1'), ln.getAttribute('x2'), ln.getAttribute('y1')]).toEqual(['0', '80', '500'])
  })

  it('marks every touch with a hollow circle on its high', () => {
    const { container } = draw([flatTop()])
    const dots = [...container.querySelectorAll('[data-role="flat-top-touch"]')]
      .map((c) => [c.getAttribute('cx'), c.getAttribute('cy'), c.getAttribute('fill')])
    expect(dots).toEqual([['0', '499', 'none'], ['10', '501', 'none'], ['30', '500', 'none']])
  })

  it('draws nothing else of that row: no candle mark, no ceiling / stop secondary levels', () => {
    const { container } = draw([flatTop()])
    const g = container.querySelector('[data-detection="uct_flat_top_breakout"]')
    expect([...g.children].map((c) => c.getAttribute('data-role'))).toEqual(['flat-top'])
    expect(container.textContent).not.toContain('Flat ceiling')
    expect(container.textContent).not.toContain('Session low')
  })

  it('control: the same row WITHOUT draw_flat_top draws the detector geometry, not a flat top', () => {
    const { container } = draw([flatTop({})])
    expect(container.querySelector('[data-role="flat-top"]')).toBeNull()
    expect(container.textContent).toContain('Flat ceiling 50.10')
  })

  it('a member (trustedOnly) never draws an unstamped flat-top fire, which the server tiers experimental', () => {
    const { container } = draw([flatTop({}, { display_tier: 'experimental' })])
    expect(container.querySelector('[data-detection="uct_flat_top_breakout"]')).toBeNull()
  })
})

describe('flatTopDrawing (pure)', () => {
  it('reads a well-formed stamp', () => {
    expect(flatTopDrawing(flatTop())).toEqual({
      price: 50, start_t: 20261012, end_t: 20261016, label: 'flat top',
      touches: [{ t: 20261012, price: 50.1 }, { t: 20261013, price: 49.9 }, { t: 20261015, price: 50 }],
    })
  })

  it('is null for another detector carrying the same extras, and for malformed stamps', () => {
    expect(flatTopDrawing({ ...flatTop(), pattern_id: 'flat_base' })).toBeNull()
    for (const bad of [null, 'x', { ...DRAW, price: 'nope' }, { ...DRAW, start_t: null }, { ...DRAW, end_t: undefined }]) {
      expect(flatTopDrawing(flatTop({ draw_flat_top: bad, draw_round: 2 }))).toBeNull()
    }
  })
})

// -- every other row is unchanged --------------------------------------------------------------

const FLAG_ANCHORS = [
  { t: 20261012, price: 52 }, { t: 20261016, price: 50 },
  { t: 20261012, price: 48 }, { t: 20261016, price: 46 },
]
const POLE = [{ t: 20261012, price: 44 }, { t: 20261013, price: 52 }]

function flag(id, extras, over = {}) {
  return {
    id, pattern_id: 'bull_flag', pattern_name: 'Bull Flag', confidence: 70, direction: 'bullish',
    status: 'forming', display_tier: 'trusted', display_layer: 'structures', draw_entry: true,
    levels: { entry: 52.4 },
    geometry: { shape: 'trendline_pair', anchors: FLAG_ANCHORS, extras: { line_spaces: ['price', 'price'], ...extras } },
    ...over,
  }
}

const BASELINE_ROWS = {
  confirmedFlag: [flag('f1', { draw_round: 9, draw_lanes: true, draw_pole: POLE })],
  flaggingFlag: [flag('f2', { stale: true, stale_reason: 'short_flag', draw_lanes: false, draw_pole: POLE,
    flagging: { tier: 'flagging', draw_round: 9, draw_lanes: true } })],
  unstampedFlatTopAdmin: [flatTop({ trigger_bars_ago: 0 }, { display_tier: 'experimental' })],
  stampOnAnotherPattern: [{ ...flatTop(), id: 'fb', pattern_id: 'flat_base', pattern_name: 'Flat Base' }],
  level: [{
    id: 'lv', pattern_id: 'support_resistance', pattern_name: 'Support', confidence: 60, direction: 'neutral',
    display_tier: 'trusted', display_layer: 'structures',
    geometry: { shape: 'horizontal_line', anchors: [{ t: 20261012, price: 48 }, { t: 20261016, price: 48 }] },
  }],
  staleRow: [flatTop({ stale: true, stale_reason: 'broke_down' }, { pattern_id: 'flat_base' })],
}

describe('every other row renders exactly as before the flat-top drawing', () => {
  for (const [name, rows] of Object.entries(BASELINE_ROWS)) {
    it(`${name} renders the markup captured before the drawing existed`, () => {
      const html = draw(rows, { trustedOnly: false, showExperimental: true }).container.innerHTML
      if (process.env.CAPTURE_FLAT_TOP_BASELINE === '1') {
        const cur = fs.existsSync(BASELINE) ? JSON.parse(fs.readFileSync(BASELINE, 'utf8')) : {}
        cur[name] = html
        fs.mkdirSync(path.dirname(BASELINE), { recursive: true })
        fs.writeFileSync(BASELINE, `${JSON.stringify(cur, null, 2)}\n`)
      }
      const golden = JSON.parse(fs.readFileSync(BASELINE, 'utf8'))
      expect(golden[name]).toBeTypeOf('string')
      expect(html).toBe(golden[name])
    })
  }

  it('control: the baseline can see a drawing (a stamped flat top does NOT match the unstamped capture)', () => {
    const golden = JSON.parse(fs.readFileSync(BASELINE, 'utf8'))
    const html = draw([flatTop({ trigger_bars_ago: 0, draw_flat_top: DRAW, draw_round: 2 },
      { display_tier: 'experimental' })], { trustedOnly: false, showExperimental: true }).container.innerHTML
    expect(html).not.toBe(golden.unstampedFlatTopAdmin)
    expect(golden.confirmedFlag.length).toBeGreaterThan(200)          // something drew in the capture
    expect(golden.unstampedFlatTopAdmin).toContain('Flat ceiling 50.10')
  })
})
