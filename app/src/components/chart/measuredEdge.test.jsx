// The "Measured edge" chip (owner decision 2, 2026-10-24): shown only on a row the server badged; tooltip text is
// exactly the owner's wording; a "Method" link to the method page; never the words confidence / probability /
// likely, and no bare percentage. Asserted by what RENDERS. Synthetic prices.
import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import PatternOverlay from './PatternOverlay'
import {
  measuredEdgeOf, measuredEdgeTooltip, MEASURED_EDGE_CHIP, MEASURED_EDGE_METHOD_LABEL,
} from './measuredEdge'

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
const draw = (props = {}) => render(
  <PatternOverlay chart={makeDailyChart(DAILY)} series={series} containerRef={containerRef()}
    enabled={false} tf="D" barTimes={DAILY} detections={[]} {...props} />,
)
const EDGE = { lift_pp: 3.1, ci: [0.4, 5.9], n: 412, period: '2023-2026', holdout: true,
  method_url: '/methodology/measured-edge' }
const row = (extra = {}) => ({
  id: 'draw:remount:SYN:1:2', pattern_id: 'draw:remount', pattern_name: 'Remount', direction: 'bullish',
  display_tier: 'trusted', category: 'setup', status: 'forming', confidence: null,
  geometry: { shape: 'horizontal_line', anchors: [{ t: DAILY[0], price: 20 }, { t: DAILY[4], price: 20 }],
    extras: { draw_round: 3 } },
  ...extra,
})

const TOOLTIP = '+3.1pp hit rate vs a plain 20-day-high breakout in the same stock (n=412, 2023-2026, '
  + 'out-of-sample check passed). Hypothetical back-test, not a guarantee; results vary.'

describe('the chip text', () => {
  it('the tooltip is exactly the owner\'s wording', () => {
    expect(measuredEdgeTooltip(measuredEdgeOf(row({ measured_edge: EDGE })))).toBe(TOOLTIP)
  })

  it('malformed or missing facts serve nothing (fail closed)', () => {
    expect(measuredEdgeOf(row())).toBeNull()
    for (const bad of [{ ...EDGE, holdout: false }, { ...EDGE, lift_pp: 0 }, { ...EDGE, n: 0 },
      { ...EDGE, n: 2.5 }, { ...EDGE, period: '' }, { ...EDGE, method_url: 'https://x.test' },
      { ...EDGE, method_url: '//x.test' }]) {
      expect(measuredEdgeOf(row({ measured_edge: bad }))).toBeNull()
    }
  })

  // ⛔ The rail the decision asks for: fails if ANY badge text forecasts, or carries a bare percentage.
  it('no badge text says confidence, probability or likely, or carries a bare %', () => {
    const FORECAST = /confidence|probability|likely/i
    const BARE_PCT = /%/
    const texts = [MEASURED_EDGE_CHIP, MEASURED_EDGE_METHOD_LABEL]
    for (const lift of [0.1, 2.6, 3.1, 6.2, 12.345]) {
      for (const n of [1, 60, 412]) {
        texts.push(measuredEdgeTooltip(measuredEdgeOf(row({ measured_edge: { ...EDGE, lift_pp: lift, n } }))))
      }
    }
    for (const t of texts) {
      expect(t, t).not.toMatch(FORECAST)
      expect(t, t).not.toMatch(BARE_PCT)
    }
  })
})

describe('the overlay draws the chip only on a badged row', () => {
  it('badged: one chip on the drawing label, the exact tooltip, and a Method link to the method page', () => {
    const { container } = draw({ setupDraws: [row({ measured_edge: EDGE })], showSetupDraws: true })
    const chips = container.querySelectorAll('[data-testid="measured-edge-chip"]')
    expect(chips.length).toBe(1)
    expect(chips[0].textContent).toContain('Measured edge')
    expect(chips[0].querySelector('title').textContent).toBe(TOOLTIP)
    const link = chips[0].querySelector('[data-testid="measured-edge-method"]')
    expect(link.getAttribute('href')).toBe('/methodology/measured-edge')
    expect(link.textContent).toContain('Method')
    // the rendered chip obeys the same word rules as the strings it was built from
    expect(chips[0].textContent).not.toMatch(/confidence|probability|likely|%/i)
  })

  it('unbadged: no chip at all, and no "no edge" chip either', () => {
    const { container } = draw({ setupDraws: [row()], showSetupDraws: true })
    expect(container.querySelector('[data-setup-draw]')).not.toBeNull()
    expect(container.querySelector('[data-testid="measured-edge-chip"]')).toBeNull()
    expect(container.textContent).not.toMatch(/edge/i)
  })
})
