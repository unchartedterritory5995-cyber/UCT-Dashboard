// Wave 4 (lane A, for lane B): the shell hands SecurityHeadline an `onRun` that runs a command
// from that panel, so the headline's unknown-ticker suggestions can be clicked. The headline is
// stubbed here (it captures the prop), so this pins the shell's wire without lane B's component.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useEffect, useReducer } from 'react'
import { render, screen, act, cleanup } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { AuthContext } from '../../context/AuthContext'

const store = vi.hoisted(() => ({ prefs: {}, listeners: new Set(), onRun: null }))

vi.mock('../../hooks/usePreferences', () => {
  const parsePref = (raw, fallback) => {
    if (raw == null) return fallback
    if (typeof raw !== 'string') return raw
    try { return JSON.parse(raw) } catch { return fallback }
  }
  const notify = () => store.listeners.forEach((f) => f())
  return {
    parsePref,
    refreshPreferences: async () => null,
    default: function usePreferences() {
      const [, force] = useReducer((x) => x + 1, 0)
      useEffect(() => { store.listeners.add(force); return () => store.listeners.delete(force) }, [])
      return {
        prefs: store.prefs,
        loading: false,
        setPref: (k, v) => { store.prefs = { ...store.prefs, [k]: v }; notify() },
        setPrefMerged: async (k, updater) => {
          const next = updater(parsePref(store.prefs[k], undefined))
          if (next === undefined) return
          store.prefs = { ...store.prefs, [k]: typeof next === 'string' ? next : JSON.stringify(next) }; notify()
        },
      }
    },
  }
})

vi.mock('../../components/terminal', async (importOriginal) => {
  const real = await importOriginal()
  return {
    ...real,
    SecurityHeadline: ({ sym, onRun }) => { store.onRun = onRun; return <div data-testid="headline">{sym}</div> },
  }
})

vi.mock('./panels', async (importOriginal) => {
  const real = await importOriginal()
  const stubs = new Map()
  return {
    ...real,
    PANEL_IMPORTERS: {},
    panelComponent: (name) => {
      if (!stubs.has(name)) stubs.set(name, function Stub({ sym }) { return <div data-testid={`stub-${name}`}>{name}:{sym || '-'}</div> })
      return stubs.get(name)
    },
  }
})

import TerminalShell from './TerminalShell'
import { TerminalRoute } from './TerminalRoutes'
import { saveTiming } from './useTerminalLayout'

beforeEach(() => {
  saveTiming.debounceMs = 0
  store.onRun = null
  store.prefs = {
    charts_workspace_groups: JSON.stringify({ A: 'AMD' }),
    terminal_layout: JSON.stringify({ v: 2, count: 1, focus: 0, panels: [{ id: 'p1', code: 'DES', channel: 'A' }] }),
  }
  try { window.localStorage.clear(); window.sessionStorage.clear() } catch { /* */ }
  global.fetch = vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) }))
  window.matchMedia = (q) => ({ matches: false, media: q, addListener() {}, removeListener() {},
    addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false } })
})
afterEach(() => cleanup())

describe('SecurityHeadline gets the panel\'s onRun', () => {
  it('a command run through it lands in the shell', async () => {
    render(
      <AuthContext.Provider value={{ cohorts: ['terminal-next'], isPaid: true }}>
        <MemoryRouter initialEntries={['/terminal']}>
          <Routes><Route path="/terminal" element={<TerminalRoute><TerminalShell /></TerminalRoute>} /></Routes>
        </MemoryRouter>
      </AuthContext.Provider>,
    )
    expect(screen.getByTestId('headline')).toHaveTextContent('AMD')
    expect(typeof store.onRun).toBe('function')
    await act(async () => { store.onRun('NVDA') })
    expect(screen.getByTestId('stub-Overview')).toHaveTextContent('Overview:NVDA')
  })
})
