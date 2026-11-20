// Boards in tabs at the SHELL (behind TERMINAL_BOARD_TABS_ENABLED, delivered as the sign-in
// payload's `terminalBoardTabsEnabled`). The pure model is boardTabs.test.js. Same harness as
// TerminalShell.starterBoards.test.jsx: a preferences store that records every write, stubbed
// components over the REAL panels module.
//
//     cd app && npx vitest run src/pages/terminal/TerminalShell.boardTabs.test.jsx --maxWorkers=2
//
// What these pin:
//   * switch OFF      today's shell, exactly: the rail, the old bar, and the new key never written
//   * switch ON       the tabs, the one box, "Add a block", "Edit board"; no rail
//   * the tab list    first-visit seeding (both cases), open from "+", a switch keeps each tab's
//                     own working copy, close, the one question on unsaved changes, eight at most
//   * Edit board      which controls each state shows; Alt+X still closes a panel with it off
//   * a panel header  the tool's plain name, then its command small and grey, then provenance
//   * the store       ONE new key written; no existing key renamed or reshaped
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { useEffect, useReducer } from 'react'
import { render, screen, fireEvent, act, cleanup, within } from '@testing-library/react'
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

vi.mock('../../utils/jsonFetcher', () => ({ default: () => Promise.resolve({}) }))

vi.mock('./panels', async (importOriginal) => {
  const real = await importOriginal()
  const stubs = new Map()
  return {
    ...real,
    PANEL_IMPORTERS: {},
    panelComponent: (name) => {
      if (!stubs.has(name)) {
        stubs.set(name, function Stub() { return <div data-testid={`stub-${name}`}>{name}</div> })
      }
      return stubs.get(name)
    },
  }
})

// The chrome's stylesheet as text (a CSS module import is a class-name map here).
const chromeCss = fs.readFileSync(path.join(process.cwd(), 'src', 'pages', 'terminal', 'BoardTabsChrome.module.css'), 'utf8')
  .replace(/\r\n/g, '\n')
import TerminalShell from './TerminalShell'
import { saveTiming } from './useTerminalLayout'
import { TerminalRoute } from './TerminalRoutes'
import {
  DEFAULT_LAYOUT, boardSnapshot, emptyLibrary, popoutHref, readLayout, readLibrary, saveBoard, setCount as countOf,
} from './boardModel'
import { BY_CODE } from './functions'
import parseCommand from './parseCommand'
import { STARTER_BOARDS, buildStarterBoard } from './starterBoards'
import { defaultStockBoard } from './stockBoards'
import { BOARD_TABS_KEY, MAX_TABS, TABS_FULL_TEXT, boardSignature, readTabs } from './boardTabs'
import { BOTTOM_BOX_ATTR, BOX_PLACEHOLDER, UCT_BOARD_LINE } from './BoardTabsChrome'
import { expectNoAxeViolations } from '../journal-2-0/a11y/axeHarness'

function setViewport(width) {
  window.matchMedia = (query) => {
    const max = /max-width:\s*(\d+)px/.exec(query)
    const min = /min-width:\s*(\d+)px/.exec(query)
    const matches = (!max || width <= Number(max[1])) && (!min || width >= Number(min[1]))
    return { matches, media: query, onchange: null, addListener() {}, removeListener() {},
      addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false } }
  }
}

const MEMBER = { cohorts: ['terminal-next'], isPaid: true }
const ON = { ...MEMBER, terminalBoardTabsEnabled: true }

function renderAt(auth = ON, url = '/terminal') {
  return render(
    <AuthContext.Provider value={auth}>
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/terminal" element={<TerminalRoute><TerminalShell /></TerminalRoute>} />
          <Route path="/terminal/calendar" element={<TerminalRoute><TerminalShell /></TerminalRoute>} />
          <Route path="*" element={<div data-testid="elsewhere" />} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  )
}

const click = async (id) => { await act(async () => { fireEvent.click(screen.getByTestId(id)) }) }
const has = (id) => screen.queryByTestId(id) !== null
const writesTo = (key) => store.writes.filter(([k]) => k === key)
const storedTabs = () => readTabs(store.prefs[BOARD_TABS_KEY]).doc
const tabEls = () => within(screen.getByTestId('terminal-tabs')).getAllByRole('tab')
const tabNames = () => tabEls().map((t) => t.textContent)
const selected = () => tabEls().find((t) => t.getAttribute('aria-selected') === 'true')
const codesOnScreen = () => {
  const n = screen.getByTestId('terminal-shell').querySelectorAll('[data-testid^="terminal-panel-"][data-code]').length
  return Array.from({ length: n }, (_, i) => screen.getByTestId(`terminal-panel-${i}`).getAttribute('data-code'))
}
const codesOf = (s) => s.commands.map((c) => parseCommand(c).code)
const starter = (name) => {
  const s = STARTER_BOARDS.find((b) => b.name === name)
  if (!s) throw new Error(`these tests read the ready-made board "${name}"; it is no longer in the list`)
  return s
}
const LEADERS = starter('Leaders')
const MARKET_OPEN = STARTER_BOARDS[0]
const MINE = countOf(DEFAULT_LAYOUT, 3)
const MINE_CODES = MINE.panels.slice(0, 3).map((p) => p.code)

