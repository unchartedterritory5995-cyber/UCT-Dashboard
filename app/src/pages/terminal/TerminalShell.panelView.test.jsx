// Customization pass 1, the SHELL half: a panel's view (usePanelView) is saved with the board
// through the layout's own debounced save, never re-runs the command (no remount), survives a
// reload, a re-run of the same code with new arguments, and is dropped when another code takes
// the panel. The hook and header halves: components/terminal/PanelTable.test.jsx.
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

const mounts = vi.hoisted(() => ({ n: 0 }))

vi.mock('./panels', async (importOriginal) => {
  const real = await importOriginal()
  const { default: usePanelView } = await import('../../components/terminal/usePanelView')
  function MoversStub({ lens, onRun }) {
    const [view, setView] = usePanelView({ sort: null, filters: { minPrice: 0 } })
    useEffect(() => { mounts.n += 1 }, [])
    return (
      <div data-testid="stub-Movers" data-lens={lens || ''}>
        <span data-testid="stub-view">{JSON.stringify(view)}</span>
        <button type="button" onClick={() => setView({ sort: { key: 'pct', dir: 'asc' } })}>sort</button>
        <button type="button" onClick={() => setView({ filters: { minPrice: 5 } })}>floor</button>
        <button type="button" onClick={() => onRun?.('MOST UP', { here: true })}>lens up</button>
      </div>
    )
  }
  return {
    ...real,
    PANEL_IMPORTERS: {},
    panelComponent: (name) => (name === 'Movers' ? MoversStub : function Stub() { return <div data-testid={`stub-${name}`}>{name}</div> }),
  }
})

import TerminalShell from './TerminalShell'
import { saveTiming } from './useTerminalLayout'
import { TerminalRoute } from './TerminalRoutes'
import { DEFAULT_LAYOUT } from './boardModel'

const OPEN = { cohorts: ['terminal-next'], isPaid: true, optionsChainEnabled: true }
function setViewport(width) {
  window.matchMedia = (query) => {
    const max = /max-width:\s*(\d+)px/.exec(query)
    const min = /min-width:\s*(\d+)px/.exec(query)
    const matches = (!max || width <= Number(max[1])) && (!min || width >= Number(min[1]))
    return { matches, media: query, onchange: null, addListener() {}, removeListener() {},
      addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false } }
  }
}
function seedBoard(view) {
  const panels = [
    { id: 'p1', code: 'MOST', channel: null, sym: null, args: [], ...(view ? { view } : {}) },
    { id: 'p2', code: 'GP', channel: 'A', sym: null, args: [] },
  ]
  store.prefs = {
    terminal_layout: JSON.stringify({ ...DEFAULT_LAYOUT, count: 2, focus: 0, panels, closed: [] }),
    charts_workspace_groups: JSON.stringify({ A: 'NVDA' }),
  }
}
function renderShell(path = '/terminal') {
  return render(
    <AuthContext.Provider value={OPEN}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/terminal" element={<TerminalRoute><TerminalShell /></TerminalRoute>} />
          <Route path="*" element={<div data-testid="elsewhere" />} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  )
}
const storedPanel = (id = 'p1') => JSON.parse(store.prefs.terminal_layout).panels.find((p) => p.id === id)
const layoutWrites = () => store.writes.filter(([k]) => k === 'terminal_layout').length

beforeEach(() => {
  saveTiming.debounceMs = 0
  try { window.sessionStorage.clear() } catch { /* */ }
  try { window.localStorage.clear() } catch { /* */ }
  store.prefs = {}
  store.writes = []
  mounts.n = 0
  setViewport(1400)
})
afterEach(() => { cleanup(); vi.useRealTimers() })

describe('a panel view is saved with the board', () => {
  it('a write saves the view on the panel record and does not remount the panel', async () => {
    seedBoard()
    renderShell()
    expect(await screen.findByTestId('stub-Movers')).toBeTruthy()
    expect(mounts.n).toBe(1)
    await act(async () => { fireEvent.click(screen.getByText('sort')) })
    expect(storedPanel().view).toEqual({ sort: { key: 'pct', dir: 'asc' } })
    expect(storedPanel().args).toEqual([])
    expect(mounts.n).toBe(1)
    await act(async () => { fireEvent.click(screen.getByText('floor')) })
    expect(storedPanel().view).toEqual({ sort: { key: 'pct', dir: 'asc' }, filters: { minPrice: 5 } })
    expect(mounts.n).toBe(1)
  })

  it('writes are debounced into one layout save', async () => {
    seedBoard()
    saveTiming.debounceMs = 1000
    vi.useFakeTimers({ shouldAdvanceTime: true })
    renderShell()
    await act(async () => { await vi.advanceTimersByTimeAsync(50) })
    const before = layoutWrites()
    await act(async () => { fireEvent.click(screen.getByText('sort')) })
    await act(async () => { fireEvent.click(screen.getByText('floor')) })
    expect(layoutWrites()).toBe(before)
    await act(async () => { await vi.advanceTimersByTimeAsync(1100) })
    expect(layoutWrites()).toBe(before + 1)
    expect(storedPanel().view).toEqual({ sort: { key: 'pct', dir: 'asc' }, filters: { minPrice: 5 } })
  })

  it('a reload opens the panel with its view', async () => {
    seedBoard({ sort: { key: 'pct', dir: 'desc' }, filters: { minPrice: 10 } })
    renderShell()
    const v = JSON.parse((await screen.findByTestId('stub-view')).textContent)
    expect(v).toEqual({ sort: { key: 'pct', dir: 'desc' }, hidden: [], filters: { minPrice: 10 } })
  })

  it('re-running the same code with new arguments keeps the view; another code drops it', async () => {
    seedBoard({ filters: { minPrice: 5 } })
    renderShell()
    await screen.findByTestId('stub-Movers')
    await act(async () => { fireEvent.click(screen.getByText('lens up')) })
    expect(storedPanel().args).toEqual(['UP'])
    expect(storedPanel().view).toEqual({ filters: { minPrice: 5 } })
    expect(JSON.parse(screen.getByTestId('stub-view').textContent).filters).toEqual({ minPrice: 5 })
    const input = screen.getByTestId('terminal-command')
    fireEvent.change(input, { target: { value: '@1 CAL' } })
    await act(async () => { fireEvent.keyDown(input, { key: 'Enter' }) })
    expect(storedPanel().code).toBe('CAL')
    expect(storedPanel()).not.toHaveProperty('view')
  })
})
