/**
 * The Views tab reads the same `rows` array the Monitor does, so the live row
 * arrives here for free — which is exactly why it needs its own tests. Two
 * things must hold that nothing else enforces:
 *
 *   1. the date cursor must not present a provisional reading as a finished day
 *   2. drill-down must route per metric — live for what was measured live, the
 *      carried session for what wasn't, and nothing at all when a carried
 *      metric has no session to attribute its names to
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
    // Compare mode (Wave B) — the container reads these on every render.
    // `visibleKeysFor`/`optionsFor` are the per-STYLE resolvers that replaced
    // the active-style-only `visibleKeys`/`options` memos; this stub only ever
    // renders one style, so it answers the same set for any of them.
    layout: 'single', compareQuad: [], setLayout: vi.fn(), setComparePane: vi.fn(),
    visibleKeysFor: () => new Set(['pct_above_50sma', 'up_4pct_today']),
    optionsFor: () => ({}),
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

// What useLiveBreadth hands down: which metrics are carried, and from when.
const LIVE_META = { carried: new Set(['atr_ext_7', 'naaim']), carriedFrom: '2026-08-04' }

/**
 * ⚠️ THESE THREE ASSERTIONS READ THE CURSOR READOUT BY TEST ID, NOT BY TEXT.
 *
 * They used to say `getByText('2026-08-04')`, which quietly assumed the date
 * appeared EXACTLY once on the page. The scrubber (2026-08-29) states the
 * session it sits on beside its slider, which is a second legitimate display of
 * the same value — so a text query now matches two elements and the failure
 * reads as a broken component rather than "a new control also shows the date".
 * The invariant these tests exist for is unchanged and, if anything, tightened:
 * a provisional reading must never be presented as a finished day. The scrubber
 * is checked for the same thing.
 */
describe('BreadthViews with a provisional row', () => {
  it('shows a clock, not a date, while the cursor sits on the live row', () => {
    render(<BreadthViews rows={makeRows()} onDrill={vi.fn()} liveStamp="1:44 PM" />)
    expect(screen.getByTestId('cursor-live').textContent).toMatch(/LIVE · 1:44 PM/)
    expect(screen.queryByTestId('cursor-date')).not.toBeInTheDocument()
    // …and the one other place the session is named marks it provisional too.
    expect(screen.getByTestId('scrubber-date').textContent).toBe('2026-08-05 · live')
  })

  it('shows the plain date once the cursor moves to a settled day', async () => {
    render(<BreadthViews rows={makeRows()} onDrill={vi.fn()} liveStamp="1:44 PM" />)
    await userEvent.click(screen.getByLabelText('Previous day'))
    expect(screen.getByTestId('cursor-date').textContent).toBe('2026-08-04')
    expect(screen.queryByTestId('cursor-live')).not.toBeInTheDocument()
    expect(screen.getByTestId('scrubber-date').textContent).toBe('2026-08-04')
  })

  it('offers a live-measured tile on the live row and drills it', async () => {
    const onDrill = vi.fn()
    render(<BreadthViews rows={makeRows()} onDrill={onDrill} live={LIVE_META}
                         liveStamp="1:44 PM" />)
    const tile = screen.queryAllByRole('button')
      .find(b => /details$/.test(b.getAttribute('aria-label') ?? ''))
    expect(tile, 'up_4pct_today is measured live and should offer a click').toBeTruthy()
    await userEvent.click(tile)
    expect(onDrill).toHaveBeenCalledWith(
      expect.objectContaining({ _live: true }),
      expect.objectContaining({ drillKey: expect.any(String) }),
      LIVE_META,
    )
  })

  // Every view derives clickability from `metric.drillKey` alone, so the
  // container strips it rather than each view learning about liveness. A tile
  // that looks disabled but still fires would be worse than one that never
  // offered — so a carried metric with no session behind it must do neither.
  it('offers nothing for a carried metric with no session to attribute it to', async () => {
    const onDrill = vi.fn()
    const carriedEverything = { carried: new Set(['pct_above_50sma', 'up_4pct_today']),
                                carriedFrom: null }
    const { container } = render(
      <BreadthViews rows={makeRows()} onDrill={onDrill} live={carriedEverything}
                    liveStamp="1:44 PM" />)

    const drillable = screen.queryAllByRole('button')
      .filter(b => /details$/.test(b.getAttribute('aria-label') ?? ''))
    expect(drillable).toHaveLength(0)

    for (const tile of container.querySelectorAll('[class*="meter"], [class*="tile"]')) {
      await userEvent.click(tile)
    }
    expect(onDrill).not.toHaveBeenCalled()
  })

  it('drills a settled day by its own row, unchanged', async () => {
    const onDrill = vi.fn()
    render(<BreadthViews rows={makeRows()} onDrill={onDrill} live={LIVE_META}
                         liveStamp="1:44 PM" />)
    await userEvent.click(screen.getByLabelText('Previous day'))
    const tile = screen.queryAllByRole('button')
      .find(b => /details$/.test(b.getAttribute('aria-label') ?? ''))
    expect(tile, 'a settled day should offer at least one drillable tile').toBeTruthy()
    await userEvent.click(tile)
    expect(onDrill).toHaveBeenCalledWith(
      expect.objectContaining({ date: '2026-08-04' }),
      expect.objectContaining({ drillKey: expect.any(String) }),
      LIVE_META,
    )
  })

  it('renders unchanged when there is no live row at all', () => {
    const rows = makeRows().slice(1)
    render(<BreadthViews rows={rows} onDrill={vi.fn()} />)
    expect(screen.getByTestId('cursor-date').textContent).toBe('2026-08-04')
    expect(screen.queryByTestId('cursor-live')).not.toBeInTheDocument()
  })
})
