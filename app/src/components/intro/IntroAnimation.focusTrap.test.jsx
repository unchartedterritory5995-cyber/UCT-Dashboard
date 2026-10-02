// app/src/components/intro/IntroAnimation.focusTrap.test.jsx
//
// A2R-01 (a11y second review, 2026-10-01). The intro's own "Skip intro" being
// the first Tab stop on a fresh load is correct (ruled so in
// docs/notebook/accessibility.md) -- an interstitial's own door goes first.
// What was missing: the overlay (position:fixed, full-screen, z-index 99999)
// had no trap, so a bare Tab -- the one key the overlay's own capture listener
// does NOT claim (only Escape/Enter/Space dismiss it) -- walked straight past
// Skip into whatever the app renders after it in the DOM, while the overlay
// still visually covered the whole page. These tests mount IntroAnimation
// beside real background content (mirroring App.jsx's actual sibling order)
// and prove Tab cannot reach it while the intro is playing.
//
// ⛔ `userEvent.tab()`, never `fireEvent.keyDown(el, {key:'Tab'})`. jsdom does
// not implement the browser's own Tab focus-traversal, so a raw keydown moves
// nothing and a test written that way passes whether or not a trap exists —
// confirmed by mutation: with `useFocusTrap(false, stageRef)` planted, every
// fireEvent-based version of this file still passed. `@testing-library/
// user-event`'s `tab()` is the one API here that actually simulates focus
// moving, which is the thing under test.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import IntroAnimation from './IntroAnimation'

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { display_name: 'Test Trader' }, loading: false }),
  AuthProvider: ({ children }) => children,
}))

function Background() {
  return (
    <div>
      {/* Stands in for the Notebook's own "Skip to notes list" -- the exact
          control A2R-01's walk found itself tabbing to on the second press. */}
      <a href="#notes" data-testid="background-link">Skip to notes list</a>
    </div>
  )
}

beforeEach(() => {
  window.sessionStorage.clear()
  // prefersReducedMotion() reads matchMedia, which jsdom does not implement.
  // "no preference" so the full cinematic (the `playing` branch) is under test.
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener() {}, removeEventListener() {} })))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('IntroAnimation — focus trap while playing (A2R-01)', () => {
  it('a second Tab (after Skip) does NOT reach content behind the overlay', async () => {
    const user = userEvent.setup()
    render(<><IntroAnimation /><Background /></>)
    const skip = screen.getByRole('button', { name: 'Skip intro' })
    skip.focus()
    expect(document.activeElement).toBe(skip)

    await user.tab()

    // The background link must never have received focus while the intro is
    // still up -- the whole point of the trap. With only one focusable node
    // in the overlay, the trap keeps returning focus to it.
    expect(document.activeElement).not.toBe(screen.getByTestId('background-link'))
    expect(document.activeElement).toBe(skip)
  })

  it('Shift+Tab from Skip also stays inside (wraps, does not walk backward out)', async () => {
    const user = userEvent.setup()
    render(<><Background /><IntroAnimation /></>)
    const skip = screen.getByRole('button', { name: 'Skip intro' })
    skip.focus()

    await user.tab({ shift: true })

    expect(document.activeElement).not.toBe(screen.getByTestId('background-link'))
    expect(document.activeElement).toBe(skip)
  })

  it('CONTROL: once the intro is dismissed, Tab reaches the background normally', async () => {
    const user = userEvent.setup()
    render(<><IntroAnimation /><Background /></>)
    const skip = screen.getByRole('button', { name: 'Skip intro' })
    skip.focus()
    await user.click(skip)
    expect(screen.queryByRole('button', { name: 'Skip intro' })).toBeNull()

    screen.getByTestId('background-link').focus()
    expect(document.activeElement).toBe(screen.getByTestId('background-link'))
  })

  it('CONTROL: the reduced-motion branch is trapped too (its only focus target is the overlay itself)', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('matchMedia', vi.fn((q) => ({
      matches: q.includes('prefers-reduced-motion'),
      addEventListener() {}, removeEventListener() {},
    })))
    render(<><IntroAnimation /><Background /></>)
    const dialog = screen.getByRole('dialog', { name: 'Welcome' })
    dialog.focus()
    expect(document.activeElement).toBe(dialog)

    await user.tab()

    expect(document.activeElement).not.toBe(screen.getByTestId('background-link'))
  })
})
