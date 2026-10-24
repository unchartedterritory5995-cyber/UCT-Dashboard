// Setup drawings (`setup_draws`: remount / undercut & rally / donchian lines, AUTO_STRUCTURES_G4_SETUPS_ENABLED):
// the UCT Intelligence "Setups" toggle exists only while the server sends the key (hidden, never a dead switch),
// and the overlay draws the lines only while that toggle is on -- with Auto patterns off too. Asserted by what
// RENDERS. Synthetic prices.
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import PatternOverlay from './PatternOverlay'
import UctIntelligencePanel from './UctIntelligencePanel'
import { layerAvailability, effectiveLayers, readUctIntelligence } from './uctIntelligence'

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

const row = (pid, level, n) => ({
  id: `${pid}:SYN:20261012:20261016`, pattern_id: pid, pattern_name: pid, direction: 'bullish',
  display_tier: 'trusted', category: 'setup', status: 'forming', levels: { entry: level }, confidence: null,
  geometry: {
    shape: 'horizontal_line',
    anchors: Array.from({ length: n }, (_, i) => ({ t: 20261012 + i, price: i < 2 ? level : level - 1 })),
    extras: { draw_round: 3, draw_setup: { shape: pid.slice(5), level, draw_round: 3 } },
  },
})
const REMOUNT = row('draw:remount', 20.5, 5)
const DONCH = row('draw:donchian_breakout', 22.0, 2)

describe('the overlay draws the setup lines only behind the Setups toggle', () => {
  it('toggle on: one full-width line per row AT its level, solid for 5 anchors and dashed for 2', () => {
    const { container } = draw({ setupDraws: [REMOUNT, DONCH], showSetupDraws: true })
    const groups = container.querySelectorAll('[data-setup-draw]')
    expect([...groups].map((g) => g.getAttribute('data-setup-draw'))).toEqual(['draw:remount', 'draw:donchian_breakout'])
    const rm = container.querySelector('[data-setup-draw="draw:remount"] line')
    expect(Number(rm.getAttribute('y1'))).toBe(1000 - 20.5 * 10)
    expect(Number(rm.getAttribute('y2'))).toBe(1000 - 20.5 * 10)
    expect(rm.getAttribute('stroke-dasharray')).toBe('none')
    const dc = container.querySelector('[data-setup-draw="draw:donchian_breakout"] line')
    expect(Number(dc.getAttribute('y1'))).toBe(1000 - 22.0 * 10)
    expect(dc.getAttribute('stroke-dasharray')).toBe('6,4')
  })

  it('toggle off (the default): nothing draws, even with rows present', () => {
    const { container } = draw({ setupDraws: [REMOUNT] })
    expect(container.querySelectorAll('[data-setup-draw]').length).toBe(0)
    const { container: c2 } = draw({ setupDraws: [REMOUNT], showSetupDraws: false })
    expect(c2.querySelectorAll('[data-setup-draw]').length).toBe(0)
  })

  it('no rows, or a malformed row: nothing draws', () => {
    expect(draw({ setupDraws: [], showSetupDraws: true }).container.querySelectorAll('[data-setup-draw]').length).toBe(0)
    const bad = { ...REMOUNT, geometry: { shape: 'rectangle', anchors: [] } }
    expect(draw({ setupDraws: [bad], showSetupDraws: true }).container.querySelectorAll('[data-setup-draw]').length).toBe(0)
  })

  it('a pending-acquisition chart shows its notice and no setup line', () => {
    const { container } = draw({ setupDraws: [REMOUNT], showSetupDraws: true, showDealStatus: true,
      dealStatus: { pending: true, label: 'Pending acquisition' } })
    expect(container.querySelectorAll('[data-setup-draw]').length).toBe(0)
    expect(screen.getByTestId('pattern-deal-status')).toBeTruthy()
  })
})

// The round-2 setup shapes: each row draws with the pattern layer's own renderer.
const shaped = (pid, shape, anchors, extras = {}) => ({
  id: `${pid}:SYN:20261012:20261016`, pattern_id: pid, pattern_name: pid, direction: 'bullish',
  display_tier: 'trusted', category: 'setup', status: 'forming', confidence: null,
  geometry: { shape, anchors, extras: { draw_round: 1, ...extras } },
})
const A = (i, price) => ({ t: DAILY[i], price })
const CHANNEL = shaped('draw:channel', 'trendline_pair', [A(0, 30), A(4, 32), A(0, 20), A(4, 22)],
  { line_spaces: ['log', 'log'] })
