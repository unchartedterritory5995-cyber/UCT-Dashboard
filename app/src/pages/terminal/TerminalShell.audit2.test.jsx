// The shell, 2026-10-05 audit round 2. Every `it` here began as a reproduction probe that
// rendered the REAL TerminalShell under MemoryRouter and watched it do the wrong thing; each
// now pins the fixed behaviour. Same mocks as TerminalShell.test.jsx (preferences store +
// stubbed panel components), plus a router handle so Back/Forward can be driven.
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
        stubs.set(name, function Stub({ sym, tf }) {
          return <div data-testid={`stub-${name}`}>{name}:{sym || '-'}{tf ? `:tf=${tf}` : ''}</div>
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
const layout = () => JSON.parse(store.prefs.terminal_layout)
const groups = () => JSON.parse(store.prefs.charts_workspace_groups || '{}')
const settle = () => act(async () => { for (let i = 0; i < 6; i += 1) await Promise.resolve() })
const wait = (ms) => act(() => new Promise((r) => setTimeout(r, ms)))

/** A fetch that answers by path; anything unrouted is a 404 (a dark route). */
function routeFetch(routes) {
  global.fetch = vi.fn(async (url) => {
    const u = String(url)
    for (const [prefix, answer] of Object.entries(routes)) {
      if (u.startsWith(prefix)) return typeof answer === 'function' ? answer(u) : answer
    }
    return { ok: false, status: 404, json: async () => ({}) }
  })
}
const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body })

const TWO = (a, b, focus = 0, extra = {}) => JSON.stringify({ v: 2, count: 2, focus, panels: [
  { id: 'p1', ...a }, { id: 'p2', ...b },
], ...extra })

beforeEach(() => {
  store.prefs = {}
  store.writes = []
  saveTiming.debounceMs = 0
  try { window.localStorage.clear(); window.sessionStorage.clear() } catch { /* */ }
  routeFetch({})
  window.matchMedia = (q) => ({ matches: false, media: q, addListener() {}, removeListener() {},
    addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false } })
})
afterEach(() => cleanup())

describe('🔴 the URL never replays a command into the wrong panel', () => {
  it('#1: focusing the calendar drops the other panel\'s ?cmd=, so a reload cannot replay it into CAL', async () => {
    store.prefs = { charts_workspace_groups: JSON.stringify({ A: 'AMD' }),
      terminal_layout: TWO({ code: 'CAL', channel: 'A' }, { code: 'DES', channel: 'A' }, 1) }
    renderAt(['/terminal'])
    await type('NVDA GP')
    expect(params().get('cmd')).toBe('NVDA GP')
    await act(async () => { fireEvent.mouseDown(screen.getByTestId('terminal-panel-0')) })
    expect(params().get('cmd')).toBeNull()             // the calendar owns this URL now
    const url = where()
    cleanup()
    renderAt([url])                                    // "reload"
    await settle()
    expect(code(0)).toBe('CAL')
    expect(code(1)).toBe('GP')
  })

  it('#3: the URL names the panel slot, and a reload with focus elsewhere puts it back in THAT slot', async () => {
    store.prefs = { charts_workspace_groups: JSON.stringify({ A: 'AMD' }),
      terminal_layout: TWO({ code: 'CAL', channel: 'A' }, { code: 'DES', channel: 'A' }, 0) }
    renderAt(['/terminal?cmd=NVDA%20GP&p=2'])
    await settle()
    expect(code(0)).toBe('CAL')                         // the focused calendar is untouched
    expect(code(1)).toBe('GP')
    expect(params().get('p')).toBe('2')
  })

  it('#3: Back replays the old command into ITS panel, not the one focused now', async () => {
    store.prefs = { charts_workspace_groups: JSON.stringify({ A: 'NVDA', B: 'AMD' }),
      terminal_layout: TWO({ code: 'DES', channel: 'A' }, { code: 'CN', channel: 'B' }, 0) }
    renderAt(['/terminal'])
    await settle()
    expect(params().get('cmd')).toBe('NVDA DES')
    expect(params().get('p')).toBe('1')
    await type('TSLA GP')                               // a history entry
    await act(async () => { fireEvent.mouseDown(screen.getByTestId('terminal-panel-1')) })
    expect(params().get('cmd')).toBe('AMD CN')
    await act(async () => { nav(-1) })
    await settle()
    expect(code(1)).toBe('CN')                          // panel 2 kept its own command…
    expect(groups().B).toBe('AMD')                      // …and group B kept its security
    expect(code(0)).toBe('DES')                         // the old command went back to panel 1
  })

  it('#3: a slot the board no longer shows falls back to the focused panel', async () => {
    store.prefs = { charts_workspace_groups: JSON.stringify({ A: 'AMD' }),
      terminal_layout: JSON.stringify({ v: 2, count: 1, focus: 0, panels: [{ id: 'p1', code: 'DES', channel: 'A' }] }) }
    renderAt(['/terminal?cmd=NVDA%20FA&p=4'])
    await settle()
    expect(code(0)).toBe('FA')
  })
})