/** A member who already has a board of their own (three panels), and maybe saved boards. */
function seedMine({ saved = [] } = {}) {
  let lib = emptyLibrary()
  saved.forEach(([name, layout], i) => { lib = saveBoard(lib, name, layout, {}, 1000 + i).library })
  store.prefs = { terminal_layout: JSON.stringify(MINE), terminal_boards: JSON.stringify(lib) }
  return { ...store.prefs }
}
const plus = async (id) => { await click('terminal-tab-add'); await click(id) }
const openStock = async (sym) => {
  await click('terminal-tab-add')
  await act(async () => { fireEvent.change(screen.getByTestId('terminal-plus-stock'), { target: { value: sym } }) })
  await click('terminal-plus-stock-open')
}
const typed = async (text) => {
  const input = screen.getByTestId('terminal-command')
  fireEvent.change(input, { target: { value: text } })
  await act(async () => { fireEvent.keyDown(input, { key: 'Enter' }) })
}
const alt = async (code) => {
  await act(async () => { fireEvent.keyDown(window, { code, key: code.replace(/^Key|^Digit/, '').toLowerCase(), altKey: true }) })
}

beforeEach(() => {
  saveTiming.debounceMs = 0
  try { window.sessionStorage.clear() } catch { /* */ }
  try { window.localStorage.clear() } catch { /* */ }
  store.prefs = {}
  store.writes = []
  setViewport(1400)
  Element.prototype.scrollIntoView = vi.fn()
})
afterEach(() => cleanup())

describe('the switch', () => {
  it.each([
    ['no key in the sign-in payload', MEMBER],
    ['false', { ...MEMBER, terminalBoardTabsEnabled: false }],
    ['a value that is not exactly true', { ...MEMBER, terminalBoardTabsEnabled: 'admin' }],
  ])('OFF (%s): today\'s shell, with its rail and its bar, and the tabs key is never written', async (_n, auth) => {
    seedMine()
    renderAt(auth)
    expect(screen.getByRole('navigation', { name: 'Terminal functions' })).toBeTruthy()      // the left rail
    expect(screen.getByTestId('terminal-boards-button').textContent).toMatch(/^Board/)       // the old bar's button
    expect(has('terminal-density-compact')).toBe(true)
    expect(has('terminal-tabs-chrome')).toBe(false)
    expect(has('terminal-tabs')).toBe(false)
    expect(has('terminal-add-block')).toBe(false)
    expect(has('terminal-edit-board')).toBe(false)
    expect(has('terminal-panel-name-0')).toBe(false)                                          // the old header
    expect(screen.getByTestId('terminal-shell').hasAttribute('data-shell')).toBe(false)
    expect(screen.getByTestId('terminal-command').getAttribute('placeholder')).not.toBe(BOX_PLACEHOLDER)
    // Use it a little: open a ready-made board the old way.
    await click('terminal-boards-button')
    await click(`terminal-starter-open-${LEADERS.id}`)
    expect(codesOnScreen()).toEqual(codesOf(LEADERS))
    expect(within(screen.getByTestId('terminal-notice')).getByRole('button', { name: 'Back to my layout' })).toBeTruthy()
    expect(writesTo(BOARD_TABS_KEY)).toEqual([])
    expect(BOARD_TABS_KEY in store.prefs).toBe(false)
  })

  it('ON: the tabs, the one box and the two buttons; no rail and no old bar', async () => {
    seedMine()
    const { container } = renderAt()
    expect(screen.getByTestId('terminal-shell').getAttribute('data-shell')).toBe('tabs')
    expect(screen.getByRole('tablist', { name: 'Open boards' })).toBeTruthy()
    const box = within(screen.getByTestId('terminal-box')).getByTestId('terminal-command')
    expect(box.getAttribute('placeholder')).toBe('Search a ticker or a tool, or type a code')
    expect(screen.getByTestId('terminal-add-block').textContent).toBe('Add a block')
    expect(screen.getByTestId('terminal-edit-board').textContent).toBe('Edit board')
    expect(screen.queryByRole('navigation', { name: 'Terminal functions' })).toBeNull()
    expect(container.querySelector('[data-testid^="terminal-rail-"]')).toBeNull()
    expect(has('terminal-fn-button')).toBe(false)
    expect(has('terminal-boards-button')).toBe(false)             // it is under "Edit board" now
    await expectNoAxeViolations(container)
  })

  it('ON: the box is the same command line: a typed code still runs', async () => {
    seedMine()
    renderAt()
    await typed('NEWS')
    expect(codesOnScreen()[0]).toBe('NEWS')
  })

  it('ON, in a popped-out panel: one panel as before, no tabs, and the tabs key is never written', () => {
    seedMine()
    renderAt(ON, popoutHref({ code: MINE_CODES[0], args: [] }, null))
    expect(has('terminal-popout')).toBe(true)
    expect(has('terminal-tabs-chrome')).toBe(false)
    expect(has('terminal-panel-name-0')).toBe(false)                                          // the old header
    expect(writesTo(BOARD_TABS_KEY)).toEqual([])
  })
})

