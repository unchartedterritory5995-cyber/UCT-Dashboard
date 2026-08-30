import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import TimelineView from './TimelineView'

const metrics = [
  { key: 'breadth_score', label: 'Health', getTier: () => 'g2', getFmt: () => '75', drillKey: null },
  { key: 'up_4pct_today', label: 'Up 4%+', getTier: () => 'g3', getFmt: () => '383', drillKey: 'up_4pct_today_list' },
]
const recentRows = [
  { date: '2026-06-01', breadth_score: 75, up_4pct_today: 383 },
  { date: '2026-05-31', breadth_score: 70, up_4pct_today: 300 },
]

describe('TimelineView', () => {
  it('renders a labeled row per metric', () => {
    render(<TimelineView recentRows={recentRows} metrics={metrics} onDrill={() => {}} />)
    expect(screen.getByText('Health')).toBeInTheDocument()
    expect(screen.getByText('Up 4%+')).toBeInTheDocument()
  })
  it('marks the signal row with a ★', () => {
    render(<TimelineView recentRows={recentRows} metrics={metrics} signalKey="breadth_score" onDrill={() => {}} />)
    const label = screen.getByText('Health')
    expect(label).toBeInTheDocument()
    expect(label.querySelector('svg')).toBeTruthy() // star-fill signal marker
  })
  it('clicking a drillable row label calls onDrill', () => {
    const onDrill = vi.fn()
    render(<TimelineView recentRows={recentRows} metrics={metrics} onDrill={onDrill} />)
    fireEvent.click(screen.getByLabelText('Up 4%+ details'))
    expect(onDrill).toHaveBeenCalledWith(metrics[1])
  })
  it('renders nothing without rows', () => {
    const { container } = render(<TimelineView recentRows={[]} metrics={metrics} onDrill={() => {}} />)
    expect(container.firstChild).toBeNull()
  })
})

// Task 9: windowDays option
const singleMetric = [{ key: 'a', label: 'a', drillKey: null, getFmt: () => 'x', getTier: () => 'g1' }]
const manyRows = Array.from({ length: 25 }, (_, i) => ({ date: `d${i}` }))

// ⛔ COUNT THE CELLS BY THEIR OWN ID, not by "children of the first element with
// a grid-template-columns style". The view draws TWO grids on one column
// template now — the dated header and the cell body — so "the first grid" names
// whichever happens to render first rather than the thing under test.
const cells = (c) => c.querySelectorAll('[data-testid^="timeline-cell-a-"]')

describe('TimelineView windowDays', () => {
  it('renders one cell per session in the window', () => {
    const { container } = render(
      <TimelineView recentRows={manyRows} metrics={singleMetric} onDrill={() => {}}
                    signalKey={null} notableKey={null} options={{ windowDays: 20 }} />,
    )
    expect(cells(container).length).toBe(20)
  })

  /**
   * 🔴 THE DEFAULT IS THE VIEW'S WHOLE DISTINCTION FROM THE HEAT RIBBON, so it
   * is pinned here rather than left to `optionDefaults`. This view prints the
   * READING in every cell; ten columns is what makes a cell wide enough to read
   * a number off. At thirty it is a colour strip, which is the Ribbon's job —
   * and the Ribbon does it over the whole loaded window instead of thirty
   * sessions.
   */
  it('defaults to a ten-session tape, and every cell carries its reading', () => {
    const { container } = render(
      <TimelineView recentRows={manyRows} metrics={singleMetric} onDrill={() => {}}
                    signalKey={null} notableKey={null} />,
    )
    const drawn = [...cells(container)]
    expect(drawn.length).toBe(10)
    expect(drawn.every(el => el.textContent === 'x')).toBe(true)
  })

  it('dates every column — the thing a 365-session ribbon cannot do', () => {
    const { container } = render(
      <TimelineView recentRows={recentRows} metrics={metrics} onDrill={() => {}}
                    signalKey={null} notableKey={null} />,
    )
    // recentRows is newest-first; the tape reads oldest → newest.
    const header = container.querySelector('[data-testid="timeline-dates"]')
    expect([...header.children].map(c => c.textContent))
      .toEqual(['', '05-31', '06-01'])
  })
})
