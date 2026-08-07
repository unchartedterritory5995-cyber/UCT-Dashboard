/**
 * Stripping `drillKey` is what stops the eight views from offering a click the
 * container would refuse — but it only works because every one of them derives
 * clickability from that field. A future view that wires onClick directly would
 * slip past it, so the container also refuses the call itself.
 *
 * That second guard is invisible to the other tests (nothing reaches it), which
 * is exactly how a real protection ends up deleted as dead code. This test
 * stands in for the view that doesn't play by the rules.
 *
 * What it guards changed when the live row became drillable: no longer "any
 * live cell", now "a cell `drillTarget` has no truthful source for" — a carried
 * metric with no session to attribute its names to.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import BreadthViews from './BreadthViews'

vi.mock('./useBreadthViews', () => ({
  default: () => ({
    viewStyle: 'meters', setViewStyle: vi.fn(),
    visibleKeys: new Set(['up_4pct_today', 'pct_above_50sma']),
    eligibleMetrics: () => [], options: {},
    presetNames: ['Default'], activePreset: 'Default', switchPreset: vi.fn(),
    isDefaultActive: true, savePreset: vi.fn(), deletePreset: vi.fn(),
    setVisibleKeys: vi.fn(), setOptions: vi.fn(), resetPreset: vi.fn(),
  }),
}))

// A view that ignores `drillKey` entirely and drills on any click. `rogue`
// drills the first visible metric (up_4pct_today, which has a drillKey);
// `rogue-last` drills pct_above_50sma, which has none.
vi.mock('./views/MetersView', () => ({
  default: ({ metrics, onDrill }) => (
    <>
      <button data-testid="rogue" onClick={() => onDrill(metrics[0])}>drill</button>
      <button data-testid="rogue-last"
              onClick={() => onDrill(metrics.find(m => !m.drillKey) ?? metrics[0])}>
        drill undrillable
      </button>
    </>
  ),
}))

const LIVE = { date: '2026-08-05', pct_above_50sma: 65.3, universe_count: 2701, _live: true }
const STORED = { date: '2026-08-04', pct_above_50sma: 66.3, universe_count: 2720 }

// up_4pct_today is the metric the rogue view drills — deliberately one that
// HAS a drillKey, so these exercise the live/carried decision rather than
// bouncing off the missing-drillKey check below.
const ORPHANED = { carried: new Set(['up_4pct_today']), carriedFrom: null }
const CARRIED = { carried: new Set(['up_4pct_today']), carriedFrom: '2026-08-04' }
const MEASURED = { carried: new Set(), carriedFrom: '2026-08-04' }

describe('the drill guard behind the drillKey stripping', () => {
  it('refuses a carried metric with no session behind it, however the view asks', async () => {
    const onDrill = vi.fn()
    render(<BreadthViews rows={[LIVE, STORED]} onDrill={onDrill} live={ORPHANED}
                         liveStamp="1:44 PM" />)
    await userEvent.click(screen.getByTestId('rogue'))
    expect(onDrill).not.toHaveBeenCalled()
  })

  it('allows a live-measured metric on the live row', async () => {
    const onDrill = vi.fn()
    render(<BreadthViews rows={[LIVE, STORED]} onDrill={onDrill} live={MEASURED}
                         liveStamp="1:44 PM" />)
    await userEvent.click(screen.getByTestId('rogue'))
    expect(onDrill).toHaveBeenCalledWith(
      expect.objectContaining({ _live: true }), expect.anything(), MEASURED)
  })

  // Carried but attributable: the click works, and drillTarget sends it to the
  // date the number came from rather than today.
  it('allows a carried metric that has a session to attribute it to', async () => {
    const onDrill = vi.fn()
    render(<BreadthViews rows={[LIVE, STORED]} onDrill={onDrill} live={CARRIED}
                         liveStamp="1:44 PM" />)
    await userEvent.click(screen.getByTestId('rogue'))
    expect(onDrill).toHaveBeenCalled()
  })

  // A metric with no drillKey has no list anywhere, live or settled — the URL
  // would read `/drill/undefined`. The old container refused only by liveness
  // and would have built exactly that.
  it('refuses a metric that declares no drillKey, on any row', async () => {
    const onDrill = vi.fn()
    render(<BreadthViews rows={[STORED]} onDrill={onDrill} noDrillKey />)
    await userEvent.click(screen.getByTestId('rogue-last'))
    expect(onDrill).not.toHaveBeenCalled()
  })

  it('still allows one from a settled row', async () => {
    const onDrill = vi.fn()
    render(<BreadthViews rows={[STORED]} onDrill={onDrill} />)
    await userEvent.click(screen.getByTestId('rogue'))
    expect(onDrill).toHaveBeenCalledWith(
      expect.objectContaining({ date: '2026-08-04' }), expect.anything(), null)
  })
})
