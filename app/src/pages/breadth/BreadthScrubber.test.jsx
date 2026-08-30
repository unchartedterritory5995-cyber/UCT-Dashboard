import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import BreadthScrubber from './BreadthScrubber'
import { SPEEDS, DEFAULT_SPEED, REDUCED_MOTION_NOTE } from './scrubberPlayback'

// Newest-first, exactly as the API serves and `filledRows` keeps it.
const rows = Array.from({ length: 5 }, (_, i) => ({ date: `2026-08-2${5 - i}` }))
//  index 0 = 2026-08-25 (newest) … index 4 = 2026-08-21 (oldest)

const mount = (props = {}) => {
  const onSeek = vi.fn()
  const onStep = vi.fn()
  const onPlayingChange = vi.fn()
  const utils = render(
    <BreadthScrubber rows={rows} rowIdx={0} playing={false}
                     onSeek={onSeek} onStep={onStep} onPlayingChange={onPlayingChange}
                     {...props} />)
  return { ...utils, onSeek, onStep, onPlayingChange }
}

// The default jsdom shim answers `matches: false`; this replaces it for the
// reduced-motion block and is restored afterwards.
const originalMatchMedia = window.matchMedia
const setReducedMotion = (matches) => {
  window.matchMedia = (query) => ({
    matches, media: query, onchange: null,
    addListener: () => {}, removeListener: () => {},
    addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
  })
}
afterEach(() => { window.matchMedia = originalMatchMedia })

describe('the slider reads oldest → newest, left → right', () => {
  /**
   * ⛔ `rows` IS NEWEST-FIRST. If the slider bound straight to `rowIdx` the
   * newest session would sit on the LEFT and every drag would feel inverted —
   * the same reversal the Heat Ribbon does for the same reason.
   */
  it('puts the newest session at the right-hand end', () => {
    mount({ rowIdx: 0 })
    expect(screen.getByTestId('scrubber-range').value).toBe('4')  // max
  })

  it('puts the oldest session at the left-hand end', () => {
    mount({ rowIdx: 4 })
    expect(screen.getByTestId('scrubber-range').value).toBe('0')
  })

  it('seeks by ROW INDEX, converting back from the slider position', () => {
    const { onSeek } = mount({ rowIdx: 0 })
    fireEvent.change(screen.getByTestId('scrubber-range'), { target: { value: '1' } })
    // slider 1 of 4 = the second-oldest session = rowIdx 3
    expect(onSeek).toHaveBeenCalledWith(3)
  })

  it('names the session it sits on', () => {
    mount({ rowIdx: 2 })
    expect(screen.getByTestId('scrubber-date').textContent).toBe('2026-08-23')
    expect(screen.getByTestId('scrubber-position').textContent).toBe('3 of 5')
  })

  it('marks a provisional row as provisional rather than as a finished day', () => {
    const live = [{ date: '2026-08-26', _live: true }, ...rows]
    render(<BreadthScrubber rows={live} rowIdx={0} playing={false}
                            onSeek={() => {}} onStep={() => {}} onPlayingChange={() => {}} />)
    expect(screen.getByTestId('scrubber-date').textContent).toBe('2026-08-26 · live')
  })
})

