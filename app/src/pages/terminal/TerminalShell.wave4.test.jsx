// The shell, audit wave 4 (lane A). Same harness as TerminalShell.audit2.test.jsx: the REAL
// TerminalShell under MemoryRouter, a preferences store and stubbed panel components. Each
// `it` began as a reproduction that went red on the code before its fix.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useEffect, useReducer } from 'react'
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useLocation, useNavigate } from 'react-router-dom'
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
    refreshPreferences: async () => null,
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

vi.mock('./panels', async (importOriginal) => {
  const real = await importOriginal()
  const stubs = new Map()
  return {
    ...real,
    PANEL_IMPORTERS: {},
    panelComponent: (name) => {
      if (!stubs.has(name)) {
        stubs.set(name, function Stub({ sym, date }) {
          return <div data-testid={`stub-${name}`}>{name}:{sym || '-'}{date ? `:date=${date}` : ''}</div>
        })
      }
      return stubs.get(name)
    },
  }
})

import TerminalShell from './TerminalShell'
import { TerminalRoute } from './TerminalRoutes'
import { saveTiming } from './useTerminalLayout'

let nav
function Where() {
  const l = useLocation()
  nav = useNavigate()
  return <div data-testid="where">{l.pathname}{l.search}</div>
}

const OPEN = { cohorts: ['terminal-next'], isPaid: true, addressSpaceEnabled: true }

function renderAt(entries, idx = entries.length - 1, auth = OPEN) {
  return render(
    <AuthContext.Provider value={auth}>
      <MemoryRouter initialEntries={entries} initialIndex={idx}>
        <Routes>
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
const where = () => screen.getByTestId('where').textContent
const params = () => new URLSearchParams(where().split('?')[1] || '')
const code = (i) => screen.getByTestId(`terminal-panel-${i}`).dataset.code
const settle = () => act(async () => { for (let i = 0; i < 6; i += 1) await Promise.resolve() })

/** A returning member whose focused panel shows a ticker (DES on group A = AMD). */
const ONE_DES = () => ({
  charts_workspace_groups: JSON.stringify({ A: 'AMD' }),
  terminal_layout: JSON.stringify({ v: 2, count: 1, focus: 0, panels: [{ id: 'p1', code: 'DES', channel: 'A' }] }),
})

beforeEach(() => {
  store.prefs = {}
  store.writes = []
  saveTiming.debounceMs = 0
  try { window.localStorage.clear(); window.sessionStorage.clear() } catch { /* */ }
  global.fetch = vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) }))
  window.matchMedia = (q) => ({ matches: false, media: q, addListener() {}, removeListener() {},
    addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false } })
})
afterEach(() => cleanup())

describe('fix 1: an arriving ?cmd= is never overwritten by the focused panel\'s command', () => {
  it('a returning member on a DES board follows a ?cmd= door (it is not replaced by ?cmd=AMD DES)', async () => {
    store.prefs = ONE_DES()
    renderAt(['/home', '/terminal?cmd=NVDA%20RES'], 1)
    await settle()
    expect(where()).toBe('/research/NVDA')
    await act(async () => { nav(-1) })
    await settle()
    expect(where()).toBe('/home')
  })

  it('the palette handoff to an AI question lands on AI Search for that member too', async () => {
    store.prefs = ONE_DES()
    renderAt(['/home', '/terminal?cmd=ASK%20why%20is%20SMH%20down'], 1)
    await settle()
    expect(where()).toMatch(/^\/ai-search\?q=/)
  })

  it('a ?cmd= that cannot run is left in the address bar, with the reason on screen', async () => {
    store.prefs = ONE_DES()
    renderAt(['/terminal?cmd=NVDA%20GPX'])
    await settle()
    expect(params().get('cmd')).toBe('NVDA GPX')
    expect(screen.getByTestId('terminal-notice')).toHaveTextContent('Unknown function "GPX" for NVDA')
    expect(code(0)).toBe('DES')
  })

  it('a ?cmd= that opens a panel still writes the panel\'s command back', async () => {
    store.prefs = ONE_DES()
    renderAt(['/terminal?cmd=nvda%20gp'])
    await settle()
    expect(code(0)).toBe('GP')
    expect(params().get('cmd')).toBe('NVDA GP')
  })
})

