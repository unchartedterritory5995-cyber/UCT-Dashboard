/* 🔴 THE FEED, AS A MEMBER MEETS IT — and the budget as a rendered fact.
 *
 * ⛔ WHY THIS EXISTS BESIDE `feedWindow.test.js`. That file proves the POLICY
 * returns at most three ids. It says nothing about whether this component uses
 * it — and the failure that matters is not a wrong window, it is a feed that
 * computes a perfect window and then mounts a chart per card anyway. Every
 * budget check would stay green while a 40-symbol scan mounted forty charts.
 *
 * ⭐ SO THE CHART IS COUNTED, NOT MOCKED AWAY. `StockChart` is replaced by a
 * marker that records each mount, which is the only way to ask "how many charts
 * are alive" from a test.
 */
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const mounts = []
/* ⛔⛔ THE STUB MUST RELEASE ITS MOUNT SLOT, exactly as a real chart does via
 * `onBarsReady`. This is the difference between a rail and a decoration: with a
 * stub that never releases, `useStaggeredMount` holds three pending slots
 * forever, so "at most three charts" would be TRUE OF A FEED WITH NO WINDOWING
 * AT ALL — the queue would simply never admit the fourth. Mutation-checked:
 * hand `symbols` to the queue instead of `feedWindow(...)` and the budget case
 * below goes red at 40 mounts. Without this line it stays green.
 */