describe('playback', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  const tick = (ms) => act(() => { vi.advanceTimersByTime(ms) })

  it('advances one session toward the newest per tick', () => {
    const { onStep } = mount({ rowIdx: 4, playing: true })
    tick(1000 / DEFAULT_SPEED)
    expect(onStep).toHaveBeenCalledWith(3)
    tick(1000 / DEFAULT_SPEED)
    expect(onStep).toHaveBeenLastCalledWith(2)
  })

  /**
   * 🔴 IT STOPS AT THE NEWEST ROW; IT DOES NOT LOOP. Wrapping back to the oldest
   * would replay history as though it were still arriving, and the user would
   * have to catch the run to get off it.
   */
  it('stops at the newest row instead of wrapping', () => {
    const { onStep, onPlayingChange } = mount({ rowIdx: 0, playing: true })
    tick(1000)   // many ticks' worth
    expect(onStep).not.toHaveBeenCalled()
    expect(onPlayingChange).toHaveBeenCalledWith(false)
  })

  it('runs faster at a higher speed setting', () => {
    const fastest = SPEEDS.at(-1)
    expect(SPEEDS).toContain(DEFAULT_SPEED)
    // A window narrow enough that the fastest setting has ticked and the
    // default has not — so this measures the speed, not just "an interval ran".
    const between = Math.ceil(1000 / fastest) + 5
    expect(between).toBeLessThan(1000 / DEFAULT_SPEED)

    const slow = mount({ rowIdx: 4, playing: true })
    tick(between)
    expect(slow.onStep, 'the default speed ticked too early').not.toHaveBeenCalled()
    slow.unmount()

    const fast = mount({ rowIdx: 4, playing: true })
    fireEvent.change(screen.getAllByTestId('scrubber-speed').at(-1), { target: { value: String(fastest) } })
    tick(between)
    expect(fast.onStep).toHaveBeenCalledTimes(1)
  })

  it('does not tick at all while paused', () => {
    const { onStep } = mount({ rowIdx: 4, playing: false })
    tick(2000)
    expect(onStep).not.toHaveBeenCalled()
  })

  /**
   * ⛔ AN INTERVAL THAT OUTLIVES ITS COMPONENT keeps calling into a parent that
   * has stopped listening — and on this tab it would keep MOVING A CURSOR
   * nobody can see.
   */
  it('leaves no interval running after unmount', () => {
    const { unmount, onStep } = mount({ rowIdx: 4, playing: true })
    tick(1000 / DEFAULT_SPEED)
    expect(onStep).toHaveBeenCalledTimes(1)
    unmount()
    tick(5000)
    expect(onStep).toHaveBeenCalledTimes(1)
  })
})

describe('prefers-reduced-motion', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('disables autoplay and says so', () => {
    setReducedMotion(true)
    mount({ rowIdx: 4 })
    const play = screen.getByTestId('scrubber-play')
    expect(play).toBeDisabled()
    expect(play.getAttribute('title')).toBe(REDUCED_MOTION_NOTE)
    expect(screen.getByTestId('scrubber-note').textContent).toBe(REDUCED_MOTION_NOTE)
  })

  /**
   * ⭐ THE REFUSAL IS NOT ONLY IN THE BUTTON. A disabled control is a UI gate,
   * and a UI gate alone is the shape of guard this repo keeps finding inert —
   * so the interval reads the same media query and refuses to run even if
   * `playing` arrives true.
   */
  it('runs no interval even when told it is playing', () => {
    setReducedMotion(true)
    const { onStep, onPlayingChange } = mount({ rowIdx: 4, playing: true })
    act(() => { vi.advanceTimersByTime(5000) })
    expect(onStep).not.toHaveBeenCalled()
    expect(onPlayingChange).toHaveBeenCalledWith(false)   // and it stops the run
  })

  it('leaves manual scrubbing fully usable', () => {
    setReducedMotion(true)
    const { onSeek } = mount({ rowIdx: 0 })
    const range = screen.getByTestId('scrubber-range')
    expect(range).not.toBeDisabled()
    fireEvent.change(range, { target: { value: '0' } })
    expect(onSeek).toHaveBeenCalledWith(4)
  })
})

describe('what it refuses, and why it says so', () => {
  it('cannot play forward from the newest session, and states that', () => {
    mount({ rowIdx: 0 })
    const play = screen.getByTestId('scrubber-play')
    expect(play).toBeDisabled()
    expect(play.getAttribute('title')).toMatch(/newest session/i)
  })

  it('refuses a one-session window rather than rendering a dead slider', () => {
    render(<BreadthScrubber rows={[rows[0]]} rowIdx={0} playing={false}
                            onSeek={() => {}} onStep={() => {}} onPlayingChange={() => {}} />)
    expect(screen.getByTestId('scrubber-range')).toBeDisabled()
    expect(screen.getByTestId('scrubber-play').getAttribute('title')).toMatch(/nothing to play/i)
  })

  it('renders nothing at all with no window', () => {
    const { container } = render(
      <BreadthScrubber rows={[]} rowIdx={0} playing={false}
                       onSeek={() => {}} onStep={() => {}} onPlayingChange={() => {}} />)
    expect(container.firstChild).toBeNull()
  })
})
