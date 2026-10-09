// app/src/components/intro/IntroAnimation.daily.test.jsx
//
// Owner decision 2026-10-08: the intro film plays ONCE PER DAY PER BROWSER (the Eastern Time
// date), not on every new tab / browser session. A member who opens the app five times a day
// sees the ~9s film once.
//
// The failing-before case: a NEW TAB the same day (sessionStorage empty, localStorage kept).
// The session gate replayed the film there; the daily gate must not.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import IntroAnimation from './IntroAnimation'
import { etDay, hasSeenIntroToday, markIntroSeenToday } from './introStorage'

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { display_name: 'Test Trader' }, loading: false }),
  AuthProvider: ({ children }) => children,
}))

let reduced = false
beforeEach(() => {
  reduced = false
  window.sessionStorage.clear()
  window.localStorage.clear()
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: reduced, addEventListener() {}, removeEventListener() {} })))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  window.sessionStorage.clear()
  window.localStorage.clear()
})

const dialog = () => screen.queryByRole('dialog', { name: 'Welcome' })

describe('IntroAnimation: once per day per browser', () => {
  it('plays on the first load of the day', () => {
    render(<IntroAnimation />)
    expect(dialog()).not.toBeNull()
  })

  it('does not replay in a new tab the same day (session storage empty, local storage kept)', () => {
    const first = render(<IntroAnimation />)
    expect(dialog()).not.toBeNull()
    first.unmount()
    window.sessionStorage.clear()          // a new tab / browser restart
    render(<IntroAnimation />)
    expect(dialog()).toBeNull()
  })

  it('plays again on the next Eastern Time day', () => {
    window.localStorage.setItem('uct_intro_last_et_day', '2000-01-01')
    render(<IntroAnimation />)
    expect(dialog()).not.toBeNull()
  })

  it('reduced motion keeps its short version, on the same daily gate', () => {
    reduced = true
    const first = render(<IntroAnimation />)
    expect(dialog()).not.toBeNull()
    expect(screen.queryByLabelText('Skip intro')).toBeNull()   // the short, still version
    first.unmount()
    window.sessionStorage.clear()
    render(<IntroAnimation />)
    expect(dialog()).toBeNull()
  })

  it('the day is the ET date: 01:00 UTC is still the previous day in New York', () => {
    expect(etDay(new Date('2026-10-09T01:00:00Z'))).toBe('2026-10-08')
    expect(etDay(new Date('2026-10-09T05:00:00Z'))).toBe('2026-10-09')
  })

  it('blocked localStorage never throws and falls back to the session gate', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function getItem(k) {
      if (this === window.localStorage) throw new Error('blocked')
      return Object.prototype.hasOwnProperty.call(this, k) ? this[k] : null
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function setItem(k, v) {
      if (this === window.localStorage) throw new Error('blocked')
      this[k] = String(v)
    })
    expect(() => markIntroSeenToday()).not.toThrow()
    expect(hasSeenIntroToday()).toBe(true)   // the session mark answered
  })
})