describe('the first time the tabs draw', () => {
  it('a member with a board of their own: it is the first tab, "My board", and nothing on screen moves', () => {
    const before = seedMine()
    renderAt()
    expect(tabNames()).toEqual(['My board'])
    expect(selected().getAttribute('data-kind')).toBe('own')
    expect(codesOnScreen()).toEqual(MINE_CODES)
    expect(screen.getByTestId('terminal-board-title').textContent).toBe('My board')
    expect(has('terminal-board-uct')).toBe(false)
    expect(store.prefs.terminal_layout).toBe(before.terminal_layout)       // byte for byte: their board is not rewritten
    expect(writesTo('terminal_layout')).toEqual([])
    expect(storedTabs().tabs).toHaveLength(1)
  })

  it('a board that is one of their saved boards: the tab carries that board\'s name', () => {
    seedMine({ saved: [['Swing Board', MINE]] })
    renderAt()
    expect(tabNames()).toEqual(['Swing Board'])
    expect(selected().getAttribute('data-kind')).toBe('saved')
    expect(writesTo('terminal_layout')).toEqual([])
  })

  it('a member on the untouched default: the first ready-made board, under its own name', () => {
    renderAt()                                                             // nothing stored at all
    expect(tabNames()).toEqual([MARKET_OPEN.name])
    expect(selected().getAttribute('data-kind')).toBe('starter')
    expect(codesOnScreen()).toEqual(codesOf(MARKET_OPEN))
    expect(screen.getByTestId('terminal-board-title').textContent).toBe(MARKET_OPEN.name)
    expect(screen.getByTestId('terminal-board-uct').textContent).toBe('A UCT board, yours to change')
    expect(UCT_BOARD_LINE).toBe('A UCT board, yours to change')
    expect(storedTabs().pending).toBeNull()                                // the board landed; nothing in flight
  })

  it('a later visit reads the stored tabs back, selected tab and all', async () => {
    seedMine()
    const first = renderAt()
    await plus(`terminal-plus-starter-${LEADERS.id}`)
    first.unmount()
    store.writes = []
    renderAt()
    expect(tabNames()).toEqual(['My board', 'Leaders'])
    expect(selected().textContent).toBe('Leaders')
    expect(codesOnScreen()).toEqual(codesOf(LEADERS))
    expect(store.writes).toEqual([])                                       // reading the tabs writes nothing
  })
})

describe('"+": open a board in a new tab', () => {
  it('a ready-made board opens in a NEW tab and is selected; the board they were on is kept', async () => {
    seedMine()
    const { container } = renderAt()
    await click('terminal-tab-add')
    const menu = screen.getByTestId('terminal-plus-menu')
    for (const s of STARTER_BOARDS) expect(within(menu).getByText(s.name)).toBeTruthy()
    expect(within(menu).getByText('A stock…')).toBeTruthy()
    expect(within(menu).getByText('Blank')).toBeTruthy()
    await expectNoAxeViolations(container.ownerDocument.body)
    await click(`terminal-plus-starter-${LEADERS.id}`)
    expect(has('terminal-plus-menu')).toBe(false)
    expect(tabNames()).toEqual(['My board', 'Leaders'])
    expect(selected().textContent).toBe('Leaders')
    expect(codesOnScreen()).toEqual(codesOf(LEADERS))
    expect(screen.getByTestId('terminal-board-uct')).toBeTruthy()
    // With tabs there is nothing to go "back" to: the other board is one tab away.
    expect(within(screen.getByTestId('terminal-notice')).queryByRole('button', { name: 'Back to my layout' })).toBeNull()
    const doc = storedTabs()
    expect(doc.tabs.map((t) => t.kind)).toEqual(['own', 'starter'])
    expect(boardSignature(doc.tabs[0].copy)).toBe(boardSignature(boardSnapshot(MINE)))      // the first tab's copy, whole
  })

  it('picking a board that is already open selects its tab instead of opening a second', async () => {
    seedMine()
    renderAt()
    await plus(`terminal-plus-starter-${LEADERS.id}`)
    await act(async () => { fireEvent.click(tabEls()[0]) })
    await plus(`terminal-plus-starter-${LEADERS.id}`)
    expect(tabNames()).toEqual(['My board', 'Leaders'])
    expect(selected().textContent).toBe('Leaders')
  })

  it('"A stock…": the tab is the ticker with a small "Stock"; a non-ticker is refused in plain words', async () => {
    seedMine()
    renderAt()
    await openStock('not a ticker!')
    expect(screen.getByTestId('terminal-plus-stock-error').textContent).toContain('A stock board opens for one ticker')
    expect(screen.getByTestId('terminal-plus-stock').getAttribute('aria-invalid')).toBe('true')
    expect(tabNames()).toEqual(['My board'])
    await act(async () => { fireEvent.change(screen.getByTestId('terminal-plus-stock'), { target: { value: '$nvda' } }) })
    await click('terminal-plus-stock-open')
    expect(selected().getAttribute('data-kind')).toBe('stock')
    expect(selected().textContent).toBe('NVDAStock')
    expect(codesOnScreen()).toEqual(defaultStockBoard().codes)
    expect(screen.getByTestId('terminal-board-title').textContent).toBe(`NVDA · ${defaultStockBoard().name}`)
    expect(storedTabs().tabs[1]).toMatchObject({ kind: 'stock', ref: defaultStockBoard().id, sym: 'NVDA' })
  })

  it('a saved board and "Blank" each open in a tab of their own', async () => {
    seedMine({ saved: [['Earnings morning', countOf(DEFAULT_LAYOUT, 4)]] })
    renderAt()
    await plus('terminal-plus-saved-earnings-morning')
    expect(selected().textContent).toBe('Earnings morning')
    expect(codesOnScreen()).toHaveLength(4)
    await plus('terminal-plus-blank')
    expect(tabNames()).toEqual(['My board', 'Earnings morning', 'New board'])
    expect(selected().getAttribute('data-kind')).toBe('blank')
    expect(codesOnScreen()).toHaveLength(1)
    // the saved boards themselves are only marked as opened, never reshaped
    expect(readLibrary(store.prefs.terminal_boards).library.boards.map((b) => b.name)).toEqual(['Earnings morning'])
  })

  it('the typed stock command opens in a tab too (the same path)', async () => {
    seedMine()
    renderAt()
    await typed('AMD STOCK')
    expect(tabNames()).toEqual(['My board', 'AMDStock'])
  })
})

