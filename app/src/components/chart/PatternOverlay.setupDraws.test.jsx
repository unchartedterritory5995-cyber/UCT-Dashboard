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
