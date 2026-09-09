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

import ReviewFeed from './ReviewFeed'
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

/* ⭐ A DRIVEABLE OBSERVER, for the cases that are about MOVEMENT.
 * The no-op stand-in above can only ever measure the feed at rest, and every
 * budget failure worth fearing is a scrolling failure: charts that accumulate,
 * distant charts that never let go, a window that widens under load. This
 * captures the real callback the component installed and lets a case say
 * "the member is now looking at card N" — the one fact the browser supplies. */
let ioCallback = null
class DriveableObserver {
  constructor(cb) { ioCallback = cb }
  observe() {}
  unobserve() {}
  disconnect() { ioCallback = null }
}
/** Report card `i` as the one on screen, and the previous one as gone. */
function lookAt(i, previous = null) {
  const entry = (index, ratio) => ({ target: { getAttribute: () => String(index) }, intersectionRatio: ratio })
  const entries = [entry(i, 1)]
  if (previous !== null) entries.push(entry(previous, 0))
  act(() => { ioCallback(entries) })
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

  it('⛔ ONE DENSITY, AND NO TOGGLE — the instrument is not the feature', () => {
    // ⚰️ This case used to flip a density toggle and assert it was remembered.
    // The toggle existed to ANSWER the density question on hardware; hardware
    // answered it (70vh = 1.43 charts per screen), so the control is gone and
    // this case now guards against it coming back as a setting nobody asked for.
    render(<ReviewFeed session={sessionAt(0)} tf="D" onOpen={() => {}} onClose={() => {}} />)
    expect(screen.queryByTestId('feed-density')).toBe(null)
    expect(localStorage.getItem('uct.review.feed.density')).toBeNull()
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

/* ─── THE BUDGET UNDER MOVEMENT ─────────────────────────────────────────────
 *
 * ⛔ THE CASES ABOVE MEASURE A FEED AT REST. Every way this budget actually
 * fails is a scrolling failure — charts that accumulate as the member moves,
 * distant charts that never let go, a ceiling that holds at 40 symbols and
 * quietly does not at 100. Those need the observer driven, so these cases drive
 * it with the component's own callback.
 */
describe('the budget under movement', () => {
  beforeEach(() => { vi.stubGlobal('IntersectionObserver', DriveableObserver) })

  it('🔴🔴 SCROLLING THE WHOLE LIST NEVER ACCUMULATES CHARTS', () => {
    // The failure this exists against is gradual and every intermediate state
    // looks fine: three live, then four, then six, then forty — a feed that
    // passes a static check and is an incident after ten seconds of use.
    render(<ReviewFeed session={sessionAt(0)} tf="D" onOpen={() => {}} onClose={() => {}} />)
    let worst = 0
    for (let i = 1; i < SYMS.length; i += 1) {
      lookAt(i, i - 1)
      worst = Math.max(worst, liveCharts())
    }
    expect(worst).toBeLessThanOrEqual(FEED_MAX_LIVE)
    expect(liveCharts()).toBeLessThanOrEqual(FEED_MAX_LIVE)
  })

  it('⛔ A DISTANT CARD DOES NOT STAY LIVE — it goes back to a placeholder', () => {
    // `useStaggeredMount` NEVER unmounts a live id by its own contract, so if
    // the window were not narrowing the id set, the first card would still be
    // holding a chart thirty cards later and this would be the only case to
    // notice.
    render(<ReviewFeed session={sessionAt(0)} tf="D" onOpen={() => {}} onClose={() => {}} />)
    expect(screen.getByTestId('chart-S0')).toBeInTheDocument()
    lookAt(30, 0)
    expect(screen.queryByTestId('chart-S0')).toBe(null)
    expect(screen.getByTestId('chart-S30')).toBeInTheDocument()
  })

  it('⛔⛔ ADMISSION CANNOT MASQUERADE AS WINDOWING', () => {
    // The rail that nearly was not one. A queue that admits three at a time and
    // never unmounts satisfies "at most three mounting" forever while mounting
    // everything. Walking the list must therefore mount MANY charts in total —
    // proof the queue kept admitting — while never holding more than three.
    render(<ReviewFeed session={sessionAt(0)} tf="D" onOpen={() => {}} onClose={() => {}} />)
    for (let i = 1; i < SYMS.length; i += 1) lookAt(i, i - 1)
    expect(mounts.length).toBeGreaterThan(FEED_MAX_LIVE * 3)   // the queue kept working
    expect(liveCharts()).toBeLessThanOrEqual(FEED_MAX_LIVE)    // and never accumulated
  })

  it('⛔ RE-ENTERING A CARD DOES NOT LEAK AN INSTANCE', () => {
    // Scrolling back and forth over the same few symbols is what a reviewer
    // comparing two names actually does, and a mount that is never released
    // would show up here first.
    render(<ReviewFeed session={sessionAt(10)} tf="D" onOpen={() => {}} onClose={() => {}} />)
    for (let n = 0; n < 6; n += 1) {
      lookAt(10, 20)
      lookAt(20, 10)
    }
    expect(liveCharts()).toBeLessThanOrEqual(FEED_MAX_LIVE)
  })

  it('⛔⛔ THE CEILING DOES NOT MOVE WITH LIST LENGTH — 10, 40, 100', () => {
    // A budget that is a property of the window is length-independent by
    // construction; a budget that is really "the queue happened to keep up"
    // is not, and 100 is where that difference shows.
    for (const n of [10, 40, 100]) {
      cleanup()
      mounts.length = 0
      const syms = Array.from({ length: n }, (_, i) => `L${i}`)
      let s = enter({ source: 'scan', symbols: syms, symbol: syms[0] })
      render(<ReviewFeed session={s} tf="D" onOpen={() => {}} onClose={() => {}} />)
      let worst = liveCharts()
      for (let i = 1; i < n; i += 1) {
        lookAt(i, i - 1)
        worst = Math.max(worst, liveCharts())
      }
      expect(worst, `list of ${n} broke the ceiling`).toBeLessThanOrEqual(FEED_MAX_LIVE)
    }
  })

  it('CONTROL: the driveable observer really moves the window', () => {
    // Without this every case above could pass against a callback that was
    // never wired, or a `lookAt` that reported into nothing — the whole block
    // would be measuring a feed frozen at card zero.
    render(<ReviewFeed session={sessionAt(0)} tf="D" onOpen={() => {}} onClose={() => {}} />)
    expect(screen.queryByTestId('chart-S25')).toBe(null)
    lookAt(25, 0)
    expect(screen.getByTestId('chart-S25')).toBeInTheDocument()
  })
})
