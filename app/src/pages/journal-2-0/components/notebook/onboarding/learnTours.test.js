// startTour, the one door a list of tours starts a walkthrough through (the get-started list's tour step). Pure: no
// screen. Starting a tour goes through the two existing doors, read off the events the gates listen for.
// Go-live wave 1: the Learn menu's own rules (its derived list, its groups, its words, its Help link) were deleted with
// the Learn menu; Help > Walkthroughs makes the same registry derivation (Support.notebook.test.jsx).
import { describe, it, expect, vi, afterEach } from 'vitest'
import { startTour } from './learnTours'
import { BASE_TOUR_ID } from './tourRegistry'
import { TOUR_OPEN_EVENT, __resetTourControl, hasPendingTourOpen } from './tourControl'
import {
  REGISTRY_TOUR_OPEN_EVENT, __resetRegistryTourControl, hasPendingRegistryTourOpen,
} from './tourRegistryControl'

afterEach(() => {
  __resetTourControl()
  __resetRegistryTourControl()
  vi.restoreAllMocks()
})

describe('startTour -- the existing doors, nothing new', () => {
  it('the base tour opens through its own door (TOUR_OPEN_EVENT), never the registry\'s', () => {
    const base = vi.fn()
    const reg = vi.fn()
    window.addEventListener(TOUR_OPEN_EVENT, base)
    window.addEventListener(REGISTRY_TOUR_OPEN_EVENT, reg)
    startTour(BASE_TOUR_ID)
    window.removeEventListener(TOUR_OPEN_EVENT, base)
    window.removeEventListener(REGISTRY_TOUR_OPEN_EVENT, reg)
    expect(base).toHaveBeenCalledTimes(1)
    expect(reg).not.toHaveBeenCalled()
    expect(hasPendingTourOpen()).toBe(true)
  })

  it('every other tour opens through the registry\'s door, with its id', () => {
    const base = vi.fn()
    const reg = vi.fn()
    window.addEventListener(TOUR_OPEN_EVENT, base)
    window.addEventListener(REGISTRY_TOUR_OPEN_EVENT, reg)
    startTour('formulas')
    window.removeEventListener(TOUR_OPEN_EVENT, base)
    window.removeEventListener(REGISTRY_TOUR_OPEN_EVENT, reg)
    expect(base).not.toHaveBeenCalled()
    expect(reg).toHaveBeenCalledTimes(1)
    expect(reg.mock.calls[0][0].detail).toEqual({ tourId: 'formulas' })
    expect(hasPendingRegistryTourOpen()).toBe('formulas')
  })
})
