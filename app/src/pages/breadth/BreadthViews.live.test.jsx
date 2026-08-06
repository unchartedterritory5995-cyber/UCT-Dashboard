/**
 * The Views tab reads the same `rows` array the Monitor does, so the live row
 * arrives here for free — which is exactly why it needs its own tests. Two
 * things must hold that nothing else enforces:
 *
 *   1. the date cursor must not present a provisional reading as a finished day
 *   2. drill-down must be off, because the per-metric stock lists are built
 *      with the row at 4:15 and a click would 404
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import BreadthViews from './BreadthViews'

// The view styles themselves are covered by their own suites; here we only care
// about the container's live handling, so render the simplest one.
vi.mock('./useBreadthViews', () => ({
  default: () => ({
    viewStyle: 'meters',
    setViewStyle: vi.fn(),
    visibleKeys: new Set(['pct_above_50sma', 'up_4pct_today']),
    eligibleMetrics: () => [],
    options: {},
    presetNames: ['Default'],
    activePreset: 'Default',
    switchPreset: vi.fn(),
    isDefaultActive: true,
    savePreset: vi.fn(),
    deletePreset: vi.fn(),
    setVisibleKeys: vi.fn(),
    setOptions: vi.fn(),
    resetPreset: vi.fn(),
  }),
}))

function makeRows() {
  const stored = {
    date: '2026-08-04', pct_above_50sma: 66.3, up_4pct_today: 573,
    universe_count: 2720, breadth_score: 71.2,
  }
  const liveRow = {
    date: '2026-08-05', pct_above_50sma: 65.3, up_4pct_today: 163,
    universe_count: 2701, breadth_score: 89.4, _live: true,
  }
  return [liveRow, stored]   // newest-first, as the API serves it
}

describe('BreadthViews with a provisional row', () => {
  it('shows a clock, not a date, while the cursor sits on the live row', () => {
    render(<BreadthViews rows={makeRows()} onDrill={vi.fn()} liveStamp="1:44 PM" />)
    expect(screen.getByText(/LIVE · 1:44 PM/)).toBeInTheDocument()
    expect(screen.queryByText('2026-08-05')).not.toBeInTheDocument()
  })

  it('shows the plain date once the cursor moves to a settled day', async () => {
    render(<BreadthViews rows={makeRows()} onDrill={vi.fn()} liveStamp="1:44 PM" />)
    await userEvent.click(screen.getByLabelText('Previous day'))
    expect(screen.getByText('2026-08-04')).toBeInTheDocument()
    expect(screen.queryByText(/LIVE ·/)).not.toBeInTheDocument()
  })

  it('offers no drillable tile on the live row, and fires nothing if clicked', async () => {
    // Every view derives clickability from `metric.drillKey` alone, so the
    // container strips it rather than each view learning about liveness. That
    // means the tile stops ADVERTISING a click (no button role, no "details"
    // label) — a disabled-looking tile that still fires would be worse than one
    // that never offered.
    const onDrill = vi.fn()
    const { container } = render(
      <BreadthViews rows={makeRows()} onDrill={onDrill} liveStamp="1:44 PM" />)

    const drillable = screen.queryAllByRole('button')
      .filter(b => /details$/.test(b.getAttribute('aria-label') ?? ''))
    expect(drillable).toHaveLength(0)

    for (const tile of container.querySelectorAll('[class*="meter"], [class*="tile"]')) {
      await userEvent.click(tile)
    }
    expect(onDrill).not.toHaveBeenCalled()
  })

  it('restores drill-down on a settled day', async () => {
    const onDrill = vi.fn()
    render(<BreadthViews rows={makeRows()} onDrill={onDrill} liveStamp="1:44 PM" />)
    await userEvent.click(screen.getByLabelText('Previous day'))
    const tile = screen.queryAllByRole('button')
      .find(b => /details$/.test(b.getAttribute('aria-label') ?? ''))
    expect(tile, 'a settled day should offer at least one drillable tile').toBeTruthy()
    await userEvent.click(tile)
    expect(onDrill).toHaveBeenCalledWith('2026-08-04', expect.objectContaining({
      drillKey: expect.any(String),
    }))
  })

  it('renders unchanged when there is no live row at all', () => {
    const rows = makeRows().slice(1)
    render(<BreadthViews rows={rows} onDrill={vi.fn()} />)
    expect(screen.getByText('2026-08-04')).toBeInTheDocument()
    expect(screen.queryByText(/LIVE ·/)).not.toBeInTheDocument()
  })
})