describe('switching tabs never loses a change', () => {
  it('each tab keeps its own working copy, there and back', async () => {
    seedMine()
    renderAt()
    await plus(`terminal-plus-starter-${LEADERS.id}`)
    await click('terminal-edit-board')
    await click('terminal-count-2')                                         // change the Leaders tab
    expect(codesOnScreen()).toEqual(codesOf(LEADERS).slice(0, 2))
    await act(async () => { fireEvent.click(tabEls()[0]) })                 // back to My board
    expect(selected().textContent).toBe('My board')
    expect(codesOnScreen()).toEqual(MINE_CODES)
    await typed('NEWS')                                                     // change My board
    const mineNow = codesOnScreen()
    expect(mineNow[0]).toBe('NEWS')
    await act(async () => { fireEvent.click(tabEls()[1]) })
    expect(codesOnScreen()).toEqual(codesOf(LEADERS).slice(0, 2))           // Leaders, as it was left
    await act(async () => { fireEvent.click(tabEls()[0]) })
    expect(codesOnScreen()).toEqual(mineNow)                                // My board, as it was left
    // The SELECTED tab's board is what the existing save path wrote.
    expect(readLayout(store.prefs.terminal_layout).layout.panels[0].code).toBe('NEWS')
    expect(storedTabs().pending).toBeNull()
  })

  it('a switch whose board write was lost is finished on the next visit', () => {
    // The tabs say "Leaders is selected", but the stored board is still My board (the browser
    // closed between the two writes).
    const leaders = boardSnapshot(buildStarterBoard(MINE, LEADERS))
    store.prefs = {
      terminal_layout: JSON.stringify(MINE),
      [BOARD_TABS_KEY]: JSON.stringify({
        v: 1, active: 'b', pending: 'b', pendingFrom: boardSignature(boardSnapshot(MINE), { own: true }),
        tabs: [
          { id: 'a', kind: 'own', ref: null, name: 'My board', sym: null, copy: boardSnapshot(MINE) },
          { id: 'b', kind: 'starter', ref: LEADERS.id, name: LEADERS.name, sym: null, copy: leaders },
        ],
      }),
    }
    renderAt()
    expect(selected().textContent).toBe('Leaders')
    expect(codesOnScreen()).toEqual(codesOf(LEADERS))
    expect(storedTabs().pending).toBeNull()
  })

  it('arrow keys, Home and End move between tabs; the selected tab is the one in the tab order', async () => {
    seedMine()
    renderAt()
    await plus(`terminal-plus-starter-${LEADERS.id}`)
    await plus('terminal-plus-blank')
    const [a, b, c] = tabEls()
    expect([a, b, c].map((t) => t.tabIndex)).toEqual([-1, -1, 0])
    c.focus()
    fireEvent.keyDown(c, { key: 'ArrowRight' })
    expect(document.activeElement).toBe(a)                                   // wraps
    fireEvent.keyDown(a, { key: 'ArrowLeft' })
    expect(document.activeElement).toBe(c)
    fireEvent.keyDown(c, { key: 'Home' })
    expect(document.activeElement).toBe(a)
    fireEvent.keyDown(a, { key: 'End' })
    expect(document.activeElement).toBe(c)
    fireEvent.keyDown(c, { key: 'ArrowLeft' })
    expect(document.activeElement).toBe(b)
    expect(selected()).toBe(c)                                               // moving focus does not switch boards
    await act(async () => { fireEvent.click(b) })                            // Enter / Space on a button
    expect(selected()).toBe(tabEls()[1])
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled()              // the selected tab is kept in view
  })
})

