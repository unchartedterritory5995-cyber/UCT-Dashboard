import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ackBeforeQuit,
  getDesktopInfo,
  hasDesktopFeature,
  isDesktopApp,
  onBeforeQuit,
  onWindowState,
} from './desktopBridge'

function makeBridge(overrides = {}) {
  const listeners = { windowState: new Set(), beforeQuit: new Set() }
  return {
    bridgeVersion: 1,
    capabilities: ['window-state', 'before-quit'],
    getInfo: vi.fn(async () => ({ appVersion: '1.0.0', platform: 'win32' })),
    onWindowState: vi.fn((cb) => { listeners.windowState.add(cb); return () => listeners.windowState.delete(cb) }),
    onBeforeQuit: vi.fn((cb) => { listeners.beforeQuit.add(cb); return () => listeners.beforeQuit.delete(cb) }),
    ackBeforeQuit: vi.fn(),
    _listeners: listeners,
    ...overrides,
  }
}

afterEach(() => { delete window.uctDesktop })

describe('desktopBridge with no bridge (a normal browser)', () => {
  it('reports nothing and calls nothing', async () => {
    expect(isDesktopApp()).toBe(false)
    expect(hasDesktopFeature('before-quit')).toBe(false)
    expect(hasDesktopFeature('window-state')).toBe(false)
    expect(() => ackBeforeQuit()).not.toThrow()
    await expect(getDesktopInfo()).resolves.toBeNull()
    const off = onBeforeQuit(() => {})
    expect(typeof off).toBe('function')
    expect(() => off()).not.toThrow()
    expect(() => onWindowState(() => {})()).not.toThrow()
  })
})

describe('desktopBridge with a bridge that is wrong or incomplete', () => {
  it.each([
    ['a non-object', 'nope'],
    ['no capabilities', { bridgeVersion: 1 }],
    ['capabilities not a list', { bridgeVersion: 1, capabilities: 'before-quit' }],
    ['no version', { capabilities: ['before-quit'] }],
  ])('%s is not the desktop app', (_label, value) => {
    window.uctDesktop = value
    expect(isDesktopApp()).toBe(false)
    expect(hasDesktopFeature('before-quit')).toBe(false)
  })

  it('a listed capability with its method missing is not available, and callers do not throw', () => {
    window.uctDesktop = makeBridge({ onBeforeQuit: undefined })
    expect(isDesktopApp()).toBe(true)
    expect(hasDesktopFeature('before-quit')).toBe(false)
    expect(hasDesktopFeature('window-state')).toBe(true)
    expect(() => onBeforeQuit(() => {})()).not.toThrow()
  })

  it('a capability needs ALL of its methods', () => {
    window.uctDesktop = makeBridge({ ackBeforeQuit: 'nope' })
    expect(hasDesktopFeature('before-quit')).toBe(false)
    expect(() => ackBeforeQuit()).not.toThrow()
  })

  it('an unlisted capability is not available even when the method exists', () => {
    window.uctDesktop = makeBridge({ capabilities: ['window-state'] })
    expect(hasDesktopFeature('before-quit')).toBe(false)
    onBeforeQuit(vi.fn())
    expect(window.uctDesktop.onBeforeQuit).not.toHaveBeenCalled()
  })

  it('an unknown capability name is false', () => {
    window.uctDesktop = makeBridge({ capabilities: ['window-state', 'teleport'] })
    expect(hasDesktopFeature('teleport')).toBe(false)
  })

  it('a bridge method that throws does not reach the caller', async () => {
    const boom = () => { throw new Error('ipc gone') }
    window.uctDesktop = makeBridge({ onBeforeQuit: boom, onWindowState: boom, ackBeforeQuit: boom, getInfo: boom })
    expect(() => onBeforeQuit(() => {})()).not.toThrow()
    expect(() => onWindowState(() => {})()).not.toThrow()
    expect(() => ackBeforeQuit()).not.toThrow()
    await expect(getDesktopInfo()).resolves.toBeNull()
  })

  it('a rejected getInfo resolves null', async () => {
    window.uctDesktop = makeBridge({ getInfo: () => Promise.reject(new Error('no')) })
    await expect(getDesktopInfo()).resolves.toBeNull()
  })

  it('an on* that returns no unsubscribe does not make unsubscribing throw', () => {
    window.uctDesktop = makeBridge({ onBeforeQuit: () => undefined })
    expect(() => onBeforeQuit(() => {})()).not.toThrow()
  })
})

describe('desktopBridge with the real shape', () => {
  it('is the desktop app and lists both features', async () => {
    window.uctDesktop = makeBridge()
    expect(isDesktopApp()).toBe(true)
    expect(hasDesktopFeature('window-state')).toBe(true)
    expect(hasDesktopFeature('before-quit')).toBe(true)
    await expect(getDesktopInfo()).resolves.toEqual({ appVersion: '1.0.0', platform: 'win32' })
  })

  it.each([
    ['onBeforeQuit', onBeforeQuit, 'beforeQuit'],
    ['onWindowState', onWindowState, 'windowState'],
  ])('%s unsubscribe removes its listener', (_name, subscribe, slot) => {
    window.uctDesktop = makeBridge()
    const cb = vi.fn()
    const off = subscribe(cb)
    expect(window.uctDesktop._listeners[slot].has(cb)).toBe(true)
    off()
    expect(window.uctDesktop._listeners[slot].has(cb)).toBe(false)
  })

  it('ackBeforeQuit reaches the bridge', () => {
    window.uctDesktop = makeBridge()
    ackBeforeQuit()
    expect(window.uctDesktop.ackBeforeQuit).toHaveBeenCalledTimes(1)
  })
})
