// Stock boards at the SHELL: one click in the Boards menu, or `NVDA STOCK` typed, puts a stock's
// panels on screen through the SAME path a saved, shared, scan or market board opens, all in ONE
// group of the board's own, set to that ticker. stockBoards.test.js proves the pure half and
// BoardsMenu.stock.test.jsx the menu. Same harness as TerminalShell.starterBoards.test.jsx (a
// preferences store that records every write, stubbed components over the REAL panels module).
//
//     cd app && npx vitest run src/pages/terminal/TerminalShell.stockBoards.test.jsx --maxWorkers=2
//
// What is written, and when (each asserted below against the recorded writes):
//   * opening the menu          nothing
//   * opening a stock board     `terminal_layout` only: the board on screen, its own group and that
//                               group's ticker. NOT `terminal_boards`, NOT `charts_workspace_groups`
//   * a new ticker on the board `terminal_layout` only (the group's ticker lives in the board)
//   * "Back to my layout"       `terminal_layout` again, back to exactly what it held
//   * "Save to my boards"       `terminal_boards`, one board ADDED, under a free name
//   * a TYPED command            also `terminal_command_history`, as every typed line does
//   * a brand-new member's very first board change of ANY kind also stores group A = SPY (the
//     first-visit rule in useTerminalLayout, unchanged; a market board does the same)
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

// The REAL panels module (names, URL ownership); only the components are stubbed, so a stock
// board's codes resolve through the real registry here. A stub prints the string props it got,
// which is how these tests read the ticker each panel was handed.
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
import {
  COMPAT_CHANNELS, DEFAULT_LAYOUT, addChannel, applyChannelSym, emptyLibrary, isCompatChannel, normalizeLayout, readLibrary,
  saveBoard, setCount as countOf,
} from './boardModel'
import { BY_CODE } from './functions'
import { panelNameFor } from './panels'
import { STARTER_BOARDS } from './starterBoards'
import { STOCK_BOARDS, defaultStockBoard } from './stockBoards'
import { STOCK_GROUP_NAME } from './stockBoardModel'

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

// A member with NO flags at all: a stock board must open whole for everyone.
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
const openStock = async (b) => { await openMenu(); await click(`terminal-stock-open-${b.id}`) }
async function type(text) {
  const input = screen.getByTestId('terminal-command')
  fireEvent.change(input, { target: { value: text } })
  await act(async () => { fireEvent.keyDown(input, { key: 'Enter' }) })
}
const writesTo = (key) => store.writes.filter(([k]) => k === key)
/** Every write but the member's own command history, which EVERY typed line appends to. */
const HISTORY_PREF = 'terminal_command_history'
const writesButHistory = () => store.writes.filter(([k]) => k !== HISTORY_PREF)
const panelCount = () => screen.getByTestId('terminal-shell').querySelectorAll('[data-testid^="terminal-panel-"][data-code]').length
const codesOnScreen = () => Array.from({ length: panelCount() }, (_, i) => screen.getByTestId(`terminal-panel-${i}`).getAttribute('data-code'))
/** What every visible panel was handed: `Name[sym=TICKER]` from its stub. */
const stubsOnScreen = () => Array.from({ length: panelCount() }, (_, i) => within(screen.getByTestId(`terminal-panel-${i}`)).getByTestId(/^stub-/).textContent)
const stubOf = (code, sym) => `${panelNameFor(BY_CODE[code].ticker)}[sym=${sym}]`
const storedLayout = () => JSON.parse(store.prefs.terminal_layout)
/** The groups the stored board's visible panels sit in (one id when they share a group). */
const storedGroups = () => { const l = storedLayout(); return [...new Set(l.panels.slice(0, l.count).map((p) => p.channel))] }
const noticeText = () => screen.getByTestId('terminal-notice').textContent

/** The member's own state before anything is opened: a two-panel board (the calendar focused, on
 *  group A), two saved boards, and /charts groups A = AAPL, B = MSFT. */
