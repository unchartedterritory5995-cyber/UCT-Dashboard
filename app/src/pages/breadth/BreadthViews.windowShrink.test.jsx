/**
 * 🔴 THE WINDOW SHRINKS UNDER THE CURSOR — regression rail.
 *
 * Scrub deep into the 365-day window, then press the 90d pill. `rowIdx` used to
 * survive the change, larger than the window it now sits in. Nothing threw: the
 * container's `filledRows[rowIdx] ?? filledRows[0]` fallback kept the DISPLAYED
 * row valid, so the only outward sign was the scrubber printing an impossible
 * position ("-5 of 5").
 *
 * ⛔ SO THE TEST SHRINKS A REAL WINDOW. A unit test of the clamp helper would
 * have stayed green through the whole bug — the helper was never the broken
 * part; the missing reconciliation was.
 *
 * ⭐ AND IT CHECKS THE CURSOR, NOT ONLY THE TEXT. The discriminating reading is
 * the DATE: with `rowIdx` out of bounds the fallback shows the NEWEST session
 * (index 0), while a properly clamped cursor sits on the OLDEST row of the new
 * window. Asserting the readout alone would pass on the half-fix that hides the
 * symptom and leaves the state wrong.
 *
 * Reachable only since the Views tab gained 90/180/365 window pills — before
 * those the window never shrank, which is why it survived earlier review.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'

vi.mock('echarts-for-react', () => ({ default: () => <div data-testid="echart" /> }))

import BreadthViews from './BreadthViews'
import BreadthScrubber from './BreadthScrubber'

const mkRows = (n) => Array.from({ length: n }, (_, i) => {
  const day = new Date(Date.UTC(2026, 7, 28) - i * 86400000)
  return {
    date: day.toISOString().slice(0, 10),
    breadth_score: 70 - (i % 9), uct_exposure: 60,
    pct_above_50sma: 60 - (i % 30), pct_above_200sma: 55, pct_above_5sma: 40,
    pct_above_10sma: 45, pct_above_20ema: 50, pct_above_40sma: 52, pct_above_100sma: 55,
    up_4pct_today: 300, down_4pct_today: 100, new_52w_highs: 40, new_52w_lows: 9,
    mcclellan_osc: 20, vix: 16, sp500_close: 5000 + i, advancing: 3000, declining: 1500,
  }
})
const WIDE = mkRows(200)   // the 365d window
const NARROW = mkRows(30)  // what the 90d pill leaves

const position = () => screen.getByTestId('scrubber-position').textContent
const cursorDate = () => screen.getByTestId('cursor-date').textContent
const toOldest = () => fireEvent.change(screen.getByTestId('scrubber-range'), { target: { value: '0' } })

beforeEach(() => localStorage.clear())

describe('the cursor cannot outlive the window it sat in', () => {
  it('lands in bounds — on the new window’s oldest row — after a shrink', () => {
    const { rerender } = render(<BreadthViews rows={WIDE} onDrill={() => {}} />)
    toOldest()
    expect(position()).toBe('1 of 200')                  // control: it really is deep
    expect(cursorDate()).toBe(WIDE[199].date)

    rerender(<BreadthViews rows={NARROW} onDrill={() => {}} />)

    expect(position()).toBe('1 of 30')
    // The load-bearing half: the CURSOR moved, it was not merely re-printed.
    expect(cursorDate()).toBe(NARROW[29].date)
    expect(cursorDate()).not.toBe(NARROW[0].date)        // not the `?? rows[0]` fallback
  })

  it('never prints an impossible position at any depth of shrink', () => {
    const { rerender } = render(<BreadthViews rows={WIDE} onDrill={() => {}} />)
    for (const n of [120, 60, 5, 1]) {
      toOldest()
      rerender(<BreadthViews rows={mkRows(n)} onDrill={() => {}} />)
      const [pos, total] = position().split(' of ').map(Number)
      expect(pos, `n=${n}`).toBeGreaterThanOrEqual(1)
      expect(pos, `n=${n}`).toBeLessThanOrEqual(total)
      expect(total, `n=${n}`).toBe(n)
    }
  })

  it('leaves the cursor alone when the window GROWS', () => {
    // Widening must not yank a reader off the session they are reading.
    const { rerender } = render(<BreadthViews rows={NARROW} onDrill={() => {}} />)
    toOldest()
    const at = cursorDate()
    rerender(<BreadthViews rows={WIDE} onDrill={() => {}} />)
    expect(cursorDate()).toBe(at)
    // Same session, restated against the bigger window: rowIdx 29 counted from
    // the newest is the 171st of 200 counted from the oldest.
    expect(position()).toBe(`${200 - 29} of 200`)
  })

  it('drags an IN-FLIGHT playback run back into the new window', () => {
    // `stepTo` is deliberately a non-validating door (it is playback's
    // non-pausing path), so a run that began beyond the new bounds would keep
    // decrementing a stale index down through zero. The container's clamp is
    // the only thing that can catch it — the scrubber re-syncs from the prop.
    vi.useFakeTimers()
    try {
      const { rerender } = render(<BreadthViews rows={WIDE} onDrill={() => {}} />)
      toOldest()
      fireEvent.click(screen.getByTestId('scrubber-play'))
      act(() => { vi.advanceTimersByTime(400) })          // a few sessions in

      rerender(<BreadthViews rows={NARROW} onDrill={() => {}} />)
      act(() => { vi.advanceTimersByTime(400) })

      const [pos, total] = position().split(' of ').map(Number)
      expect(total).toBe(30)
      expect(pos).toBeGreaterThanOrEqual(1)
      expect(pos).toBeLessThanOrEqual(30)
      expect(NARROW.map(r => r.date)).toContain(cursorDate())
      // ⭐ The discriminating half. An unclamped run keeps decrementing a stale
      // index far outside the window, so `filledRows[rowIdx] ?? filledRows[0]`
      // pins the display to the NEWEST row and it never moves. A clamped one is
      // walking forward through the new window from its oldest row.
      expect(cursorDate()).not.toBe(NARROW[0].date)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('the scrubber’s own readout is clamped too', () => {
  it('prints a possible position even when handed an out-of-bounds cursor', () => {
    // Both halves are fixed on purpose. This one is the display; the container
    // test above is the state. Fixing only this would hide the bug.
    render(<BreadthScrubber rows={mkRows(5)} rowIdx={40} playing={false}
                            onSeek={() => true} onStep={() => {}} onPlayingChange={() => {}} />)
    expect(position()).toBe('1 of 5')
  })

  it('prints the honest position when the cursor is in bounds', () => {
    // Non-vacuity: the clamp must not be flattening every reading to "1".
    render(<BreadthScrubber rows={mkRows(5)} rowIdx={1} playing={false}
                            onSeek={() => true} onStep={() => {}} onPlayingChange={() => {}} />)
    expect(position()).toBe('4 of 5')
  })
})
