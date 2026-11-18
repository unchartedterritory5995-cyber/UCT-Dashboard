import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import DesktopBridgeSync, { QUIT_STILL_ALIVE_MS } from './DesktopBridgeSync'
import { __resetAppClosingForTests, isAppClosing } from '../lib/appClosing'
import { announceDeskLaunchBlocked, finishDeskLaunch, isDeskLaunchBlocked, isDeskLaunchPending, withdrawDeskLaunch } from '../lib/popoutRegistry'
import { __resetPrefsSessionForTests, publishPrefsUser } from '../lib/prefsSession'

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))

beforeEach(() => { delete window.uctDesktop; localStorage.clear(); __resetPrefsSessionForTests(); withdrawDeskLaunch(); window.opener = null })
afterEach(() => { cleanup(); delete window.uctDesktop; vi.useRealTimers(); __resetAppClosingForTests(); __resetPrefsSessionForTests(); withdrawDeskLaunch(); localStorage.clear(); window.opener = null; window.history.replaceState({}, '', '/') })

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
  it('stays closing for a full minute, longer than a member sits on a Leave or Stay dialog', () => {
    expect(QUIT_STILL_ALIVE_MS).toBe(60000)
  })

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

describe('the launch restore signal', () => {
  const seed = (uid) => localStorage.setItem(`uct.desk.v1:${uid}:pl-1`, JSON.stringify({ kind: 'board', id: 'pl-1', widgets: [{ id: 'r1' }], tabId: 'gone' }))
  const inShell = () => { window.uctDesktop = makeBridge() }

  it('asks the host to mount once the member is known and they have records', () => {
    inShell()
    seed('A')
    render(<DesktopBridgeSync />)
    expect(isDeskLaunchPending()).toBe(false)
    act(() => publishPrefsUser('A'))
    expect(isDeskLaunchPending()).toBe(true)
  })

  it('asks for nothing with no records', () => {
    inShell()
    render(<DesktopBridgeSync />)
    act(() => publishPrefsUser('A'))
    expect(isDeskLaunchPending()).toBe(false)
  })

  it('asks for nothing when the records are another member', () => {
    inShell()
    seed('A')
    render(<DesktopBridgeSync />)
    act(() => publishPrefsUser('B'))
    expect(isDeskLaunchPending()).toBe(false)
  })

  it('a child window of the app never restores the desk', () => {
    inShell()
    seed('A')
    window.opener = {}
    render(<DesktopBridgeSync />)
    act(() => publishPrefsUser('A'))
    expect(isDeskLaunchPending()).toBe(false)
  })

  it('a Terminal pop-out child never restores the desk', () => {
    inShell()
    seed('A')
    window.history.replaceState({}, '', '/terminal?popout=abc')
    render(<DesktopBridgeSync />)
    act(() => publishPrefsUser('A'))
    expect(isDeskLaunchPending()).toBe(false)
  })

  it('a leaf arriving after the workspace already settled cannot leave the signal stuck', () => {
    inShell()
    seed('A')
    publishPrefsUser('A')
    finishDeskLaunch()                                        // the workspace answered first
    render(<DesktopBridgeSync />)                             // the leaf's chunk lands late
    expect(isDeskLaunchPending()).toBe(false)
  })

  it('a bridge without the before-quit methods asks for nothing, as a browser would', () => {
    window.uctDesktop = makeBridge({ capabilities: ['window-state'] })
    seed('A')
    render(<DesktopBridgeSync />)
    act(() => publishPrefsUser('A'))
    expect(isDeskLaunchPending()).toBe(false)
  })

  it('a sign-out withdraws a pending restore', () => {
    inShell()
    seed('A')
    render(<DesktopBridgeSync />)
    act(() => publishPrefsUser('A'))
    act(() => publishPrefsUser(null))
    expect(isDeskLaunchPending()).toBe(false)
  })
})

describe('a board that could not reopen at launch while on another page', () => {
  it('tells the member outside the board, and the toast dismisses', () => {
    window.uctDesktop = makeBridge()
    render(<DesktopBridgeSync />)
    expect(screen.queryByTestId('desk-launch-blocked-toast')).toBeNull()
    act(() => announceDeskLaunchBlocked())
    expect(screen.getByTestId('desk-launch-blocked-toast')).toHaveTextContent(/back on your Charts page/i)
    act(() => { fireEvent.click(screen.getByRole('button', { name: /dismiss/i })) })
    expect(screen.queryByTestId('desk-launch-blocked-toast')).toBeNull()
    expect(isDeskLaunchBlocked()).toBe(false)
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

describe('telemetry site events', () => {
  const eventsBridge = () => makeBridge({ capabilities: ['window-state', 'before-quit', 'site-events'], reportEvent: vi.fn() })

  it('reports signed_in once a member is signed in, in the main window', async () => {
    const bridge = eventsBridge()
    window.uctDesktop = bridge
    render(<DesktopBridgeSync />)
    await act(async () => {})
    expect(bridge.reportEvent).not.toHaveBeenCalled()
    await act(async () => { publishPrefsUser('u1') })
    expect(bridge.reportEvent).toHaveBeenCalledWith('signed_in')
  })

  it('a pop-out window (it has an opener) never reports', async () => {
    const bridge = eventsBridge()
    window.uctDesktop = bridge
    window.opener = {}
    publishPrefsUser('u1')
    render(<DesktopBridgeSync />)
    await act(async () => {})
    expect(bridge.reportEvent).not.toHaveBeenCalled()
  })

  it('an older shell without the capability is never called', async () => {
    const bridge = makeBridge({ reportEvent: vi.fn() })
    window.uctDesktop = bridge
    publishPrefsUser('u1')
    render(<DesktopBridgeSync />)
    await act(async () => {})
    expect(bridge.reportEvent).not.toHaveBeenCalled()
  })
})
