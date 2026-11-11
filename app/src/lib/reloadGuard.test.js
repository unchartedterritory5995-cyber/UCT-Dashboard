import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  shouldDeferReload, announceUpdateRequired, isUpdateAnnounced, isTerminalPopoutChild,
  reloadNow, UPDATE_REQUIRED_EVENT, __resetReloadGuardForTests,
} from './reloadGuard'
import { registerPopout } from './popoutRegistry'
import { __resetAppClosingForTests } from '../pages/charts/popout/PopoutWindow'

beforeEach(() => { __resetReloadGuardForTests(); __resetAppClosingForTests() })
afterEach(() => { window.history.replaceState({}, '', '/') })

describe('shouldDeferReload', () => {
  it('is false with no pop-outs on an ordinary page', () => {
    expect(shouldDeferReload()).toBe(false)
  })
  it('is true while a portal pop-out is open, false after it closes', () => {
    const release = registerPopout()
    expect(shouldDeferReload()).toBe(true)
    release()
    expect(shouldDeferReload()).toBe(false)
  })
  it('is true on a Terminal pop-out child (/terminal?popout=token)', () => {
    window.history.replaceState({}, '', '/terminal?popout=abc')
    expect(isTerminalPopoutChild()).toBe(true)
    expect(shouldDeferReload()).toBe(true)
  })
  it('is false on /terminal without a token, and on other pages with the query', () => {
    window.history.replaceState({}, '', '/terminal')
    expect(shouldDeferReload()).toBe(false)
    window.history.replaceState({}, '', '/charts?popout=abc')
    expect(shouldDeferReload()).toBe(false)
  })
})

describe('announceUpdateRequired', () => {
  it('sets the flag and fires uct:update-required', () => {
    const fn = vi.fn()
    window.addEventListener(UPDATE_REQUIRED_EVENT, fn)
    expect(UPDATE_REQUIRED_EVENT).toBe('uct:update-required')
    announceUpdateRequired()
    window.removeEventListener(UPDATE_REQUIRED_EVENT, fn)
    expect(fn).toHaveBeenCalledTimes(1)
    expect(isUpdateAnnounced()).toBe(true)
  })
})

describe('reloadNow', () => {
  it('clears the closing flag 5 seconds later if the page is still alive', () => {
    const timers = []
    reloadNow({ reload: () => {}, setTimer: (fn, ms) => timers.push([fn, ms]) })
    expect(timers).toHaveLength(1)
    expect(timers[0][1]).toBe(5000)
    expect(() => timers[0][0]()).not.toThrow()
  })
})