function seed({ boards = ['Swing Board', 'Leaders'], layout = countOf(DEFAULT_LAYOUT, 2), groups = { A: 'AAPL', B: 'MSFT' } } = {}) {
  let lib = emptyLibrary()
  boards.forEach((n, i) => { lib = saveBoard(lib, n, countOf(DEFAULT_LAYOUT, 3), { A: 'NVDA' }, 1000 + i).library })
  store.prefs = {
    terminal_layout: JSON.stringify(layout),
    terminal_boards: JSON.stringify(lib),
    charts_workspace_groups: JSON.stringify(groups),
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

describe('opening a stock board from the Boards menu', () => {
  it('CONTROL: the menu lists every stock board under the market ones, named with the ticker the board is on, and opening the menu writes nothing', async () => {
    seed()
    renderAt()
    await openMenu()
    const list = screen.getByTestId('terminal-stock-boards')
    expect(within(list).getAllByRole('listitem')).toHaveLength(STOCK_BOARDS.length)
    for (const b of STOCK_BOARDS) {
      const btn = screen.getByTestId(`terminal-stock-open-${b.id}`)
      expect(btn.textContent.startsWith(`${b.name} · AAPL`)).toBe(true)
      expect(btn.disabled).toBe(false)
    }
    expect(within(screen.getByTestId('terminal-starter-boards')).getAllByRole('listitem')).toHaveLength(STARTER_BOARDS.length)
    expect(store.writes).toEqual([])
  })

  it.each(STOCK_BOARDS.map((b) => [b.name, b]))('%s: one click shows its panels, in order, EVERY one a live panel on that ticker', async (_n, b) => {
    seed()
    renderAt()
    await openStock(b)
    expect(screen.queryByTestId('terminal-boards-menu')).toBeNull()                 // the menu closed
    expect(screen.getByTestId('terminal-grid').getAttribute('data-count')).toBe(String(b.codes.length))
    expect(codesOnScreen()).toEqual(b.codes)
    // The panel's own component mounted with the ticker: never "needs a ticker", "not enabled" or "unknown".
    expect(stubsOnScreen()).toEqual(b.codes.map((c) => stubOf(c, 'AAPL')))
    expect(screen.getByTestId('terminal-panel-0').getAttribute('data-focused')).toBe('true')
    expect(screen.getByTestId('terminal-boards-button').textContent).toBe(`Board: ${b.name}`)
    const notice = screen.getByTestId('terminal-notice')
    expect(notice.textContent).toContain(`Opened the stock board ${b.name} for AAPL (${b.codes.join(', ')}).`)
    expect(notice.textContent).toContain('Your saved boards were not changed')
    expect(within(notice).getByRole('button', { name: 'Save to my boards' })).toBeTruthy()
    expect(within(notice).getByRole('button', { name: 'Back to my layout' })).toBeTruthy()
  })

  it('the panels are in ONE group of the board\'s own, which holds the ticker; groups A to D carry none', async () => {
    seed()
    renderAt()
    await openStock(defaultStockBoard())
    const l = storedLayout()
    const groups = storedGroups()
    expect(groups).toHaveLength(1)
    const [g] = groups
    expect(isCompatChannel(g)).toBe(false)
    expect(l.activeChannel).toBe(g)
    expect(l.channels.find((c) => c.id === g)).toMatchObject({ name: STOCK_GROUP_NAME, sym: 'AAPL', history: ['AAPL'] })
    for (const p of l.panels.slice(0, l.count)) expect(p.sym, p.code).toBe(null)   // the ticker is the group's
    for (const id of COMPAT_CHANNELS) expect(l.channels.find((c) => c.id === id).sym, id).toBe(null)
  })

  it('NEVER changes the saved boards or the /charts groups: only the board on screen is written', async () => {
    const before = seed()
    renderAt()
    for (const b of STOCK_BOARDS) {
      await openStock(b)                                  // one after another, all of them
      expect(store.prefs.terminal_boards, b.name).toBe(before.terminal_boards)                    // byte for byte
      expect(store.prefs.charts_workspace_groups, b.name).toBe(before.charts_workspace_groups)    // byte for byte
    }
    expect(writesTo('terminal_boards')).toEqual([])
    expect(writesTo('charts_workspace_groups')).toEqual([])
    // CONTROL: the open did write the one thing an opened board writes.
    expect(writesTo('terminal_layout').length).toBeGreaterThanOrEqual(STOCK_BOARDS.length)
    expect(new Set(store.writes.map(([k]) => k))).toEqual(new Set(['terminal_layout']))
    // Opening several reused ONE group: the board holds the four /charts groups and one more.
    expect(storedLayout().channels).toHaveLength(COMPAT_CHANNELS.length + 1)
  })

  it('opened for a ticker NO group holds (an unlinked chart\'s own): the /charts groups are still byte for byte', async () => {
    // The rows above open for AAPL, which group A already holds, so a write of the same ticker to
    // group A would change nothing there. Here the ticker is TSLA: any write to A to D would show.
    const base = normalizeLayout(countOf(DEFAULT_LAYOUT, 3))
    const layout = normalizeLayout({ ...base, focus: 2, panels: base.panels.map((p, i) => (i === 2 ? { ...p, channel: null, sym: 'TSLA' } : p)) })
    const before = seed({ layout })
    renderAt()
    const b = defaultStockBoard()
    await openMenu()
    expect(screen.getByTestId(`terminal-stock-open-${b.id}`).textContent.startsWith(`${b.name} · TSLA`)).toBe(true)
    await click(`terminal-stock-open-${b.id}`)
    expect(stubsOnScreen()).toEqual(b.codes.map((c) => stubOf(c, 'TSLA')))
    expect(store.prefs.charts_workspace_groups).toBe(before.charts_workspace_groups)
    expect(store.prefs.terminal_boards).toBe(before.terminal_boards)
    expect(new Set(store.writes.map(([k]) => k))).toEqual(new Set(['terminal_layout']))
    await click('terminal-revert-layout')
    expect(JSON.parse(store.prefs.terminal_layout)).toEqual(JSON.parse(before.terminal_layout))
    expect(writesTo('charts_workspace_groups')).toEqual([])
  })

  it('a new ticker typed in one panel moves the WHOLE board, and still writes nothing to the /charts groups', async () => {
    const before = seed()
    renderAt()
    const b = defaultStockBoard()
    await openStock(b)
    const [g] = storedGroups()
    await type(`AMD ${b.codes[0]}`)
    expect(codesOnScreen()).toEqual(b.codes)
    expect(stubsOnScreen()).toEqual(b.codes.map((c) => stubOf(c, 'AMD')))
    expect(storedGroups()).toEqual([g])
    expect(storedLayout().channels.find((c) => c.id === g)).toMatchObject({ sym: 'AMD', history: ['AMD', 'AAPL'] })
    expect(store.prefs.charts_workspace_groups).toBe(before.charts_workspace_groups)
    expect(writesTo('charts_workspace_groups')).toEqual([])
    // …and the menu now offers the boards for the ticker the board is on.
    await openMenu()
    expect(screen.getByTestId(`terminal-stock-open-${STOCK_BOARDS[1].id}`).textContent.startsWith(`${STOCK_BOARDS[1].name} · AMD`)).toBe(true)
    // CONTROL: on the member's OWN board the same command DOES move group A, as it always has.
    await click('terminal-revert-layout')
    await type('TSLA DES')
    expect(JSON.parse(store.prefs.charts_workspace_groups)).toEqual({ A: 'TSLA', B: 'MSFT' })
  })

  it('a group the member added keeps its ticker and its history; the stock board takes another', async () => {
    const added = addChannel(countOf(DEFAULT_LAYOUT, 2))
    const mine = normalizeLayout(applyChannelSym(added.layout, added.id, 'TSLA'))
    const own = mine.channels.find((c) => c.id === added.id)
    seed({ layout: { ...mine, activeChannel: 'A' } })
    renderAt()
    await openStock(defaultStockBoard())
    const l = storedLayout()
    const [g] = storedGroups()
    expect(g).not.toBe(added.id)
    expect(l.channels.find((c) => c.id === added.id)).toEqual(own)
    expect(l.channels.find((c) => c.id === g)).toMatchObject({ name: STOCK_GROUP_NAME, sym: 'AAPL' })
  })

  it('"Back to my layout" returns exactly the board the member had, even after opening several and changing the ticker', async () => {
    const before = seed()
    renderAt()
    const mine = codesOnScreen()
    expect(mine).toHaveLength(2)
    await openStock(STOCK_BOARDS[0])
    await type(`AMD ${STOCK_BOARDS[0].codes[0]}`)
    await openStock(STOCK_BOARDS[STOCK_BOARDS.length - 1])
    expect(codesOnScreen()).not.toEqual(mine)
    await click('terminal-revert-layout')
    expect(codesOnScreen()).toEqual(mine)
    expect(screen.getByTestId('terminal-boards-button').textContent).toBe('Boards')
    expect(JSON.parse(store.prefs.terminal_layout)).toEqual(JSON.parse(before.terminal_layout))
    expect(store.prefs.terminal_boards).toBe(before.terminal_boards)
    expect(store.prefs.charts_workspace_groups).toBe(before.charts_workspace_groups)
    expect(writesTo('charts_workspace_groups')).toEqual([])
  })

  it('the board that is open is marked in the menu, and the mark goes when the member goes back', async () => {
    seed()
    renderAt()
    const b = STOCK_BOARDS[1]
    await openStock(b)
    await openMenu()
    expect(screen.getByTestId(`terminal-stock-open-${b.id}`).getAttribute('aria-current')).toBe('true')
    expect(screen.getAllByText('Open now')).toHaveLength(1)
    await click('terminal-revert-layout')
    await openMenu()
    expect(screen.queryByText('Open now')).toBeNull()
  })

  it('NO ticker on the board: the rows are disabled and say why, and nothing opens or is written', async () => {
    seed({ groups: {} })
    renderAt()
    const mine = codesOnScreen()
    await openMenu()
    for (const b of STOCK_BOARDS) {
      const btn = screen.getByTestId(`terminal-stock-open-${b.id}`)
      expect(btn.disabled).toBe(true)
      expect(screen.getByTestId(`terminal-stock-why-${b.id}`).textContent.trim()).toBe('Pick a ticker first.')
      await act(async () => { fireEvent.click(btn) })
    }
    expect(screen.getByTestId('terminal-boards-menu')).toBeTruthy()                 // still open: nothing happened
    expect(codesOnScreen()).toEqual(mine)
    expect(store.writes).toEqual([])
    // The market boards beside them still open.
    expect(screen.getByTestId(`terminal-starter-open-${STARTER_BOARDS[0].id}`).disabled).toBe(false)
  })

  it('a brand-new member (nothing saved at all): it opens for the SPY their first board shows, and nothing is saved to their boards', async () => {
    renderAt()                                               // store.prefs = {}
    await openMenu()
    const b = defaultStockBoard()
    expect(screen.getByTestId(`terminal-stock-open-${b.id}`).textContent.startsWith(`${b.name} · SPY`)).toBe(true)
    await click(`terminal-stock-open-${b.id}`)
    expect(stubsOnScreen()).toEqual(b.codes.map((c) => stubOf(c, 'SPY')))
    expect(writesTo('terminal_boards')).toEqual([])
    expect(store.prefs.terminal_boards).toBeUndefined()
    // The first-visit rule (useTerminalLayout, unchanged): the first board change of ANY kind keeps
    // the SPY the first board was showing. That is the ONLY thing in the /charts groups.
    expect(writesTo('charts_workspace_groups').map(([, v]) => JSON.parse(v))).toEqual([{ A: 'SPY' }])
  })
})

describe('the typed command: NVDA STOCK', () => {
  it('opens the default board for THAT ticker, in one group, and writes only the board on screen', async () => {
    const before = seed()
    renderAt()
    const b = defaultStockBoard()
    await type('NVDA STOCK')
    expect(codesOnScreen()).toEqual(b.codes)
    expect(stubsOnScreen()).toEqual(b.codes.map((c) => stubOf(c, 'NVDA')))
    expect(storedGroups()).toHaveLength(1)
    expect(isCompatChannel(storedGroups()[0])).toBe(false)
    expect(noticeText()).toContain(`Opened the stock board ${b.name} for NVDA`)
    expect(screen.getByTestId('terminal-boards-button').textContent).toBe(`Board: ${b.name}`)
    expect(store.prefs.terminal_boards).toBe(before.terminal_boards)
    expect(store.prefs.charts_workspace_groups).toBe(before.charts_workspace_groups)
    // CONTROL: the typed line went into the member's command history, as every typed line does.
    expect(writesTo(HISTORY_PREF).map(([, v]) => JSON.parse(v))).toEqual([['NVDA STOCK']])
    expect(new Set(writesButHistory().map(([k]) => k))).toEqual(new Set(['terminal_layout']))
    await click('terminal-revert-layout')
    expect(JSON.parse(store.prefs.terminal_layout)).toEqual(JSON.parse(before.terminal_layout))
  })

  it('a word picks the board, in either order, and lower case is the same command', async () => {
    seed()
    renderAt()
    const b = STOCK_BOARDS[1]
    await type(`nvda stock ${b.word.toLowerCase()}`)
    expect(codesOnScreen()).toEqual(b.codes)
    expect(stubsOnScreen()).toEqual(b.codes.map((c) => stubOf(c, 'NVDA')))
    const last = STOCK_BOARDS[STOCK_BOARDS.length - 1]
    await type(`STOCK AMD ${last.word}`)
    expect(stubsOnScreen()).toEqual(last.codes.map((c) => stubOf(c, 'AMD')))
    expect(screen.getByTestId('terminal-boards-button').textContent).toBe(`Board: ${last.name}`)
  })

  it('STOCK alone opens for the ticker the board is on; with none it says to type one and changes nothing', async () => {
    seed()
    renderAt()
    await type('STOCK')
    expect(stubsOnScreen()).toEqual(defaultStockBoard().codes.map((c) => stubOf(c, 'AAPL')))
    cleanup()
    store.writes = []
    try { window.sessionStorage.clear() } catch { /* */ }
    seed({ groups: {} })
    renderAt()
    const mine = codesOnScreen()
    await type('STOCK')
    expect(codesOnScreen()).toEqual(mine)
    expect(noticeText()).toContain('STOCK needs a ticker. Type it first, like NVDA STOCK.')
    expect(writesButHistory()).toEqual([])
  })

  it('a word that is not a board is refused with the boards that exist, and nothing changes', async () => {
    seed()
    renderAt()
    const mine = codesOnScreen()
    await type('NVDA STOCK SIDEWAYS')
    expect(codesOnScreen()).toEqual(mine)
    expect(noticeText()).toContain('"SIDEWAYS" is not a stock board.')
    for (const b of STOCK_BOARDS) expect(noticeText()).toContain(b.name)
    expect(writesButHistory()).toEqual([])
    expect(screen.queryByTestId('terminal-revert-layout')).toBeNull()
  })

  it('never from a link: `?cmd=NVDA STOCK` in the address bar is refused and the member\'s board stays', async () => {
    const before = seed()
    renderAt('/terminal?cmd=NVDA%20STOCK')
    await act(async () => {})
    expect(codesOnScreen()).toEqual(['CAL', 'DES'])
    expect(noticeText()).toContain('STOCK runs from the command line or the Boards button, not from a link.')
    expect(store.prefs.terminal_layout).toBe(before.terminal_layout)
    expect(screen.queryByTestId('terminal-revert-layout')).toBeNull()
  })
})

describe('keeping one: "Save to my boards" adds a board, and never replaces one of the member\'s', () => {
  it('a free name: saved under the board\'s own name, with its group and ticker, beside the boards already there', async () => {
    const before = seed()
    renderAt()
    const b = defaultStockBoard()
    await openStock(b)
    const [g] = storedGroups()
    await click('terminal-notice-save-starter')
    const lib = readLibrary(store.prefs.terminal_boards).library
    const was = readLibrary(before.terminal_boards).library
    expect(lib.boards.map((x) => x.name)).toEqual([...was.boards.map((x) => x.name), b.name])
    expect(lib.boards.slice(0, was.boards.length)).toEqual(was.boards)
    const saved = lib.boards[lib.boards.length - 1]
    expect(saved.layout.panels.slice(0, saved.layout.count).map((p) => [p.code, p.channel])).toEqual(b.codes.map((c) => [c, g]))
    expect(saved.layout.channels.find((c) => c.id === g)).toMatchObject({ sym: 'AAPL' })
    expect(writesTo('terminal_boards')).toHaveLength(1)
    expect(writesTo('charts_workspace_groups')).toEqual([])
    const notice = screen.getByTestId('terminal-notice')
    expect(notice.textContent).toContain(`Saved as ${b.name}`)
    expect(within(notice).getByRole('button', { name: 'Back to my layout' })).toBeTruthy()
    expect(within(notice).queryByRole('button', { name: 'Save to my boards' })).toBeNull()
  })

  it('a name the member already uses: their board is kept byte for byte, the copy takes the next free name', async () => {
    const b = defaultStockBoard()
    const before = seed({ boards: ['Swing Board', b.name] })    // the member has their OWN board of that name
    renderAt()
    await openStock(b)
    await click('terminal-notice-save-starter')
    const lib = readLibrary(store.prefs.terminal_boards).library
    const was = readLibrary(before.terminal_boards).library
    const own = was.boards.find((x) => x.name === b.name)
    expect(lib.boards).toHaveLength(was.boards.length + 1)
    expect(lib.boards.find((x) => x.id === own.id)).toEqual(own)
    const copy = lib.boards[lib.boards.length - 1]
    expect(copy.name).toBe(`${b.name} 2`)
    expect(copy.layout.panels.slice(0, copy.layout.count).map((p) => p.code)).toEqual(b.codes)
    expect(noticeText()).toContain(`Saved as ${b.name} 2`)
    expect(noticeText()).not.toContain('Replaced')
  })
})

describe('on a phone (390px): a stock board shows as tabs, one panel at a time', () => {
  it('opens from the same menu; every panel is a tab named with the ticker, the first is showing, the rest stay mounted and hidden', async () => {
    setViewport(390)
    const before = seed()
    renderAt()
    expect(screen.getByTestId('terminal-shell').getAttribute('data-phone')).toBe('true')
    const b = STOCK_BOARDS.find((x) => x.codes.length === 4)
    expect(b, 'the fixture this test reads: a four-panel stock board').toBeTruthy()
    await openStock(b)
    expect(screen.getByTestId('terminal-grid').getAttribute('data-count')).toBe('1')   // one panel on a phone
    const tabs = within(screen.getByTestId('terminal-phone-switcher')).getAllByRole('tab')
    expect(tabs.map((t) => t.textContent)).toEqual(b.codes.map((c) => `AAPL ${c}`))
    expect(tabs.map((t) => t.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false', 'false'])
    expect(b.codes.map((_, i) => screen.getByTestId(`terminal-panel-${i}`).hidden)).toEqual([false, true, true, true])
    await click('terminal-phone-switch-2')
    expect(b.codes.map((_, i) => screen.getByTestId(`terminal-panel-${i}`).hidden)).toEqual([true, true, false, true])
    expect(store.prefs.terminal_boards).toBe(before.terminal_boards)
    expect(store.prefs.charts_workspace_groups).toBe(before.charts_workspace_groups)
    // The way back is on the bar as well as on the notice.
    await click('terminal-revert-layout')
    expect(within(screen.getByTestId('terminal-phone-switcher')).getAllByRole('tab')).toHaveLength(2)
  })
})
