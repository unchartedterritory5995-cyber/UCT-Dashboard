// app/src/components/intro/IntroAnimation.weekly.test.jsx
//
// S12 (audit 2026-11-05, M9): the intro FILM plays in full ONCE A WEEK PER DEVICE (Eastern Time days); every other
// page load gets a 0.6 s fade that never blocks a press. ⚰️ This file was IntroAnimation.daily.test.jsx, pinning
// once per day (owner decision 2026-10-08) -- a daily member still saw the ~9 s film every morning.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import IntroAnimation, { QUICK_FADE_MS } from './IntroAnimation'
import { etDay, fullIntroDue, markFullIntroPlayed, FULL_INTRO_EVERY_DAYS } from './introStorage'

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
  window.history.replaceState(null, '', '/')
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  window.sessionStorage.clear()
  window.localStorage.clear()
})

const film = () => screen.queryByRole('dialog', { name: 'Welcome' })
const fade = () => document.querySelector('[data-intro-fade]')
const KEY = 'uct_intro_last_full_et_day'
const daysAgo = (n) => etDay(new Date(Date.now() - n * 86400000))

describe('IntroAnimation: the film once a week per device, a 0.6 s fade otherwise', () => {
  it('plays the film on a device that has never seen it', () => {
    render(<IntroAnimation />)
    expect(film()).not.toBeNull()
    expect(screen.getByLabelText('Skip intro')).toBeTruthy()
  })

  it('the next load -- a new tab, the same day -- gets the fade on the Notebook, not the film', () => {
    const first = render(<IntroAnimation />)
    first.unmount()
    window.sessionStorage.clear()
    window.history.replaceState(null, '', '/journal/notebook')
    render(<IntroAnimation />)
    expect(film()).toBeNull()
    expect(fade()).not.toBeNull()
  })

  // Fix round 1 (review Minor 12): M9 is the PHONE NOTEBOOK's mockup, and its "otherwise a 0.6 s fade" is the
  // Notebook's. Off the Notebook a load between two films shows nothing, as before (the film itself stays app-wide).
  it('off the Notebook, a load between two films shows no fade', () => {
    markFullIntroPlayed()
    window.history.replaceState(null, '', '/dashboard')
    render(<IntroAnimation />)
    expect(film()).toBeNull()
    expect(fade()).toBeNull()
  })

  // Fix round 1 (review Minor 12): the old daily key (`uct_intro_last_et_day`) counts as the film having played that
  // day -- no member sees the 9 s film on the first load after the deploy just because the key's name changed -- and
  // it is retired once read.
  it('the old daily key counts as seen, and is removed', () => {
    window.localStorage.setItem('uct_intro_last_et_day', daysAgo(1))
    expect(fullIntroDue()).toBe(false)
    expect(window.localStorage.getItem('uct_intro_last_et_day')).toBeNull()
    expect(window.localStorage.getItem(KEY)).toBe(daysAgo(1))
  })

  it('an old key a week old migrates and the film is due again', () => {
    window.localStorage.setItem('uct_intro_last_et_day', daysAgo(FULL_INTRO_EVERY_DAYS))
    expect(fullIntroDue()).toBe(true)
  })

  it('six days later it is still the fade; seven days later the film plays again', () => {
    window.localStorage.setItem(KEY, daysAgo(FULL_INTRO_EVERY_DAYS - 1))
    const six = render(<IntroAnimation />)
    expect(film()).toBeNull()
    six.unmount()
    window.localStorage.setItem(KEY, daysAgo(FULL_INTRO_EVERY_DAYS))
    render(<IntroAnimation />)
    expect(film()).not.toBeNull()
  })

  it('the fade lasts 0.6 s, is hidden from assistive tech, and never blocks a press', () => {
    vi.useFakeTimers()
    markFullIntroPlayed()
    window.history.replaceState(null, '', '/journal/notebook')
    render(<IntroAnimation />)
    expect(QUICK_FADE_MS).toBe(600)
    expect(fade()).toHaveAttribute('aria-hidden', 'true')
    const css = readFileSync(join(process.cwd(), 'src', 'components', 'intro', 'IntroAnimation.module.css'), 'utf8')
    expect(css).toMatch(/\.quickFade \{\s*pointer-events: none;\s*animation: overlayFadeOut 0\.6s/)
    act(() => { vi.advanceTimersByTime(QUICK_FADE_MS) })
    expect(fade()).toBeNull()
  })

  it('reduced motion: the short still version on the weekly gate, and no fade between', () => {
    reduced = true
    const first = render(<IntroAnimation />)
    expect(film()).not.toBeNull()
    expect(screen.queryByLabelText('Skip intro')).toBeNull()
    first.unmount()
    render(<IntroAnimation />)
    expect(film()).toBeNull()
    expect(fade()).toBeNull()
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
    expect(fullIntroDue()).toBe(true)
    expect(() => markFullIntroPlayed()).not.toThrow()
    expect(fullIntroDue()).toBe(false)   // the session mark answered
  })
})
