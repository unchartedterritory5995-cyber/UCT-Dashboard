// MOST through the REAL grammar, registry and shell: what a member types reaches the movers panel,
// and a movers row — clicked or addressed by number — LOADS that name into the linked group while
// every panel keeps its function. The panel itself is a stub that does what the real one does
// (publishes `$SYM` rows, clicks call onRun('$SYM', { keepFunction: true })), so this file proves
// the shell half; panels/MoversPanel.test.jsx proves the panel half.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useEffect, useReducer } from 'react'
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { AuthContext } from '../../context/AuthContext'
import parseCommand from './parseCommand'
import { applyArgs, argsEcho } from './args'
import { BY_CODE } from './functions'

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
        stubs.set(name, name === 'Movers'
          ? function MoversStub({ lens, onRun, onRows }) {
            useEffect(() => { onRows?.(['$AMD', '$TSLA']) }, [onRows])
            return (
              <div data-testid="stub-Movers" data-lens={lens || ''}>
                <button type="button" onClick={() => onRun?.('$AMD', { keepFunction: true })}>row AMD</button>
                <button type="button" onClick={() => onRun?.('AMD MOVE', { next: true })}>story AMD</button>
              </div>
            )
          }
          : name === 'Imov'
          ? function ImovStub({ theme, onRun }) {
            return (
              <div data-testid="stub-Imov" data-theme={theme || ''}>
                <button type="button" onClick={() => onRun?.('IMOV THEME SEMICONDUCTORS', { here: true })}>pick semis</button>
              </div>
            )
          }
          : name === 'Rrg'
          ? function RrgStub({ onRows }) {
            useEffect(() => { onRows?.(['XLK GP', 'XLU GP']) }, [onRows])
            return <div data-testid="stub-Rrg">Rrg</div>
          }
          : function Stub({ sym }) { return <div data-testid={`stub-${name}`}>{name}:{sym || '-'}</div> })
      }
      return stubs.get(name)
    },
  }
})

import TerminalShell, { isLoadRow } from './TerminalShell'
import { saveTiming } from './useTerminalLayout'
import { TerminalRoute } from './TerminalRoutes'
import { DEFAULT_LAYOUT } from './boardModel'
import { COMMAND_PANELS } from './panels'

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

