import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import TugView from './TugView'

const metrics = [
  { key: 'up_4pct_today', label: 'Up 4%+', getFmt: () => '383', drillKey: 'up_4pct_today_list',
    pair: { partnerKey: 'down_4pct_today', side: 'up' } },
  { key: 'down_4pct_today', label: 'Dn 4%+', getFmt: () => '208', drillKey: 'down_4pct_today_list',
    pair: { partnerKey: 'up_4pct_today', side: 'down' } },
]
const row = { up_4pct_today: 383, down_4pct_today: 208 }

describe('TugView', () => {
  it('renders one tug row per pair with both formatted values', () => {
    render(<TugView currentRow={row} metrics={metrics} normalize={() => 50} onDrill={() => {}} />)
    expect(screen.getByText('383')).toBeInTheDocument()
    expect(screen.getByText('208')).toBeInTheDocument()
  })
  it('shows a net posture summary line', () => {
    render(<TugView currentRow={row} metrics={metrics} normalize={() => 50} onDrill={() => {}} />)
    expect(screen.getByText(/BULLISH/)).toBeInTheDocument()
  })
  it('clicking a side with a drillKey calls onDrill', () => {
    const onDrill = vi.fn()
    render(<TugView currentRow={row} metrics={metrics} normalize={() => 50} onDrill={onDrill} />)
    fireEvent.click(screen.getByLabelText('Up 4%+ details'))
    expect(onDrill).toHaveBeenCalledWith(metrics[0])
  })
  it('renders unpaired metrics as single signed bars', () => {
    const m = [
      { key: 'vix', label: 'VIX', getFmt: () => '16', drillKey: null, polarity: 'bear' },
      { key: 'breadth_score', label: 'Health', getFmt: () => '75', drillKey: null, polarity: 'bull' },
    ]
    render(<TugView currentRow={{ vix: 16, breadth_score: 75 }} metrics={m} normalize={() => 70} onDrill={() => {}} />)
    expect(screen.getByText('VIX')).toBeInTheDocument()
    expect(screen.getByText('Health')).toBeInTheDocument()
    expect(screen.getByText('16')).toBeInTheDocument()
  })
})

/**
 * 🔴 THE BAR LIED TO MAKE ROOM FOR ITS OWN LABEL. Every side carried
 * `minWidth: 28` so the count printed inside it would fit, which meant a small
 * share drew several times longer than it was — on the one board whose entire
 * job is comparing two lengths. The count has its own column now and the bar is
 * pure share.
 */
describe('TugView encoding', () => {
  const pairRow = { up_4pct_today: 342, down_4pct_today: 42 }
  const draw = (opts = {}) => render(
    <TugView currentRow={pairRow} metrics={metrics} normalize={() => 50}
             onDrill={() => {}} options={opts} />)

  it('draws each side at exactly its share of the pair, with no minimum width', () => {
    const { getByTestId } = draw()
    // 342 / 384 and 42 / 384.
    expect(getByTestId('tug-bar-up_4pct_today').style.width).toBe('89.0625%')
    expect(getByTestId('tug-bar-down_4pct_today').style.width).toBe('10.9375%')
  })

  it('states the split in words beside the pair, and the scale above it', () => {
    const { getByTestId, container } = draw()
    expect(getByTestId('tug-pair-up_4pct_today').textContent).toContain('11% \u00b7 89%')
    expect(container.querySelector('[data-testid="tug-scale"]').textContent)
      .toContain('SHARE OF PAIR')
  })

  // ⛔ `mono` HAS NO GREEN. The posture line was `#34d399` / `#f87171` —
  // classic's two colours, hardcoded — so the board's one summary figure ignored
  // the palette control entirely.
  it('reads the palette for the net posture line', () => {
    const { getByTestId } = draw({ palette: 'mono' })
    const html = getByTestId('tug-posture').outerHTML.toLowerCase()
    expect(html).toContain('212, 175, 55')          // mono bull #d4af37
    expect(html).not.toContain('52, 211, 153')      // classic bull #34d399
  })
})