describe('🔴 a door opened from the URL does not trap the Back button', () => {
  it('#2: Back from a ?cmd= door returns to the page before it, not into the door again', async () => {
    renderAt(['/home', '/terminal?cmd=NVDA%20RES'], 1)
    await settle()
    expect(where()).toBe('/research/NVDA')
    await act(async () => { nav(-1) })
    await settle()
    expect(where()).toBe('/home')
  })

  it('#2: the palette\'s handoff (/terminal?cmd=…) to an AI question is replaced the same way', async () => {
    renderAt(['/home', '/terminal?cmd=ASK%20why%20is%20SMH%20down'], 1)
    await settle()
    expect(where()).toMatch(/^\/ai-search\?q=/)
    await act(async () => { nav(-1) })
    await settle()
    expect(where()).toBe('/home')
  })

  it('a TYPED door still pushes (Back returns to the terminal)', async () => {
    renderAt(['/terminal'])
    await type('NVDA RES')
    expect(where()).toBe('/research/NVDA')
    await act(async () => { nav(-1) })
    await settle()
    expect(where()).toMatch(/^\/terminal/)
  })
})

describe('🟠 targeting and entry', () => {
  it('#4: the sidebar\'s /terminal/calendar puts CAL over the focused panel only with an Undo', async () => {
    store.prefs = { charts_workspace_groups: JSON.stringify({ A: 'NVDA' }),
      terminal_layout: JSON.stringify({ v: 2, count: 1, focus: 0, panels: [{ id: 'p1', code: 'GP', channel: 'A', args: ['W'] }] }) }
    renderAt(['/terminal/calendar'])
    await settle()
    expect(code(0)).toBe('CAL')
    expect(layout().closed[0].panel).toMatchObject({ code: 'GP', args: ['W'] })
    expect(screen.getByTestId('terminal-notice')).toHaveTextContent('in place of NVDA GP W')
    await act(async () => { fireEvent.click(screen.getByTestId('terminal-notice-undo-calendar')) })
    await settle()
    expect(layout().panels[0]).toMatchObject({ id: 'p1', code: 'GP', args: ['W'] })
    expect(layout().closed).toHaveLength(0)
    expect(where()).toMatch(/^\/terminal(\?|$)/)
    expect(code(0)).toBe('GP')
  })

  it('#5: @A skips a calendar in group A and lands on the first panel that follows a security', async () => {
    store.prefs = { charts_workspace_groups: JSON.stringify({ A: 'AMD' }),
      terminal_layout: TWO({ code: 'CAL', channel: 'A' }, { code: 'DES', channel: 'A' }, 0) }
    renderAt(['/terminal'])
    await type('@A NVDA GP')
    expect(code(0)).toBe('CAL')
    expect(code(1)).toBe('GP')
  })

  it('#20: @E reaches a group the board added', async () => {
    store.prefs = { terminal_layout: TWO({ code: 'DES', channel: 'A' }, { code: 'CN', channel: 'E' }, 0,
      { channels: [{ id: 'E', name: 'Group E', color: '#f472b6', sym: 'MSFT', history: [] }] }) }
    renderAt(['/terminal'])
    await type('@E NVDA FA')
    expect(code(1)).toBe('FA')
    expect(screen.getByTestId('terminal-panel-1')).toHaveTextContent('Financials:NVDA')
  })

  it('#6: `GP $NVDA` charts NVDA (the `$` is not part of the ticker)', async () => {
    store.prefs = { charts_workspace_groups: JSON.stringify({ A: 'AMD' }),
      terminal_layout: JSON.stringify({ v: 2, count: 1, focus: 0, panels: [{ id: 'p1', code: 'DES', channel: 'A' }] }) }
    renderAt(['/terminal'])
    await type('GP $NVDA')
    expect(screen.getByTestId('terminal-panel-0')).toHaveTextContent('Chart:NVDA')
    await type('NVDA CMP $AMD')
    expect(where()).toBe('/research/NVDA/compare/AMD')
  })

  it('#21: `GP W` draws the linked security weekly — it does not chart the ticker W', async () => {
    store.prefs = { charts_workspace_groups: JSON.stringify({ A: 'NVDA' }),
      terminal_layout: JSON.stringify({ v: 2, count: 1, focus: 0, panels: [{ id: 'p1', code: 'DES', channel: 'A' }] }) }
    renderAt(['/terminal'])
    await type('GP W')
    expect(screen.getByTestId('terminal-panel-0')).toHaveTextContent('Chart:NVDA:tf=W')
  })

  it('#9: a market-wide door given a ticker says so and waits, instead of dropping it silently', async () => {
    renderAt(['/terminal'])
    await type('NVDA DASH')
    expect(where()).toMatch(/^\/terminal/)
    expect(screen.getByTestId('terminal-notice')).toHaveTextContent('DASH is market-wide; NVDA is ignored.')
    expect(screen.getByTestId('terminal-notice').getAttribute('role')).toBe('alert')
    await act(async () => { fireEvent.click(screen.getByTestId('terminal-notice-go')) })
    expect(where()).toBe('/dashboard')
  })

  it('#15: a pasted ticker list is answered at the command line, never sent to AI Search', async () => {
    renderAt(['/terminal'])
    await type('NVDA AMD MSFT TSLA')
    expect(where()).toMatch(/^\/terminal/)
    expect(screen.getByTestId('terminal-notice')).toHaveTextContent(/list of tickers/)
  })

  it('#22: full-width input runs like ASCII', async () => {
    renderAt(['/terminal'])
    await type('ＮＶＤＡ ＦＡ')
    expect(screen.getByTestId('terminal-panel-0')).toHaveTextContent('Financials:NVDA')
  })
})

