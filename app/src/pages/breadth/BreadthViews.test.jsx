import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('echarts-for-react', () => ({ default: () => <div data-testid="echart" /> }))

import BreadthViews from './BreadthViews'

const rows = [
  { date: '2026-06-01', breadth_score: 75, up_4pct_today: 383, down_4pct_today: 208, vix: 16, pct_above_50sma: 57.8 },
  { date: '2026-05-31', breadth_score: 70, up_4pct_today: 300, down_4pct_today: 250, vix: 17, pct_above_50sma: 55 },
]

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
    expect(screen.getByText('Health')).toBeInTheDocument()
  })
})
