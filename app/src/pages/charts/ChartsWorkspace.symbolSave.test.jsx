// A scan is saved once, where it stops (groupSymSavePace.js).
//
// Measured on production 2026-11-14: a 40-chart scan at 0.7 s a chart made 38 saves of the linked
// ticker (POST /api/auth/preferences), each 0.17 s of server work when calm and 0.7 to 2.1 s after a
// restart, for symbols the member had already left. A pick on its own is saved 0.4 s later, as
// before; changes less than GROUP_SCAN_GAP_MS apart are a scan and are saved once, GROUP_SCAN_SAVE_MS
// after the last one. Leaving the board or the page going away saves a pending symbol at once.
//
// Same mock shape as ChartsWorkspace.memberSwitch.test.jsx; the stub widget links any ticker.
import { render, screen, act } from '@testing-library/react'
import { vi, describe, test, expect, beforeEach, afterEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

const SYMS = ['AAA', 'BBB', 'CCC', 'DDD', 'EEE']
vi.mock('./WidgetHost', async () => {
  const { useWorkspace } = await import('./WorkspaceContext')
  function StubWidget({ widget }) {
    const { setGroupSym } = useWorkspace()
    return (
      <div data-testid={`body-${widget.type}`}>
        {['AAA', 'BBB', 'CCC', 'DDD', 'EEE'].map((s) => (
          <button key={s} data-testid={`pick-${s}`} onClick={() => setGroupSym(widget.color, s)}>{s}</button>
        ))}
      </div>
    )
  }
  return { default: StubWidget }
})
vi.mock('./mobile/MobileChartsApp', () => ({ default: () => <div>MOBILE</div> }))
vi.mock('./grid/MultiChartGrid', () => ({ default: () => <div>GRID</div> }))
vi.mock('./grid/MultiChartMenu', () => ({ default: () => <div>MC MENU</div> }))
vi.mock('react-grid-layout', () => ({
  Responsive: ({ children }) => <div data-testid="rgl-responsive">{children}</div>,
  WidthProvider: (C) => C,
}))

const setPref = vi.fn()
let mockPrefs = {}
vi.mock('../../hooks/usePreferences', () => ({
  default: () => ({ prefs: mockPrefs, setPref, setPrefMerged: vi.fn(), loading: false }),
  parsePref: (raw, fallback) => {
    if (raw == null) return fallback
    if (typeof raw !== 'string') return raw
    try { return JSON.parse(raw) } catch { return fallback }
  },
  refreshPreferences: vi.fn(),
  whenWritesSettle: () => Promise.resolve(),
}))
vi.mock('../../hooks/useMediaQuery', () => ({ default: () => false }))
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 1, role: 'user' } }) }))
vi.mock('../../hooks/useChartLayouts', () => ({
  default: () => ({ global: [], mine: [], isLoading: false, saveLayout: async () => ({}), deleteLayout: async () => {}, refresh: () => {} }),
}))

import ChartsWorkspace from './ChartsWorkspace'
import { publishPrefsUser, __resetPrefsSessionForTests } from '../../lib/prefsSession'
import { GROUP_SAVE_MS, GROUP_SCAN_GAP_MS, GROUP_SCAN_SAVE_MS } from './groupSymSavePace'

const BOARD = JSON.stringify({ widgets: [{ id: 'a1', type: 'scanner', color: 'C', x: 0, y: 0, w: 24, h: 20, opts: {} }], cols: 24, version: 1 })
const saved = () => setPref.mock.calls.filter(([k]) => k === 'charts_workspace_groups').map(([, v]) => JSON.parse(v).C)
const pick = (s) => act(() => { screen.getByTestId(`pick-${s}`).click() })
const pass = (ms) => act(() => { vi.advanceTimersByTime(ms) })
function renderWS() {
  window.history.replaceState({}, '', '/charts')
  return render(<MemoryRouter><ChartsWorkspace /></MemoryRouter>)
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  setPref.mockReset()
  localStorage.clear()
  __resetPrefsSessionForTests()
  publishPrefsUser('A')
  mockPrefs = { charts_workspace_layout: BOARD }
  globalThis.fetch = vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) }))
})
afterEach(() => {
  vi.useRealTimers()
  delete globalThis.fetch
  __resetPrefsSessionForTests()
  window.history.replaceState({}, '', '/')
})