describe('closing a tab', () => {
  it('the only tab cannot be closed', () => {
    seedMine()
    renderAt()
    expect(has('terminal-tab-close')).toBe(false)
  })

  it('a board with nothing unsaved closes at once, and its neighbour takes the screen', async () => {
    seedMine()
    renderAt()
    await plus(`terminal-plus-starter-${LEADERS.id}`)
    await click('terminal-tab-close')
    expect(has('terminal-tab-confirm')).toBe(false)
    expect(tabNames()).toEqual(['My board'])
    expect(codesOnScreen()).toEqual(MINE_CODES)
  })

  it('a board with unsaved changes asks ONCE, in plain words; "Keep it open" keeps it', async () => {
    seedMine()
    renderAt()
    await plus(`terminal-plus-starter-${LEADERS.id}`)
    await click('terminal-edit-board')
    await click('terminal-count-2')
    await click('terminal-tab-close')
    const ask = screen.getByTestId('terminal-tab-confirm')
    expect(ask.textContent).toContain('Leaders has changes that are not saved anywhere. If you close it, they are gone.')
    await click('terminal-tab-confirm-no')
    expect(tabNames()).toEqual(['My board', 'Leaders'])
    expect(codesOnScreen()).toEqual(codesOf(LEADERS).slice(0, 2))
    await click('terminal-tab-close')
    await click('terminal-tab-confirm-yes')
    expect(has('terminal-tab-confirm')).toBe(false)
    expect(tabNames()).toEqual(['My board'])
    expect(codesOnScreen()).toEqual(MINE_CODES)
  })

  it('Delete on a focused tab closes it (a parked tab is judged by its own copy)', async () => {
    seedMine()
    renderAt()
    await plus(`terminal-plus-starter-${LEADERS.id}`)
    const first = tabEls()[0]
    first.focus()
    await act(async () => { fireEvent.keyDown(first, { key: 'Delete' }) })
    // "My board" is saved nowhere, so it asks; the Leaders tab on screen is untouched meanwhile.
    expect(screen.getByTestId('terminal-tab-confirm').textContent).toContain('My board has changes that are not saved anywhere')
    await click('terminal-tab-confirm-yes')
    expect(tabNames()).toEqual(['Leaders'])
    expect(codesOnScreen()).toEqual(codesOf(LEADERS))
  })
})

describe('eight boards at most', () => {
  it('says so at the limit, and a ninth is refused out loud with nothing changed', async () => {
    seedMine()
    renderAt()
    for (const s of STARTER_BOARDS) await plus(`terminal-plus-starter-${s.id}`)
    let n = 1 + STARTER_BOARDS.length
    for (const sym of ['NVDA', 'AMD', 'AAPL', 'MSFT', 'TSLA', 'META', 'GOOG']) {
      if (n >= MAX_TABS) break
      await openStock(sym)
      n += 1
    }
    expect(tabEls()).toHaveLength(MAX_TABS)
    expect(screen.getByTestId('terminal-tabs-full').textContent).toBe(TABS_FULL_TEXT)
    const before = store.prefs[BOARD_TABS_KEY]
    const codes = codesOnScreen()
    await typed('COIN STOCK')                                               // a ninth, by the typed command
    expect(tabEls()).toHaveLength(MAX_TABS)
    expect(screen.getByTestId('terminal-notice').textContent).toContain(TABS_FULL_TEXT)
    expect(screen.getByTestId('terminal-notice').getAttribute('role')).toBe('alert')
    expect(codesOnScreen()).toEqual(codes)
    expect(store.prefs[BOARD_TABS_KEY]).toBe(before)
    await click('terminal-tab-add')                                         // and the menu says it too
    expect(screen.getByTestId('terminal-plus-full').textContent).toBe(TABS_FULL_TEXT)
    expect(screen.getByTestId('terminal-plus-blank').disabled).toBe(true)
    expect(screen.getByTestId(`terminal-plus-starter-${LEADERS.id}`).disabled).toBe(true)
  })
})

