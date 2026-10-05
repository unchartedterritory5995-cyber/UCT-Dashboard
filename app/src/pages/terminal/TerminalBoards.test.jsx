// UCT Terminal — lane T2 at the SHELL: what a member sees when the board model acts.
// boardModel.test.js proves the pure model; these prove the shell WIRES it: an unreadable
// layout is never written over, close is undoable, a `B:` address opens a saved board and
// "Back to my layout" returns, a bare ticker opens its preset, density persists, and the
// keep-the-classic-calendar choice narrows the cohort redirect. Same harness as
// TerminalShell.test.jsx (kept separate so lane T3's edits there never collide with these).
//
// The last block proves lane T3's grammar speaks T2's CHANNEL model at the shell: `@B` and
// `@2` resolve through `layout.channels`/`panelChannel`, `?cmd=` reads the panel's security
// from its channel, a `B:` address still opens a board on the one run path, and row <GO>.
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
        stubs.set(name, function Stub({ sym, volSurface, tf, focusCode, onRows }) {
          // The Help stub publishes a numbered list, as the real HelpPanel does (row <GO>).
          useEffect(() => { if (name === 'Help') onRows?.(['AMD FA', 'TSLA GP']) }, [onRows])
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
import { saveTiming } from './useTerminalLayout'
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
  saveTiming.debounceMs = 0   // layout writes land at once here; the debounce has its own rail
  try { window.sessionStorage.clear() } catch { /* */ }   // the per-tab "Back to my layout" memory
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

  it('FIX 4: "Back to my layout" clears a board-injected ticker on a previously-unlinked channel back to empty', async () => {
    // Channel A starts UNLINKED (no charts_workspace_groups at all). The saved board carries a
    // ticker on channel A, so opening it injects NVDA into A. `setGroupSym` used to silently
    // drop an empty/falsy sym, and `revertLayout` only called it when `prev.syms[ch]` was
    // truthy — so reverting could never write A back to empty, leaving the board's ticker
    // stuck on a channel the member had never linked.
    const saved = saveBoard(emptyLibrary(), 'Earnings morning',
      { ...countOf(DEFAULT_LAYOUT, 3) }, { A: 'NVDA' })
    store.prefs = {
      terminal_layout: JSON.stringify(countOf(DEFAULT_LAYOUT, 1)),
      terminal_boards: JSON.stringify(saved.library),
    }
    renderAt('/terminal')
    expect(store.prefs.charts_workspace_groups).toBeUndefined()
    await type('B:earnings-morning')
    expect(JSON.parse(store.prefs.charts_workspace_groups)).toEqual({ A: 'NVDA' })
    await act(async () => { fireEvent.click(screen.getByTestId('terminal-notice-revert')) })
    const groupsAfter = store.prefs.charts_workspace_groups ? JSON.parse(store.prefs.charts_workspace_groups) : {}
    expect(groupsAfter.A).toBeFalsy()
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

import { channelTarget, panelCommandText } from './TerminalShell'
import { addChannel, setPanelChannel } from './boardModel'

const cmdOf = () => new URLSearchParams(screen.getByTestId('where').textContent.split('?')[1] || '').get('cmd')

describe('T3 on T2 — the grammar addresses CHANNELS', () => {
  it('channelTarget: a letter resolves through layout.channels + panelChannel; a number is a slot', () => {
    let board = countOf(DEFAULT_LAYOUT, 4)                            // CAL·A, DES·A, GP·A, CN·B
    const { layout: withE, id } = addChannel(board)
    board = setPanelChannel(withE, 2, id, {})                          // panel 3 joins channel E
    expect(id).toBe('E')
    expect(channelTarget('B', board)).toEqual({ index: 3 })
    expect(channelTarget('E', board)).toEqual({ index: 2 })            // a terminal-own channel
    // A's first panel is CAL, which follows no security: @A goes to the first LINKABLE A panel
    // (audit #5 — @A NVDA GP used to overwrite the calendar).
    expect(channelTarget('A', board)).toEqual({ index: 1 })
    expect(channelTarget('2', board)).toEqual({ index: 1 })
    expect(channelTarget('Q', board).error).toContain('no group Q')
    expect(channelTarget('C', board).error).toContain('No panel on screen is linked to Group C')
    expect(channelTarget('4', countOf(board, 2)).error).toContain('not on screen')
    expect(channelTarget('B', countOf(board, 3)).error).toContain('Group B')  // B's panel is off screen
  })

  it("panelCommandText reads the security from the panel's channel (syms), or its own when unlinked", () => {
    const p = { id: 'p1', code: 'GP', channel: 'E', sym: 'IGNORED', args: ['W'] }
    expect(panelCommandText(p, { E: 'nvda' })).toBe('NVDA GP W')
    expect(panelCommandText({ ...p, channel: null }, {})).toBe('IGNORED GP W')
    expect(panelCommandText({ id: 'p2', code: 'BRD', channel: 'A' }, { A: 'NVDA' })).toBe('BRD')
  })

  it('@B TICKER FUNC lands on the panel joined to channel B, sets B, and leaves A alone', async () => {
    store.prefs = { terminal_layout: JSON.stringify(countOf(DEFAULT_LAYOUT, 4)), charts_workspace_groups: JSON.stringify({ A: 'AAPL' }) }
    renderAt('/terminal')
    await type('@B NVDA FA')
    const target = screen.getByTestId('terminal-panel-3')
    expect(target.getAttribute('data-channel')).toBe('B')
    expect(target.getAttribute('data-code')).toBe('FA')
    expect(target.getAttribute('data-focused')).toBe('true')
    expect(await within(target).findByTestId('stub-Financials')).toHaveTextContent('Financials:NVDA')
    expect(screen.getByTestId('terminal-panel-0').getAttribute('data-code')).toBe('CAL')
    expect(JSON.parse(store.prefs.charts_workspace_groups)).toEqual({ A: 'AAPL', B: 'NVDA' })
    expect(cmdOf()).toBe('NVDA FA')                                   // ?cmd= from the CHANNEL's security
  })

  it('@2 reaches a panel on a terminal-own channel (E): its security lives in the board record', async () => {
    const { layout: withE } = addChannel(countOf(DEFAULT_LAYOUT, 4))
    store.prefs = { terminal_layout: JSON.stringify(setPanelChannel(withE, 1, 'E', {})) }
    renderAt('/terminal')
    await type('@2 MSFT FA')
    const target = screen.getByTestId('terminal-panel-1')
    expect(target.getAttribute('data-channel')).toBe('E')
    expect(await within(target).findByTestId('stub-Financials')).toHaveTextContent('Financials:MSFT')
    const saved = JSON.parse(store.prefs.terminal_layout)
    expect(saved.channels.find((c) => c.id === 'E').sym).toBe('MSFT')
    expect(cmdOf()).toBe('MSFT FA')
  })

  it('FIX 3: @B CAL is redirected to the existing calendar panel elsewhere on the board, WITH a notice', async () => {
    // DEFAULT_LAYOUT at count 4: panel 0 is CAL on channel A. Explicitly targeting @B with CAL
    // hits the URL-owning re-use rule (a Calendar panel appears at most once) and gets silently
    // redirected to panel 0 — with no word said that the explicit @B target was overridden.
    store.prefs = { terminal_layout: JSON.stringify(countOf(DEFAULT_LAYOUT, 4)) }
    renderAt('/terminal')
    await type('@B CAL')
    expect(screen.getByTestId('terminal-panel-0').getAttribute('data-focused')).toBe('true')
    expect(screen.getByTestId('terminal-notice').textContent).toContain('@B was redirected')
  })

  it('@C with no panel on C is said, and nothing moves', async () => {
    store.prefs = { terminal_layout: JSON.stringify(countOf(DEFAULT_LAYOUT, 4)) }
    renderAt('/terminal')
    const before = store.prefs.terminal_layout
    await type('@C NVDA FA')
    expect(screen.getByTestId('terminal-notice').textContent).toContain('No panel on screen is linked to Group C')
    expect(store.prefs.terminal_layout).toBe(before)
  })

  it('a B: address arriving as ?cmd= goes down the one run path and opens the board', async () => {
    const saved = saveBoard(emptyLibrary(), 'Earnings morning', countOf(DEFAULT_LAYOUT, 3), {}, 1)
    store.prefs = { terminal_boards: JSON.stringify(saved.library) }
    renderAt('/terminal?cmd=B%3Aearnings-morning')
    expect(screen.getByTestId('terminal-grid').getAttribute('data-count')).toBe('3')
    expect(screen.getByTestId('terminal-boards-button').textContent).toContain('Earnings morning')
  })

  it("row <GO>: a number runs that row of the FOCUSED panel's numbered list", async () => {
    renderAt('/terminal')
    await type('HELP')
    expect(await screen.findByTestId('stub-Help')).toBeTruthy()
    await type('2')
    const panel = screen.getByTestId('terminal-panel-0')
    expect(panel.getAttribute('data-code')).toBe('GP')
    expect(await within(panel).findByTestId('stub-Chart')).toHaveTextContent('Chart:TSLA')
    await type('9')
    expect(screen.getByTestId('terminal-notice').textContent).toContain('no numbered list')
  })
})
