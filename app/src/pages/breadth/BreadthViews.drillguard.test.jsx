/**
 * Stripping `drillKey` is what stops today's eight views from offering a click
 * on the live row — but it only works because every one of them derives
 * clickability from that field. A future view that wires onClick directly would
 * slip past it, so the container also refuses the call itself.
 *
 * That second guard is invisible to the other tests (nothing reaches it), which
 * is exactly how a real protection ends up deleted as dead code. This test
 * stands in for the view that doesn't play by the rules.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import BreadthViews from './BreadthViews'

vi.mock('./useBreadthViews', () => ({
  default: () => ({
    viewStyle: 'meters', setViewStyle: vi.fn(),
    visibleKeys: new Set(['pct_above_50sma']),
    eligibleMetrics: () => [], options: {},
    presetNames: ['Default'], activePreset: 'Default', switchPreset: vi.fn(),
    isDefaultActive: true, savePreset: vi.fn(), deletePreset: vi.fn(),
    setVisibleKeys: vi.fn(), setOptions: vi.fn(), resetPreset: vi.fn(),
  }),
}))

// A view that ignores `drillKey` entirely and drills on any click.
vi.mock('./views/MetersView', () => ({
  default: ({ metrics, onDrill }) => (
    <button data-testid="rogue" onClick={() => onDrill(metrics[0])}>drill</button>
  ),
}))

const LIVE = { date: '2026-08-05', pct_above_50sma: 65.3, universe_count: 2701, _live: true }
const STORED = { date: '2026-08-04', pct_above_50sma: 66.3, universe_count: 2720 }

describe('the drill guard behind the drillKey stripping', () => {
  it('refuses a drill from the live row even when the view asks for one', async () => {
    const onDrill = vi.fn()
    render(<BreadthViews rows={[LIVE, STORED]} onDrill={onDrill} liveStamp="1:44 PM" />)
    await userEvent.click(screen.getByTestId('rogue'))
    expect(onDrill).not.toHaveBeenCalled()
  })

  it('still allows one from a settled row', async () => {
    const onDrill = vi.fn()
    render(<BreadthViews rows={[STORED]} onDrill={onDrill} />)
    await userEvent.click(screen.getByTestId('rogue'))
    expect(onDrill).toHaveBeenCalledWith('2026-08-04', expect.anything())
  })
})
