// Live sweep 2026-10-05: BRKE / ERX / EVTS answered `pending` and told the member to reopen.
// usePendingReask asks again on its own while pending, stops once answered, and gives up after
// PENDING_REASK_MAX tries.
import { render, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { usePendingReask, PENDING_REASK_MS, PENDING_REASK_MAX } from './depthFetch'

function Probe({ pending, mutate, k = 'NVDA' }) {
  usePendingReask(pending, mutate, k)
  return null
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('usePendingReask', () => {
  it('re-asks while pending and stops once the answer is in', () => {
    const mutate = vi.fn()
    const { rerender } = render(<Probe pending mutate={mutate} />)
    act(() => { vi.advanceTimersByTime(PENDING_REASK_MS) })
    expect(mutate).toHaveBeenCalledTimes(1)
    rerender(<Probe pending={false} mutate={mutate} />)
    act(() => { vi.advanceTimersByTime(PENDING_REASK_MS * 5) })
    expect(mutate).toHaveBeenCalledTimes(1)
  })

  it('never asks when nothing is pending', () => {
    const mutate = vi.fn()
    render(<Probe pending={false} mutate={mutate} />)
    act(() => { vi.advanceTimersByTime(PENDING_REASK_MS * 3) })
    expect(mutate).not.toHaveBeenCalled()
  })

  it('gives up after the cap, then starts fresh for a new symbol', () => {
    const mutate = vi.fn()
    const { rerender } = render(<Probe pending mutate={mutate} />)
    for (let i = 0; i < PENDING_REASK_MAX + 3; i++) {
      // a fresh `pending` answer each round, the way SWR hands back a new object
      rerender(<Probe pending mutate={mutate} k="NVDA" />)
      act(() => { vi.advanceTimersByTime(PENDING_REASK_MS) })
      rerender(<Probe pending={false} mutate={mutate} k="NVDA" />)
      rerender(<Probe pending mutate={mutate} k="NVDA" />)
    }
    expect(mutate.mock.calls.length).toBe(PENDING_REASK_MAX)
    rerender(<Probe pending mutate={mutate} k="AAPL" />)
    act(() => { vi.advanceTimersByTime(PENDING_REASK_MS) })
    expect(mutate.mock.calls.length).toBe(PENDING_REASK_MAX + 1)
  })
})

import { cleanup, screen } from '@testing-library/react'
import PendingGaveUp from './PendingGaveUp'

function GaveUpProbe({ pending, mutate, k = 'NVDA' }) {
  const r = usePendingReask(pending, mutate, k)
  return <PendingGaveUp exhausted={r.exhausted} onRetry={r.retry} what="The read" />
}

describe('after the cap the panel stops promising and offers a check', () => {
  afterEach(() => cleanup())
  it('says automatic checking has stopped, and Check again re-arms it', () => {
    const mutate = vi.fn()
    const { rerender } = render(<GaveUpProbe pending mutate={mutate} />)
    for (let i = 0; i < PENDING_REASK_MAX + 1; i++) {
      act(() => { vi.advanceTimersByTime(PENDING_REASK_MS) })
      rerender(<GaveUpProbe pending={false} mutate={mutate} />)
      rerender(<GaveUpProbe pending mutate={mutate} />)
    }
    expect(screen.getByTestId('pending-gave-up').textContent).toMatch(/automatic checking has stopped/)
    const before = mutate.mock.calls.length
    act(() => { screen.getByRole('button', { name: 'Check again' }).click() })
    expect(mutate.mock.calls.length).toBe(before + 1)
    expect(screen.queryByTestId('pending-gave-up')).toBeNull()
    act(() => { vi.advanceTimersByTime(PENDING_REASK_MS) })
    expect(mutate.mock.calls.length).toBe(before + 2)
  })

  it('never shows while the re-ask is still running', () => {
    render(<GaveUpProbe pending mutate={vi.fn()} />)
    expect(screen.queryByTestId('pending-gave-up')).toBeNull()
  })
})
