// @vitest-environment jsdom
// How a caller asks the generic engine to open a registered tour by id (wave 14,
// lane W14-0) -- mirrors tourControl.test.js's own coverage of the base tour's
// single-pending-flag door (that file does not exist as a standalone suite; the
// behaviour it would cover is exercised inline by NotebookTour.test.jsx instead --
// this file is the equivalent for the generalized door).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  REGISTRY_TOUR_OPEN_EVENT, openRegistryTour, hasPendingRegistryTourOpen,
  takePendingRegistryTourOpenAny, __resetRegistryTourControl,
} from './tourRegistryControl'

beforeEach(() => { __resetRegistryTourControl() })
afterEach(() => { __resetRegistryTourControl() })

describe('openRegistryTour', () => {
  it('sets the pending id and dispatches the event, carrying it in detail', () => {
    const seen = []
    const onOpen = (e) => seen.push(e.detail.tourId)
    window.addEventListener(REGISTRY_TOUR_OPEN_EVENT, onOpen)
    openRegistryTour('tour-x')
    window.removeEventListener(REGISTRY_TOUR_OPEN_EVENT, onOpen)
    expect(seen).toEqual(['tour-x'])
    expect(hasPendingRegistryTourOpen()).toBe('tour-x')
  })

  it('a second call replaces the pending id (one at a time, decision D3)', () => {
    openRegistryTour('tour-a')
    openRegistryTour('tour-b')
    expect(hasPendingRegistryTourOpen()).toBe('tour-b')
  })
})

describe('takePendingRegistryTourOpenAny', () => {
  it('returns the pending id once, and clears it', () => {
    openRegistryTour('tour-x')
    expect(takePendingRegistryTourOpenAny()).toBe('tour-x')
    expect(takePendingRegistryTourOpenAny()).toBeNull()
    expect(hasPendingRegistryTourOpen()).toBeNull()
  })

  it('null when nothing is pending', () => {
    expect(takePendingRegistryTourOpenAny()).toBeNull()
  })
})

describe('surviving no window', () => {
  it('does not throw when dispatchEvent is unavailable', () => {
    const real = window.dispatchEvent
    window.dispatchEvent = () => { throw new Error('no window') }
    expect(() => openRegistryTour('tour-x')).not.toThrow()
    expect(hasPendingRegistryTourOpen()).toBe('tour-x') // the pending id still carries the request
    window.dispatchEvent = real
  })
})

describe('__resetRegistryTourControl', () => {
  it('clears the pending id (rails only)', () => {
    openRegistryTour('tour-x')
    __resetRegistryTourControl()
    expect(hasPendingRegistryTourOpen()).toBeNull()
  })
})