describe('fix 2: a bare ticker on the calendar loads into the overview beside it', () => {
  it('first-visit board (CAL focused, SPY overview): NVDA goes into the overview, the calendar stays', async () => {
    renderAt(['/terminal'])                                   // no saved board: CAL + SPY DES
    await settle()
    await type('NVDA')
    expect(code(0)).toBe('CAL')
    expect(code(1)).toBe('DES')
    expect(screen.getAllByTestId('stub-Overview')).toHaveLength(1)
    expect(screen.getByTestId('stub-Overview')).toHaveTextContent('Overview:NVDA')
    expect(screen.getByTestId('terminal-panel-1').dataset.focused).toBe('true')
    expect(screen.getByTestId('terminal-notice')).toHaveTextContent('Loaded NVDA into the overview in panel 2; CAL stays in panel 1.')
    expect(params().get('cmd')).toBe('NVDA DES')
    expect(params().get('p')).toBe('2')
  })

  it('with no overview on screen, the focused calendar takes the ticker as before', async () => {
    store.prefs = { terminal_layout: JSON.stringify({ v: 2, count: 1, focus: 0, panels: [{ id: 'p1', code: 'CAL', channel: 'A' }] }) }
    renderAt(['/terminal'])
    await type('NVDA')
    expect(code(0)).toBe('DES')
    expect(screen.getByTestId('stub-Overview')).toHaveTextContent('Overview:NVDA')
  })

  it('a ticker panel keeps the old rule: a bare ticker turns the focused panel into DES', async () => {
    store.prefs = { charts_workspace_groups: JSON.stringify({ A: 'AMD' }),
      terminal_layout: JSON.stringify({ v: 2, count: 2, focus: 0, panels: [
        { id: 'p1', code: 'GP', channel: 'A' }, { id: 'p2', code: 'DES', channel: 'A' }] }) }
    renderAt(['/terminal'])
    await type('NVDA')
    expect(code(0)).toBe('DES')
  })
})

describe('fix 3: `NVDA DP` opens the dark pool page on NVDA', () => {
  it('the ticker rides in the URL the page reads (?ticker=), instead of being refused', async () => {
    renderAt(['/terminal'])
    await type('NVDA DP')
    expect(where()).toBe('/dark-pool?ticker=NVDA')
  })

  it('`DP TSLA` is the same command; `DP` alone still opens the whole page', async () => {
    renderAt(['/terminal'])
    await type('DP TSLA')
    expect(where()).toBe('/dark-pool?ticker=TSLA')
    cleanup()
    renderAt(['/terminal'])
    await type('DP')
    expect(where()).toBe('/dark-pool')
  })
})

describe('fix 4: CATH takes a day', () => {
  it('`CATH 2026-10-01` opens the catalyst list for that session', async () => {
    renderAt(['/terminal'])
    await type('CATH 2026-10-01')
    expect(code(0)).toBe('CATH')
    expect(screen.getByTestId('terminal-panel-0')).toHaveTextContent(':date=2026-10-01')
    expect(params().get('cmd')).toBe('CATH 2026-10-01')
  })

  it('a day still ahead is said to be not applied', async () => {
    renderAt(['/terminal'])
    await type('CATH 2099-01-01')
    expect(screen.getByTestId('terminal-notice')).toHaveTextContent('Not applied: "2099-01-01"')
  })
})

describe('fix 5: `ERN` alone opens the earnings calendar', () => {
  it('on a board whose focused panel shows a ticker, ERN opens CAL, not that ticker\'s earnings', async () => {
    store.prefs = ONE_DES()
    renderAt(['/terminal'])
    await type('ERN')
    await settle()
    expect(code(0)).toBe('CAL')
    expect(where()).toMatch(/^\/terminal\/calendar/)
    expect(params().get('earnings')).toBeNull()
  })

  it('`NVDA ERN` still opens NVDA\'s earnings window', async () => {
    store.prefs = ONE_DES()
    renderAt(['/terminal'])
    await type('NVDA ERN')
    await settle()
    expect(code(0)).toBe('ERN')
    expect(params().get('earnings')).toBe('NVDA')
  })
})
