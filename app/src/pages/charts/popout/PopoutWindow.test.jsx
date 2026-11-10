import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import PopoutWindow, { markAppClosing, clearAppClosing, __resetAppClosingForTests } from './PopoutWindow'
import { reloadNow } from '../../../lib/reloadGuard'
import { hasOpenPopouts } from '../../../lib/popoutRegistry'

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
    __resetAppClosingForTests()
  })

  // Blink dispatches the popup's beforeunload synchronously inside close(). The
  // ordering is what loses a board, so the fake reproduces it.
  function makeClosingFake() {
    const fake = makeFakeWindow()
    fake.close = vi.fn(function () { this.closed = true; fake._fire('beforeunload') })
    return fake
  }

  describe('the opener going away', () => {
    it('does not report a user close when the opener unloads', () => {
      const fake = makeClosingFake()
      openSpy = vi.spyOn(window, 'open').mockReturnValue(fake)
      const onClose = vi.fn()

      render(<PopoutWindow onClose={onClose}><p>x</p></PopoutWindow>)
      act(() => {
        window.dispatchEvent(new Event('beforeunload', { cancelable: true }))
        window.dispatchEvent(new Event('pagehide'))
      })

      expect(fake.close).toHaveBeenCalled()
      expect(onClose).not.toHaveBeenCalled()
    })

    it('the win.closed poll does not report it either', () => {
      const fake = makeClosingFake()
      openSpy = vi.spyOn(window, 'open').mockReturnValue(fake)
      const onClose = vi.fn()

      render(<PopoutWindow onClose={onClose}><p>x</p></PopoutWindow>)
      act(() => {
        window.dispatchEvent(new Event('beforeunload', { cancelable: true }))
        vi.advanceTimersByTime(2000)
      })

      expect(onClose).not.toHaveBeenCalled()
    })

    it('hands the board back if the page is still alive after the unload was cancelled', () => {
      // "Leave site?" answered Stay (the indicator builder's unsaved-draft guard):
      // the window is already gone and the page lives on.
      const fake = makeClosingFake()
      openSpy = vi.spyOn(window, 'open').mockReturnValue(fake)
      const onClose = vi.fn()

      render(<PopoutWindow onClose={onClose}><p>x</p></PopoutWindow>)
      act(() => { window.dispatchEvent(new Event('beforeunload', { cancelable: true })) })
      expect(onClose).not.toHaveBeenCalled()

      act(() => { vi.advanceTimersByTime(6000) })
      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('an unmount inside that wait reports nothing', () => {
      const fake = makeClosingFake()
      openSpy = vi.spyOn(window, 'open').mockReturnValue(fake)
      const onClose = vi.fn()

      const { unmount } = render(<PopoutWindow onClose={onClose}><p>x</p></PopoutWindow>)
      act(() => { window.dispatchEvent(new Event('beforeunload', { cancelable: true })) })
      unmount()
      act(() => { vi.advanceTimersByTime(6000) })

      expect(onClose).not.toHaveBeenCalled()
    })
  })

  describe('markAppClosing', () => {
    it('stops a window closing first from reporting a user close', () => {
      const fake = makeFakeWindow()
      openSpy = vi.spyOn(window, 'open').mockReturnValue(fake)
      const onClose = vi.fn()

      render(<PopoutWindow onClose={onClose}><p>x</p></PopoutWindow>)
      markAppClosing()
      act(() => {
        fake._fire('beforeunload')
        fake.closed = true
        vi.advanceTimersByTime(2000)
      })

      expect(onClose).not.toHaveBeenCalled()
    })

    it('clearAppClosing: after a cancelled reload a close is a user close again', () => {
      const fake = makeFakeWindow()
      openSpy = vi.spyOn(window, 'open').mockReturnValue(fake)
      const onClose = vi.fn()

      render(<PopoutWindow onClose={onClose}><p>x</p></PopoutWindow>)
      markAppClosing()
      clearAppClosing()
      act(() => {
        fake._fire('beforeunload')
        fake.closed = true
        vi.advanceTimersByTime(2000)
      })

      expect(onClose).toHaveBeenCalled()
    })

    it('reloadNow: marks closing, and clears it 5s later when the page stayed (Stay on Leave site)', () => {
      const fake = makeFakeWindow()
      openSpy = vi.spyOn(window, 'open').mockReturnValue(fake)
      const onClose = vi.fn()
      render(<PopoutWindow onClose={onClose}><p>x</p></PopoutWindow>)

      reloadNow({ reload: () => {} })           // real timers faked by this file's useFakeTimers
      act(() => { fake._fire('beforeunload'); fake.closed = true; vi.advanceTimersByTime(1000) })
      expect(onClose).not.toHaveBeenCalled()    // while the reload is pending, no dock

      act(() => { vi.advanceTimersByTime(5000) })  // page still alive: flag cleared
      const fake2 = makeFakeWindow()
      openSpy.mockReturnValue(fake2)
      const onClose2 = vi.fn()
      render(<PopoutWindow onClose={onClose2}><p>y</p></PopoutWindow>)
      act(() => { fake2._fire('beforeunload'); fake2.closed = true; vi.advanceTimersByTime(2000) })
      expect(onClose2).toHaveBeenCalled()       // a close docks again
    })

    it('control: without it the same close is reported', () => {
      const fake = makeFakeWindow()
      openSpy = vi.spyOn(window, 'open').mockReturnValue(fake)
      const onClose = vi.fn()

      render(<PopoutWindow onClose={onClose}><p>x</p></PopoutWindow>)
      act(() => { fake._fire('beforeunload') })

      expect(onClose).toHaveBeenCalledTimes(1)
    })
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

  it('registers an open window and releases it on unmount', () => {
    const fake = makeFakeWindow()
    openSpy = vi.spyOn(window, 'open').mockReturnValue(fake)

    const { unmount } = render(<PopoutWindow><p>x</p></PopoutWindow>)
    expect(hasOpenPopouts()).toBe(true)
    unmount()
    expect(hasOpenPopouts()).toBe(false)
  })

  it('a blocked window.open does not register', () => {
    openSpy = vi.spyOn(window, 'open').mockReturnValue(null)

    const { unmount } = render(<PopoutWindow><p>x</p></PopoutWindow>)
    expect(hasOpenPopouts()).toBe(false)
    unmount()
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

describe('PopoutWindow names and placement', () => {
  let openSpy
  const FEATURES = 'width=1200,height=800,left=0,top=0,popup=yes,menubar=no,toolbar=no,location=no,status=no,resizable=yes,scrollbars=yes'
  const SHELL_FEATURES = 'width=1200,height=800,popup=yes,menubar=no,toolbar=no,location=no,status=no,resizable=yes,scrollbars=yes'

  function makeOverhangingFake() {
    const fake = makeFakeWindow()
    return Object.assign(fake, { screen: { availHeight: 1000 }, outerHeight: 1100, outerWidth: 800, screenY: 0, resizeTo: vi.fn() })
  }
  const inShell = () => { window.uctDesktop = { bridgeVersion: 1, capabilities: ['before-quit', 'window-state'] } }

  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => {
    vi.useRealTimers()
    openSpy?.mockRestore()
    delete window.uctDesktop
  })

  it('default props open exactly what a browser opens today', () => {
    const fake = makeOverhangingFake()
    openSpy = vi.spyOn(window, 'open').mockReturnValue(fake)
    render(<PopoutWindow><p>x</p></PopoutWindow>)
    expect(openSpy).toHaveBeenCalledWith('', '', FEATURES)
    expect(fake.resizeTo).toHaveBeenCalled()
  })

  it('a named window in a browser is still anonymous and still anchored', () => {
    const fake = makeOverhangingFake()
    openSpy = vi.spyOn(window, 'open').mockReturnValue(fake)
    render(<PopoutWindow windowName="uct-board-pl-1"><p>x</p></PopoutWindow>)
    expect(openSpy).toHaveBeenCalledWith('', '', FEATURES)
    expect(fake.resizeTo).toHaveBeenCalled()
  })

  it('in the app a named window keeps its name and leaves placement to the shell', () => {
    inShell()
    const fake = makeOverhangingFake()
    openSpy = vi.spyOn(window, 'open').mockReturnValue(fake)
    render(<PopoutWindow windowName="uct-board-pl-1"><p>x</p></PopoutWindow>)
    expect(openSpy).toHaveBeenCalledWith('', 'uct-board-pl-1', SHELL_FEATURES)
    act(() => { vi.advanceTimersByTime(500) })
    expect(fake.resizeTo, 'fitToWorkArea would fight the saved bounds').not.toHaveBeenCalled()
  })

  it('in the app an unnamed window is treated as today', () => {
    inShell()
    const fake = makeOverhangingFake()
    openSpy = vi.spyOn(window, 'open').mockReturnValue(fake)
    render(<PopoutWindow><p>x</p></PopoutWindow>)
    expect(openSpy).toHaveBeenCalledWith('', '', FEATURES)
    expect(fake.resizeTo).toHaveBeenCalled()
  })

  it('a null window.open with a name still reports blocked', () => {
    inShell()
    openSpy = vi.spyOn(window, 'open').mockReturnValue(null)
    const onBlocked = vi.fn()
    render(<PopoutWindow windowName="uct-board-pl-1" onBlocked={onBlocked}><p>x</p></PopoutWindow>)
    expect(onBlocked).toHaveBeenCalledTimes(1)
  })

  it('a named window handed back still holding the last root is cleared, not doubled', () => {
    inShell()
    const fake = makeFakeWindow()
    const stale = fake.document.createElement('div')
    stale.className = 'uct-popout-root'
    stale.textContent = 'the window this name had a tick ago'
    fake.document.body.appendChild(stale)
    const staleStyle = fake.document.createElement('style')
    staleStyle.id = 'stale-style'
    fake.document.head.appendChild(staleStyle)
    openSpy = vi.spyOn(window, 'open').mockReturnValue(fake)

    render(<PopoutWindow windowName="uct-board-pl-1"><p>fresh</p></PopoutWindow>)

    const roots = fake.document.querySelectorAll('.uct-popout-root')
    expect(roots).toHaveLength(1)
    expect(roots[0].textContent).toBe('fresh')
    expect(fake.document.body.textContent).not.toContain('a tick ago')
    expect(fake.document.getElementById('stale-style'), 'the mirrored styles of the last mount go too').toBeNull()
  })
})
