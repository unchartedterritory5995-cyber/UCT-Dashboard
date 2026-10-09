// UCT Terminal — a brand-new member's first board (owner decision 2026-10-08, product item #1).
// A member with NO saved board opens on two panels: the calendar and an SPY overview (DES on
// group A), instead of one bare calendar. Opening writes nothing; the first real change saves
// the board and keeps SPY in group A (only if the member has not picked a ticker of their own).
// A returning member, and a member whose preferences are still loading, never see it.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useEffect, useReducer } from 'react'
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { AuthContext } from '../../context/AuthContext'

const store = vi.hoisted(() => ({ prefs: {}, listeners: new Set(), writes: [], loading: false }))

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
        loading: store.loading,
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
import { FIRST_VISIT_SYM, defaultLayout, firstVisitLayout, serializeLayout } from './boardModel'

function setViewport(width) {
  window.matchMedia = (query) => {
    const max = /max-width:\s*(\d+)px/.exec(query)
    const min = /min-width:\s*(\d+)px/.exec(query)
    const matches = (!max || width <= Number(max[1])) && (!min || width >= Number(min[1]))
    return { matches, media: query, onchange: null, addListener() {}, removeListener() {},
      addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false } }
  }
}

const OPEN = { cohorts: ['terminal-next'], isPaid: true }

function renderAt(url) {
  return render(
    <AuthContext.Provider value={OPEN}>
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/terminal" element={<TerminalRoute><TerminalShell /></TerminalRoute>} />
          <Route path="*" element={<div data-testid="elsewhere" />} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  )
}

async function type(text) {
  const input = screen.getByTestId('terminal-command')
  fireEvent.change(input, { target: { value: text } })
  await act(async () => { fireEvent.keyDown(input, { key: 'Enter' }) })
}

const panels = () => screen.getAllByTestId(/^terminal-panel-\d+$/)
const groupsPref = () => JSON.parse(store.prefs.charts_workspace_groups || '{}')

beforeEach(() => {
  saveTiming.debounceMs = 0
  try { window.sessionStorage.clear() } catch { /* */ }
  try { window.localStorage.clear() } catch { /* */ }
  store.prefs = {}
  store.writes = []
  store.loading = false
  setViewport(1400)
})
afterEach(() => cleanup())

describe('the first-visit board, as data', () => {
  it('is the default board with its first two panels showing: CAL, then DES on group A', () => {
    const l = firstVisitLayout()
    expect(l.count).toBe(2)
    expect(l.panels.slice(0, 2).map((p) => [p.code, p.channel])).toEqual([['CAL', 'A'], ['DES', 'A']])
    expect(l.focus).toBe(0)
    expect(FIRST_VISIT_SYM).toBe('SPY')
  })
})

describe('a brand-new member opens on the calendar beside an SPY overview', () => {
  it('two panels: CAL and an overview of SPY (not "needs a ticker"), and opening writes nothing', async () => {
    renderAt('/terminal')
    expect(panels()).toHaveLength(2)
    expect(await screen.findByTestId('stub-Calendar')).toBeTruthy()
    expect(await screen.findByTestId('stub-Overview')).toHaveTextContent(`Overview:${FIRST_VISIT_SYM}`)
    expect(screen.queryByText(/needs a ticker/)).toBeNull()
    expect(store.writes).toEqual([])
  })

  it('the first real change saves the board AND keeps SPY in group A, so the overview keeps it', async () => {
    renderAt('/terminal')
    await type('HELP')                                   // replaces the focused calendar
    expect(JSON.parse(store.prefs.terminal_layout).count).toBe(2)
    expect(groupsPref().A).toBe(FIRST_VISIT_SYM)
    expect(screen.getByTestId('stub-Overview')).toHaveTextContent(`Overview:${FIRST_VISIT_SYM}`)
  })

  it('a ticker the member picks wins over the first-visit SPY', async () => {
    renderAt('/terminal')
    await type('NVDA GP')
    expect(groupsPref().A).toBe('NVDA')
    expect(screen.getByTestId('stub-Overview')).toHaveTextContent('Overview:NVDA')
  })

  it('a member who already has a group A ticker sees it, and it is never overwritten', async () => {
    store.prefs = { charts_workspace_groups: JSON.stringify({ A: 'AAPL' }) }
    renderAt('/terminal')
    expect(await screen.findByTestId('stub-Overview')).toHaveTextContent('Overview:AAPL')
    await type('HELP')
    expect(groupsPref().A).toBe('AAPL')
  })
})

describe('everyone else is untouched', () => {
  it('a returning member opens on their own saved board', async () => {
    store.prefs = { terminal_layout: serializeLayout(defaultLayout()) }
    renderAt('/terminal')
    expect(panels()).toHaveLength(1)
    expect(await screen.findByTestId('stub-Calendar')).toBeTruthy()
    expect(screen.queryByTestId('stub-Overview')).toBeNull()
  })

  it('while preferences are still loading, the first-visit board never flashes', () => {
    store.loading = true
    renderAt('/terminal')
    expect(screen.queryByTestId('stub-Overview')).toBeNull()
    expect(store.writes).toEqual([])
  })
})
