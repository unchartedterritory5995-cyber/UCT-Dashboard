import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('echarts-for-react', () => ({ default: () => <div data-testid="echart" /> }))

import BreadthViews from './BreadthViews'

const rows = [
  { date: '2026-06-01', breadth_score: 75, up_4pct_today: 383, down_4pct_today: 208, vix: 16, pct_above_50sma: 57.8 },
  { date: '2026-05-31', breadth_score: 70, up_4pct_today: 300, down_4pct_today: 250, vix: 17, pct_above_50sma: 55 },
]

// Deep enough for a lens: the Regime Clock needs `rocWindow + 1` = 21 sessions
// before it will measure momentum at all.
const deepRows = Array.from({ length: 30 }, (_, i) => ({
  date: `2026-05-${String(30 - i).padStart(2, '0')}`,
  breadth_score: 75 - i, up_4pct_today: 383 - i, down_4pct_today: 208 + i,
  vix: 16 + (i % 4), pct_above_50sma: 70 - i,
}))

beforeEach(() => localStorage.clear())

describe('BreadthViews', () => {
  it('defaults to the treemap view', () => {
    render(<BreadthViews rows={rows} onDrill={() => {}} />)
    expect(screen.getByTestId('echart')).toBeInTheDocument()
  })
  it('switching to Rings swaps the rendered view', () => {
    render(<BreadthViews rows={rows} onDrill={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Rings' }))
    expect(screen.queryByTestId('echart')).not.toBeInTheDocument()
    expect(screen.getAllByText('Health').length).toBeGreaterThan(0)
  })

  // 🔴 NO TEST HERE EVER SELECTED A LENS, so the lens branch of the props
  // bundle — a different contract from the board one — was never exercised
  // through the real container. `viewRegistry.test.jsx` renders lenses, but
  // against its OWN copy of the bundle; only this file proves the wire.
  it('switching to a LENS renders the lens through the real container', () => {
    render(<BreadthViews rows={deepRows} onDrill={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Regime Clock' }))
    expect(screen.queryByTestId('echart')).not.toBeInTheDocument()
    expect(screen.getByTestId('regime-name')).toBeInTheDocument()
    // It read the window, not just today's row: momentum needs 21 sessions and
    // the refusal would have rendered instead had the bundle handed it fewer.
    expect(screen.queryByTestId('clock-insufficient')).not.toBeInTheDocument()
    expect(screen.getByTestId('regime-momentum').textContent).toMatch(/^[+-]/)
  })

  it('a lens whose window is too short renders its stated refusal, not a chart', () => {
    render(<BreadthViews rows={rows} onDrill={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Regime Clock' }))
    expect(screen.getByTestId('clock-insufficient').textContent).toMatch(/needs 21 sessions/i)
  })
})
