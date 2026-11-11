import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'

import useSymbolSettle, { settleAction, QUIET_MS, BURST_SETTLE_MS } from './useSymbolSettle'

function Probe({ sym, isWarm, ms = 90, log }) {
  const settled = useSymbolSettle(sym, { debounceMs: ms, isWarm })
  log?.push(settled)
  return <span data-testid="settled">{settled}</span>
}
const shown = () => screen.getByTestId('settled').textContent
const wait = (ms) => act(() => { vi.advanceTimersByTime(ms) })

describe('settleAction', () => {
  it('applies the first change after a quiet stretch', () => {
    expect(settleAction({ now: 1000, lastRequestAt: 1000 - QUIET_MS - 1, lastAppliedAt: 0, warm: false })).toBe('apply')
  })
  it('defers a change inside a burst when the symbol is not warm', () => {
    expect(settleAction({ now: 1000, lastRequestAt: 950, lastAppliedAt: 0, warm: false })).toBe('defer')
  })
  it('applies a warm symbol inside a burst once enough time has passed since the last apply', () => {
    expect(settleAction({ now: 1000, lastRequestAt: 950, lastAppliedAt: 1000 - BURST_SETTLE_MS, warm: true })).toBe('apply')
  })
  it('defers a warm symbol inside a burst when the last apply was too recent', () => {
    expect(settleAction({ now: 1000, lastRequestAt: 950, lastAppliedAt: 1000 - BURST_SETTLE_MS + 1, warm: true })).toBe('defer')
  })
})

describe('useSymbolSettle', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(100000) })
  afterEach(() => vi.useRealTimers())

  it('settles the first symbol on mount', () => {
    render(<Probe sym="NVDA" />)
    expect(shown()).toBe('NVDA')
  })

  it('a change after a quiet stretch lands in the same commit, with no timer', () => {
    const { rerender } = render(<Probe sym="NVDA" />)
    wait(QUIET_MS + 1)
    rerender(<Probe sym="AMD" />)
    expect(shown()).toBe('AMD')
  })

  it('a key-through every 100 ms applies only the leading symbol and the last, in order', () => {
    const log = []
    const { rerender } = render(<Probe sym="A" log={log} />)
    wait(QUIET_MS + 1)
    for (const s of ['B', 'C', 'D', 'E', 'F']) {
      rerender(<Probe sym={s} log={log} />)
      wait(100)
    }
    wait(BURST_SETTLE_MS)
    expect(shown()).toBe('F')
    const applied = [...new Set(log)]
    expect(applied).toEqual(['A', 'B', 'F'])
  })

  it('a timer armed for an earlier symbol never lands after the request moved on', () => {
    const { rerender } = render(<Probe sym="A" />)
    wait(QUIET_MS + 1)
    rerender(<Probe sym="B" />)      // leading
    wait(10)
    rerender(<Probe sym="C" />)      // deferred
    wait(50)
    rerender(<Probe sym="D" />)      // replaces the deferred C
    wait(BURST_SETTLE_MS - 1)
    expect(shown()).toBe('B')        // nothing landed yet, and never C
    wait(2)
    expect(shown()).toBe('D')
  })

  it('a return to the settled symbol during a burst cancels the pending one', () => {
    const { rerender } = render(<Probe sym="A" />)
    wait(QUIET_MS + 1)
    rerender(<Probe sym="B" />)
    wait(10)
    rerender(<Probe sym="C" />)
    wait(10)
    rerender(<Probe sym="B" />)
    wait(BURST_SETTLE_MS + 5)
    expect(shown()).toBe('B')
  })

  it('applies a warm symbol at once inside a burst when the last apply was long enough ago', () => {
    const { rerender } = render(<Probe sym="A" isWarm={() => true} />)
    wait(QUIET_MS + 1)
    rerender(<Probe sym="B" isWarm={() => true} />)
    wait(BURST_SETTLE_MS)
    rerender(<Probe sym="C" isWarm={() => true} />)
    expect(shown()).toBe('C')
  })

  it('a zero wait passes the request straight through', () => {
    const { rerender } = render(<Probe sym="A" ms={0} />)
    rerender(<Probe sym="B" ms={0} />)
    expect(shown()).toBe('B')
    rerender(<Probe sym="C" ms={0} />)
    expect(shown()).toBe('C')
  })
})