/** MOST in panel 1; GP and FA follow group A (NVDA). */
function seedBoard() {
  const panels = [
    { id: 'p1', code: 'MOST', channel: null, sym: null, args: [] },
    { id: 'p2', code: 'GP', channel: 'A', sym: null, args: [] },
    { id: 'p3', code: 'FA', channel: 'A', sym: null, args: [] },
  ]
  store.prefs = {
    terminal_layout: JSON.stringify({ ...DEFAULT_LAYOUT, count: 3, focus: 0, panels, closed: [] }),
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

beforeEach(() => {
  saveTiming.debounceMs = 0
  try { window.sessionStorage.clear() } catch { /* */ }
  try { window.localStorage.clear() } catch { /* */ }
  store.prefs = {}
  store.writes = []
  setViewport(1400)
})
afterEach(() => cleanup())

describe('the grammar and registry reach MOST', () => {
  it('MOST is a market-only code whose lens arguments are applied, and VOL stays a code', () => {
    const fn = BY_CODE.MOST
    expect(fn.ticker).toBeUndefined()
    expect(fn.market.panel).toBe('Movers')
    expect(COMMAND_PANELS.has('Movers')).toBe(true)
    for (const [line, lens] of [['MOST UP', 'up'], ['most losers', 'down'], ['MOST RVOL', 'volume']]) {
      const cmd = parseCommand(line)
      expect(cmd).toMatchObject({ ok: true, code: 'MOST', sym: null })
      expect(applyArgs(fn.market, cmd.args).props).toEqual({ lens })
    }
    const vol = applyArgs(fn.market, ['XYZ'])
    expect(vol.ignored).toEqual(['XYZ'])
    expect(argsEcho('MOST', vol)).toBe('Not applied: "XYZ" — MOST takes UP, DOWN or RVOL or MINE (only your names).')
  })

  it('a `$SYM` row is a load row; a command row and a bare word are not', () => {
    expect(isLoadRow('$NVDA')).toBe(true)
    expect(isLoadRow('$BRK.B')).toBe(true)
    expect(isLoadRow('NVDA GP')).toBe(false)
    expect(isLoadRow('NVDA')).toBe(false)
    expect(isLoadRow('$NVDA GP')).toBe(false)
    expect(isLoadRow('HELP')).toBe(false)
  })
})

describe('a movers row loads the name into the linked panels', () => {
  it('clicking a row re-points group A; MOST, GP and FA all keep their functions', async () => {
    seedBoard()
    renderShell()
    expect(screen.getByTestId('stub-Chart')).toHaveTextContent('Chart:NVDA')
    await act(async () => { fireEvent.mouseDown(screen.getByTestId('terminal-panel-0')) })
    await act(async () => { fireEvent.click(screen.getByText('row AMD')) })
    expect([code(0), code(1), code(2)]).toEqual(['MOST', 'GP', 'FA'])
    expect(screen.getByTestId('stub-Chart')).toHaveTextContent('Chart:AMD')
    expect(screen.getByTestId('stub-Financials')).toHaveTextContent('Financials:AMD')
    expect(notice()).toBe('Loaded AMD into Group A: panels 2, 3 kept their functions.')
  })

  it('typing a row number does the same as clicking it — the list never turns into DES', async () => {
    seedBoard()
    renderShell()
    await screen.findByTestId('stub-Movers')
    const input = screen.getByTestId('terminal-command')
    fireEvent.change(input, { target: { value: '2' } })
    await act(async () => { fireEvent.keyDown(input, { key: 'Enter' }) })
    expect(code(0)).toBe('MOST')
    expect(screen.getByTestId('stub-Chart')).toHaveTextContent('Chart:TSLA')
  })

  it('CONTROL: typing the same name as a command (plain Enter) still turns the focused panel into DES', async () => {
    seedBoard()
    renderShell()
    await screen.findByTestId('stub-Movers')
    const input = screen.getByTestId('terminal-command')
    fireEvent.change(input, { target: { value: 'TSLA' } })
    await act(async () => { fireEvent.keyDown(input, { key: 'Enter' }) })
    expect(code(0)).toBe('DES')
  })

  it('MOST DOWN typed in the shell opens the movers panel on the losers lens', async () => {
    seedBoard()
    store.prefs.terminal_layout = JSON.stringify({ ...JSON.parse(store.prefs.terminal_layout), focus: 1 })
    renderShell()
    const input = screen.getByTestId('terminal-command')
    fireEvent.change(input, { target: { value: 'MOST DOWN' } })
    await act(async () => { fireEvent.keyDown(input, { key: 'Enter' }) })
    expect(code(1)).toBe('MOST')
    const lensed = screen.getAllByTestId('stub-Movers').map((n) => n.getAttribute('data-lens'))
    expect(lensed).toContain('down')
  })
})

describe('an "open X" link inside a list opens BESIDE the list, never over it', () => {
  it('the MOST story link "Open AMD MOVE" adds a panel after MOST when the board has room; MOST, GP and FA stay', async () => {
    seedBoard()
    renderShell()
    await act(async () => { fireEvent.mouseDown(screen.getByTestId('terminal-panel-0')) })
    await act(async () => { fireEvent.click(screen.getByText('story AMD')) })
    expect([code(0), code(1), code(2), code(3)]).toEqual(['MOST', 'MOVE', 'GP', 'FA'])
    expect(screen.getByTestId('stub-Move')).toHaveTextContent('Move:AMD')
    // MOST is unlinked, so the new panel is too: group A (GP, FA) still shows NVDA.
    expect(screen.getByTestId('stub-Chart')).toHaveTextContent('Chart:NVDA')
    expect(notice()).toBe('Opened AMD MOVE in a new panel 2; MOST stays in panel 1.')
  })

  it('a second story replaces the first MOVE beside the list instead of stacking another panel', async () => {
    seedBoard()
    renderShell()
    await act(async () => { fireEvent.mouseDown(screen.getByTestId('terminal-panel-0')) })
    await act(async () => { fireEvent.click(screen.getByText('story AMD')) })
    await act(async () => { fireEvent.mouseDown(screen.getByTestId('terminal-panel-0')) })
    await act(async () => { fireEvent.click(screen.getByText('story AMD')) })
    expect([code(0), code(1), code(2), code(3)]).toEqual(['MOST', 'MOVE', 'GP', 'FA'])
    expect(screen.getAllByTestId('stub-Move')).toHaveLength(1)
  })

  it('on a full board it reuses the next visible panel, and MOST is still kept', async () => {
    seedBoard()
    const lay = JSON.parse(store.prefs.terminal_layout)
    lay.count = 4
    lay.panels = [...lay.panels, { id: 'p4', code: 'DES', channel: 'A', sym: null, args: [] }]
    store.prefs.terminal_layout = JSON.stringify(lay)
    renderShell()
    await act(async () => { fireEvent.mouseDown(screen.getByTestId('terminal-panel-0')) })
    await act(async () => { fireEvent.click(screen.getByText('story AMD')) })
    expect([code(0), code(1), code(2), code(3)]).toEqual(['MOST', 'MOVE', 'FA', 'DES'])
    expect(notice()).toBe('Opened AMD MOVE in panel 2; MOST stays in panel 1.')
  })

  it('an RRG row typed by number opens its chart beside the graph, exactly as clicking it does', async () => {
    store.prefs = {
      terminal_layout: JSON.stringify({ ...DEFAULT_LAYOUT, count: 1, focus: 0,
        panels: [{ id: 'p1', code: 'RRG', channel: null, sym: null, args: [] }, ...DEFAULT_LAYOUT.panels.slice(1)], closed: [] }),
      charts_workspace_groups: JSON.stringify({ A: 'NVDA' }),
    }
    renderShell()
    await screen.findByTestId('stub-Rrg')
    const input = screen.getByTestId('terminal-command')
    fireEvent.change(input, { target: { value: '2' } })
    await act(async () => { fireEvent.keyDown(input, { key: 'Enter' }) })
    expect([code(0), code(1)]).toEqual(['RRG', 'GP'])
    expect(screen.getByTestId('stub-Chart')).toHaveTextContent('Chart:XLU')
  })
})

describe('IMOV writes a hand-picked theme into its OWN panel command', () => {
  it('the pick lands in that panel (not the focused one), as args the panel reads back', async () => {
    seedBoard()
    const lay = JSON.parse(store.prefs.terminal_layout)
    lay.panels[1] = { id: 'p2', code: 'IMOV', channel: null, sym: null, args: [] }
    store.prefs.terminal_layout = JSON.stringify(lay)
    renderShell()
    await act(async () => { fireEvent.click(screen.getByText('pick semis')) })
    expect([code(0), code(1), code(2)]).toEqual(['MOST', 'IMOV', 'FA'])
    expect(screen.getByTestId('stub-Imov').getAttribute('data-theme')).toBe('SEMICONDUCTORS')
    const saved = JSON.parse(store.prefs.terminal_layout)
    expect(saved.panels[1]).toMatchObject({ code: 'IMOV', args: ['THEME', 'SEMICONDUCTORS'] })
    expect(saved.panels[0]).toMatchObject({ code: 'MOST' })
  })
})