const PENNANT = shaped('draw:pennant', 'trendline_pair', [A(1, 40), A(4, 37), A(2, 33), A(4, 35)],
  { line_spaces: ['log', 'log'], draw_pole: [A(0, 25), A(1, 40)] })
const DARVAS = shaped('draw:darvas-box', 'rectangle', [A(1, 50), A(4, 46)])
const DIVERGENCE = shaped('draw:rsi-bullish-divergence', 'neckline', [A(1, 18), A(3, 17)])

describe('the round-2 setup shapes draw with the pattern renderers', () => {
  it('a channel draws two lines and a lane, no pole', () => {
    const { container } = draw({ setupDraws: [CHANNEL], showSetupDraws: true })
    const g = container.querySelector('[data-setup-draw="draw:channel"]')
    expect(g).toBeTruthy()
    expect(g.querySelector('[data-role="upper"]')).toBeTruthy()
    expect(g.querySelector('[data-role="lower"]')).toBeTruthy()
    expect(g.querySelector('[data-role="pole"]')).toBeNull()
  })

  it('a pennant draws its two lines AND its pole', () => {
    const { container } = draw({ setupDraws: [PENNANT], showSetupDraws: true })
    const g = container.querySelector('[data-setup-draw="draw:pennant"]')
    expect(g.querySelector('[data-role="upper"]')).toBeTruthy()
    const pole = g.querySelector('[data-role="pole"]')
    expect(pole).toBeTruthy()
    expect(Number(pole.getAttribute('y1'))).toBe(1000 - 25 * 10)
    expect(Number(pole.getAttribute('y2'))).toBe(1000 - 40 * 10)
  })

  it('a Darvas box draws one rectangle spanning its two corners', () => {
    const { container } = draw({ setupDraws: [DARVAS], showSetupDraws: true })
    const rect = container.querySelector('[data-setup-draw="draw:darvas-box"] rect')
    expect(rect).toBeTruthy()
    expect(Number(rect.getAttribute('y'))).toBe(1000 - 50 * 10)
    expect(Number(rect.getAttribute('height'))).toBe(40)
  })

  it('a 2-anchor neckline draws the divergence segment with its two dots', () => {
    const { container } = draw({ setupDraws: [DIVERGENCE], showSetupDraws: true })
    const g = container.querySelector('[data-setup-draw="draw:rsi-bullish-divergence"]')
    expect(g.querySelector('[data-role="divergence"]')).toBeTruthy()
    expect(g.querySelectorAll('circle').length).toBe(2)
  })

  it('an unknown shape in the setup layer is dropped, never guessed at', () => {
    const odd = shaped('draw:odd', 'cup_curve', [A(0, 10), A(2, 8), A(4, 10)])
    const { container } = draw({ setupDraws: [odd, CHANNEL], showSetupDraws: true })
    const ids = [...container.querySelectorAll('[data-setup-draw]')].map((g) => g.getAttribute('data-setup-draw'))
    expect(ids).toEqual(['draw:channel'])
  })
})

// The round-3 setup shapes (setup_draw_r3.py), each with the pattern layer's own renderer.
const TRENDLINE = shaped('draw:major-trendline', 'trendline_pair', [A(0, 20), A(4, 24)], { line_spaces: ['lin'] })
TRENDLINE.geometry.semantic_subtype = 'single_trendline'
const IHS = shaped('draw:inverse-head-shoulders', 'neckline', [A(0, 30), A(1, 34), A(2, 26), A(3, 34), A(4, 30)])
const BEAR_FLAG = shaped('draw:bear-flag', 'trendline_pair', [A(1, 30), A(4, 32), A(1, 26), A(4, 28)],
  { line_spaces: ['log', 'log'], draw_pole: [A(0, 40), A(1, 28)] })

