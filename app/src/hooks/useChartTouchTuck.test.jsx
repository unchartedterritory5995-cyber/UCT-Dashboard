// app/src/hooks/useChartTouchTuck.test.jsx
//
// Decision B3 (2026-11-07): on the phone chart shell the floating buttons hide while
// the chart is being touched — pointerdown on the chart until a short idle after the
// last pointerup. This hook is the one writer of the root attribute every reader keys
// on. jsdom does no layout, so these cases assert the attribute and its timing.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, cleanup, fireEvent } from '@testing-library/react'
import { useRef } from 'react'
import useChartTouchTuck, { CHART_TOUCH_ATTR, CHART_TOUCH_IDLE_MS } from './useChartTouchTuck'

function Harness({ enabled = true, idleMs }) {
  const ref = useRef(null)
  useChartTouchTuck(ref, { enabled, ...(idleMs ? { idleMs } : null) })
  return (
    <div ref={ref} data-testid="chart">
      <canvas data-testid="canvas" />
      <button type="button" data-testid="chip">RSI(14)</button>
      <span role="button" data-testid="legend-chip">MACD</span>
      {/* a phone chip that taps through to the editor: no role, only the chip's id */}
      <span data-instance-id="inst:rsi:1" data-testid="tap-chip"><span data-testid="tap-chip-label">RSI(14) 54.3</span></span>
    </div>
  )
}
const root = () => document.documentElement
const tucked = () => root().hasAttribute(CHART_TOUCH_ATTR)
const down = (el, init = {}) => fireEvent.pointerDown(el, { pointerType: 'touch', pointerId: 1, ...init })
const up = (init = {}) => fireEvent.pointerUp(window, { pointerType: 'touch', pointerId: 1, ...init })

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { cleanup(); vi.useRealTimers(); root().removeAttribute(CHART_TOUCH_ATTR) })

describe('B3 · the chart-touch tuck', () => {
  it('the attribute name is the one the readers use, and the idle is short', () => {
    expect(CHART_TOUCH_ATTR).toBe('data-chart-touching')
    expect(CHART_TOUCH_IDLE_MS).toBeGreaterThan(0)
    expect(CHART_TOUCH_IDLE_MS).toBeLessThanOrEqual(1400) // never longer than the scroll tuck
  })

  it('a finger down on the chart tucks at once; it stays while the finger is down', () => {
    const { getByTestId } = render(<Harness />)
    expect(tucked()).toBe(false)
    down(getByTestId('canvas'))
    expect(tucked()).toBe(true)
    vi.advanceTimersByTime(CHART_TOUCH_IDLE_MS * 5)
    expect(tucked(), 'a held finger must keep the buttons away').toBe(true)
  })

  it('lifting starts the idle: still tucked just before it ends, back right after', () => {
    const { getByTestId } = render(<Harness />)
    down(getByTestId('canvas'))
    up()
    expect(tucked()).toBe(true)
    vi.advanceTimersByTime(CHART_TOUCH_IDLE_MS - 1)
    expect(tucked()).toBe(true)
    vi.advanceTimersByTime(1)
    expect(tucked()).toBe(false)
  })

  it('a lift heard anywhere on the window counts (a pan that ends off the chart)', () => {
    const { getByTestId } = render(<Harness />)
    down(getByTestId('canvas'))
    fireEvent.pointerCancel(window, { pointerType: 'touch', pointerId: 1 })
    vi.advanceTimersByTime(CHART_TOUCH_IDLE_MS)
    expect(tucked()).toBe(false)
  })

  it('a second press inside the idle keeps the buttons away (no flicker between pans)', () => {
    const { getByTestId } = render(<Harness />)
    down(getByTestId('canvas'))
    up()
    vi.advanceTimersByTime(CHART_TOUCH_IDLE_MS - 50)
    down(getByTestId('canvas'))
    vi.advanceTimersByTime(200)
    expect(tucked()).toBe(true)
    up()
    vi.advanceTimersByTime(CHART_TOUCH_IDLE_MS)
    expect(tucked()).toBe(false)
  })

  it('a pinch: the idle starts only when the LAST finger lifts', () => {
    const { getByTestId } = render(<Harness />)
    down(getByTestId('canvas'), { pointerId: 1 })
    down(getByTestId('canvas'), { pointerId: 2 })
    up({ pointerId: 1 })
    vi.advanceTimersByTime(CHART_TOUCH_IDLE_MS * 2)
    expect(tucked(), 'one finger is still on the chart').toBe(true)
    up({ pointerId: 2 })
    vi.advanceTimersByTime(CHART_TOUCH_IDLE_MS)
    expect(tucked()).toBe(false)
  })

  it('⛔ a mouse never tucks anything', () => {
    const { getByTestId } = render(<Harness />)
    down(getByTestId('canvas'), { pointerType: 'mouse' })
    expect(tucked()).toBe(false)
  })

  it('⛔ a press on one of the chart\'s own controls (a legend chip, a button) is not touching the chart', () => {
    const { getByTestId } = render(<Harness />)
    down(getByTestId('chip'))
    expect(tucked()).toBe(false)
    down(getByTestId('legend-chip'), { pointerId: 3 })
    expect(tucked()).toBe(false)
    // review, 2026-11-07: a chip with no button role (onBodyTap), pressed on its label
    down(getByTestId('tap-chip-label'), { pointerId: 5 })
    expect(tucked()).toBe(false)
    // …and the control: the same finger on the canvas does tuck
    down(getByTestId('canvas'), { pointerId: 4 })
    expect(tucked()).toBe(true)
  })

  it('⛔ a press OUTSIDE the chart is not touching the chart', () => {
    render(<Harness />)
    down(document.body)
    expect(tucked()).toBe(false)
  })

  it('a lift with no matching press does not start anything', () => {
    render(<Harness />)
    root().setAttribute(CHART_TOUCH_ATTR, '') // someone else's state, untouched
    up({ pointerId: 99 })
    vi.advanceTimersByTime(CHART_TOUCH_IDLE_MS * 2)
    expect(tucked()).toBe(true)
  })

  it('disabled: no listener, no attribute', () => {
    const { getByTestId } = render(<Harness enabled={false} />)
    down(getByTestId('canvas'))
    expect(tucked()).toBe(false)
  })

  it('the attribute never outlives the shell: unmount mid-touch clears it', () => {
    const { getByTestId, unmount } = render(<Harness />)
    down(getByTestId('canvas'))
    expect(tucked()).toBe(true)
    unmount()
    expect(tucked()).toBe(false)
  })
})
