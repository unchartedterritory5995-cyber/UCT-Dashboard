import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import DesktopBridgeSync, { QUIT_STILL_ALIVE_MS } from './DesktopBridgeSync'
import { __resetAppClosingForTests, isAppClosing } from '../lib/appClosing'

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))

beforeEach(() => { delete window.uctDesktop })
afterEach(() => { cleanup(); delete window.uctDesktop; vi.useRealTimers(); __resetAppClosingForTests() })

function makeBridge(overrides = {}) {
  const quit = new Set()
  return {
    bridgeVersion: 1,
    capabilities: ['window-state', 'before-quit'],
    getInfo: async () => ({ appVersion: '1', platform: 'win32' }),
    onWindowState: () => () => {},
    onBeforeQuit: vi.fn((cb) => { quit.add(cb); return () => quit.delete(cb) }),
    ackBeforeQuit: vi.fn(),
    _quit: () => [...quit].forEach((cb) => cb()),
    _listeners: () => quit.size,
    ...overrides,
  }
}

describe('DesktopBridgeSync', () => {
  it('renders nothing and does not throw with no bridge', () => {
    const { container } = render(<DesktopBridgeSync />)
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing with a bridge missing every method', async () => {
    window.uctDesktop = { bridgeVersion: 1, capabilities: ['before-quit', 'window-state'] }
    const { container } = render(<DesktopBridgeSync />)
    await act(async () => {})
    expect(container.firstChild).toBeNull()
  })
})

describe('the desktop app quitting', () => {
  it('marks the app closing and only then acks, so no window closing can dock a board', () => {
    const bridge = makeBridge({ ackBeforeQuit: vi.fn(() => { expect(isAppClosing()).toBe(true) }) })
    window.uctDesktop = bridge
    render(<DesktopBridgeSync />)
    expect(isAppClosing()).toBe(false)
    bridge._quit()
    expect(isAppClosing()).toBe(true)
    expect(bridge.ackBeforeQuit).toHaveBeenCalledTimes(1)
  })

  it('subscribes once across re-renders, and unsubscribes on unmount', () => {
    const bridge = makeBridge()
    window.uctDesktop = bridge
    const { rerender, unmount } = render(<DesktopBridgeSync />)
    rerender(<DesktopBridgeSync />)
    rerender(<DesktopBridgeSync />)
    expect(bridge.onBeforeQuit).toHaveBeenCalledTimes(1)
    expect(bridge._listeners()).toBe(1)
    unmount()
    expect(bridge._listeners()).toBe(0)
  })

  it('a quit that never happened lets a closed window dock its board again', () => {
    vi.useFakeTimers()
    const bridge = makeBridge()
    window.uctDesktop = bridge
    render(<DesktopBridgeSync />)
    bridge._quit()
    act(() => { vi.advanceTimersByTime(QUIT_STILL_ALIVE_MS - 1) })
    expect(isAppClosing(), 'still inside the window a real quit needs').toBe(true)
    act(() => { vi.advanceTimersByTime(1) })
    expect(isAppClosing()).toBe(false)
  })

  it('a bridge whose ackBeforeQuit throws still leaves the app marked closing', () => {
    const bridge = makeBridge({ ackBeforeQuit: () => { throw new Error('ipc gone') } })
    window.uctDesktop = bridge
    render(<DesktopBridgeSync />)
    expect(() => bridge._quit()).not.toThrow()
    expect(isAppClosing()).toBe(true)
  })

  it('a bridge without the before-quit methods subscribes to nothing', () => {
    const bridge = makeBridge({ capabilities: ['window-state'] })
    window.uctDesktop = bridge
    render(<DesktopBridgeSync />)
    expect(bridge.onBeforeQuit).not.toHaveBeenCalled()
  })
})

describe('the mount in App.jsx', () => {
  const app = readFileSync(path.join(HERE, '..', 'App.jsx'), 'utf8')

  it('only renders in the desktop app, and never lands in the first-load bundle', () => {
    expect(app).toMatch(/const DesktopBridgeSync = plainLazy\(\(\) => import\('\.\/components\/DesktopBridgeSync'\)\.catch\(/)
    expect(app).toMatch(/\{isDesktopApp\(\) && <Suspense fallback=\{null\}><DesktopBridgeSync \/><\/Suspense>\}/)
    expect(app).not.toMatch(/^import DesktopBridgeSync/m)
  })

  it('reads no shared context: the leaf holds nothing of Layout or App', () => {
    const src = readFileSync(path.join(HERE, 'DesktopBridgeSync.jsx'), 'utf8')
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    expect(code).not.toMatch(/useAuth\(\)/)
    expect(code).not.toMatch(/usePreferences\(\)/)
    expect(code).not.toMatch(/useContext\(/)
  })
})
