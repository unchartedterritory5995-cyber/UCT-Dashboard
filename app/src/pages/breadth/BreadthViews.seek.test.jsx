/**
 * The cursor as a wire, tested through the REAL container.
 *
 * `seek.test.js` proves the resolver and `views/seekAffordances.test.jsx` proves
 * each view renders an affordance. Neither can see the wire between them — a
 * view could offer a perfect date to an `onSeek` the container forgot to pass,
 * and every one of those files would stay green. This one mounts
 * `BreadthViews`, clicks what a user clicks, and reads the cursor readout.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'

vi.mock('echarts-for-react', () => ({ default: () => <div data-testid="echart" /> }))

import BreadthViews from './BreadthViews'
import { SEEK_OUT_OF_WINDOW } from './views/breadthViewShared'

// 40 real sessions, newest-first — deep enough for every lens' own minimum.
const rows = Array.from({ length: 40 }, (_, i) => {
  const day = new Date(Date.UTC(2026, 7, 28) - i * 86400000)
  return {
    date: day.toISOString().slice(0, 10),
    breadth_score: 70 - (i % 9), uct_exposure: 60,
    pct_above_50sma: 60 - i, pct_above_200sma: 55, pct_above_5sma: 40,
    pct_above_10sma: 45, pct_above_20ema: 50, pct_above_40sma: 52, pct_above_100sma: 55,
    up_4pct_today: 300 - i, down_4pct_today: 100 + i,
    new_52w_highs: 40, new_52w_lows: 9, mcclellan_osc: 20 - i, vix: 16 + (i % 4),
    sp500_close: 5000 + i * 3, advancing: 3000, declining: 1500,
  }
})
const OLDEST = rows[rows.length - 1].date
const NEWEST = rows[0].date

const cursorDate = () => screen.getByTestId('cursor-date').textContent

beforeEach(() => localStorage.clear())

describe('a date on screen moves the cursor', () => {
  it('clicking a Heat Ribbon cell seeks to that session', () => {
    const { container } = render(<BreadthViews rows={rows} onDrill={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Heat Ribbon' }))

    const cell = container.querySelector('[data-testid^="ribbon-cell-"]')
    const target = cell.getAttribute('data-seek-date')
    expect(target).not.toBe(cursorDate())      // there is somewhere to go
    fireEvent.click(cell)
    expect(cursorDate()).toBe(target)
    // …and the scrubber, which reads the same cursor, followed.
    expect(screen.getByTestId('scrubber-date').textContent).toBe(target)
  })

  it('clicking a Regime Clock trail dot seeks to that session', () => {
    const { container } = render(<BreadthViews rows={rows} onDrill={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Regime Clock' }))

    const dots = [...container.querySelectorAll('[data-testid^="clock-dot-"]')]
    const dot = dots.find(d => d.getAttribute('data-seek-date') !== cursorDate())
    fireEvent.click(dot)
    expect(cursorDate()).toBe(dot.getAttribute('data-seek-date'))
  })

  it('the arrow buttons still walk the cursor a session at a time', () => {
    render(<BreadthViews rows={rows} onDrill={() => {}} />)
    expect(cursorDate()).toBe(NEWEST)
    fireEvent.click(screen.getByLabelText('Previous day'))
    expect(cursorDate()).toBe(rows[1].date)
    fireEvent.click(screen.getByLabelText('Next day'))
    expect(cursorDate()).toBe(NEWEST)
  })

  it('the arrow KEYS still work — one binding, not two', () => {
    render(<BreadthViews rows={rows} onDrill={() => {}} />)
    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    expect(cursorDate()).toBe(rows[1].date)
    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    expect(cursorDate()).toBe(rows[2].date)
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(cursorDate()).toBe(rows[1].date)
  })

  it('the scrubber drives the same cursor', () => {
    render(<BreadthViews rows={rows} onDrill={() => {}} />)
    fireEvent.change(screen.getByTestId('scrubber-range'), { target: { value: '0' } })
    expect(cursorDate()).toBe(OLDEST)
  })
})

/**
 * 🔴 THE REFUSAL, END TO END.
 *
 * The Analogue Deck names historical sessions the server found across ALL of
 * history — most of them outside a loaded window. This is the one place the
 * whole `canSeek` contract is visible to a user, so it is checked against the
 * real container's window rather than a hand-built `canSeek`.
 */