describe('saving the linked ticker', () => {
  test('a pick is saved GROUP_SAVE_MS later, as before', () => {
    renderWS()
    pick('AAA')
    pass(GROUP_SAVE_MS - 1)
    expect(saved()).toEqual([])
    pass(1)
    expect(saved()).toEqual(['AAA'])
    pass(10_000)
    expect(saved()).toEqual(['AAA'])                                   // once
  })

  test('a scan of five charts is two saves: its first chart, and the one it stopped on', () => {
    renderWS()
    const STEP = 700
    expect(STEP).toBeLessThan(GROUP_SCAN_GAP_MS)
    expect(STEP).toBeGreaterThan(GROUP_SAVE_MS)                        // (the old rule saved every one of these)
    for (const s of SYMS) { pick(s); pass(STEP) }
    expect(saved()).toEqual(['AAA'])                                   // nothing for BBB, CCC, DDD while it runs
    pass(GROUP_SCAN_SAVE_MS - STEP - 1)
    expect(saved()).toEqual(['AAA'])
    pass(1)
    expect(saved()).toEqual(['AAA', 'EEE'])
    pass(10_000)
    expect(saved()).toEqual(['AAA', 'EEE'])
  })

  test('CONTROL: picks further apart than the gap are each saved GROUP_SAVE_MS after', () => {
    renderWS()
    pick('AAA')
    pass(GROUP_SCAN_GAP_MS + 1)
    expect(saved()).toEqual(['AAA'])
    pick('BBB')
    pass(GROUP_SAVE_MS - 1)
    expect(saved()).toEqual(['AAA'])
    pass(1)
    expect(saved()).toEqual(['AAA', 'BBB'])
  })

  test('the same symbol announced twice for one move is one pick, not a scan', () => {
    renderWS()
    pick('AAA')
    pick('AAA')                                                        // a list and its chart both report it
    pass(GROUP_SAVE_MS)
    expect(saved()).toEqual(['AAA'])
  })

  test('after a scan has rested, the next pick is a pick again', () => {
    renderWS()
    pick('AAA'); pass(700); pick('BBB')
    pass(GROUP_SCAN_SAVE_MS)
    expect(saved()).toEqual(['AAA', 'BBB'])
    pass(GROUP_SCAN_GAP_MS)
    pick('CCC')
    pass(GROUP_SAVE_MS)
    expect(saved()).toEqual(['AAA', 'BBB', 'CCC'])
  })

  test('leaving the board mid-scan saves the symbol left, once', () => {
    const { unmount } = renderWS()
    pick('AAA'); pass(700); pick('BBB'); pass(100)
    expect(saved()).toEqual(['AAA'])
    unmount()
    expect(saved()).toEqual(['AAA', 'BBB'])
    pass(10_000)
    expect(saved()).toEqual(['AAA', 'BBB'])
  })

  test('the page going away mid-scan saves the symbol left, once', () => {
    renderWS()
    pick('AAA'); pass(700); pick('BBB'); pass(100)
    expect(saved()).toEqual(['AAA'])
    act(() => { window.dispatchEvent(new Event('pagehide')) })
    expect(saved()).toEqual(['AAA', 'BBB'])
    pass(10_000)
    expect(saved()).toEqual(['AAA', 'BBB'])
    act(() => { window.dispatchEvent(new Event('pagehide')) })          // nothing pending: nothing written
    expect(saved()).toEqual(['AAA', 'BBB'])
  })

  test('a scan pending when another member signs in is dropped, never written into their account', () => {
    renderWS()
    pick('AAA'); pass(700); pick('BBB')
    act(() => { publishPrefsUser('B') })
    pass(10_000)
    expect(saved()).toEqual(['AAA'])
  })

  test('once the board is gone its listener is gone too', () => {
    const add = vi.spyOn(window, 'addEventListener')
    const remove = vi.spyOn(window, 'removeEventListener')
    try {
      const { unmount } = renderWS()
      const added = add.mock.calls.filter(([type]) => type === 'pagehide').map(([, fn]) => fn)
      expect(added.length).toBeGreaterThan(0)
      unmount()
      const removed = remove.mock.calls.filter(([type]) => type === 'pagehide').map(([, fn]) => fn)
      for (const fn of added) expect(removed).toContain(fn)
    } finally {
      add.mockRestore(); remove.mockRestore()
    }
  })
})
