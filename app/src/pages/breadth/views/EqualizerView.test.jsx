import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import EqualizerView from './EqualizerView'

const metrics = [
  { key: 'breadth_score', label: 'Health', getTier: () => 'g2', getFmt: () => '75', drillKey: null },
  { key: 'up_4pct_today', label: 'Up 4%+', getTier: () => 'g3', getFmt: () => '383', drillKey: 'up_4pct_today_list' },
]
const currentRow = { breadth_score: 75, up_4pct_today: 383 }

describe('EqualizerView', () => {
  // ⛔ THE VALUE IS READ OFF ITS OWN COLUMN, not by text. The board draws a
  // NUMBERED axis now (0 · 25 · 50 · 75 · 100 — the marks that make a column
  // height readable at all), so `getByText('75')` is ambiguous between a
  // reading and a gridline label. Scoping it to the column is the point:
  // "this metric's column shows this metric's value".
  it('renders a column per metric with its value', () => {
    render(<EqualizerView currentRow={currentRow} metrics={metrics} normalize={() => 60} onDrill={() => {}} />)
    expect(screen.getByTestId('equalizer-value-breadth_score').textContent).toBe('75')
    expect(screen.getByTestId('equalizer-value-up_4pct_today').textContent).toBe('383')
    expect(screen.getByText('Health')).toBeInTheDocument()
  })

  /**
   * 🔴 THE NAMES WERE NOT ON SCREEN. Every column was `height: 100%` with the
   * label appended AFTER the bar, so the label was pushed past the bottom of the
   * panel and clipped — a board of unlabelled colour. The name gutter is
   * reserved before the plot gets a pixel now, and the axis it is measured
   * against is drawn.
   */
  it('reserves a name for every column and numbers the axis it is read against', () => {
    const { container } = render(
      <EqualizerView currentRow={currentRow} metrics={metrics} normalize={() => 60} onDrill={() => {}} />)
    for (const m of metrics) expect(screen.getByText(m.label)).toBeInTheDocument()
    const axis = container.querySelector('[data-testid="equalizer-axis"]')
    expect([...axis.children].map(c => c.textContent)).toEqual(['0', '25', '50', '75', '100'])
  })
  it('marks the signal column with a ★', () => {
    render(<EqualizerView currentRow={currentRow} metrics={metrics} normalize={() => 60}
                          signalKey="breadth_score" onDrill={() => {}} />)
    const label = screen.getByText('Health')
    expect(label).toBeInTheDocument()
    expect(label.querySelector('svg')).toBeTruthy() // star-fill signal marker
  })
  it('clicking a drillable column calls onDrill', () => {
    const onDrill = vi.fn()
    render(<EqualizerView currentRow={currentRow} metrics={metrics} normalize={() => 60} onDrill={onDrill} />)
    fireEvent.click(screen.getByLabelText('Up 4%+ details'))
    expect(onDrill).toHaveBeenCalledWith(metrics[1])
  })
})