describe('🟠 boards: "Back to my layout" means the member\'s layout', () => {
  const board = { v: 2, count: 1, focus: 0, activeChannel: 'A', panels: [{ id: 'b1', code: 'GP', channel: 'A' }], channels: [] }
  const prefs = () => ({
    charts_workspace_groups: JSON.stringify({ A: 'AMD' }),
    terminal_layout: TWO({ code: 'FA', channel: 'A' }, { code: 'CN', channel: 'A' }, 0),
    terminal_boards: JSON.stringify({ v: 1, boards: [{ id: 'bx', name: 'Chart', slug: 'chart', layout: board }],
      presets: { '*': 'bx' }, favorites: [], keepCalendar: false }),
  })

  it('#10: two preset opens in a row still revert to the member\'s own board', async () => {
    store.prefs = prefs()
    renderAt(['/terminal'])
    await type('NVDA')
    await type('MSFT')
    await act(async () => { fireEvent.click(screen.getByTestId('terminal-notice-revert')) })
    expect(layout().count).toBe(2)
    expect(layout().panels.slice(0, 2).map((p) => p.code)).toEqual(['FA', 'CN'])
    expect(groups().A).toBe('AMD')
  })

  it('#10: the revert survives a reload (per-tab memory) and is offered on the bar', async () => {
    store.prefs = prefs()
    renderAt(['/terminal'])
    await type('NVDA')
    cleanup()
    renderAt(['/terminal'])
    await settle()
    await act(async () => { fireEvent.click(screen.getByTestId('terminal-revert-layout')) })
    expect(layout().panels.slice(0, 2).map((p) => p.code)).toEqual(['FA', 'CN'])
    expect(screen.queryByTestId('terminal-revert-layout')).toBeNull()
  })
})

