// The real board through ChartsDeskHost: a popped board keeps its window when the trader changes page,
// the hidden board does no main-window work and answers no shortcut, and with nothing popped it all
// behaves as it did. Same mock shape as ChartsWorkspace.deskRecovery.test.jsx.
import { render, screen, act, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { vi, describe, test, expect, beforeEach, afterEach } from 'vitest'
import { useSyncExternalStore } from 'react'
import { MemoryRouter, Routes, Route, Outlet, Navigate, useNavigate } from 'react-router-dom'

vi.mock('./WidgetHost', () => ({
  default: ({ widget, onRemove, onPopOut }) => (
    <div data-testid={`body-${widget.id}`}>
      {widget.type}
      <button data-testid={`remove-${widget.id}`} onClick={onRemove}>x</button>
      {onPopOut && <button data-testid={`pop-${widget.id}`} onClick={onPopOut}>pop</button>}
    </div>
  ),
}))
vi.mock('./mobile/MobileChartsApp', () => ({ default: () => <div data-testid="mobile-charts-app">MOBILE</div> }))
vi.mock('./grid/MultiChartGrid', () => ({ default: () => <div data-testid="multichart-grid">GRID</div> }))
vi.mock('./grid/MultiChartMenu', () => ({ default: () => <div data-testid="multichart-menu">MC MENU</div> }))
vi.mock('react-grid-layout', () => ({
  Responsive: ({ children }) => <div data-testid="rgl-responsive">{children}</div>,
  WidthProvider: (C) => C,
}))

const setPref = vi.fn()
const setPrefMerged = vi.fn()
let mockPrefs = {}
let mockIsMobile = false
vi.mock('../../hooks/usePreferences', () => ({
  default: () => ({ prefs: mockPrefs, setPref, setPrefMerged, loading: false, readFailed: false }),
  parsePref: (raw, fallback) => {
    if (raw == null) return fallback
    if (typeof raw !== 'string') return raw
    try { return JSON.parse(raw) } catch { return fallback }
  },
  refreshPreferences: vi.fn(),
  whenWritesSettle: () => Promise.resolve(),
}))
vi.mock('../../hooks/useMediaQuery', () => ({ default: () => mockIsMobile }))
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 1, role: 'user' } }) }))
vi.mock('../../hooks/useChartLayouts', () => ({
  default: () => ({
    global: [], mine: [], isLoading: false,
    saveLayout: async () => ({}), deleteLayout: async () => {}, refresh: () => {},
  }),
}))

import ChartsDeskHost, { ChartsRouteSlot } from './ChartsDeskHost'
import { hasOpenPopouts } from '../../lib/popoutRegistry'
import { publishPrefsUser, __resetPrefsSessionForTests } from '../../lib/prefsSession'

const widget = (id, x = 0) => ({ id, type: 'scanner', color: 'C', x, y: 0, w: 6, h: 10, opts: {} })
const board = (...widgets) => JSON.stringify({ widgets, cols: 24, version: 1 })
const layoutWrites = () => setPref.mock.calls.filter(([k]) => k === 'charts_workspace_layout').map(([, v]) => JSON.parse(v))

// Auth the way AuthGuard behaves: a signed-out member is sent to /login, out of the shell.
const auth = { signedIn: true, listeners: new Set() }
const useSignedIn = () => useSyncExternalStore((f) => { auth.listeners.add(f); return () => auth.listeners.delete(f) }, () => auth.signedIn)
function Guard() { return useSignedIn() ? <Outlet /> : <Navigate to="/login" replace /> }
function signOut() { act(() => { auth.signedIn = false; auth.listeners.forEach((f) => f()) }) }

let navigate
function Nav() { navigate = useNavigate(); return null }
function Shell() { return (<><Nav /><ChartsDeskHost /><Outlet /></>) }

function makeFakeWindow() {
  const doc = document.implementation.createHTMLDocument('popup')
  const listeners = {}
  const fake = {
    document: doc,
    closed: false,
    KeyboardEvent: window.KeyboardEvent,
    addEventListener: (t, fn) => { (listeners[t] ||= []).push(fn) },
    removeEventListener: (t, fn) => { listeners[t] = (listeners[t] || []).filter((f) => f !== fn) },
    history: { replaceState: vi.fn() },
    _fire: (t) => (listeners[t] || []).forEach((fn) => fn()),
    close: vi.fn(() => { fake.closed = true; fake._fire('beforeunload') }),
  }
  return fake
}

