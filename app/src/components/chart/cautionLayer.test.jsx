// The CAUTION layer, client half (owner decision 7, 2026-10-24): bearish setup rows (server-marked
// `direction: "bearish"`) are an opt-in "Caution" sub-toggle, OFF by default. Off: not drawn, not listed. On: drawn
// amber with exit wording, listed under the toggle. Never "short", never a sell instruction, never a badge. Bullish
// setups are unchanged. Asserted by what RENDERS. Synthetic prices.
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import PatternOverlay from './PatternOverlay'
import UctIntelligencePanel, { chartSetupRows } from './UctIntelligencePanel'
import {
  readUctIntelligence, effectiveLayers, layerAvailability, sanitizeUctIntelligence, setUctIntelligenceLayer,
} from './uctIntelligence'
import { CAUTION_LABELS, cautionLabel, cautionListRows, visibleSetupDraws } from './cautionLayer'
import { PATTERN_COLORS } from './patternShapes/style'

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
const A = (i, price) => ({ t: DAILY[i], price })
const shaped = (pid, name, direction, shape, anchors, extras = {}) => ({
  id: `${pid}:SYN:20261012:20261016`, pattern_id: pid, pattern_name: name, direction,
  display_tier: 'trusted', category: 'setup', status: 'forming', confidence: null,
  geometry: { shape, anchors, extras: { draw_round: 2, ...extras } },
})
const DOUBLE_TOP = shaped('draw:double-top', 'Double top', 'bearish', 'neckline',
  [A(0, 30), A(1, 26), A(2, 30.2), A(3, 26.1), A(4, 29.9)])
const WEDGE = shaped('draw:falling-wedge', 'Falling wedge', 'bullish', 'trendline_pair',
  [A(0, 40), A(4, 36), A(0, 30), A(4, 33)], { line_spaces: ['log', 'log'] })
const curve = (period, prices) => ({ points: prices.map((p, i) => ({ t: DAILY[i], price: p })) })
const DEATH = [
  shaped('draw:death-cross', 'Death cross', 'bearish', 'horizontal_line', [A(0, 50), A(4, 47)],
    { draw_ema: { kind: 'sma', period: 50, ...curve(50, [50, 49, 48, 47.5, 47]) } }),
  shaped('draw:death-cross', 'Death cross', 'bearish', 'horizontal_line', [A(0, 49), A(4, 48)],
    { draw_ema: { kind: 'sma', period: 200, ...curve(200, [49, 48.8, 48.5, 48.2, 48]) } }),
].map((r, i) => ({ ...r, id: `${r.id}:${i}` }))

const drawnIds = (c) => [...c.querySelectorAll('[data-setup-draw]')].map((g) => g.getAttribute('data-setup-draw'))

describe('the Caution sub-toggle is OFF by default and persisted in cs.uctIntelligence', () => {
  it('never set: off; stored true: on; the sanitiser keeps it', () => {
    expect(readUctIntelligence({}).caution).toBe(false)
    expect(readUctIntelligence({ uctIntelligence: { added: true } }).caution).toBe(false)
    expect(readUctIntelligence({ uctIntelligence: { caution: true } }).caution).toBe(true)
    expect(sanitizeUctIntelligence({ caution: true, junk: 1 })).toEqual({ caution: true })
    const next = setUctIntelligenceLayer({ uctIntelligence: { added: true } }, 'caution', true)
    expect(next.uctIntelligence).toEqual({ added: true, caution: true })
  })

  it('exists only while the payload carries setup_draws, and acts only when added and on', () => {
    expect(layerAvailability({}).caution).toBe(false)
    expect(layerAvailability({ setupDraws: [] }).caution).toBe(true)
    const a = layerAvailability({ setupDraws: [] })
    expect(effectiveLayers({ uctIntelligence: { added: true } }, a).caution).toBe(false)
    expect(effectiveLayers({ uctIntelligence: { added: true, caution: true } }, a).caution).toBe(true)
    expect(effectiveLayers({ uctIntelligence: { added: true, caution: true } }, layerAvailability({})).caution).toBe(false)
  })
})