describe('the round-3 setup shapes draw with the pattern renderers', () => {
  it('a major trendline draws ONE line, never a pair', () => {
    const { container } = draw({ setupDraws: [TRENDLINE], showSetupDraws: true })
    const g = container.querySelector('[data-setup-draw="draw:major-trendline"]')
    expect(g.querySelectorAll('[data-role="line"]').length).toBe(1)
    expect(g.querySelector('[data-role="upper"]')).toBeNull()
    expect(g.querySelector('[data-role="lower"]')).toBeNull()
  })

  it('the same two anchors without the single_trendline subtype draw nothing (the server withholds that row)', () => {
    const bare = { ...TRENDLINE, geometry: { ...TRENDLINE.geometry, semantic_subtype: undefined } }
    const { container } = draw({ setupDraws: [bare], showSetupDraws: true })
    const g = container.querySelector('[data-setup-draw="draw:major-trendline"]')
    expect(g.querySelector('[data-role="line"]')).toBeNull()
    expect(g.querySelector('path')).toBeNull()
  })

  it('an inverse head and shoulders draws its five-point silhouette and the neckline through its two peaks', () => {
    const { container } = draw({ setupDraws: [IHS], showSetupDraws: true })
    const g = container.querySelector('[data-setup-draw="draw:inverse-head-shoulders"]')
    expect(g.querySelector('polyline').getAttribute('points').split(' ').length).toBe(5)
    const neck = g.querySelector('line')
    expect(Number(neck.getAttribute('y1'))).toBeCloseTo(1000 - 34 * 10)
    expect(Number(neck.getAttribute('y2'))).toBeCloseTo(1000 - 34 * 10)
  })

  it('an AVWAP reclaim draws its curve labelled AVWAP, never as a moving average', () => {
    const avwap = shaped('draw:avwap-reclaim', 'horizontal_line', [A(0, 30), A(4, 28)],
      { draw_ema: { kind: 'avwap', points: [A(0, 30), A(2, 29), A(4, 28)] } })
    const { container } = draw({ setupDraws: [avwap], showSetupDraws: true })
    const g = container.querySelector('[data-setup-draw="draw:avwap-reclaim"]')
    expect(g.querySelector('polyline[data-role="ema"]').getAttribute('points').split(' ').length).toBe(3)
    expect(g.textContent).toMatch(/^AVWAP · /)
    expect(g.textContent).not.toMatch(/EMA|SMA|undefined/)
  })

  it('a bear flag draws its two lines AND its pole', () => {
    const { container } = draw({ setupDraws: [BEAR_FLAG], showSetupDraws: true })
    const g = container.querySelector('[data-setup-draw="draw:bear-flag"]')
    expect(g.querySelector('[data-role="upper"]')).toBeTruthy()
    expect(g.querySelector('[data-role="lower"]')).toBeTruthy()
    const pole = g.querySelector('[data-role="pole"]')
    expect(Number(pole.getAttribute('y1'))).toBe(1000 - 40 * 10)
    expect(Number(pole.getAttribute('y2'))).toBe(1000 - 28 * 10)
  })
})

describe('the RSI(14) panel under a divergence row', () => {
  const PANEL = {
    kind: 'rsi14', guides: [70, 30],
    points: DAILY.map((t, i) => ({ t, value: [25, 22, 30, 28, 35][i] })),
    p1: { t: DAILY[1], value: 22 }, p2: { t: DAILY[3], value: 28 },
  }
  const WITH_PANEL = { ...DIVERGENCE, geometry: { ...DIVERGENCE.geometry,
    extras: { ...DIVERGENCE.geometry.extras, draw_panel: PANEL } } }

  it('row + toggle on: the strip draws its guides, the RSI line, and the divergence joined with dots', () => {
    const { container } = draw({ setupDraws: [WITH_PANEL], showSetupDraws: true })
    const p = container.querySelector('[data-setup-panel="rsi14"]')
    expect(p).toBeTruthy()
    expect([...p.querySelectorAll('[data-role="rsi-guide"]')].map((g) => g.getAttribute('data-level')))
      .toEqual(['70', '30'])
    expect(p.querySelector('[data-role="rsi-line"]').getAttribute('points').split(' ').length).toBe(5)
    const seg = p.querySelector('[data-role="rsi-divergence"]')
    expect(Number(seg.getAttribute('y2'))).toBeLessThan(Number(seg.getAttribute('y1')))  // RSI higher low rises
    expect(p.querySelectorAll('circle').length).toBe(2)
    expect(p.textContent).toContain('RSI(14)')
    // the strip sits at the bottom of the pane
    const bg = p.querySelector('[data-role="rsi-panel-bg"]')
    expect(Number(bg.getAttribute('y')) + Number(bg.getAttribute('height'))).toBe(400)
  })

  it('no draw_panel on the row: the divergence line draws, the strip does not', () => {
    const { container } = draw({ setupDraws: [DIVERGENCE], showSetupDraws: true })
    expect(container.querySelector('[data-role="divergence"]')).toBeTruthy()
    expect(container.querySelector('[data-setup-panel]')).toBeNull()
  })

  it('toggle off: the strip goes away with the setup layer', () => {
    const { container, rerender } = draw({ setupDraws: [WITH_PANEL], showSetupDraws: true })
    expect(container.querySelector('[data-setup-panel="rsi14"]')).toBeTruthy()
    rerender(
      <PatternOverlay chart={makeDailyChart(DAILY)} series={series} containerRef={containerRef()}
        enabled={false} tf="D" barTimes={DAILY} detections={[]} setupDraws={[WITH_PANEL]} showSetupDraws={false} />,
    )
    expect(container.querySelector('[data-setup-panel]')).toBeNull()
  })
})

