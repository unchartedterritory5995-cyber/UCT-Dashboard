// (review of #2934, U1) a held switch tells the member the ticker was taken, without changing the header or the chart.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, render, screen, act } from '@testing-library/react'
import PendingSwitchCue, { usePendingCue, PENDING_CUE_MS } from './PendingSwitchCue'

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('the pending switch cue', () => {
  it('shows only after the switch has been held PENDING_CUE_MS, and goes the moment it commits', () => {
    const h = renderHook(({ req, shown }) => usePendingCue(req, shown), { initialProps: { req: 'AAA', shown: 'AAA' } })
    expect(h.result.current).toBe(null)
    h.rerender({ req: 'BBB', shown: 'AAA' })
    act(() => { vi.advanceTimersByTime(PENDING_CUE_MS - 1) })
    expect(h.result.current).toBe(null)                   // a switch that commits quickly never shows it
    act(() => { vi.advanceTimersByTime(1) })
    expect(h.result.current).toBe('BBB')
    h.rerender({ req: 'BBB', shown: 'BBB' })              // the switch committed
    expect(h.result.current).toBe(null)
  })

  it('a newer press restarts the wait and names the newer ticker', () => {
    const h = renderHook(({ req, shown }) => usePendingCue(req, shown), { initialProps: { req: 'BBB', shown: 'AAA' } })
    act(() => { vi.advanceTimersByTime(PENDING_CUE_MS) })
    expect(h.result.current).toBe('BBB')
    h.rerender({ req: 'CCC', shown: 'AAA' })
    expect(h.result.current).toBe(null)
    act(() => { vi.advanceTimersByTime(PENDING_CUE_MS) })
    expect(h.result.current).toBe('CCC')
  })

  it('renders a status chip naming the ticker, and nothing without one', () => {
    const { rerender } = render(<PendingSwitchCue sym="BL" />)
    expect(screen.getByRole('status')).toHaveTextContent('BL')
    rerender(<PendingSwitchCue sym={null} />)
    expect(screen.queryByRole('status')).toBe(null)
  })
})
