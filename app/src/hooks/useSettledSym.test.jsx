import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'

import useSettledSym from './useSettledSym'

function Probe({ sym }) {
  const { settled, stepping } = useSettledSym(sym, 200)
  return (
    <>
      <span data-testid="settled">{settled}</span>
      <span data-testid="stepping">{String(stepping)}</span>
    </>
  )
}

describe('useSettledSym (§4.4 settle debounce)', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('the first symbol is settled immediately — opening must not wait 200ms', () => {
    render(<Probe sym="NVDA" />)
    expect(screen.getByTestId('settled').textContent).toBe('NVDA')
    expect(screen.getByTestId('stepping').textContent).toBe('false')
  })

  it('holds the previous symbol while stepping, then settles', () => {
    const { rerender } = render(<Probe sym="NVDA" />)
    rerender(<Probe sym="AMD" />)
    expect(screen.getByTestId('settled').textContent).toBe('NVDA')
    expect(screen.getByTestId('stepping').textContent).toBe('true')
    act(() => { vi.advanceTimersByTime(200) })
    expect(screen.getByTestId('settled').textContent).toBe('AMD')
    expect(screen.getByTestId('stepping').textContent).toBe('false')
  })

  it('a fast run of steps settles ONCE, on the last symbol', () => {
    const { rerender } = render(<Probe sym="A" />)
    for (const s of ['B', 'C', 'D', 'E']) {
      rerender(<Probe sym={s} />)
      act(() => { vi.advanceTimersByTime(50) })
    }
    expect(screen.getByTestId('settled').textContent).toBe('A')
    act(() => { vi.advanceTimersByTime(200) })
    expect(screen.getByTestId('settled').textContent).toBe('E')
  })

  it('settles on null (the modal closing) without hanging a timer', () => {
    const { rerender, unmount } = render(<Probe sym="NVDA" />)
    rerender(<Probe sym={null} />)
    act(() => { vi.advanceTimersByTime(200) })
    expect(screen.getByTestId('settled').textContent).toBe('')
    expect(() => unmount()).not.toThrow()
  })
})