vi.mock('../../../components/StockChart', async () => {
  const { useEffect } = await import('react')
  return {
    default: ({ sym, onBarsReady }) => {
      useEffect(() => {
        mounts.push(sym)
        onBarsReady?.()
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [])
      return <div data-testid={`chart-${sym}`} data-live-chart="1" />
    },
  }
})

import ReviewFeed, { DENSITIES } from './ReviewFeed'
import { FEED_MAX_LIVE } from './feedWindow'
import { enter, step } from './reviewSession'

const SYMS = Array.from({ length: 40 }, (_, i) => `S${i}`)

/** The observer needs layout; jsdom has none. A no-op stand-in keeps the effect
 *  honest (it really runs, really disconnects) without inventing geometry the
 *  browser would have supplied — the centre stays where the feed opened. */
class NoopObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const liveCharts = () => document.querySelectorAll('[data-live-chart]').length

beforeEach(() => {
  mounts.length = 0
  localStorage.clear()
  vi.stubGlobal('IntersectionObserver', NoopObserver)
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

/** A session opened at `index`, with the walk recorded up to there. */
function sessionAt(index) {
  let s = enter({ source: 'scan', label: 'Momentum', symbols: SYMS, symbol: SYMS[0] })
  for (let i = 0; i < index; i += 1) s = step(s, 1)
  return s
}

describe('the review feed', () => {
  it('🔴🔴 FORTY CARDS, AT MOST THREE LIVE CHARTS', () => {
    // The claim that separates a review feed from a mobile memory incident. The
    // desktop grid measured 16 live cells at +63 MB; forty is not a bigger
    // version of that, it is a different outcome.
    render(<ReviewFeed session={sessionAt(10)} tf="D" onOpen={() => {}} onClose={() => {}} />)
    expect(screen.getAllByTestId(/^feed-card-/).length).toBe(40)
    expect(liveCharts()).toBeLessThanOrEqual(FEED_MAX_LIVE)
    expect(mounts.length).toBeLessThanOrEqual(FEED_MAX_LIVE)
  })

  it('⭐ the live ones are AROUND the symbol the review is at', () => {
    render(<ReviewFeed session={sessionAt(10)} tf="D" onOpen={() => {}} onClose={() => {}} />)
    expect(screen.getByTestId('chart-S10')).toBeInTheDocument()
    expect(screen.getByTestId('chart-S9')).toBeInTheDocument()
    expect(screen.queryByTestId('chart-S20')).toBe(null)
  })

  it('⛔ every other card is a PLACEHOLDER, not a missing row', () => {
    // A bounded feed must still be a complete list — the member is looking
    // across the whole set, and a card that is not live is still a card.
    render(<ReviewFeed session={sessionAt(10)} tf="D" onOpen={() => {}} onClose={() => {}} />)
    expect(screen.getByTestId('feed-card-S30')).toBeInTheDocument()
    expect(screen.getByTestId('feed-skeleton-S30')).toBeInTheDocument()
  })

  it('CONTROL: a list SHORTER than the budget mounts all of it', () => {
    // Without this the cap could be satisfied by a feed that mounts one chart,
    // or none — both would pass every assertion above.
    const s = enter({ source: 'scan', symbols: ['AAA', 'BBB'], symbol: 'AAA' })
    render(<ReviewFeed session={s} tf="D" onOpen={() => {}} onClose={() => {}} />)
    expect(liveCharts()).toBe(2)
  })

  it('⭐ the cards are the SESSION ORDER, not a re-sort', () => {
    render(<ReviewFeed session={sessionAt(0)} tf="D" onOpen={() => {}} onClose={() => {}} />)
    const shown = screen.getAllByTestId(/^feed-card-/)
      .map((el) => el.getAttribute('data-testid').replace('feed-card-', ''))
    expect(shown).toEqual(SYMS)
  })

  it('🔴 tapping a card moves the REVIEW to that index', () => {
    // ⛔ The index, not the symbol: the feed and the transport control share one
    // model, so "12 / 47" and the chart can never disagree about where you are.
    const onOpen = vi.fn()
    render(<ReviewFeed session={sessionAt(10)} tf="D" onOpen={onOpen} onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /open S30, 31 of 40/i }))
    expect(onOpen).toHaveBeenCalledWith(30)
  })

  it('marks the symbols already visited, and only those', () => {
    render(<ReviewFeed session={sessionAt(3)} tf="D" onOpen={() => {}} onClose={() => {}} />)
    expect(screen.getByTestId('feed-seen-S0')).toBeInTheDocument()
    expect(screen.getByTestId('feed-seen-S3')).toBeInTheDocument()
    expect(screen.queryByTestId('feed-seen-S9')).toBe(null)
  })

  it('⭐ the density A/B flips and is remembered', () => {
    // The question — how many charts a reviewer wants per screen — is answered
    // by a trader on a real phone, so the toggle exists to be felt, and it has
    // to survive the trip back into the feed.
    render(<ReviewFeed session={sessionAt(0)} tf="D" onOpen={() => {}} onClose={() => {}} />)
    const btn = screen.getByTestId('feed-density')
    expect(btn).toHaveAttribute('aria-pressed', 'false')
    act(() => { fireEvent.click(btn) })
    expect(btn).toHaveAttribute('aria-pressed', 'true')
    expect(DENSITIES).toContain(localStorage.getItem('uct.review.feed.density'))

    cleanup()
    render(<ReviewFeed session={sessionAt(0)} tf="D" onOpen={() => {}} onClose={() => {}} />)
    expect(screen.getByTestId('feed-density')).toHaveAttribute('aria-pressed', 'true')
  })

  it('⭐ publishes an instrument, because the real budget is a claim about a device', () => {
    // A test can prove the ceiling in jsdom; it cannot prove 60 fps or a heap
    // that returns to baseline. This is what a measurement run reads.
    render(<ReviewFeed session={sessionAt(10)} tf="D" onOpen={() => {}} onClose={() => {}} />)
    const m = window.__uctReviewFeed
    expect(m.total).toBe(40)
    expect(m.budget).toBe(FEED_MAX_LIVE)
    // ⛔ THE PEAK, not the current value: a budget is only broken once, and a
    // readout of "3 now" looks healthy a frame after mounting nine.
    expect(m.peakLive).toBeLessThanOrEqual(FEED_MAX_LIVE)
  })
})
