// An EMBEDDED list (a page the shell renders unforked: U20, FREC, CATH, RISK, OSCR, WIRE) is a
// numbered list exactly like MOST's: it publishes `$SYM` rows through `usePanelSymbolRows`
// (PanelListContext), typing a row number while it is focused LOADS that name into the linked
// group, and `BOARD <FUNC>` / its "Board of" control build a board from its names. The page is a
// stub that does what the real ones do; each page's own `*.rows.test.jsx` proves its half.
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

// The REAL panels module with stubbed components. U20's stub publishes through the REAL hook and
// renders the REAL "Board of" control, as UCT20.jsx does; every other panel is a plain stub.
vi.mock('./panels', async (importOriginal) => {
  const real = await importOriginal()
  const terminal = await import('../../components/terminal')
  const { BY_CODE } = await import('./functions')
  const u20Name = real.panelNameFor(BY_CODE.U20.market)
  const stubs = new Map()
  return {
    ...real,
    PANEL_IMPORTERS: {},
    panelComponent: (name) => {
      if (!stubs.has(name)) {
        stubs.set(name, name === u20Name
          ? function U20Stub() {
            const syms = terminal.usePanelSymbolRows(['AMD', 'TSLA', 'AMD'], 'UCT 20')
            return <div data-testid="stub-U20"><terminal.BoardFromList syms={syms} label="UCT 20" testId="uct20-board" /></div>
          }
          : function Stub({ sym }) { return <div data-testid={`stub-${name}`}>{name}:{sym || '-'}</div> })
      }
      return stubs.get(name)
    },
  }
})

import TerminalShell from './TerminalShell'
import { saveTiming } from './useTerminalLayout'
import { TerminalRoute } from './TerminalRoutes'
import { DEFAULT_LAYOUT } from './boardModel'

function setViewport(width) {
  window.matchMedia = (query) => {
    const max = /max-width:\s*(\d+)px/.exec(query)
    const min = /min-width:\s*(\d+)px/.exec(query)
    const matches = (!max || width <= Number(max[1])) && (!min || width >= Number(min[1]))
    return { matches, media: query, onchange: null, addListener() {}, removeListener() {},
      addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false } }
  }
}

const OPEN = { cohorts: ['terminal-next'], isPaid: true, optionsChainEnabled: true }

/** U20 in panel 1 (unlinked); GP follows group A (NVDA). */
function seedBoard(focus = 0) {
  const panels = [
    { id: 'p1', code: 'U20', channel: null, sym: null, args: [] },
    { id: 'p2', code: 'GP', channel: 'A', sym: null, args: [] },
  ]
  store.prefs = {
    terminal_layout: JSON.stringify({ ...DEFAULT_LAYOUT, count: 2, focus, panels, closed: [] }),
    charts_workspace_groups: JSON.stringify({ A: 'NVDA' }),
  }
}

function renderShell() {
  return render(
    <AuthContext.Provider value={OPEN}>
      <MemoryRouter initialEntries={['/terminal']}>
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
async function type(line) {
  const input = screen.getByTestId('terminal-command')
  fireEvent.change(input, { target: { value: line } })
  await act(async () => { fireEvent.keyDown(input, { key: 'Enter' }) })
}

beforeEach(() => {
  saveTiming.debounceMs = 0
  try { window.sessionStorage.clear() } catch { /* */ }
  try { window.localStorage.clear() } catch { /* */ }
  store.prefs = {}
  store.writes = []
  setViewport(1400)
})
afterEach(() => cleanup())

describe('an embedded list is a numbered list', () => {
  it('typing a row number while U20 is focused loads that row\'s name into group A; U20 stays U20', async () => {
    seedBoard(0)
    renderShell()
    await screen.findByTestId('stub-U20')
    expect(screen.getByTestId('stub-Chart')).toHaveTextContent('Chart:NVDA')
    await type('2')
    expect([code(0), code(1)]).toEqual(['U20', 'GP'])
    expect(screen.getByTestId('stub-Chart')).toHaveTextContent('Chart:TSLA')
    // row 3 is the third row on screen (a repeated name keeps its own number)
    await type('3')
    expect(screen.getByTestId('stub-Chart')).toHaveTextContent('Chart:AMD')
  })

  it('a row past the end names the range', async () => {
    seedBoard(0)
    renderShell()
    await screen.findByTestId('stub-U20')
    await type('9')
    expect(notice()).toBe('There is no row 9 here (rows 1-3).')
  })

  it('CONTROL: with the chart focused instead, the same number addresses nothing', async () => {
    seedBoard(1)
    renderShell()
    await screen.findByTestId('stub-U20')
    await type('2')
    expect(notice()).toBe('The focused panel has no numbered list. HELP shows one.')
    expect(screen.getByTestId('stub-Chart')).toHaveTextContent('Chart:NVDA')
  })
})

describe('an embedded list builds a board', () => {
  it('BOARD GP while U20 is focused opens its names (de-duplicated) as charts', async () => {
    seedBoard(0)
    renderShell()
    await screen.findByTestId('stub-U20')
    await type('BOARD GP')
    expect([code(0), code(1)]).toEqual(['GP', 'GP'])
    expect(screen.getAllByTestId('stub-Chart').map((n) => n.textContent)).toEqual(['Chart:AMD', 'Chart:TSLA'])
    expect(screen.queryByTestId('terminal-panel-2')).toBeNull()
  })

  it('its "Board of" control does the same', async () => {
    seedBoard(0)
    renderShell()
    await screen.findByTestId('uct20-board')
    expect(screen.getByTestId('uct20-board-open')).toHaveTextContent('Open 2')
    await act(async () => { fireEvent.click(screen.getByTestId('uct20-board-open')) })
    expect(screen.getAllByTestId('stub-Chart').map((n) => n.textContent)).toEqual(['Chart:AMD', 'Chart:TSLA'])
  })
})
