// UCT Terminal — lane T2 at the SHELL: what a member sees when the board model acts.
// boardModel.test.js proves the pure model; these prove the shell WIRES it: an unreadable
// layout is never written over, close is undoable, a `B:` address opens a saved board and
// "Back to my layout" returns, a bare ticker opens its preset, density persists, and the
// keep-the-classic-calendar choice narrows the cohort redirect. Same harness as
// TerminalShell.test.jsx (kept separate so lane T3's edits there never collide with these).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useEffect, useReducer } from 'react'
import { render, screen, fireEvent, act, cleanup, within } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'
import fs from 'node:fs'
import path from 'node:path'
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

// The REAL panels module (names, the panel-set surface ids, URL ownership) with only the
// components stubbed — so a surface code here resolves through the real TERM-037 panel set.
// A stub given the security BOOM throws during render (the V22 throwing-panel rail).
vi.mock('./panels', async (importOriginal) => {
  const real = await importOriginal()
  const stubs = new Map()
  return {
    ...real,
    PANEL_IMPORTERS: {},
    panelComponent: (name) => {
      if (!stubs.has(name)) {
        stubs.set(name, function Stub({ sym, volSurface, tf, focusCode }) {
          if (sym === 'BOOM') throw new Error(`stub ${name} blew up`)
          return (
            <div data-testid={`stub-${name}`}>
              {name}:{sym || '-'}{volSurface ? ':vol' : ''}{tf ? `:tf=${tf}` : ''}{focusCode ? `:focus=${focusCode}` : ''}
            </div>
          )
        })
      }
      return stubs.get(name)
    },
  }
})

import TerminalShell from './TerminalShell'
import { CalendarRoute, TerminalRoute } from './TerminalRoutes'

function setViewport(width) {
  window.matchMedia = (query) => {
    const max = /max-width:\s*(\d+)px/.exec(query)
    const min = /min-width:\s*(\d+)px/.exec(query)
    const matches = (!max || width <= Number(max[1])) && (!min || width >= Number(min[1]))
    return { matches, media: query, onchange: null, addListener() {}, removeListener() {},
      addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false } }
  }
}

function Where() {
  const l = useLocation()
  return <div data-testid="where">{l.pathname}{l.search}</div>
}

const OPEN = { cohorts: ['terminal-next'], isPaid: true, optionsChainEnabled: true, optionsVolSurfaceEnabled: true }

function renderAt(url, auth = OPEN) {
  return render(
    <AuthContext.Provider value={auth}>
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/calendar" element={<CalendarRoute><div data-testid="legacy-calendar" /></CalendarRoute>} />
          <Route path="/terminal" element={<TerminalRoute><TerminalShell /></TerminalRoute>} />
          <Route path="/terminal/calendar" element={<TerminalRoute><TerminalShell /></TerminalRoute>} />
          <Route path="*" element={<div data-testid="elsewhere" />} />
        </Routes>
        <Where />
      </MemoryRouter>
    </AuthContext.Provider>,
  )
}

async function type(text) {
  const input = screen.getByTestId('terminal-command')
  fireEvent.change(input, { target: { value: text } })
  await act(async () => { fireEvent.keyDown(input, { key: 'Enter' }) })
}

beforeEach(() => {
  store.prefs = {}
  store.writes = []
  setViewport(1400)
  try { window.localStorage.clear() } catch { /* */ }
})
afterEach(() => cleanup())


import { DEFAULT_LAYOUT, emptyLibrary, saveBoard, setCount as countOf, setKeepCalendar, setPreset } from './boardModel'

const layoutWrites = () => store.writes.filter(([k]) => k === 'terminal_layout')