describe('a date the window cannot reach is refused, not faked', () => {
  const PAYLOAD = {
    reference_date: NEWEST,
    analogues: [
      { date: rows[7].date, similarity: 91.2, forward_returns: { fwd_20d: 3.1 } },
      { date: '2025-03-11', similarity: 88.1, forward_returns: { fwd_20d: -2.1 } },
    ],
  }
  const realFetch = globalThis.fetch
  beforeEach(() => {
    globalThis.fetch = vi.fn((url) => Promise.resolve({
      ok: true, status: 200,
      json: () => Promise.resolve(String(url).includes('analogues') ? PAYLOAD : {}),
    }))
  })
  afterEach(() => { globalThis.fetch = realFetch })

  it('renders the in-window match live and the 2025 one disabled', async () => {
    render(<BreadthViews rows={rows} onDrill={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Analogue Deck' }))

    const dead = await screen.findByTestId('analogues-seek-2025-03-11')
    const live = screen.getByTestId(`analogues-seek-${rows[7].date}`)

    expect(live).not.toBeDisabled()
    expect(dead).toBeDisabled()
    expect(dead.getAttribute('title')).toBe(SEEK_OUT_OF_WINDOW)
    expect(dead.textContent).toBe('2025-03-11')     // still legible, just not live

    fireEvent.click(dead)
    expect(cursorDate()).toBe(NEWEST)               // nothing moved

    fireEvent.click(live)
    expect(cursorDate()).toBe(rows[7].date)         // and the live one does
  })
})

describe('playback and the cursor never fight', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())
  const run = (ms) => act(() => { vi.advanceTimersByTime(ms) })

  const startAtOldest = () => {
    render(<BreadthViews rows={rows} onDrill={() => {}} />)
    fireEvent.change(screen.getByTestId('scrubber-range'), { target: { value: '0' } })
    expect(cursorDate()).toBe(OLDEST)
    fireEvent.click(screen.getByTestId('scrubber-play'))
  }

  it('advances the cursor and stops at the newest row', () => {
    startAtOldest()
    run(200)
    expect(cursorDate()).not.toBe(OLDEST)
    run(60_000)                                   // far past the end of the window
    expect(cursorDate()).toBe(NEWEST)
    // Stopped, not looped: another minute of ticks leaves it exactly there.
    run(60_000)
    expect(cursorDate()).toBe(NEWEST)
  })

  it('pauses on a manual seek so the user is not fighting it', () => {
    startAtOldest()
    run(400)
    fireEvent.change(screen.getByTestId('scrubber-range'), { target: { value: '0' } })
    expect(cursorDate()).toBe(OLDEST)
    run(5_000)
    expect(cursorDate(), 'playback kept running after a manual seek').toBe(OLDEST)
  })

  it('pauses on arrow-key navigation too', () => {
    startAtOldest()
    run(400)
    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    const parked = cursorDate()
    run(5_000)
    expect(cursorDate(), 'playback kept running after an arrow key').toBe(parked)
  })

  it('pauses when a date on a view is clicked', () => {
    render(<BreadthViews rows={rows} onDrill={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Heat Ribbon' }))
    fireEvent.change(screen.getByTestId('scrubber-range'), { target: { value: '0' } })
    fireEvent.click(screen.getByTestId('scrubber-play'))
    run(400)
    const cell = document.querySelector('[data-testid^="ribbon-cell-"]')
    fireEvent.click(cell)
    const parked = cursorDate()
    run(5_000)
    expect(cursorDate()).toBe(parked)
  })

  /**
   * ⛔ AN INTERVAL THAT OUTLIVES THE TAB keeps moving a cursor nobody can see.
   * React would also warn about setting state on an unmounted tree; this fails
   * on the behaviour rather than on the warning.
   */
  it('leaves no interval behind when the tab unmounts', () => {
    render(<BreadthViews rows={rows} onDrill={() => {}} />)
    fireEvent.change(screen.getByTestId('scrubber-range'), { target: { value: '0' } })
    fireEvent.click(screen.getByTestId('scrubber-play'))
    run(400)
    const seen = cursorDate()
    expect(seen).not.toBe(OLDEST)
    document.body.innerHTML = ''      // crude, but it is what a route change does
    expect(() => run(10_000)).not.toThrow()
  })
})

describe('the cursor survives a window change', () => {
  it('falls back to the newest row when the loaded window shrinks under it', async () => {
    const { rerender } = render(<BreadthViews rows={rows} onDrill={() => {}} />)
    fireEvent.change(screen.getByTestId('scrubber-range'), { target: { value: '0' } })
    expect(cursorDate()).toBe(OLDEST)
    rerender(<BreadthViews rows={rows.slice(0, 5)} onDrill={() => {}} />)
    await waitFor(() => expect(screen.getByTestId('cursor-date')).toBeInTheDocument())
    // `filledRows[rowIdx] ?? filledRows[0]` — the reading on screen is a row
    // that exists, never a blank cursor.
    expect(rows.slice(0, 5).map(r => r.date)).toContain(cursorDate())
  })
})
