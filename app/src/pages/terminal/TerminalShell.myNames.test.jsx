// ALRT and W through the REAL grammar, registry and shell (lane 9). The panels are stubs; the
// network half of ALRT (alertCommand.setAlert) is a spy, so this file proves the WIRING: a typed
// `NVDA ALRT 950` sets exactly one alert and opens `NVDA ALRT` (the list), a link never sets one,
// and `W` opens the watchlist monitor. alertCommand.test.js proves the POST itself.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useEffect, useReducer } from 'react'
import { render, screen, fireEvent, act, cleanup, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { AuthContext } from '../../context/AuthContext'

const store = vi.hoisted(() => ({ prefs: {}, listeners: new Set() }))
const alerts = vi.hoisted(() => ({ calls: [], answer: null }))

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

vi.mock('./alertCommand', async (importOriginal) => ({
  ...(await importOriginal()),
  setAlert: (plan) => { alerts.calls.push(plan); return alerts.answer() },
}))

vi.mock('./panels', async (importOriginal) => {
  const real = await importOriginal()
  const stubs = new Map()
  return {
    ...real,
    PANEL_IMPORTERS: {},
    panelComponent: (name) => {
      if (!stubs.has(name)) {
        stubs.set(name, function Stub({ sym, list }) {
          return <div data-testid={`stub-${name}`}>{name}:{sym || '-'}:{list || '-'}</div>
        })
      }
      return stubs.get(name)
    },
  }
})

import TerminalShell from './TerminalShell'
import { saveTiming } from './useTerminalLayout'
import { TerminalRoute } from './TerminalRoutes'
import { DEFAULT_LAYOUT } from './boardModel'

const OPEN = { cohorts: ['terminal-next'], isPaid: true }

function seedBoard() {
  store.prefs = {
    terminal_layout: JSON.stringify({ ...DEFAULT_LAYOUT, count: 1, focus: 0,
      panels: [{ id: 'p1', code: 'DES', channel: null, sym: 'AAPL', args: [] }], closed: [] }),
  }
}
function renderShell(entry = '/terminal') {
  return render(
    <AuthContext.Provider value={OPEN}>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/terminal" element={<TerminalRoute><TerminalShell /></TerminalRoute>} />
          <Route path="*" element={<div data-testid="elsewhere" />} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  )
}
const code = (i) => screen.queryByTestId(`terminal-panel-${i}`)?.getAttribute('data-code')
const notice = () => screen.getByTestId('terminal-notice').textContent
const panel0 = () => JSON.parse(store.prefs.terminal_layout).panels[0]
async function type(text) {
  const input = screen.getByTestId('terminal-command')
  fireEvent.change(input, { target: { value: text } })
  await act(async () => { fireEvent.keyDown(input, { key: 'Enter' }) })
}

beforeEach(() => {
  saveTiming.debounceMs = 0
  try { window.sessionStorage.clear() } catch { /* */ }
  try { window.localStorage.clear() } catch { /* */ }
  alerts.calls = []
  alerts.answer = () => Promise.resolve({ text: 'Alert set: NVDA above $950.00 (now $912.00).' })
  seedBoard()
})
afterEach(() => cleanup())

describe('ALRT from the command line', () => {
  it('NVDA ALRT 950 sets ONE alert, opens NVDA ALRT (the list, no price kept), and confirms', async () => {
    renderShell()
    await type('NVDA ALRT 950')
    expect(alerts.calls).toEqual([{ ok: true, create: true, sym: 'NVDA', price: 950, direction: null }])
    expect(code(0)).toBe('ALRT')
    expect(panel0()).toMatchObject({ code: 'ALRT', args: [] })    // a reload re-creates nothing
    await waitFor(() => expect(notice()).toContain('Alert set: NVDA above $950.00 (now $912.00).'))
  })

  it('a failed save is said in plain English', async () => {
    alerts.answer = () => Promise.reject(Object.assign(new Error('x'), { memberText: 'Price alerts need a paid plan.' }))
    renderShell()
    await type('NVDA ALRT <950')
    expect(alerts.calls[0]).toMatchObject({ sym: 'NVDA', direction: 'below' })
    await waitFor(() => expect(notice()).toContain('Price alerts need a paid plan.'))
  })

  it('a bad price is refused with the reason and sets nothing', async () => {
    renderShell()
    await type('NVDA ALRT abc')
    expect(alerts.calls).toEqual([])
    expect(notice()).toContain('"ABC" is not a price.')
    expect(code(0)).toBe('DES')
  })

  it('a link (?cmd=) never sets an alert', async () => {
    renderShell(`/terminal?cmd=${encodeURIComponent('NVDA ALRT 950')}`)
    await act(async () => {})
    expect(alerts.calls).toEqual([])
    expect(notice()).toContain('Price alerts are set from the command line, not from a link.')
  })

  it('ALRT with no price just lists, and sets nothing', async () => {
    renderShell()
    await type('ALRT')
    expect(alerts.calls).toEqual([])
    expect(code(0)).toBe('ALRT')
  })
})

describe('W opens the watchlist monitor', () => {
  it('W opens MON; W 2 picks the second list; $W is still Wayfair', async () => {
    renderShell()
    await type('W')
    expect(code(0)).toBe('MON')
    await type('W 2')
    expect(screen.getByTestId('stub-Watchlist').textContent).toBe('Watchlist:-:2')
    await type('$W')
    expect(code(0)).toBe('DES')
  })
})