describe('lane T2 — the shell wires the board model', () => {
  it('an UNREADABLE stored layout is said, and nothing is written over it until "Start fresh"', async () => {
    store.prefs = { terminal_layout: '{not json' }
    renderAt('/terminal')
    expect(screen.getByTestId('terminal-unreadable')).toBeTruthy()
    await type('NVDA FA')
    expect(await screen.findByTestId('stub-Financials')).toHaveTextContent('Financials:NVDA') // the session board works
    expect(layoutWrites()).toHaveLength(0)                            // …and writes nothing
    expect(store.prefs.terminal_layout).toBe('{not json')
    await act(async () => { fireEvent.click(screen.getByTestId('terminal-start-fresh')) })
    expect(layoutWrites()).toHaveLength(1)
    expect(JSON.parse(store.prefs.terminal_layout).panels[0].code).toBe('FA')
  })

  it('a v1 layout is READ through the shim (not replaced by the default)', () => {
    store.prefs = { terminal_layout: JSON.stringify({ v: 1, count: 2, focus: 1, panels: [
      { code: 'FA', group: 'N', sym: 'AMD' }, { code: 'GP', group: 'A' }] }) }
    renderAt('/terminal')
    expect(screen.queryByTestId('terminal-unreadable')).toBe(null)
    expect(screen.getByTestId('terminal-panel-0').getAttribute('data-code')).toBe('FA')
    expect(screen.getByTestId('terminal-panel-1').getAttribute('data-channel')).toBe('A')
  })

  it('close is undoable: the panel comes back in its slot', async () => {
    store.prefs = { terminal_layout: JSON.stringify(countOf(DEFAULT_LAYOUT, 2)) }
    renderAt('/terminal')
    const code1 = screen.getByTestId('terminal-panel-1').getAttribute('data-code')
    await act(async () => { fireEvent.click(screen.getByTestId('terminal-close-1')) })
    expect(screen.queryByTestId('terminal-panel-1')).toBe(null)
    expect(JSON.parse(store.prefs.terminal_layout).count).toBe(1)
    await act(async () => { fireEvent.click(screen.getByTestId('terminal-notice-undo-close')) })
    expect(screen.getByTestId('terminal-panel-1').getAttribute('data-code')).toBe(code1)
    expect(JSON.parse(store.prefs.terminal_layout).count).toBe(2)
  })

  it('a B: address opens the saved board, and "Back to my layout" restores the one it replaced', async () => {
    const saved = saveBoard(emptyLibrary(), 'Earnings morning',
      { ...countOf(DEFAULT_LAYOUT, 3) }, { A: 'NVDA' }, 1)
    store.prefs = {
      terminal_layout: JSON.stringify(countOf(DEFAULT_LAYOUT, 1)),
      terminal_boards: JSON.stringify(saved.library),
    }
    renderAt('/terminal')
    expect(screen.getByTestId('terminal-grid').getAttribute('data-count')).toBe('1')
    await type('B:earnings-morning')
    expect(screen.getByTestId('terminal-grid').getAttribute('data-count')).toBe('3')
    expect(screen.getByTestId('terminal-boards-button').textContent).toContain('Earnings morning')
    await act(async () => { fireEvent.click(screen.getByTestId('terminal-notice-revert')) })
    expect(screen.getByTestId('terminal-grid').getAttribute('data-count')).toBe('1')
  })

  it('an unknown B: address is said, not silently ignored', async () => {
    renderAt('/terminal')
    await type('B:nope')
    expect(screen.getByTestId('terminal-notice').textContent).toContain('No board at B:nope')
  })

  it('a bare ticker with a preset opens that board for the ticker', async () => {
    const saved = saveBoard(emptyLibrary(), 'Deep dive', countOf(DEFAULT_LAYOUT, 2), {}, 1)
    store.prefs = { terminal_boards: JSON.stringify(setPreset(saved.library, 'TSLA', saved.board.id)) }
    renderAt('/terminal')
    await type('TSLA')
    expect(screen.getByTestId('terminal-grid').getAttribute('data-count')).toBe('2')
    expect(screen.getByTestId('terminal-notice').textContent).toContain('Opened Deep dive for TSLA')
  })

  it('density is a board setting with a visible control, and it persists', async () => {
    renderAt('/terminal')
    await act(async () => { fireEvent.click(screen.getByTestId('terminal-density-dense')) })
    expect(screen.getByTestId('terminal-shell').getAttribute('data-density')).toBe('dense')
    expect(JSON.parse(store.prefs.terminal_layout).density).toBe('dense')
  })

  it('keep-the-classic-calendar: an ADMITTED member who chose it stays on /calendar', () => {
    store.prefs = { terminal_boards: JSON.stringify(setKeepCalendar(emptyLibrary(), true)) }
    renderAt('/calendar')
    expect(screen.getByTestId('legacy-calendar')).toBeTruthy()
    cleanup()
    store.prefs = {}
    renderAt('/calendar')
    expect(screen.queryByTestId('legacy-calendar')).toBe(null)
  })
})
