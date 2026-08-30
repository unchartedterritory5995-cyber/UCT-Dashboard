import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import RingsView from './RingsView'

const metrics = [
  { key: 'breadth_score', label: 'Health', getTier: () => 'g2', getFmt: () => '75', drillKey: null },
  { key: 'up_4pct_today', label: 'Up 4%+', getTier: () => 'g3', getFmt: () => '383', drillKey: 'up_4pct_today_list' },
]
const row = { breadth_score: 75, up_4pct_today: 383 }

describe('RingsView', () => {
  it('renders a ring per metric with its formatted value + label', () => {
    render(<RingsView currentRow={row} prevRow={null} metrics={metrics}
                      normalize={() => 60} onDrill={() => {}} />)
    expect(screen.getByText('Health')).toBeInTheDocument()
    expect(screen.getByText('75')).toBeInTheDocument()
    expect(screen.getByText('Up 4%+')).toBeInTheDocument()
  })
  it('clicking a ring with a drillKey calls onDrill with the metric', () => {
    const onDrill = vi.fn()
    render(<RingsView currentRow={row} prevRow={null} metrics={metrics}
                      normalize={() => 60} onDrill={onDrill} />)
    fireEvent.click(screen.getByLabelText('Up 4%+ details'))
    expect(onDrill).toHaveBeenCalledWith(metrics[1])
  })
})

/**
 * 🔴 THE ARC WAS UNDECODABLE. It is `normalize` — a rank on the board-wide 0–100
 * scale — while the number inside it is the raw reading, so "342" in a nearly
 * full ring read as though 342 were a percentage of something. Both halves of
 * the fix are asserted: the rank is PRINTED, and the basis line says what the
 * arc measures.
 */
describe('RingsView says what its arc means', () => {
  it('prints the rank the arc encodes, beside the reading it does not', () => {
    const { getByTestId, getByText } = render(
      <RingsView currentRow={row} rows={[{}, {}, {}]} metrics={metrics}
                 normalize={() => 62} onDrill={() => {}} />)
    expect(getByTestId('rings-rank-up_4pct_today').textContent).toBe('62/100')
    expect(getByText('383')).toBeInTheDocument()   // …and the reading is still the reading
  })

  it('states the scale in its basis line, with the window it ranked against', () => {
    const { getByTestId } = render(
      <RingsView currentRow={row} rows={Array.from({ length: 90 }, () => ({}))}
                 metrics={metrics} normalize={() => 62} onDrill={() => {}} />)
    const basis = getByTestId('rings-basis').textContent
    expect(basis).toContain('90 sessions')
    expect(basis).toMatch(/rank 0.100/i)
  })

  it('draws no rank when the metric cannot be ranked, rather than an implied zero', () => {
    const { container } = render(
      <RingsView currentRow={row} rows={[]} metrics={metrics}
                 normalize={() => null} onDrill={() => {}} />)
    expect(container.querySelector('[data-testid^="rings-rank-"]')).toBeNull()
  })
})
