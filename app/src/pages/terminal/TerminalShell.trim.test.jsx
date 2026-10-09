// UCT Terminal — the function-list trim in the shell (owner decision 2026-10-08). A board saved
// before the trim still opens: WIIM / BRKE panels render MOVE / EE, and a panel naming a removed
// code (EXP, PMKT, SETL) says where it went instead of "Unknown function". HELP lists the merged
// codes as aliases and does not list the removed ones. Panels are stubbed (TerminalShell.test.jsx).
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
import { defaultLayout } from './boardModel'
import HelpPanel from './panels/HelpPanel'

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

/** A board saved BEFORE the trim, raw (not normalised), as the preference holds it. */
function savedBoard(...codes) {
  const l = defaultLayout()
  return JSON.stringify({
    ...l, count: codes.length, focus: 0,
    panels: codes.map((code, i) => ({ id: `p${i + 1}`, code, channel: null, sym: 'NVDA', args: [] })),
  })
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

describe('a board saved before the trim still opens', () => {
  it('WIIM and BRKE panels render MOVE and EE; nothing reads "Unknown function"', async () => {
    store.prefs = { terminal_layout: savedBoard('WIIM', 'BRKE') }
    renderAt('/terminal')
    expect(await screen.findByTestId('stub-Move')).toHaveTextContent('Move:NVDA')
    expect(await screen.findByTestId('stub-Estimates')).toHaveTextContent('Estimates:NVDA')
    expect(screen.queryByText(/Unknown function/)).toBeNull()
  })

  it.each(['PMKT', 'SETL', 'EXP'])('a %s panel says it was removed and where to go, without crashing', async (code) => {
    store.prefs = { terminal_layout: savedBoard('GP', code) }
    renderAt('/terminal')
    expect(await screen.findByTestId('stub-Chart')).toBeTruthy()          // the rest of the board lives
    const note = await screen.findByTestId('terminal-panel-retired')
    expect(note).toHaveTextContent(`${code} (`)
    expect(note).toHaveTextContent('was removed from the terminal')
    expect(screen.queryByText(`Unknown function ${code}.`)).toBeNull()
  })

  it('typing a removed code says so out loud', async () => {
    renderAt('/terminal')
    await type('PMKT')
    expect(screen.getByTestId('terminal-notice')).toHaveTextContent('PMKT (post-market) was removed from the terminal')
  })
})

describe('HELP after the trim', () => {
  it('lists WIIM beside MOVE and BRKE beside EE, and no row for a removed code', () => {
    render(<HelpPanel auth={{}} />)
    expect(screen.getByTestId('terminal-help-alias-MOVE')).toHaveTextContent('also WIIM')
    expect(screen.getByTestId('terminal-help-alias-EE')).toHaveTextContent('also BRKE')
    const rowCodes = [...document.querySelectorAll('[data-panel-row] span:nth-child(2)')].map((n) => n.textContent)
    for (const gone of ['WIIM', 'BRKE', 'EXP', 'PMKT', 'SETL']) expect(rowCodes, gone).not.toContain(gone)
    expect(rowCodes).toContain('MOVE')
  })
})
