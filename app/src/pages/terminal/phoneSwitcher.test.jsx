// UCT Terminal — the phone panel switcher + touch panel-count control (P14a).
// On phone the grid renders only the FOCUSED panel, so a member needs a touch way to see
// which panels are stored and switch between them, and a touch way to change how many are
// active. This scopes to that: one tab per active panel (tapping it calls the same `setFocus`
// the keyboard shortcuts use), and the same 1/2/3/4 count buttons the desktop bar has, wired
// to the same `setCount`/`countTo` handler. Mirrors TerminalShell.test.jsx's idiom exactly
// (same prefs mock, same panels stub, same renderAt/setViewport/type helpers).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useEffect, useReducer } from 'react'
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { AuthContext } from '../../context/AuthContext'

const store = vi.hoisted(() => ({ prefs: {}, listeners: new Set(), writes: [] }))

vi.mock('../../hooks/usePreferences', () => {
  const parsePref = (raw, fallback) => {
    if (raw == null) return fallback
    if (typeof raw !== 'string') return raw
    try { return JSON.parse(raw) } catch { return fallback }
  }
  const notify = () => store.listeners.forEach((f) => f())
  return {
    parsePref,
    default: function usePreferences() {
      const [, force] = useReducer((x) => x + 1, 0)
      useEffect(() => { store.listeners.add(force); return () => store.listeners.delete(force) }, [])
      return {
        prefs: store.prefs,
        loading: false,
        setPref: (k, v) => { store.writes.push([k, v]); store.prefs = { ...store.prefs, [k]: v }; notify() },
        setPrefMerged: async (k, updater) => {
          const next = updater(parsePref(store.prefs[k], undefined))
          if (next === undefined) return
          const v = typeof next === 'string' ? next : JSON.stringify(next)
          store.writes.push([k, v]); store.prefs = { ...store.prefs, [k]: v }; notify()
        },
      }
    },
  }
})

// Same panels stub as TerminalShell.test.jsx: real names/panel-set ids, components stubbed.
vi.mock('./panels', async (importOriginal) => {
  const real = await importOriginal()
  const stubs = new Map()
  return {
    ...real,
    PANEL_IMPORTERS: {},
    panelComponent: (name) => {
      if (!stubs.has(name)) {
        stubs.set(name, function Stub({ sym }) {
          return <div data-testid={`stub-${name}`}>{name}:{sym || '-'}</div>
        })
      }
      return stubs.get(name)
    },
  }
})

import TerminalShell from './TerminalShell'
import { saveTiming } from './useTerminalLayout'
import { TerminalRoute } from './TerminalRoutes'

function setViewport(width) {
  window.matchMedia = (query) => {
    const max = /max-width:\s*(\d+)px/.exec(query)
    const min = /min-width:\s*(\d+)px/.exec(query)
    const matches = (!max || width <= Number(max[1])) && (!min || width >= Number(min[1]))
    return { matches, media: query, onchange: null, addListener() {}, removeListener() {},
      addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false } }
  }
}

const OPEN = { cohorts: ['terminal-next'], isPaid: true, optionsChainEnabled: true, optionsVolSurfaceEnabled: true }

function renderAt(url, auth = OPEN) {
  return render(
    <AuthContext.Provider value={auth}>
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/terminal" element={<TerminalRoute><TerminalShell /></TerminalRoute>} />
          <Route path="/terminal/calendar" element={<TerminalRoute><TerminalShell /></TerminalRoute>} />
          <Route path="*" element={<div data-testid="elsewhere" />} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  )
}

beforeEach(() => {
  saveTiming.debounceMs = 0   // layout writes land at once here; the debounce has its own rail
  try { window.sessionStorage.clear() } catch { /* */ }   // the per-tab "Back to my layout" memory
  store.prefs = {}
  store.writes = []
  setViewport(390)
  try { window.localStorage.clear() } catch { /* */ }
})
afterEach(() => cleanup())

