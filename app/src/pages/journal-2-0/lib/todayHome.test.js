import { describe, it, expect } from 'vitest'
import { HOME_VIEW, LANDING_PREF, TODAY_VIEW, resolveLanding, __setTodayLandingForTests } from './todayHome'

// Notebook simplify, Task 5: the Notebook opens on the notes list, whatever the stored `notebook_landing` says.
describe('resolveLanding', () => {
  it('answers the notes list for every stored value, the old choices included', () => {
    for (const raw of ['today', 'home', 'all', '"today"', '"home"', ' today ', 'nonsense', '', null, undefined, 42]) {
      expect(resolveLanding(raw)).toBe('all')
    }
  })

  it('the test switch no longer moves the landing (it decides only where the first run lands)', () => {
    __setTodayLandingForTests(true)
    expect(resolveLanding('today')).toBe('all')
    expect(resolveLanding(undefined)).toBe('all')
    __setTodayLandingForTests(false)
    expect(resolveLanding('home')).toBe('all')
    expect(resolveLanding(undefined)).toBe('all')
  })

  it('keeps the view ids and the preference key other files import', () => {
    expect(TODAY_VIEW).toBe('today')
    expect(HOME_VIEW).toBe('home')
    expect(LANDING_PREF).toBe('notebook_landing')
  })
})