const flush = () => act(async () => { for (let i = 0; i < 12; i += 1) await Promise.resolve() })
const go = async (to) => { await act(async () => { navigate(to) }); await flush() }

async function renderDesk() {
  const view = render(
    <MemoryRouter initialEntries={['/charts']}>
      <Routes>
        <Route element={<Guard />}>
          <Route element={<Shell />}>
            <Route path="/charts" element={<ChartsRouteSlot />} />
            <Route path="/dashboard" element={<div data-testid="dash">dash</div>} />
            <Route path="/journal" element={<div data-testid="journal">journal</div>} />
          </Route>
        </Route>
        <Route path="/login" element={<div data-testid="login">login</div>} />
      </Routes>
    </MemoryRouter>,
  )
  await waitFor(() => expect(screen.getByTestId('rgl-responsive')).toBeTruthy(), { timeout: 10000 })
  await flush()
  return view
}

function popBoard() {
  act(() => { fireEvent.click(screen.getByText('Layouts ▾')) })
  act(() => { fireEvent.click(screen.getByText('⧉ Pop Out Layout')) })
}

let popups
let lockRequests
beforeEach(() => {
  __resetPrefsSessionForTests()
  act(() => { publishPrefsUser(1) })
  setPref.mockReset()
  setPref.mockImplementation(() => Promise.resolve(true))
  setPrefMerged.mockReset()
  auth.signedIn = true
  mockIsMobile = false
  mockPrefs = { charts_workspace_layout: board(widget('a', 0), widget('b', 6)) }
  popups = []
  window.open = vi.fn(() => { const w = makeFakeWindow(); popups.push(w); return w })
  lockRequests = 0
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: {
      request: (_name, cb) => { lockRequests += 1; return Promise.resolve(cb()) },
      query: async () => ({ held: [] }),
    },
  })
  localStorage.clear()
})
afterEach(() => {
  cleanup()
  window.history.replaceState({}, '', '/')
})

describe('with a board popped', () => {
  test('navigating keeps the window open and hides the board without unmounting it', async () => {
    await renderDesk()
    popBoard()
    await flush()
    expect(window.open).toHaveBeenCalledTimes(1)
    const win = popups[0]
    expect(hasOpenPopouts()).toBe(true)

    await go('/dashboard')
    expect(win.close).not.toHaveBeenCalled()
    expect(hasOpenPopouts()).toBe(true)
    expect(screen.getByTestId('dash')).toBeTruthy()
    // the popped board's widgets are still being rendered into its own window
    expect(win.document.querySelector('[data-testid="body-a"]'), 'the board in the window died').toBeTruthy()
    // the hidden board does no main-window work: no grid, no widgets, its chrome hidden
    expect(screen.queryByTestId('rgl-responsive'), 'the main grid keeps painting while hidden').toBeNull()
    expect(document.querySelector('[data-charts-theme]').style.display).toBe('none')
  })

  test('returning to /charts does not open a second window or mount a second workspace', async () => {
    await renderDesk()
    popBoard()
    await flush()
    const win = popups[0]
    const locksAfterMount = lockRequests

    await go('/dashboard')
    await go('/charts')
    expect(window.open).toHaveBeenCalledTimes(1)
    expect(win.close).not.toHaveBeenCalled()
    expect(lockRequests, 'a second instance would have asked for the owner lock').toBe(locksAfterMount)
    expect(document.querySelectorAll('[data-charts-theme]')).toHaveLength(1)
    await waitFor(() => expect(screen.getByTestId('rgl-responsive')).toBeTruthy())
    expect(document.querySelector('[data-charts-theme]').style.display).toBe('')
  })

  test('closing the last window while hidden docks it, saves it, and lets the workspace go', async () => {
    await renderDesk()
    popBoard()
    await flush()
    const win = popups[0]
    await go('/dashboard')
    setPref.mockClear()

    act(() => { win.close() })   // the member's own close button
    await flush()
    await waitFor(() => expect(hasOpenPopouts()).toBe(false))
    await flush()
    expect(document.querySelector('[data-charts-theme]'), 'nothing popped: no hidden board left').toBeNull()
    const saved = layoutWrites()
    expect(saved.some((l) => l.widgets.some((w) => w.id === 'a')), 'the board came home in the save').toBe(true)
  })

  test('a member switch while hidden closes the windows and frees the board', async () => {
    await renderDesk()
    popBoard()
    await flush()
    const win = popups[0]
    await go('/dashboard')
    act(() => { publishPrefsUser(2) })
    await flush()
    expect(win.close).toHaveBeenCalled()
    await flush()
    expect(hasOpenPopouts()).toBe(false)
  })
})

