// Ready-made boards at the SHELL: one click in the Boards menu puts the board on screen through
// the SAME path a saved, shared or scan board opens, and it NEVER touches the member's saved
// boards. starterBoards.test.js proves the pure half and BoardsMenu.starter.test.jsx the menu.
// Same harness as TerminalBoards.test.jsx (a preferences store that records every write, stubbed
// components over the REAL panels module).
//
//     cd app && npx vitest run src/pages/terminal/TerminalShell.starterBoards.test.jsx --maxWorkers=2
//
// What is written, and when (each asserted below against the recorded writes):
//   * opening the menu            nothing
//   * opening a ready-made board  `terminal_layout` only (the board on screen, as any opened
//                                 board writes it). NOT `terminal_boards`, NOT the /charts groups
//   * "Back to my layout"         `terminal_layout` again, back to exactly what it held
//   * "Save to my boards"         `terminal_boards`, one board ADDED, under a free name
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useEffect, useReducer } from 'react'
import { render, screen, fireEvent, act, cleanup, within } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'
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

// Every read the shell makes on its own (aliases, command counts) answers empty.
vi.mock('../../utils/jsonFetcher', () => ({ default: () => Promise.resolve({}) }))

// The REAL panels module (names, the panel-set surface ids, URL ownership); only the components
// are stubbed, so a ready-made board's codes resolve through the real registry here.
vi.mock('./panels', async (importOriginal) => {
  const real = await importOriginal()
  const stubs = new Map()
  return {
    ...real,
    PANEL_IMPORTERS: {},
    panelComponent: (name) => {
      if (!stubs.has(name)) {
        stubs.set(name, function Stub(props) {
          const shown = Object.entries(props).filter(([, v]) => typeof v === 'string').map(([k, v]) => `${k}=${v}`).join(',')
          return <div data-testid={`stub-${name}`}>{name}[{shown}]</div>
        })
      }
      return stubs.get(name)
    },
  }
})

import TerminalShell from './TerminalShell'
import { saveTiming } from './useTerminalLayout'
import { TerminalRoute } from './TerminalRoutes'
import { DEFAULT_LAYOUT, emptyLibrary, readLibrary, saveBoard, setCount as countOf } from './boardModel'
import { BY_CODE } from './functions'
import { panelNameFor } from './panels'
import parseCommand from './parseCommand'
import { STARTER_BOARDS } from './starterBoards'

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

// A member with NO flags at all: a ready-made board must open whole for everyone.
const MEMBER = { cohorts: ['terminal-next'], isPaid: true }