describe('🟠 async answers', () => {
  it('#12: a sector lookup that answers after the member moved on does not navigate', async () => {
    let answer
    routeFetch({ '/api/terminal/compare-target': () => new Promise((r) => { answer = r }) })
    renderAt(['/terminal'])
    await type('NVDA CMP SECTOR')
    await type('AMD FA')                                // moved on
    await act(async () => { answer(json(200, { comparator: 'XLK' })) })
    await settle()
    expect(where()).toMatch(/^\/terminal/)
    expect(screen.getByTestId('terminal-panel-0')).toHaveTextContent('Financials:AMD')
  })

  it('#12: a late address resolve does not navigate either', async () => {
    let answer
    routeFetch({ '/api/address/resolve': () => new Promise((r) => { answer = r }) })
    renderAt(['/terminal'])
    await type('L:12')
    await type('AMD FA')
    await act(async () => { answer(json(200, { to: '/charts?layout=12' })) })
    await settle()
    expect(where()).toMatch(/^\/terminal/)
  })

  it('#13: CMP SECTOR tells "not enabled" (404) from "lookup failed" from "none known"', async () => {
    renderAt(['/terminal'])
    routeFetch({})
    await type('NVDA CMP SECTOR'); await settle()
    expect(screen.getByTestId('terminal-notice')).toHaveTextContent('not enabled on this server')
    routeFetch({ '/api/terminal/compare-target': json(500, {}) })
    await type('NVDA CMP SECTOR'); await settle()
    expect(screen.getByTestId('terminal-notice')).toHaveTextContent(/Could not look up NVDA's sector ETF just now/)
    routeFetch({ '/api/terminal/compare-target': json(200, { comparator: null }) })
    await type('NVDA CMP SECTOR'); await settle()
    expect(screen.getByTestId('terminal-notice')).toHaveTextContent('No sector ETF is known for NVDA')
  })

  it('#13: an ALIAS on a server where aliases are off says so (not "try again")', async () => {
    renderAt(['/terminal'])
    await type('ALIAS SEMIS = SMH GP'); await settle()
    expect(screen.getByTestId('terminal-notice')).toHaveTextContent('Aliases are not enabled on this server yet.')
    routeFetch({ '/api/terminal/aliases/SEMIS': json(500, {}) })
    await type('ALIAS SEMIS = SMH GP'); await settle()
    expect(screen.getByTestId('terminal-notice')).toHaveTextContent('SEMIS was not saved just now; try again.')
  })
})

describe('🟡 the URL-sync breaker and the write cost', () => {
  it('#16: once the 2s window passes, the URL catches up with the focused panel (trailing write)', async () => {
    const quiet = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      renderAt(['/terminal'])
      for (const c of ['NVDA DES', 'AMD DES', 'MSFT DES', 'TSLA DES', 'AAPL DES', 'META DES', 'GOOG DES']) await type(c)
      expect(screen.getByTestId('terminal-notice')).toHaveTextContent(/catches up/)
      expect(params().get('cmd')).not.toBe('GOOG DES')
      await wait(2300)
      expect(params().get('cmd')).toBe('GOOG DES')
      expect(screen.queryByTestId('terminal-notice')).toBeNull()   // the pause notice is no longer true
    } finally { quiet.mockRestore() }
  })

  it('#19: a focus-only click posts nothing; real changes coalesce into ONE debounced write', async () => {
    store.prefs = { charts_workspace_groups: JSON.stringify({ A: 'AMD', B: 'MSFT' }),
      terminal_layout: TWO({ code: 'DES', channel: 'A' }, { code: 'CN', channel: 'B' }, 0) }
    saveTiming.debounceMs = 250
    renderAt(['/terminal'])
    await settle()
    const writes = () => store.writes.filter(([k]) => k === 'terminal_layout')
    await act(async () => { fireEvent.mouseDown(screen.getByTestId('terminal-panel-1')) })
    await act(async () => { fireEvent.mouseDown(screen.getByTestId('terminal-panel-0')) })
    await wait(320)
    expect(writes()).toHaveLength(0)
    await type('NVDA FA')
    await type('NVDA OWN')
    expect(writes()).toHaveLength(0)                    // still inside the debounce
    expect(code(0)).toBe('OWN')                          // …but on screen at once
    await wait(320)
    expect(writes()).toHaveLength(1)
    expect(layout().panels[0].code).toBe('OWN')
  })

  it('#19: a write still inside its debounce is flushed when the shell unmounts', async () => {
    saveTiming.debounceMs = 60000
    renderAt(['/terminal'])
    await type('NVDA FA')
    expect(store.writes.filter(([k]) => k === 'terminal_layout')).toHaveLength(0)
    cleanup()
    expect(layout().panels[0].code).toBe('FA')
  })
})