describe('with a single widget popped', () => {
  test('navigating keeps the window open too (poppedWidgetIds, not just poppedLayouts)', async () => {
    await renderDesk()
    act(() => { fireEvent.click(screen.getByTestId('pop-a')) })
    await flush()
    expect(window.open).toHaveBeenCalledTimes(1)
    const win = popups[0]
    await go('/dashboard')
    expect(win.close).not.toHaveBeenCalled()
    expect(win.document.querySelector('[data-testid="body-a"]')).toBeTruthy()
    expect(screen.queryByTestId('rgl-responsive')).toBeNull()
  })
})

describe('with nothing popped', () => {
  test('navigating unmounts the workspace exactly as today, and returning mounts a fresh one', async () => {
    await renderDesk()
    const locksAfterMount = lockRequests
    await go('/dashboard')
    expect(document.querySelector('[data-charts-theme]'), 'still mounted on another route').toBeNull()
    await go('/charts')
    await waitFor(() => expect(screen.getByTestId('rgl-responsive')).toBeTruthy())
    await flush()
    expect(lockRequests, 'a fresh mount takes its own lock').toBeGreaterThan(locksAfterMount)
    expect(window.open).not.toHaveBeenCalled()
  })

  test('the visible board renders into the page with no wrapper element around it', async () => {
    await renderDesk()
    const ws = document.querySelector('[data-charts-theme]')
    expect(ws.style.display).toBe('')
    expect(ws.parentElement.dataset.chartsDeskWrapper, 'no wrapper div in the DOM').toBeUndefined()
  })
})

describe('sign-out', () => {
  test('unmounts everything and closes the windows', async () => {
    await renderDesk()
    popBoard()
    await flush()
    const win = popups[0]
    await go('/dashboard')
    signOut()
    await flush()
    expect(screen.getByTestId('login')).toBeTruthy()
    expect(win.close).toHaveBeenCalled()
    expect(hasOpenPopouts()).toBe(false)
    expect(document.querySelector('[data-charts-theme]')).toBeNull()
  })
})

describe('a hidden board answers no shortcut and does no route-scoped work', () => {
  const chord = () => fireEvent.keyDown(document.body, { key: 'j', ctrlKey: true, altKey: true })

  test('the visible board still answers its Ctrl+Alt+J hint (control)', async () => {
    await renderDesk()
    chord()
    await flush()
    expect(document.body.textContent).toContain('Hover a chart first')
  })

  test('hidden: Ctrl+Alt+J on another page is not the board\'s', async () => {
    await renderDesk()
    popBoard()
    await flush()
    await go('/dashboard')
    chord()
    await flush()
    expect(document.body.textContent).not.toContain('Hover a chart first')
  })

  test('hidden: the phone branch does not mount while the viewport reads as phone', async () => {
    await renderDesk()
    popBoard()
    await flush()
    const win = popups[0]
    await go('/dashboard')
    mockIsMobile = true
    await go('/journal')
    expect(screen.queryByTestId('mobile-charts-app'), 'the hidden board must not paint the phone shell').toBeNull()
    expect(document.documentElement.hasAttribute('data-mobile-chart-shell')).toBe(false)
    expect(win.close, 'the window stays while hidden').not.toHaveBeenCalled()
  })

  test('a URL door arriving on return is applied (?ensure=)', async () => {
    await renderDesk()
    popBoard()
    await flush()
    await go('/dashboard')
    // the door reads window.location.search; MemoryRouter does not write it
    window.history.pushState({}, '', '/charts?ensure=chart')
    await go('/charts')
    await waitFor(() => expect(screen.getAllByText('chart').length).toBeGreaterThan(0))
  })
})