describe('"Edit board"', () => {
  const EDIT_ONLY = ['terminal-grip-0', 'terminal-group-0', 'terminal-dup-0', 'terminal-close-0', 'terminal-count-2',
    'terminal-density-compact', 'terminal-boards-button', 'terminal-edit-versions', 'terminal-edit-bar']

  it('OFF: a panel header is the name, provenance and the three reading actions; no layout control anywhere', async () => {
    seedMine()
    const { container } = renderAt()
    expect(screen.getByTestId('terminal-edit-board').getAttribute('aria-pressed')).toBe('false')
    for (const id of EDIT_ONLY) expect(has(id), id).toBe(false)
    expect(has('terminal-max-0')).toBe(true)
    expect(has('terminal-popout-0')).toBe(true)
    await expectNoAxeViolations(container)
  })

  it('ON: grip, group, duplicate, close, panel count, density, save and version history appear', async () => {
    seedMine()
    const { container } = renderAt()
    await click('terminal-edit-board')
    expect(screen.getByTestId('terminal-edit-board').getAttribute('aria-pressed')).toBe('true')
    for (const id of EDIT_ONLY) expect(has(id), id).toBe(true)
    expect(has('terminal-max-0')).toBe(true)
    expect(has('terminal-popout-0')).toBe(true)
    await expectNoAxeViolations(container)
    await click('terminal-edit-board')
    for (const id of EDIT_ONLY) expect(has(id), id).toBe(false)
  })

  it('every shortcut works with Edit OFF: Alt+X closes the focused panel, Alt+Z brings it back', async () => {
    seedMine()
    renderAt()
    expect(has('terminal-close-0')).toBe(false)
    await alt('KeyX')
    expect(codesOnScreen()).toEqual(MINE_CODES.slice(1))
    await alt('KeyZ')
    expect(codesOnScreen()).toEqual(MINE_CODES)
  })

  it('"Put it back the way it was" returns the board to how it stood when Edit was switched on', async () => {
    seedMine()
    renderAt()
    await click('terminal-edit-board')
    expect(has('terminal-revert-layout')).toBe(false)                        // nothing changed yet
    await click('terminal-count-2')
    await click('terminal-close-0')
    expect(codesOnScreen()).not.toEqual(MINE_CODES)
    expect(screen.getByTestId('terminal-revert-layout').textContent).toBe('Put it back the way it was')
    await click('terminal-revert-layout')
    expect(codesOnScreen()).toEqual(MINE_CODES)
    expect(has('terminal-revert-layout')).toBe(false)
  })

  it('"Save board" saves through the existing path, and the tab becomes that saved board', async () => {
    seedMine()
    renderAt()
    await click('terminal-edit-board')
    await click('terminal-boards-button')
    fireEvent.change(screen.getByTestId('terminal-board-name'), { target: { value: 'Morning' } })
    await click('terminal-board-save')
    expect(readLibrary(store.prefs.terminal_boards).library.boards.map((b) => b.name)).toEqual(['Morning'])
    expect(storedTabs().tabs[0]).toMatchObject({ kind: 'saved', name: 'Morning' })
    expect(storedTabs().tabs[0].ref).toBe(readLibrary(store.prefs.terminal_boards).library.boards[0].id)
  })
})

describe('"Reset to UCT default"', () => {
  it('is offered only on a ready-made board that differs, asks once, and puts the UCT board back', async () => {
    seedMine()
    renderAt()
    await click('terminal-edit-board')
    expect(has('terminal-reset-default')).toBe(false)                        // "My board" is not a UCT board
    await plus(`terminal-plus-starter-${LEADERS.id}`)
    expect(has('terminal-reset-default')).toBe(false)                        // nothing to reset yet
    await click('terminal-count-2')
    await typed('NEWS')
    expect(codesOnScreen()).not.toEqual(codesOf(LEADERS))
    await click('terminal-reset-default')
    expect(screen.getByTestId('terminal-tab-confirm').textContent).toContain('Leaders will go back to the board UCT made')
    await click('terminal-tab-confirm-no')
    expect(codesOnScreen()).not.toEqual(codesOf(LEADERS))                    // "Keep my changes" kept them
    await click('terminal-reset-default')
    await click('terminal-tab-confirm-yes')
    expect(codesOnScreen()).toEqual(codesOf(LEADERS))
    expect(has('terminal-reset-default')).toBe(false)
    expect(tabNames()).toEqual(['My board', 'Leaders'])
  })
})

describe('one header line per panel', () => {
  it('the tool\'s plain name, then its command small and grey, then provenance', () => {
    seedMine()
    renderAt()
    MINE_CODES.forEach((code, i) => {
      const name = screen.getByTestId(`terminal-panel-name-${i}`)
      const cmd = screen.getByTestId(`terminal-panel-code-${i}`)
      expect(name.textContent, code).toBe(BY_CODE[code].label)
      expect(cmd.textContent, code).toContain(code)
      expect(name.nextElementSibling, code).toBe(cmd)                        // name first, the code after it
      expect(name.parentElement.children.length).toBeLessThanOrEqual(3)      // name, code, provenance: one line
    })
  })

  it('the code is grey, never the accent (the stylesheet says so)', () => {
    const rule = /\.panelCode\s*\{([^}]*)\}/.exec(chromeCss)[1]
    expect(rule).toMatch(/color:\s*var\(--text-muted\)/)
    expect(rule).not.toMatch(/accent|gold/)
    const tool = /\.rowCode\s*\{([^}]*)\}/.exec(chromeCss)[1]
    expect(tool).toMatch(/color:\s*var\(--text-muted\)/)
  })
})

describe('"Add a block": the tools by plain name', () => {
  it('lists every group, name first and code after; the filter narrows; picking one adds it as the old sheet does', async () => {
    seedMine()
    const { container } = renderAt()
    await click('terminal-add-block')
    const list = screen.getByTestId('terminal-tools')
    const news = within(list).getByTestId('terminal-tool-NEWS')
    expect(news.firstElementChild.textContent).toBe(BY_CODE.NEWS.label)
    expect(news.lastElementChild.textContent).toBe('NEWS')
    expect(within(list).getAllByRole('heading').length).toBeGreaterThan(3)
    await expectNoAxeViolations(container.ownerDocument.body)
    await act(async () => { fireEvent.change(screen.getByTestId('terminal-tools-filter'), { target: { value: 'zzzz no such tool' } }) })
    expect(screen.getByTestId('terminal-tools-empty')).toBeTruthy()
    await act(async () => { fireEvent.change(screen.getByTestId('terminal-tools-filter'), { target: { value: 'news' } }) })
    expect(within(screen.getByTestId('terminal-tools')).getByTestId('terminal-tool-NEWS')).toBeTruthy()
    expect(within(screen.getByTestId('terminal-tools')).queryByTestId('terminal-tool-CAL')).toBeNull()
    await click('terminal-tool-NEWS')
    expect(has('terminal-tools')).toBe(false)
    expect(codesOnScreen()[0]).toBe('NEWS')
  })

  it('focus goes back to the button that opened each list', async () => {
    seedMine()
    renderAt()
    await click('terminal-add-block')
    await act(async () => { fireEvent.keyDown(document, { key: 'Escape' }) })
    expect(has('terminal-tools')).toBe(false)
    expect(document.activeElement).toBe(screen.getByTestId('terminal-add-block'))
    await click('terminal-tab-add')
    await act(async () => { fireEvent.keyDown(document, { key: 'Escape' }) })
    expect(has('terminal-plus-menu')).toBe(false)
    expect(document.activeElement).toBe(screen.getByTestId('terminal-tab-add'))
  })
})

