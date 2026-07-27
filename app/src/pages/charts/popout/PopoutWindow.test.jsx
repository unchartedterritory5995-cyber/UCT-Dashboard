import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import PopoutWindow from './PopoutWindow'

/** A stand-in for the window `window.open` hands back. */
function makeFakeWindow() {
  const doc = document.implementation.createHTMLDocument('popup')
  const listeners = {}
  return {
    document: doc,
    closed: false,
    KeyboardEvent: window.KeyboardEvent,
    addEventListener: (type, fn) => { (listeners[type] ||= []).push(fn) },
    removeEventListener: (type, fn) => {
      listeners[type] = (listeners[type] || []).filter(f => f !== fn)
    },
    history: { replaceState: vi.fn() },
    close: vi.fn(function () { this.closed = true }),
    _fire: (type) => (listeners[type] || []).forEach(fn => fn()),
  }
}

describe('PopoutWindow', () => {
  let openSpy

  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => {
    vi.useRealTimers()
    openSpy?.mockRestore()
  })

  it('renders children into the popped window, not the opener', () => {
    const fake = makeFakeWindow()
    openSpy = vi.spyOn(window, 'open').mockReturnValue(fake)

    render(<PopoutWindow title="Board"><p>hello monitor two</p></PopoutWindow>)

    expect(fake.document.body.textContent).toContain('hello monitor two')
    // The whole point: it must NOT also be sitting in the main document.
    expect(screen.queryByText('hello monitor two')).toBeNull()
  })

  it('reports a blocked popup instead of failing silently', () => {
    // window.open returns null when the browser blocks it — the one failure the
    // user cannot otherwise see.
    openSpy = vi.spyOn(window, 'open').mockReturnValue(null)
    const onBlocked = vi.fn()

    render(<PopoutWindow onBlocked={onBlocked}><p>x</p></PopoutWindow>)

    expect(onBlocked).toHaveBeenCalledTimes(1)
  })

  it('calls onClose when the user closes the window', () => {
    const fake = makeFakeWindow()
    openSpy = vi.spyOn(window, 'open').mockReturnValue(fake)
    const onClose = vi.fn()

    render(<PopoutWindow onClose={onClose}><p>x</p></PopoutWindow>)
    act(() => { fake._fire('beforeunload') })

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('still detects a close that fires no beforeunload', () => {
    const fake = makeFakeWindow()
    openSpy = vi.spyOn(window, 'open').mockReturnValue(fake)
    const onClose = vi.fn()

    render(<PopoutWindow onClose={onClose}><p>x</p></PopoutWindow>)
    fake.closed = true
    act(() => { vi.advanceTimersByTime(500) })

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('only reports a close once, however many signals arrive', () => {
    const fake = makeFakeWindow()
    openSpy = vi.spyOn(window, 'open').mockReturnValue(fake)
    const onClose = vi.fn()

    render(<PopoutWindow onClose={onClose}><p>x</p></PopoutWindow>)
    act(() => {
      fake._fire('beforeunload')
      fake.closed = true
      vi.advanceTimersByTime(2000)
    })

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closes the window when the opener unmounts, and reports no user close', () => {
    const fake = makeFakeWindow()
    openSpy = vi.spyOn(window, 'open').mockReturnValue(fake)
    const onClose = vi.fn()

    const { unmount } = render(<PopoutWindow onClose={onClose}><p>x</p></PopoutWindow>)
    unmount()

    expect(fake.close).toHaveBeenCalled()
    // Unmounting is the app docking the window back, not the user closing it —
    // firing onClose here would re-enter the dock handler.
    expect(onClose).not.toHaveBeenCalled()
  })

  it('does not reopen the window when the parent re-renders', () => {
    const fake = makeFakeWindow()
    openSpy = vi.spyOn(window, 'open').mockReturnValue(fake)

    const { rerender } = render(
      <PopoutWindow onClose={() => {}}><p>a</p></PopoutWindow>,
    )
    // New inline handler identity on every render is the normal calling pattern.
    rerender(<PopoutWindow onClose={() => {}}><p>b</p></PopoutWindow>)
    rerender(<PopoutWindow onClose={() => {}}><p>c</p></PopoutWindow>)

    expect(openSpy).toHaveBeenCalledTimes(1)
    expect(fake.document.body.textContent).toContain('c')
  })

  it('relabels the address strip to the app URL instead of about:blank', () => {
    const fake = makeFakeWindow()
    openSpy = vi.spyOn(window, 'open').mockReturnValue(fake)

    render(<PopoutWindow><p>x</p></PopoutWindow>)

    // Chrome won't let the strip be hidden, so it's relabelled in place. It must
    // be a replaceState, NOT a navigation — loading the URL would boot a second
    // copy of the app in the popup.
    expect(fake.history.replaceState).toHaveBeenCalledWith(
      {}, '', `${window.location.origin}/charts`,
    )
  })

  it('still opens the window if relabelling the strip is refused', () => {
    const fake = makeFakeWindow()
    fake.history.replaceState = vi.fn(() => { throw new Error('SecurityError') })
    openSpy = vi.spyOn(window, 'open').mockReturnValue(fake)

    render(<PopoutWindow><p>cosmetic only</p></PopoutWindow>)

    expect(fake.document.body.textContent).toContain('cosmetic only')
  })

  it('copies the opener stylesheets so the popup is not unstyled', () => {
    const fake = makeFakeWindow()
    openSpy = vi.spyOn(window, 'open').mockReturnValue(fake)
    const style = document.createElement('style')
    style.textContent = '.popout-probe { color: rgb(1, 2, 3); }'
    document.head.appendChild(style)

    try {
      render(<PopoutWindow><p>x</p></PopoutWindow>)
      expect(fake.document.head.innerHTML).toContain('.popout-probe')
    } finally {
      document.head.removeChild(style)
    }
  })
})