describe('the overlay draws bearish rows only behind Caution, amber, with exit wording', () => {
  it('Setups on, Caution off (the default): the bullish row draws, the bearish row does not', () => {
    const { container } = draw({ setupDraws: [DOUBLE_TOP, WEDGE], showSetupDraws: true })
    expect(drawnIds(container)).toEqual(['draw:falling-wedge'])
    expect(container.textContent).not.toMatch(/double top/i)
  })

  it('Caution on: the double top draws amber with its exit label; bullish rows are unchanged', () => {
    const { container } = draw({ setupDraws: [DOUBLE_TOP, WEDGE], showSetupDraws: true, showCautionDraws: true })
    expect(drawnIds(container)).toEqual(['draw:double-top', 'draw:falling-wedge'])
    const dt = container.querySelector('[data-setup-draw="draw:double-top"]')
    expect(dt.getAttribute('data-caution')).toBe('true')
    expect(dt.innerHTML).toContain(PATTERN_COLORS.caution)
    expect(dt.innerHTML).not.toContain(PATTERN_COLORS.bearish)
    expect(dt.textContent).toContain('Possible double top: watch the 2nd-peak low if you hold')
    const wedge = container.querySelector('[data-setup-draw="draw:falling-wedge"]')
    expect(wedge.getAttribute('data-caution')).toBeNull()
    expect(wedge.innerHTML).toContain(PATTERN_COLORS.bullish)
  })

  it('Caution on, Setups off: only the caution rows draw', () => {
    const { container } = draw({ setupDraws: [DOUBLE_TOP, WEDGE], showCautionDraws: true })
    expect(drawnIds(container)).toEqual(['draw:double-top'])
  })

  it('the death cross draws as a moving-average state, never as a pattern name', () => {
    const { container } = draw({ setupDraws: DEATH, showCautionDraws: true })
    expect(drawnIds(container)).toEqual(['draw:death-cross', 'draw:death-cross'])
    expect(container.textContent).toContain('50-day below 200-day')
    expect(container.textContent).not.toMatch(/death cross/i)
  })

  it('a caution row is never badged, even if a measured_edge rides on it', () => {
    const badged = { ...DOUBLE_TOP, measured_edge: { lift_pp: 3.1, ci: [1, 5], n: 99, period: '2023-2026',
      holdout: true, method_url: '/methodology/measured-edge' } }
    const { container } = draw({ setupDraws: [badged], showCautionDraws: true })
    expect(drawnIds(container)).toEqual(['draw:double-top'])
    expect(container.querySelector('[data-testid="measured-edge-chip"]')).toBeNull()
  })
})

describe('the panel: a Caution toggle, off by default, that lists bearish rows only when on', () => {
  const base = readUctIntelligence({ uctIntelligence: { added: true } })
  const avail = layerAvailability({ setupDraws: [DOUBLE_TOP] })

  it('the toggle exists only while setup_draws is served', () => {
    render(<UctIntelligencePanel state={base} availability={layerAvailability({})} onSetLayer={() => {}} />)
    expect(screen.queryByTestId('uct-intel-toggle-caution')).toBeNull()
  })

  it('off by default: unchecked, nothing listed; checking it writes caution=true', () => {
    const onSetLayer = vi.fn()
    render(<UctIntelligencePanel state={base} availability={avail} onSetLayer={onSetLayer}
      setupDraws={[DOUBLE_TOP, WEDGE]} />)
    const box = screen.getByTestId('uct-intel-toggle-caution').querySelector('input')
    expect(box.checked).toBe(false)
    expect(screen.queryByTestId('uct-intel-caution')).toBeNull()
    expect(screen.queryByText(/double top/i)).toBeNull()
    fireEvent.click(box)
    expect(onSetLayer).toHaveBeenCalledWith('caution', true)
  })

  it('on: lists each bearish setup once, in exit wording, and no bullish row', () => {
    render(<UctIntelligencePanel state={{ ...base, caution: true }} availability={avail} onSetLayer={() => {}}
      setupDraws={[DOUBLE_TOP, WEDGE, ...DEATH]} />)
    const rows = screen.getAllByTestId('uct-intel-caution-row').map((li) => li.textContent)
    expect(rows).toEqual(['Possible double top: watch the 2nd-peak low if you hold', '50-day below 200-day'])
  })

  it('a bearish verdict or tag is never in the Setups list', () => {
    const data = { verdicts: [{ setup: 'uct_flag_htf', direction: 'bullish' }, { setup: 'x_top', direction: 'bearish' }],
      setup_tags: [{ setup: 'uct_hve', direction: 'bearish' }, { setup: 'nr7' }] }
    expect(chartSetupRows(data).map((r) => r.setup)).toEqual(['uct_flag_htf', 'nr7'])
  })
})

describe('caution wording is exit framing only', () => {
  const FORBIDDEN = /\b(short|shorts|shorting|sell|selling|sold)\b/i

  it('no label says short or sell, and each names what to watch if you hold', () => {
    const labels = [...Object.values(CAUTION_LABELS), cautionLabel({ pattern_id: 'draw:new', pattern_name: 'Rising wedge' })]
    for (const l of labels) expect(l, l).not.toMatch(FORBIDDEN)
    for (const [pid, l] of Object.entries(CAUTION_LABELS)) {
      if (pid === 'draw:death-cross') expect(l).toBe('50-day below 200-day')
      else expect(l, l).toMatch(/if you hold$/)
    }
  })

  it('covers the four bearish member setups the decision names', () => {
    for (const pid of ['draw:wyckoff-upthrust', 'draw:double-top', 'draw:death-cross', 'draw:bear-flag']) {
      expect(CAUTION_LABELS[pid], pid).toBeTruthy()
    }
  })

  it('visibleSetupDraws and cautionListRows agree on which rows are caution rows', () => {
    const rows = [DOUBLE_TOP, WEDGE, ...DEATH]
    expect(visibleSetupDraws(rows, { caution: true }).map((r) => r.pattern_id))
      .toEqual(['draw:double-top', 'draw:death-cross', 'draw:death-cross'])
    expect(visibleSetupDraws(rows, { setups: true }).map((r) => r.pattern_id)).toEqual(['draw:falling-wedge'])
    expect(cautionListRows(rows).map((r) => r.pattern_id)).toEqual(['draw:double-top', 'draw:death-cross'])
  })
})