describe('renaming', () => {
  it('"My board" can be renamed; a UCT board offers no rename', async () => {
    seedMine()
    renderAt()
    await click('terminal-tab-rename')
    fireEvent.change(screen.getByTestId('terminal-tab-rename-input'), { target: { value: 'Morning desk' } })
    await click('terminal-tab-rename-save')
    expect(tabNames()).toEqual(['Morning desk'])
    expect(storedTabs().tabs[0].name).toBe('Morning desk')
    await plus(`terminal-plus-starter-${LEADERS.id}`)
    expect(has('terminal-tab-rename')).toBe(false)
  })

  it('a saved board is renamed in the saved boards too; a name already taken is refused', async () => {
    seedMine({ saved: [['Swing Board', MINE], ['Other', countOf(DEFAULT_LAYOUT, 4)]] })
    renderAt()
    await click('terminal-tab-rename')
    fireEvent.change(screen.getByTestId('terminal-tab-rename-input'), { target: { value: 'Other' } })
    await click('terminal-tab-rename-save')
    expect(tabNames()).toEqual(['Swing Board'])
    expect(screen.getByTestId('terminal-notice').textContent).toContain('already have a saved board named Other')
    await click('terminal-tab-rename')
    fireEvent.change(screen.getByTestId('terminal-tab-rename-input'), { target: { value: 'Swing v2' } })
    await click('terminal-tab-rename-save')
    expect(tabNames()).toEqual(['Swing v2'])
    expect(readLibrary(store.prefs.terminal_boards).library.boards.map((b) => b.name)).toEqual(['Swing v2', 'Other'])
  })
})

describe('the store', () => {
  it('writes ONE new key; the existing keys keep their names and their shapes', async () => {
    const before = seedMine({ saved: [['Swing Board', countOf(DEFAULT_LAYOUT, 4)]] })
    renderAt()
    await plus(`terminal-plus-starter-${LEADERS.id}`)
    await click('terminal-edit-board')
    await click('terminal-count-2')
    await act(async () => { fireEvent.click(tabEls()[0]) })
    await plus('terminal-plus-blank')
    await click('terminal-tab-close')
    const keys = new Set(store.writes.map(([k]) => k))
    expect(keys.has('terminal_board_tabs')).toBe(true)
    expect([...keys].sort()).toEqual(['terminal_board_tabs', 'terminal_layout'])
    expect(store.prefs.terminal_boards).toBe(before.terminal_boards)        // the saved boards: byte for byte
    // The board on screen is still a board the layout reader accepts, in the key it always used.
    expect(readLayout(store.prefs.terminal_layout).status).toBe('ok')
    const doc = JSON.parse(store.prefs.terminal_board_tabs)
    expect(Object.keys(doc).sort()).toEqual(['active', 'pending', 'pendingFrom', 'tabs', 'v'])
    expect(doc.v).toBe(1)
    for (const t of doc.tabs) expect(Object.keys(t).sort()).toEqual(['copy', 'id', 'kind', 'name', 'ref', 'sym'])
  })

  it('tabs that cannot be read are never saved over: the board on screen shows, and nothing is written', async () => {
    seedMine()
    store.prefs = { ...store.prefs, [BOARD_TABS_KEY]: '{not json' }
    renderAt()
    expect(screen.getByTestId('terminal-tabs-unreadable').getAttribute('role')).toBe('alert')
    expect(tabNames()).toEqual(['My board'])
    expect(codesOnScreen()).toEqual(MINE_CODES)
    await plus(`terminal-plus-starter-${LEADERS.id}`)                       // this visit still works
    expect(tabNames()).toEqual(['My board', 'Leaders'])
    expect(store.prefs[BOARD_TABS_KEY]).toBe('{not json')
    expect(writesTo(BOARD_TABS_KEY)).toEqual([])
    await click('terminal-tabs-start-fresh')                                // the member's own choice replaces it
    expect(storedTabs().tabs.map((t) => t.name)).toEqual(['My board', 'Leaders'])
  })
})