describe('phone panel switcher (P14a)', () => {
  it('renders one tab per active panel — layout.panels.slice(0, layout.count)', () => {
    // v1 fixtures (as TerminalShell.test.jsx uses) only validate count in [1, 2, 4] — this
    // targets the same boardModel.migrateV1 path with count=4, all 4 panels active.
    store.prefs = { terminal_layout: JSON.stringify({ v: 1, count: 4, focus: 0, panels: [
      { code: 'GP', group: 'A' }, { code: 'DES', group: 'A' }, { code: 'CN', group: 'N', sym: 'AMD' }, { code: 'FA', group: 'A' },
    ] }) }
    renderAt('/terminal')
    const switcher = screen.getByTestId('terminal-phone-switcher')
    expect(switcher.querySelectorAll('[role="tab"]')).toHaveLength(4)
    expect(screen.getByTestId('terminal-phone-switch-0')).toHaveTextContent('GP')
    expect(screen.getByTestId('terminal-phone-switch-1')).toHaveTextContent('DES')
    expect(screen.getByTestId('terminal-phone-switch-2')).toHaveTextContent('CN')
    expect(screen.getByTestId('terminal-phone-switch-3')).toHaveTextContent('FA')
  })

  it('the active tab reflects layout.focus, and only the focused panel is shown (the rest stay mounted, hidden)', () => {
    store.prefs = { terminal_layout: JSON.stringify({ v: 1, count: 4, focus: 1, panels: [
      { code: 'GP', group: 'A' }, { code: 'DES', group: 'A', sym: 'AAPL' }, { code: 'CN', group: 'N', sym: 'AMD' }, { code: 'FA', group: 'A' },
    ] }) }
    renderAt('/terminal')
    expect(screen.getByTestId('terminal-phone-switch-1').getAttribute('aria-selected')).toBe('true')
    expect(screen.getByTestId('terminal-phone-switch-0').getAttribute('aria-selected')).toBe('false')
    expect(screen.getByTestId('terminal-panel-1').hidden).toBe(false)
    expect(screen.getByTestId('terminal-panel-0').hidden).toBe(true)
  })

  it('tapping a tab calls setFocus: the UI moves focus to that panel and persists it', async () => {
    store.prefs = { terminal_layout: JSON.stringify({ v: 1, count: 4, focus: 0, panels: [
      { code: 'GP', group: 'A' }, { code: 'DES', group: 'A', sym: 'AAPL' }, { code: 'CN', group: 'N', sym: 'AMD' }, { code: 'FA', group: 'A' },
    ] }) }
    renderAt('/terminal')
    expect(screen.getByTestId('terminal-panel-0').hidden).toBe(false)
    expect(screen.getByTestId('terminal-panel-2').hidden).toBe(true)

    await act(async () => { fireEvent.click(screen.getByTestId('terminal-phone-switch-2')) })

    expect(screen.getByTestId('terminal-panel-2')).toHaveTextContent('News:AMD')
    expect(screen.getByTestId('terminal-panel-2').hidden).toBe(false)
    expect(screen.getByTestId('terminal-panel-0').hidden).toBe(true)
    expect(screen.getByTestId('terminal-phone-switch-2').getAttribute('aria-selected')).toBe('true')
    // Focus is a per-viewer convenience (audit #19): remembered on this device by panel id, and
    // NOT posted — a focus click must not mint a board version.
    expect(window.localStorage.getItem('uct.terminal.focusPanel')).toBe('p3')   // the v1 migration's slot ids
    expect(store.writes.filter(([k]) => k === 'terminal_layout')).toHaveLength(0)
  })

  it('the phone count control changes the active panel count and tab count, via the same setCount handler', async () => {
    renderAt('/terminal')
    // default fresh layout starts at count 1
    expect(screen.getByTestId('terminal-phone-switcher').querySelectorAll('[role="tab"]')).toHaveLength(1)

    await act(async () => { fireEvent.click(screen.getByTestId('terminal-phone-count-2')) })

    expect(screen.getByTestId('terminal-phone-switcher').querySelectorAll('[role="tab"]')).toHaveLength(2)
    expect(JSON.parse(store.prefs.terminal_layout).count).toBe(2)
    // the phone grid still SHOWS exactly one panel (the focused one) even though 2 are active;
    // the other is mounted and hidden so switching back does not refetch or reset it
    const panels = screen.getAllByTestId(/^terminal-panel-\d+$/)
    expect(panels).toHaveLength(2)
    expect(panels.filter((el) => !el.hidden)).toHaveLength(1)
  })

  it('the desktop panel-count control is absent on phone; only the phone one is present', () => {
    renderAt('/terminal')
    expect(screen.queryByTestId('terminal-count-2')).toBeNull()
    expect(screen.getByTestId('terminal-phone-count-2')).toBeTruthy()
  })
  it('switching away and back keeps the panel mounted: its content is the same element, not a remount', async () => {
    store.prefs = { terminal_layout: JSON.stringify({ v: 1, count: 2, focus: 0, panels: [
      { code: 'DES', group: 'N', sym: 'AAPL' }, { code: 'CN', group: 'N', sym: 'AMD' },
    ] }) }
    renderAt('/terminal')
    await screen.findByText('Overview:AAPL')
    const before = screen.getByTestId('terminal-panel-0').querySelector('[data-testid^="stub-"]')
    expect(before).toBeTruthy()
    await act(async () => { fireEvent.click(screen.getByTestId('terminal-phone-switch-1')) })
    await act(async () => { fireEvent.click(screen.getByTestId('terminal-phone-switch-0')) })
    const after = screen.getByTestId('terminal-panel-0').querySelector('[data-testid^="stub-"]')
    expect(after).toBe(before)
  })
})