describe('🟡 pop-outs, focus and shortcuts', () => {
  it('#23: closing a pop-out window yourself brings the panel back on the board', async () => {
    store.prefs = { charts_workspace_groups: JSON.stringify({ A: 'AMD' }),
      terminal_layout: TWO({ code: 'DES', channel: 'A' }, { code: 'GP', channel: 'A' }, 0) }
    const fakeWin = { closed: false, close() { this.closed = true } }
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(fakeWin)
    try {
      renderAt(['/terminal'])
      await act(async () => { fireEvent.click(screen.getByTestId('terminal-popout-1')) })
      expect(screen.getByTestId('terminal-popped-1')).toBeTruthy()
      fakeWin.closed = true                              // the member closed it
      await wait(1150)
      expect(screen.queryByTestId('terminal-popped-1')).toBeNull()
      expect(layout().panels[1].popout).toBeFalsy()
    } finally { openSpy.mockRestore() }
  })

  it('Alt+] / Alt+[ step to the next / previous panel, wrapping', async () => {
    store.prefs = { terminal_layout: TWO({ code: 'DES', channel: 'A' }, { code: 'CN', channel: 'B' }, 0) }
    renderAt(['/terminal'])
    const focused = () => screen.getAllByTestId(/^terminal-panel-\d$/).findIndex((el) => el.dataset.focused === 'true')
    await act(async () => { fireEvent.keyDown(window, { code: 'BracketRight', key: ']', altKey: true }) })
    expect(focused()).toBe(1)
    await act(async () => { fireEvent.keyDown(window, { code: 'BracketRight', key: ']', altKey: true }) })
    expect(focused()).toBe(0)
    await act(async () => { fireEvent.keyDown(window, { code: 'BracketLeft', key: '[', altKey: true }) })
    expect(focused()).toBe(1)
  })

  it('#24: a rail click hands focus back to the command line', async () => {
    renderAt(['/terminal'])
    await act(async () => { screen.getByTestId('terminal-rail-BRD').focus(); fireEvent.click(screen.getByTestId('terminal-rail-BRD')) })
    expect(document.activeElement).toBe(screen.getByTestId('terminal-command'))
  })
})