describe('on a phone', () => {
  it('the tabs, the box and the two buttons draw; panels keep today\'s phone layout', async () => {
    setViewport(390)
    seedMine()
    const { container } = renderAt()
    expect(screen.getByTestId('terminal-shell').getAttribute('data-phone')).toBe('true')
    expect(screen.getByRole('tablist', { name: 'Open boards' })).toBeTruthy()
    expect(within(screen.getByTestId('terminal-box')).getByTestId('terminal-command')).toBeTruthy()
    expect(has('terminal-add-block')).toBe(true)
    expect(has('terminal-phone-switcher')).toBe(true)                        // the engine's one-panel-at-a-time switcher
    await click('terminal-edit-board')
    expect(has('terminal-count-2')).toBe(false)                              // as today: no panel count on a phone
    await plus(`terminal-plus-starter-${LEADERS.id}`)
    expect(selected().textContent).toBe('Leaders')
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled()
    await expectNoAxeViolations(container)
  })

  it('the stylesheet: tabs scroll sideways, the box is last above the safe area, 44px targets, nothing wide', () => {
    const css = chromeCss.replace(/\/\*[\s\S]*?\*\//g, '')
    const block = (query) => {
      const at = css.indexOf(`@media ${query}`)
      expect(at, query).toBeGreaterThan(-1)
      let depth = 0
      for (let i = css.indexOf('{', at); i < css.length; i += 1) {
        if (css[i] === '{') depth += 1
        if (css[i] === '}') { depth -= 1; if (depth === 0) return css.slice(at, i + 1) }
      }
      return ''
    }
    expect(/\.tabs\s*\{[^}]*overflow-x:\s*auto/.test(css)).toBe(true)
    const phone = block('(max-width: 640px)')
    const box = /\.box\s*\{([^}]*)\}/.exec(phone)[1]
    expect(box).toMatch(/order:\s*99/)
    expect(box).toMatch(/env\(safe-area-inset-bottom/)
    expect(phone).not.toMatch(/position:\s*fixed/)
    const touch = block('(max-width: 1024px)')
    expect(touch).toMatch(/\.tab,\s*\.plus,\s*\.iconBtn,\s*\.btn,\s*\.row\s*\{\s*min-height:\s*var\(--tap-min\)/)
    // only the app's two breakpoints, and no fixed width a 340px screen could not hold
    const queries = [...css.matchAll(/@media\s*\(([^)]*)\)/g)].map((m) => m[1])
    expect(queries.filter((q) => /width/.test(q)).every((q) => /^(max-width: (640|1024)px|min-width: 1025px)$/.test(q))).toBe(true)
    // declared widths only: a media query's own condition is a screen size, not a box
    const declared = css.replace(/@media[^{]*\{/g, '{')
    const widths = [...declared.matchAll(/(?<![a-z-])(?:min-width|width):\s*(\d+)px/g)].map((m) => Number(m[1]))
    expect(widths.every((w) => w <= 340)).toBe(true)
    expect(css).toMatch(/prefers-reduced-motion: reduce/)
    expect(css).not.toMatch(/infinite/)
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(/)
    // seen on a real screen (2026-11-19): the title row on a phone is the status line (the tab
    // already names the board; the heading stays for screen readers), and the tools filter box
    // must not take the row basis as its HEIGHT inside the tools column
    expect(phone).toMatch(/\.boardLine\s*\{\s*display:\s*none/)
    expect(/\.boardName\s*\{[^}]*clip:\s*rect\(0, 0, 0, 0\)/.test(phone)).toBe(true)
    expect(/\.boardName\s*\{[^}]*display:\s*none/.test(phone)).toBe(false)
    expect(css).toMatch(/\.tools > \.field\s*\{\s*flex:\s*0 0 auto/)
  })

  it('the floating Help button and voice orb step up over the bottom box (phone), and clear "Edit board" (desktop)', () => {
    const read = (...parts) => fs.readFileSync(path.join(process.cwd(), 'src', ...parts), 'utf8').replace(/\r\n/g, '\n')
    const lifted = (css, cls) => new RegExp(
      `@media \\(max-width: 640px\\) \\{[^@]*:global\\(html\\[${BOTTOM_BOX_ATTR}\\]\\) \\.${cls} \\{\\s*bottom: calc\\(68px \\+ env\\(safe-area-inset-bottom`,
    ).test(css)
    expect(lifted(read('components', 'FeedbackWidget.module.css'), 'fab')).toBe(true)
    expect(lifted(read('components', 'voice', 'FloatingOrb.module.css'), 'orbCluster')).toBe(true)
    // desktop: the Help button is fixed in the top right corner; the first row leaves it room
    expect(chromeCss).toMatch(/@media \(min-width: 1025px\) \{\s*\.top \{\s*padding-right: calc\(var\(--space-md\) \+ 34px\)/)
  })

  it('the chrome marks the page while it is mounted, and only then', () => {
    const root = document.documentElement
    seedMine()
    const on = renderAt()
    expect(root.hasAttribute(BOTTOM_BOX_ATTR)).toBe(true)
    on.unmount()
    expect(root.hasAttribute(BOTTOM_BOX_ATTR)).toBe(false)
    renderAt(MEMBER)
    expect(root.hasAttribute(BOTTOM_BOX_ATTR)).toBe(false)                   // switch off: today's shell, untouched
  })
})
