/**
 * §5's two halves at the container: what a link DOES when it opens, and what
 * the container reports back for the link to carry.
 *
 * The router lives one level up (`Breadth.jsx`), so this drives the same props
 * the page passes — which is also the proof that the default (`urlState={null}`)
 * is "today's behaviour exactly": every other file in this directory renders
 * this component without them and is unchanged.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, within, act } from '@testing-library/react'

vi.mock('echarts-for-react', () => ({ default: () => <div data-testid="echart" /> }))

// A SERVER that has an opinion — this is the thing the URL has to beat.
const remote = vi.hoisted(() => ({ value: null }))
vi.mock('../../hooks/usePreferences', () => ({
  default: () => ({ prefs: remote.value ?? {}, setPref: vi.fn(), loading: false }),
  parsePref: (v) => v,
}))

import BreadthViews from './BreadthViews'
import { SEEK_OUT_OF_WINDOW } from './views/breadthViewShared'
import { PREF_KEY } from './useBreadthViews'

const mkRows = (n) => Array.from({ length: n }, (_, i) => {
  const day = new Date(Date.UTC(2026, 7, 28) - i * 86400000)
  return {
    date: day.toISOString().slice(0, 10),
    breadth_score: 70 - (i % 9), uct_exposure: 60,
    pct_above_50sma: 60 - (i % 30), pct_above_200sma: 55, pct_above_5sma: 40,
    pct_above_10sma: 45, pct_above_20ema: 50, pct_above_40sma: 52, pct_above_100sma: 55,
    up_4pct_today: 300 - (i % 50), down_4pct_today: 100, new_52w_highs: 40, new_52w_lows: 9,
    mcclellan_osc: 20, vix: 16, sp500_close: 5000 + i, advancing: 3000, declining: 1500,
  }
})
const rows = mkRows(40)
const deep = mkRows(200)

const switcher = () => within(screen.getByRole('group', { name: 'Visualization style' }))
const cursorDate = () => screen.getByTestId('cursor-date').textContent

beforeEach(() => { localStorage.clear(); remote.value = null })

describe('the URL wins over stored preferences', () => {
  it('opens the style the link names, over the server’s saved one', () => {
    // ⛔ This is the race the override exists for: the preference blob arrives
    // in an effect AFTER first paint and setStates the whole thing, so a
    // "apply the URL on mount" effect in the container would be silently
    // stomped a tick later.
    remote.value = { [PREF_KEY]: { viewStyle: 'radar', byView: {} } }
    render(<BreadthViews rows={rows} onDrill={() => {}}
                         urlState={{ view: 'clock', date: null, compare: null }} />)
    expect(switcher().getByRole('button', { name: 'Regime Clock' }))
      .toHaveAttribute('aria-pressed', 'true')
  })

  it('leaves the stored style alone when the link names none', () => {
    remote.value = { [PREF_KEY]: { viewStyle: 'radar', byView: {} } }
    render(<BreadthViews rows={rows} onDrill={() => {}}
                         urlState={{ view: null, date: null, compare: null }} />)
    expect(switcher().getByRole('button', { name: 'Radar' }))
      .toHaveAttribute('aria-pressed', 'true')
  })

  it('opens compare on the link’s quad, over a stored single layout', () => {
    remote.value = { [PREF_KEY]: { viewStyle: 'radar', byView: {}, layout: 'single' } }
    const quad = ['ribbon', 'clock', 'events', 'radar']
    render(<BreadthViews rows={rows} onDrill={() => {}}
                         urlState={{ view: null, date: null, compare: quad }} />)
    expect(screen.getByTestId('layout-compare')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getAllByTestId(/^compare-pane-\d+$/)
      .map(p => p.getAttribute('data-pane-style'))).toEqual(quad)
  })
})

describe('?date= uses Wave A’s refusal, not a second one', () => {
  it('seeks to a session inside the loaded window', () => {
    render(<BreadthViews rows={rows} onDrill={() => {}}
                         urlState={{ view: null, date: rows[9].date, compare: null }} />)
    expect(cursorDate()).toBe(rows[9].date)
    expect(screen.queryByTestId('url-date-refusal')).toBeNull()
  })

  it('refuses a session the window does not hold, and says why', () => {
    render(<BreadthViews rows={rows} onDrill={() => {}}
                         urlState={{ view: null, date: '2025-03-11', compare: null }} />)
    // The cursor did NOT quietly land on the newest row pretending otherwise.
    expect(cursorDate()).toBe(rows[0].date)
    const refusal = screen.getByTestId('url-date-refusal')
    expect(refusal.textContent).toContain('2025-03-11')      // still legible
    expect(refusal.textContent).toContain(SEEK_OUT_OF_WINDOW)
  })

  it('lands the same link once the window is widened', () => {
    // The Analogue Deck's promise, applied to the URL: widen and it goes live.
    const target = deep[150].date
    const { rerender } = render(<BreadthViews rows={rows} onDrill={() => {}}
                                              urlState={{ view: null, date: target, compare: null }} />)
    expect(screen.getByTestId('url-date-refusal')).toBeTruthy()

    rerender(<BreadthViews rows={deep} onDrill={() => {}}
                           urlState={{ view: null, date: target, compare: null }} />)
    expect(cursorDate()).toBe(target)
    expect(screen.queryByTestId('url-date-refusal')).toBeNull()
  })

  it('does not fight the user after it has landed', () => {
    render(<BreadthViews rows={rows} onDrill={() => {}}
                         urlState={{ view: null, date: rows[9].date, compare: null }} />)
    fireEvent.click(screen.getByRole('button', { name: 'LATEST' }))
    expect(cursorDate()).toBe(rows[0].date)      // stays where the user put it
  })
})

/**
 * 🔴 A REFUSAL IS A CLAIM ABOUT NOW, AND THIS ONE KEPT STANDING.
 *
 * "2026-07-13 — that session is outside the loaded window" is true the moment a
 * link opens on a window that does not hold it. It stops describing the
 * reader's situation the moment they scrub somewhere reachable: the cursor is
 * now where THEY put it, and a banner still naming the link's date reads as a
 * live condition rather than as what happened on the way in.
 *
 * ⭐ ONE LATCH, TWO BEHAVIOURS. "The reader has taken the cursor" also retires
 * the RETRY — a later widen must not yank them back to the link's date from
 * wherever they went. Both hang off the same fact, so they cannot disagree.
 */
