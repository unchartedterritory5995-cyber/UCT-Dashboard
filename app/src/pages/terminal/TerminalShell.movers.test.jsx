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
  const { default: PanelSymbol } = await import('../../components/terminal/PanelSymbol')
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
            useEffect(() => { onRows?.(['$XLK', '$XLU']) }, [onRows])
            return <div data-testid="stub-Rrg">Rrg</div>
          }
          : name === 'Alerts'
          ? function AlertsStub({ sym, onRun }) {
            return (
              <div data-testid="stub-Alerts" data-sym={sym || ''}>
                <button type="button" onClick={() => onRun?.('$AMD', { keepFunction: true })}>alert AMD</button>
              </div>
            )
          }
          : name === 'Peer'
          ? function PeerStub({ sym }) {
            // The REAL publisher component, as the embedded lists use it.
            return <div data-testid="stub-Peer" data-sym={sym || ''}><PanelSymbol sym={sym} /><PanelSymbol sym="AMD" /></div>
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

// ── Linked panels (2026-10-09): a ticker activated in ANY list row is published to that list's
// group by the one publisher (TerminalShell `publishSymbol`, boardModel.rowLinkPlan). ──
const layoutWrites = () => store.writes.filter(([k]) => k === 'terminal_layout').length
function seed(panels, groups = { A: 'NVDA' }, extra = {}) {
  store.prefs = {
    terminal_layout: JSON.stringify({ ...DEFAULT_LAYOUT, count: panels.length, focus: 0, panels, closed: [], ...extra }),
    charts_workspace_groups: JSON.stringify(groups),
  }
}

describe("linked panels: a list row loads its name into the list's group", () => {
  it('a list on group A beside DES and GP: a click re-points DES and GP, the list keeps its function, the board is written a bounded number of times', async () => {
    seed([
      { id: 'p1', code: 'MOST', channel: 'A', sym: null, args: [] },
      { id: 'p2', code: 'DES', channel: 'A', sym: null, args: [] },
      { id: 'p3', code: 'GP', channel: 'A', sym: null, args: [] },
    ], { A: 'NVDA' }, { focus: 2 })
    renderShell()
    expect(screen.getByTestId('stub-Chart')).toHaveTextContent('Chart:NVDA')
    const before = layoutWrites()
    // No mouseDown first: the publisher reads the panel the row is IN, not the focused one.
    await act(async () => { fireEvent.click(screen.getByText('row AMD')) })
    expect([code(0), code(1), code(2)]).toEqual(['MOST', 'DES', 'GP'])
    expect(screen.getByTestId('stub-Overview')).toHaveTextContent('Overview:AMD')
    expect(screen.getByTestId('stub-Chart')).toHaveTextContent('Chart:AMD')
    expect(notice()).toBe('Loaded AMD into Group A: panels 2, 3 kept their functions.')
    // the shell's live region says the same, so keyboard and screen-reader members hear it
    expect(screen.getByTestId('terminal-notice-announce').textContent).toContain('Loaded AMD into Group A')
    // no remount loop: one publish is at most a couple of layout writes, and it settles
    const after = layoutWrites()
    expect(after - before).toBeLessThanOrEqual(2)
    await act(async () => { await new Promise((r) => setTimeout(r, 30)) })
    expect(layoutWrites()).toBe(after)
  })

  it("an UNLINKED list loads into the board's active group (as MOST always did) and does NOT re-point itself", async () => {
    seed([
      { id: 'p1', code: 'ALRT', channel: null, sym: null, args: [] },
      { id: 'p2', code: 'GP', channel: 'A', sym: null, args: [] },
    ])
    renderShell()
    expect(screen.getByTestId('stub-Alerts').getAttribute('data-sym')).toBe('')
    await act(async () => { fireEvent.click(screen.getByText('alert AMD')) })
    expect([code(0), code(1)]).toEqual(['ALRT', 'GP'])
    expect(screen.getByTestId('stub-Chart')).toHaveTextContent('Chart:AMD')
    // the list still shows every alert (before this, it turned itself into AMD ALRT)
    expect(screen.getByTestId('stub-Alerts').getAttribute('data-sym')).toBe('')
    expect(JSON.parse(store.prefs.terminal_layout).panels[0]).toMatchObject({ code: 'ALRT', channel: null, sym: null })
  })

  it('FALLBACK: nothing on screen follows the group, so the name opens beside the list (a link never dead-ends)', async () => {
    seed([
      { id: 'p1', code: 'ALRT', channel: null, sym: null, args: [] },
      { id: 'p2', code: 'CN', channel: 'B', sym: null, args: [] },
    ])
    renderShell()
    await act(async () => { fireEvent.click(screen.getByText('alert AMD')) })
    expect([code(0), code(1), code(2)]).toEqual(['ALRT', 'DES', 'CN'])
    expect(screen.getByTestId('stub-Overview')).toHaveTextContent('Overview:AMD')
    expect(screen.getByTestId('stub-Alerts').getAttribute('data-sym')).toBe('')
    expect(notice()).toBe('Opened AMD DES in a new panel 2; ALRT stays in panel 1.')
  })

  it('a list showing every name only because its group is empty keeps that list: it is unlinked, the others follow', async () => {
    const channels = [...DEFAULT_LAYOUT.channels, { id: 'E', name: 'Group E', color: '#f472b6', sym: null, history: [] }]
    seed([
      { id: 'p1', code: 'ALRT', channel: 'E', sym: null, args: [] },
      { id: 'p2', code: 'DES', channel: 'E', sym: null, args: [] },
    ], { A: 'NVDA' }, { channels })
    renderShell()
    await act(async () => { fireEvent.click(screen.getByText('alert AMD')) })
    expect(screen.getByTestId('stub-Overview')).toHaveTextContent('Overview:AMD')
    expect(screen.getByTestId('stub-Alerts').getAttribute('data-sym')).toBe('')
    expect(JSON.parse(store.prefs.terminal_layout).panels[0]).toMatchObject({ code: 'ALRT', channel: null })
    expect(notice()).toBe('Loaded AMD into Group E: panel 2 kept its function. ALRT in panel 1 keeps its full list and is no longer linked.')
  })

  it('a single-ticker panel (PEER) follows its group: its peer row re-points it and the chart once, no loop; the current name is marked', async () => {
    seed([
      { id: 'p1', code: 'PEER', channel: 'A', sym: null, args: [] },
      { id: 'p2', code: 'GP', channel: 'A', sym: null, args: [] },
    ])
    renderShell()
    expect(screen.getByTestId('stub-Peer').getAttribute('data-sym')).toBe('NVDA')
    expect(screen.getByTestId('panel-symbol-NVDA').getAttribute('aria-current')).toBe('true')
    expect(screen.getByTestId('panel-symbol-AMD').getAttribute('aria-current')).toBeNull()
    const before = layoutWrites()
    const peerRow = screen.getByTestId('panel-symbol-AMD')
    peerRow.focus()
    // keyboard activation of a native button (Enter / Space) is its click event
    await act(async () => { fireEvent.click(peerRow) })
    expect(screen.getByTestId('stub-Chart')).toHaveTextContent('Chart:AMD')
    expect(screen.getByTestId('stub-Peer').getAttribute('data-sym')).toBe('AMD')
    expect(screen.getAllByTestId('panel-symbol-AMD').map((n) => n.getAttribute('aria-current'))).toEqual(['true', 'true'])
    expect([code(0), code(1)]).toEqual(['PEER', 'GP'])
    const after = layoutWrites()
    expect(after - before).toBeLessThanOrEqual(2)
    await act(async () => { await new Promise((r) => setTimeout(r, 30)) })
    expect(layoutWrites()).toBe(after)
  })

  it("CONTROL: Shift+Enter keeps its own rule (it loads the FOCUSED panel's group, an unlinked one included)", async () => {
    seed([
      { id: 'p1', code: 'DES', channel: null, sym: 'NVDA', args: [] },
      { id: 'p2', code: 'GP', channel: 'A', sym: null, args: [] },
    ])
    renderShell()
    const input = screen.getByTestId('terminal-command')
    fireEvent.change(input, { target: { value: 'TSLA' } })
    await act(async () => { fireEvent.keyDown(input, { key: 'Enter', shiftKey: true }) })
    expect(screen.getByTestId('stub-Overview')).toHaveTextContent('Overview:TSLA')
    expect(screen.getByTestId('stub-Chart')).toHaveTextContent('Chart:NVDA')
  })
})