function renderAt(url = '/terminal') {
  return render(
    <AuthContext.Provider value={MEMBER}>
      <MemoryRouter initialEntries={[url]}>
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

const click = async (id) => { await act(async () => { fireEvent.click(screen.getByTestId(id)) }) }
const openMenu = () => click('terminal-boards-button')
const openStarter = async (s) => { await openMenu(); await click(`terminal-starter-open-${s.id}`) }
const writesTo = (key) => store.writes.filter(([k]) => k === key)
const codesOnScreen = () => {
  const n = Number(screen.getByTestId('terminal-shell').querySelectorAll('[data-testid^="terminal-panel-"][data-code]').length)
  return Array.from({ length: n }, (_, i) => screen.getByTestId(`terminal-panel-${i}`).getAttribute('data-code'))
}
const codesOf = (s) => s.commands.map((c) => parseCommand(c).code)
const byName = (name) => {
  const s = STARTER_BOARDS.find((b) => b.name === name)
  if (!s) throw new Error(`these tests read the ready-made board "${name}"; it is no longer in the list`)
  return s
}

/** The member's own state before anything is opened: a two-panel board and two saved boards. */
function seed({ boards = ['Swing Board', 'Leaders'] } = {}) {
  let lib = emptyLibrary()
  boards.forEach((n, i) => { lib = saveBoard(lib, n, countOf(DEFAULT_LAYOUT, 3), { A: 'NVDA' }, 1000 + i).library })
  store.prefs = {
    terminal_layout: JSON.stringify(countOf(DEFAULT_LAYOUT, 2)),
    terminal_boards: JSON.stringify(lib),
    charts_workspace_groups: JSON.stringify({ A: 'AAPL', B: 'MSFT' }),
  }
  return { ...store.prefs }
}

beforeEach(() => {
  saveTiming.debounceMs = 0   // layout writes land at once here; the debounce has its own rail
  try { window.sessionStorage.clear() } catch { /* */ }   // the per-tab "Back to my layout" memory
  try { window.localStorage.clear() } catch { /* */ }
  store.prefs = {}
  store.writes = []
  setViewport(1400)
})
afterEach(() => cleanup())

describe('opening a ready-made board from the Boards menu', () => {
  it('CONTROL: the menu lists every ready-made board, and merely opening the menu writes nothing', async () => {
    seed()
    renderAt()
    await openMenu()
    const list = screen.getByTestId('terminal-starter-boards')
    expect(within(list).getAllByRole('listitem')).toHaveLength(STARTER_BOARDS.length)
    for (const s of STARTER_BOARDS) expect(within(list).getByText(s.about)).toBeTruthy()
    expect(store.writes).toEqual([])
  })

  it.each(STARTER_BOARDS.map((s) => [s.name, s]))('%s: one click shows its panels, in order, each a live panel', async (_n, s) => {
    seed()
    renderAt()
    await openStarter(s)
    expect(screen.queryByTestId('terminal-boards-menu')).toBeNull()                 // the menu closed
    expect(screen.getByTestId('terminal-grid').getAttribute('data-count')).toBe(String(s.commands.length))
    expect(codesOnScreen()).toEqual(codesOf(s))
    s.commands.forEach((text, i) => {
      const cmd = parseCommand(text)
      const name = panelNameFor(BY_CODE[cmd.code].market)
      const panel = screen.getByTestId(`terminal-panel-${i}`)
      // The panel's own component mounted: never "needs a ticker", "not enabled" or "unknown".
      expect(within(panel).getByTestId(`stub-${name}`), `${s.name}: ${text}`).toBeTruthy()
    })
    expect(screen.getByTestId('terminal-panel-0').getAttribute('data-focused')).toBe('true')
    expect(screen.getByTestId('terminal-boards-button').textContent).toBe(`Board: ${s.name}`)
    const notice = screen.getByTestId('terminal-notice')
    expect(notice.textContent).toContain(`Opened the ready-made board ${s.name}`)
    expect(notice.textContent).toContain('Your saved boards were not changed')
    expect(within(notice).getByRole('button', { name: 'Save to my boards' })).toBeTruthy()
    expect(within(notice).getByRole('button', { name: 'Back to my layout' })).toBeTruthy()
  })

  it('an argument in the list reaches the panel (PCHG QTD opens on the quarter)', async () => {
    seed()
    renderAt()
    const s = byName('Leaders')
    await openStarter(s)
    const at = s.commands.indexOf('PCHG QTD')
    expect(at).toBeGreaterThanOrEqual(0)
    expect(within(screen.getByTestId(`terminal-panel-${at}`)).getByTestId('stub-PeriodChange').textContent).toBe('PeriodChange[range=qtd]')
  })

  it('NEVER changes the saved boards or the /charts groups: only the board on screen is written', async () => {
    const before = seed()
    renderAt()
    for (const s of STARTER_BOARDS) {
      await openStarter(s)                                  // one after another, all of them
      expect(store.prefs.terminal_boards, s.name).toBe(before.terminal_boards)           // byte for byte
      expect(store.prefs.charts_workspace_groups, s.name).toBe(before.charts_workspace_groups)
    }
    expect(writesTo('terminal_boards')).toEqual([])
    expect(writesTo('charts_workspace_groups')).toEqual([])
    // CONTROL: the open did write the one thing an opened board writes today.
    expect(writesTo('terminal_layout').length).toBeGreaterThanOrEqual(STARTER_BOARDS.length)
    expect(new Set(store.writes.map(([k]) => k))).toEqual(new Set(['terminal_layout']))
  })

  it('"Back to my layout" returns exactly the board the member had, even after opening several', async () => {
    const before = seed()
    renderAt()
    const mine = codesOnScreen()
    expect(mine).toHaveLength(2)
    await openStarter(STARTER_BOARDS[0])
    await openStarter(STARTER_BOARDS[STARTER_BOARDS.length - 1])
    expect(codesOnScreen()).not.toEqual(mine)
    await click('terminal-revert-layout')
    expect(codesOnScreen()).toEqual(mine)
    expect(screen.getByTestId('terminal-boards-button').textContent).toBe('Boards')
    expect(JSON.parse(store.prefs.terminal_layout)).toEqual(JSON.parse(before.terminal_layout))
    expect(store.prefs.terminal_boards).toBe(before.terminal_boards)
    expect(JSON.parse(store.prefs.charts_workspace_groups)).toEqual(JSON.parse(before.charts_workspace_groups))
  })

  it('a brand-new member (nothing saved at all) can open one, and still nothing is saved to their boards', async () => {
    renderAt()                                               // store.prefs = {}
    await openStarter(STARTER_BOARDS[0])
    expect(codesOnScreen()).toEqual(codesOf(STARTER_BOARDS[0]))
    expect(writesTo('terminal_boards')).toEqual([])
    expect(store.prefs.terminal_boards).toBeUndefined()
  })

  it('the board that is open is marked in the menu, and the mark goes when the member goes back', async () => {
    seed()
    renderAt()
    const s = STARTER_BOARDS[1]
    await openStarter(s)
    await openMenu()
    expect(screen.getByTestId(`terminal-starter-open-${s.id}`).getAttribute('aria-current')).toBe('true')
    expect(screen.getAllByText('Open now')).toHaveLength(1)
    await click('terminal-revert-layout')
    await openMenu()
    expect(screen.queryByText('Open now')).toBeNull()
  })

  it('the calendar inside a ready-made board opens in its panel without leaving the terminal', async () => {
    seed()
    renderAt()
    const s = STARTER_BOARDS.find((b) => b.commands.includes('CAL'))
    expect(s, 'the fixture this test reads: a ready-made board with CAL').toBeTruthy()
    await openStarter(s)
    expect(screen.getAllByTestId('stub-Calendar')).toHaveLength(1)
    expect(screen.queryByTestId('elsewhere')).toBeNull()
    expect(screen.getByTestId('where').textContent.startsWith('/terminal')).toBe(true)
  })
})

describe('keeping one: "Save to my boards" adds a board, and never replaces one of the member\'s', () => {
  it('a free name: saved under the board\'s own name, beside the boards already there', async () => {
    const before = seed()
    renderAt()
    const s = byName('Market open')
    await openStarter(s)
    await click('terminal-notice-save-starter')
    const lib = readLibrary(store.prefs.terminal_boards).library
    const was = readLibrary(before.terminal_boards).library
    expect(lib.boards.map((b) => b.name)).toEqual([...was.boards.map((b) => b.name), 'Market open'])
    expect(lib.boards.slice(0, was.boards.length)).toEqual(was.boards)
    const saved = lib.boards[lib.boards.length - 1]
    expect(saved.layout.panels.slice(0, saved.layout.count).map((p) => p.code)).toEqual(codesOf(s))
    expect(writesTo('terminal_boards')).toHaveLength(1)
    const notice = screen.getByTestId('terminal-notice')
    expect(notice.textContent).toContain('Saved as Market open')
    // The way back stays on the notice that says it was saved; the save button does not.
    expect(within(notice).getByRole('button', { name: 'Back to my layout' })).toBeTruthy()
    expect(within(notice).queryByRole('button', { name: 'Save to my boards' })).toBeNull()
  })

  it('a name the member already uses: their board is kept byte for byte, the copy is "Leaders 2"', async () => {
    const before = seed()                                     // the member has their OWN "Leaders"
    renderAt()
    const s = byName('Leaders')
    await openStarter(s)
    await click('terminal-notice-save-starter')
    const lib = readLibrary(store.prefs.terminal_boards).library
    const was = readLibrary(before.terminal_boards).library
    const own = was.boards.find((b) => b.name === 'Leaders')
    expect(lib.boards).toHaveLength(was.boards.length + 1)
    expect(lib.boards.find((b) => b.id === own.id)).toEqual(own)
    expect(lib.boards.find((b) => b.id === own.id).layout.panels.map((p) => p.code)).not.toEqual(expect.arrayContaining(['LEAD']))
    const copy = lib.boards[lib.boards.length - 1]
    expect(copy.name).toBe('Leaders 2')
    expect(copy.layout.panels.slice(0, copy.layout.count).map((p) => p.code)).toEqual(codesOf(s))
    expect(screen.getByTestId('terminal-notice').textContent).toContain('Saved as Leaders 2')
    expect(screen.getByTestId('terminal-notice').textContent).not.toContain('Replaced')
  })

  it('saved boards that cannot be read: the board still opens, nothing is written over them, and the save says why', async () => {
    store.prefs = { terminal_layout: JSON.stringify(countOf(DEFAULT_LAYOUT, 1)), terminal_boards: '{not json' }
    renderAt()
    const s = STARTER_BOARDS[0]
    await openStarter(s)
    expect(codesOnScreen()).toEqual(codesOf(s))
    await click('terminal-notice-save-starter')
    expect(store.prefs.terminal_boards).toBe('{not json')
    expect(writesTo('terminal_boards')).toEqual([])
    expect(screen.getByTestId('terminal-notice').textContent).toContain('could not be read')
  })
})

describe('on a phone (390px): the menu works, and a four-panel board shows one panel at a time', () => {
  it('opens from the same menu; every panel is a tab, the first is showing, the rest stay mounted and hidden', async () => {
    setViewport(390)
    const before = seed()
    renderAt()
    expect(screen.getByTestId('terminal-shell').getAttribute('data-phone')).toBe('true')
    const s = STARTER_BOARDS.find((b) => b.commands.length === 4)
    expect(s, 'the fixture this test reads: a four-panel ready-made board').toBeTruthy()
    await openStarter(s)
    expect(screen.getByTestId('terminal-grid').getAttribute('data-count')).toBe('1')   // one panel on a phone
    const tabs = within(screen.getByTestId('terminal-phone-switcher')).getAllByRole('tab')
    expect(tabs.map((t) => t.textContent)).toEqual(s.commands.map((c) => c.toUpperCase()))
    expect(tabs.map((t) => t.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false', 'false'])
    expect(s.commands.map((_, i) => screen.getByTestId(`terminal-panel-${i}`).hidden)).toEqual([false, true, true, true])
    await click('terminal-phone-switch-2')
    expect(s.commands.map((_, i) => screen.getByTestId(`terminal-panel-${i}`).hidden)).toEqual([true, true, false, true])
    expect(store.prefs.terminal_boards).toBe(before.terminal_boards)
    // The way back is on the bar as well as on the notice.
    await click('terminal-revert-layout')
    expect(within(screen.getByTestId('terminal-phone-switcher')).getAllByRole('tab')).toHaveLength(2)
  })
})