describe('a refused ?date= stops asserting itself once the reader moves', () => {
  const OUT = '2025-03-11'

  it('shows the refusal on arrival, and drops it on the reader\'s first seek', () => {
    render(<BreadthViews rows={rows} onDrill={() => {}}
                         urlState={{ view: null, date: OUT, compare: null }} />)
    expect(screen.getByTestId('url-date-refusal')).toBeTruthy()
    fireEvent.click(screen.getByLabelText('Previous day'))
    expect(screen.queryByTestId('url-date-refusal'),
      'the banner kept naming a session the reader had already scrubbed away from').toBeNull()
  })

  it('drops it on an arrow KEY too — every door the cursor moves through', () => {
    render(<BreadthViews rows={rows} onDrill={() => {}}
                         urlState={{ view: null, date: OUT, compare: null }} />)
    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    expect(screen.queryByTestId('url-date-refusal')).toBeNull()
  })

  it('and stays gone when the reader returns to the newest row', () => {
    // ⛔ THE REASON THE LATCH IS NOT `rowIdx !== 0`. Scrub away and back and a
    // position-derived banner would return, re-asserting a link the reader has
    // already answered.
    render(<BreadthViews rows={rows} onDrill={() => {}}
                         urlState={{ view: null, date: OUT, compare: null }} />)
    fireEvent.click(screen.getByLabelText('Previous day'))
    fireEvent.click(screen.getByRole('button', { name: 'LATEST' }))
    expect(screen.queryByTestId('url-date-refusal')).toBeNull()
  })

  it('CONTROL: an untouched cursor keeps the refusal, and the widen still lands', () => {
    // Without this the rule above could be satisfied by a banner that never
    // shows, and by a link that never retries.
    const target = deep[150].date
    const { rerender } = render(<BreadthViews rows={rows} onDrill={() => {}}
                                              urlState={{ view: null, date: target, compare: null }} />)
    expect(screen.getByTestId('url-date-refusal')).toBeTruthy()
    rerender(<BreadthViews rows={deep} onDrill={() => {}}
                           urlState={{ view: null, date: target, compare: null }} />)
    expect(cursorDate()).toBe(target)
  })

  it('a widen does NOT yank a reader who has taken the cursor', () => {
    const target = deep[150].date
    const { rerender } = render(<BreadthViews rows={rows} onDrill={() => {}}
                                              urlState={{ view: null, date: target, compare: null }} />)
    fireEvent.click(screen.getByLabelText('Previous day'))
    const mine = cursorDate()
    rerender(<BreadthViews rows={deep} onDrill={() => {}}
                           urlState={{ view: null, date: target, compare: null }} />)
    expect(cursorDate(), 'the spent link pulled the reader off their own session').toBe(mine)
  })
})

