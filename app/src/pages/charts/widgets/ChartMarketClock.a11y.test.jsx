// The chart header's market clock is a TAB STOP on purpose (focus reveals the session
// popup for a keyboard user), and it was a bare <div tabindex=0>: VoiceOver read "10:46:04
// PM ET" with no role and no name (WebKit walk of the TickerPopup, 1194 and 1200).
import { render, screen, fireEvent, act } from '@testing-library/react'
import { vi, test, expect, afterEach } from 'vitest'

vi.mock('../../../hooks/useMarketOpen', () => ({
  default: () => ({ isOpen: false, isExtended: false }),
}))

import ChartMarketClock from './ChartMarketClock'

afterEach(() => { vi.useRealTimers() })

test('the clock is a named timer that keeps its tab stop', () => {
  render(<ChartMarketClock />)
  const clock = screen.getByRole('timer')
  expect(clock).toHaveAttribute('tabindex', '0')
  expect(clock).toHaveAccessibleName(/^Market clock, \d{1,2}:\d{2} (AM|PM) ET, /)
})

test('the name carries the minute, never the second -- a focused clock is not re-announced every tick', () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-27T14:46:04Z'))
  render(<ChartMarketClock />)
  const clock = screen.getByRole('timer')
  const before = clock.getAttribute('aria-label')
  expect(before).not.toMatch(/:\d{2}:\d{2}/)
  act(() => { vi.advanceTimersByTime(3000) })
  expect(clock.getAttribute('aria-label')).toBe(before)
  // the VISIBLE clock still ticks seconds
  expect(clock.textContent).toMatch(/:\d{2}:\d{2}/)
})

test('focus still reveals the session popup (the reason it is focusable)', () => {
  render(<ChartMarketClock />)
  const clock = screen.getByRole('timer')
  fireEvent.focus(clock)
  // the name already carries the same status line the popup shows
  expect(clock.getAttribute('aria-label')).toMatch(/MARKET CLOSED|Opens|Closes/i)
})
