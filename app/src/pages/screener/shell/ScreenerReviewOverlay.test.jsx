import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'

// StockChart is heavy (canvas / lightweight-charts) — stand it in with a probe
// that just echoes the symbol, so we test the flip logic, not the chart.
vi.mock('../../../components/StockChart', () => ({
  default: ({ sym }) => <div data-testid="rev-chart">{sym}</div>,
}))
// Sheet is a portal/focus-trap; render its children inline while open.
vi.mock('../../../components/mobile/Sheet', () => ({
  default: ({ open, children }) => (open ? <div role="dialog">{children}</div> : null),
}))
import ScreenerReviewOverlay from './ScreenerReviewOverlay'

const SYMS = ['AAA', 'BBB', 'CCC']

describe('ScreenerReviewOverlay', () => {
  it('renders the first symbol and the position', () => {
    render(<ScreenerReviewOverlay symbols={SYMS} open onClose={() => {}} />)
    expect(screen.getByTestId('rev-chart')).toHaveTextContent('AAA')
    expect(screen.getByText('1 / 3')).toBeInTheDocument()
  })

  it('advances with Space / ArrowDown and goes back with ArrowUp, clamped at the ends', () => {
    render(<ScreenerReviewOverlay symbols={SYMS} open onClose={() => {}} />)
    fireEvent.keyDown(window, { key: 'ArrowDown' })
    expect(screen.getByTestId('rev-chart')).toHaveTextContent('BBB')
    fireEvent.keyDown(window, { key: ' ' })
    expect(screen.getByTestId('rev-chart')).toHaveTextContent('CCC')
    fireEvent.keyDown(window, { key: 'ArrowDown' }) // already last — clamps
    expect(screen.getByTestId('rev-chart')).toHaveTextContent('CCC')
    fireEvent.keyDown(window, { key: 'ArrowUp' })
    expect(screen.getByTestId('rev-chart')).toHaveTextContent('BBB')
  })

  it('the Next button advances too', () => {
    render(<ScreenerReviewOverlay symbols={SYMS} open onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Next chart' }))
    expect(screen.getByTestId('rev-chart')).toHaveTextContent('BBB')
  })

  it('ignores keys while typing in a field', () => {
    render(<div><input data-testid="f" /><ScreenerReviewOverlay symbols={SYMS} open onClose={() => {}} /></div>)
    const inp = screen.getByTestId('f'); inp.focus()
    fireEvent.keyDown(inp, { key: 'ArrowDown' })
    expect(screen.getByTestId('rev-chart')).toHaveTextContent('AAA')
  })

  it('renders nothing when closed or empty', () => {
    const a = render(<ScreenerReviewOverlay symbols={SYMS} open={false} onClose={() => {}} />)
    expect(a.container).toBeEmptyDOMElement()
    const b = render(<ScreenerReviewOverlay symbols={[]} open onClose={() => {}} />)
    expect(b.container).toBeEmptyDOMElement()
  })
})