describe('what the container reports back for the link', () => {
  const lastCall = (fn) => fn.mock.calls[fn.mock.calls.length - 1][0]

  it('reports the style, and NO date while the cursor is on the newest row', () => {
    // A link that pinned today's date would still say "2026-08-28" tomorrow —
    // a different read than the one that was shared.
    const onUrlChange = vi.fn()
    render(<BreadthViews rows={rows} onDrill={() => {}}
                         urlState={{ view: null, date: null, compare: null }}
                         onUrlChange={onUrlChange} />)
    expect(lastCall(onUrlChange)).toMatchObject({ view: 'treemap', date: null, layout: 'single' })
  })

  it('reports the date once the cursor leaves the newest row, and drops it again', () => {
    const onUrlChange = vi.fn()
    render(<BreadthViews rows={rows} onDrill={() => {}}
                         urlState={{ view: null, date: null, compare: null }}
                         onUrlChange={onUrlChange} />)
    fireEvent.click(screen.getByLabelText('Previous day'))
    expect(lastCall(onUrlChange).date).toBe(rows[1].date)
    fireEvent.click(screen.getByRole('button', { name: 'LATEST' }))
    expect(lastCall(onUrlChange).date).toBeNull()
  })

  /**
   * 🔴 A RUN IN FLIGHT USED TO REPORT EVERY TICK.
   *
   * Playback steps the cursor up to sixteen times a second and each step was
   * reported upward, re-rendering the page to hand a 300ms-debounced writer a
   * value that was stale before it could be written. The debounce was doing its
   * job; the REPORT above it was the churn, and playback is this tab's
   * showpiece. The link still ends up describing where the reader is: the
   * effect fires once when the run stops, which is the only position during a
   * run a share was ever going to mean.
   */
  it('reports NOTHING while playback runs, and once when it stops', async () => {
    vi.useFakeTimers()
    try {
      const onUrlChange = vi.fn()
      render(<BreadthViews rows={rows} onDrill={() => {}}
                           urlState={{ view: null, date: null, compare: null }}
                           onUrlChange={onUrlChange} />)
      // Off the newest row first: playback refuses to start there, by design.
      fireEvent.change(screen.getByTestId('scrubber-range'),
        { target: { value: String(rows.length - 1 - 20) } })
      const before = onUrlChange.mock.calls.length
      const at20 = cursorDate()

      fireEvent.click(screen.getByTestId('scrubber-play'))
      act(() => { vi.advanceTimersByTime(1200) })          // ~10 sessions at 8/s
      expect(cursorDate(), 'the run did not advance, so this proves nothing').not.toBe(at20)
      expect(onUrlChange.mock.calls.length,
        'every playback tick was reported upward').toBe(before)

      fireEvent.click(screen.getByTestId('scrubber-play'))  // pause
      const settled = cursorDate()
      expect(onUrlChange.mock.calls.length).toBeGreaterThan(before)
      expect(onUrlChange.mock.calls[onUrlChange.mock.calls.length - 1][0].date,
        'the link did not end up on the session the run stopped at').toBe(settled)
    } finally {
      vi.useRealTimers()
    }
  })

  it('reports the layout and the quad when compare is on', () => {
    const onUrlChange = vi.fn()
    render(<BreadthViews rows={rows} onDrill={() => {}}
                         urlState={{ view: null, date: null, compare: null }}
                         onUrlChange={onUrlChange} />)
    expect(lastCall(onUrlChange).layout).toBe('single')
    fireEvent.click(screen.getByTestId('layout-compare'))
    const after = lastCall(onUrlChange)
    expect(after.layout).toBe('compare')
    expect(after.compare).toHaveLength(4)
  })
})

describe('no URL state at all is today’s behaviour exactly', () => {
  it('renders, reports nothing, and shows no refusal', () => {
    expect(() => render(<BreadthViews rows={rows} onDrill={() => {}} />)).not.toThrow()
    expect(screen.queryByTestId('url-date-refusal')).toBeNull()
    expect(cursorDate()).toBe(rows[0].date)
    expect(screen.getByTestId('layout-single')).toHaveAttribute('aria-pressed', 'true')
  })
})