describe('the Setups toggle is gated on the payload key', () => {
  it('lights from the PRESENCE of setup_draws (even empty), and stays hidden without it', () => {
    expect(layerAvailability({ setupDraws: [] }).setups).toBe(true)
    expect(layerAvailability({ setupDraws: [REMOUNT] }).setups).toBe(true)
    expect(layerAvailability({ setupDraws: undefined }).setups).toBe(false)
    expect(layerAvailability({ setupDraws: null }).setups).toBe(false)
    expect(layerAvailability({}).setups).toBe(false)
  })

  it('the Technical tab release still lights it on its own', () => {
    expect(layerAvailability({ setupsReleased: true }).setups).toBe(true)
  })

  it('a stored ON draws only while the key is present and the indicator is added', () => {
    const cs = { uctIntelligence: { added: true, setups: true } }
    expect(effectiveLayers(cs, layerAvailability({ setupDraws: [] })).setups).toBe(true)
    expect(effectiveLayers(cs, layerAvailability({})).setups).toBe(false)
    expect(effectiveLayers({ uctIntelligence: { added: false, setups: true } },
      layerAvailability({ setupDraws: [] })).setups).toBe(false)
  })

  const panel = (props) => render(
    <UctIntelligencePanel state={readUctIntelligence({ uctIntelligence: { added: true, setups: true } })}
      onSetLayer={vi.fn()} onRemove={vi.fn()} {...props} />,
  )

  it('the panel renders no Setups toggle until the key arrives', () => {
    panel({ availability: layerAvailability({}) })
    expect(screen.queryByTestId('uct-intel-toggle-setups')).toBeNull()
  })

  it('lines only: the toggle shows, and no confirmed-setup list (not released to this viewer)', () => {
    panel({ availability: layerAvailability({ setupDraws: [REMOUNT] }), setupsList: false,
      setups: { setups: [], loading: false, error: false } })
    expect(screen.getByTestId('uct-intel-toggle-setups')).toBeTruthy()
    expect(screen.getByText('Setup lines on this chart (daily)')).toBeTruthy()
    expect(screen.queryByTestId('uct-intel-setups-empty')).toBeNull()
    expect(screen.queryByTestId('uct-intel-setups')).toBeNull()
  })
})

describe('a moving-average curve row (golden / death cross) draws as the curve', () => {
  const curve = (period, prices) => ({
    ...row('draw:golden-cross', prices[0], 2),
    id: `draw:golden-cross:SYN:20261012:20261016:${period}`,
    geometry: {
      shape: 'horizontal_line',
      anchors: [{ t: 20261012, price: prices[0] }, { t: 20261016, price: prices[2] }],
      extras: {
        draw_round: 2, draw_setup: { shape: 'golden_cross' },
        draw_ema: { kind: 'sma', period, points: [
          { t: 20261012, price: prices[0] }, { t: 20261014, price: prices[1] }, { t: 20261016, price: prices[2] }] },
      },
    },
  })

  it('each curve row draws a polyline through its points and no flat line', () => {
    const rows = [curve(50, [20, 21, 23]), curve(200, [22, 22, 22])]
    const { container } = draw({ setupDraws: rows, showSetupDraws: true })
    const groups = container.querySelectorAll('[data-setup-draw="draw:golden-cross"]')
    expect(groups.length).toBe(2)
    for (const g of groups) {
      expect(g.querySelector('polyline[data-role="ema"]')).not.toBeNull()
      expect(g.querySelector('line')).toBeNull()
    }
    const pts = groups[0].querySelector('polyline[data-role="ema"]').getAttribute('points').split(' ')
    expect(pts.length).toBe(3)
    expect(Number(pts[1].split(',')[1])).toBe(1000 - 21 * 10)
    expect(screen.getAllByText(/50 SMA/).length).toBe(1)
    expect(screen.getAllByText(/200 SMA/).length).toBe(1)
  })
})
