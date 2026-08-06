// app/src/components/intro/IntroAnimation.skipKeys.test.jsx
//
// The intro is a full-screen takeover, so a key that dismisses it must be
// CONSUMED by it — not merely handled first.
//
// The bug this pins: the skip handler ran in the capture phase (so nothing
// could stopPropagation it away) and called preventDefault(), but never
// stopped the event itself. One Escape therefore did two things — skipped the
// intro AND reached every window listener underneath. On a deep link like
// /calendar?earnings=NVDA the modal opens behind the intro, so the single
// Escape that dismissed the intro also hit EarningsModal's window keydown
// listener (EarningsModal.jsx:231) → onClose() → route.close() → the
// ?earnings param stripped. The symbol in a shared link was gone before the
// member ever saw it.
//
// The listener registered below is a faithful stand-in for that one: same
// node (window), same phase (bubble), same shape. The control case is what
// keeps this honest — a key the intro does NOT claim must still pass through,
// so a blanket "swallow every keydown" would fail here just as loudly as the
// original leak.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import IntroAnimation from './IntroAnimation'

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { display_name: 'Test Trader' }, loading: false }),
  AuthProvider: ({ children }) => children,
}))

// prefersReducedMotion() reads matchMedia, which jsdom does not implement.
// Report "no preference" so the full cinematic (the branch that owns the skip
// keys) is the one under test.
beforeEach(() => {
  window.sessionStorage.clear()
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener() {}, removeEventListener() {} })))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/** Mirrors EarningsModal's Escape-to-close listener: window, bubble phase. */
function spyOnWindowKeydown() {
  const seen = vi.fn()
  window.addEventListener('keydown', seen)
  return { seen, cleanup: () => window.removeEventListener('keydown', seen) }
}

describe('IntroAnimation — skip keys are consumed, not just handled first', () => {
  for (const key of [
    { key: 'Escape', code: 'Escape' },
    { key: 'Enter', code: 'Enter' },
    { key: ' ', code: 'Space' },
  ]) {
    it(`${key.code} dismisses the intro without reaching a listener underneath`, () => {
      const { seen, cleanup } = spyOnWindowKeydown()
      try {
        render(<IntroAnimation />)
        expect(screen.getByLabelText('Skip intro')).toBeTruthy()

        // Dispatch from body — where a real keystroke originates — so the
        // event actually travels window-capture → body → window-bubble.
        fireEvent.keyDown(document.body, key)

        // The intro is gone: the skip still works.
        expect(screen.queryByLabelText('Skip intro')).toBeNull()
        // And nothing underneath ever saw the key.
        expect(seen).not.toHaveBeenCalled()
      } finally {
        cleanup()
      }
    })
  }

  it('CONTROL: a key the intro does not claim still reaches listeners underneath', () => {
    const { seen, cleanup } = spyOnWindowKeydown()
    try {
      render(<IntroAnimation />)

      fireEvent.keyDown(document.body, { key: 'a', code: 'KeyA' })

      // Untouched: still playing, and the key passed straight through.
      expect(screen.getByLabelText('Skip intro')).toBeTruthy()
      expect(seen).toHaveBeenCalledTimes(1)
    } finally {
      cleanup()
    }
  })

  it('CONTROL: once the intro is done, skip keys flow through again', () => {
    const { seen, cleanup } = spyOnWindowKeydown()
    try {
      render(<IntroAnimation />)
      fireEvent.keyDown(document.body, { key: 'Escape', code: 'Escape' })
      expect(seen).not.toHaveBeenCalled()

      // The intro no longer owns the key — the app underneath does. Without
      // this, "consumed" would silently mean "swallowed forever".
      fireEvent.keyDown(document.body, { key: 'Escape', code: 'Escape' })
      expect(seen).toHaveBeenCalledTimes(1)
    } finally {
      cleanup()
    }
  })
})
