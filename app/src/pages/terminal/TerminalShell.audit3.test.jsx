// The shell, 2026-10-05 audit round 3. Same harness as TerminalShell.audit2.test.jsx (the
// preferences store + stubbed panel components + a router handle). Every `it` began as a probe
// that watched the REAL TerminalShell do the wrong thing, and asserts by rendered text / DOM.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useEffect, useReducer } from 'react'
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useLocation, useNavigate, useNavigationType } from 'react-router-dom'
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
import { FUNCTION_RECENTS_KEY } from './recents'
import { FAVORITES_MAX, emptyLibrary, encodeShare, saveBoard, setPreset, DEFAULT_LAYOUT } from './boardModel'
import { FUNCTIONS } from './functions'

let nav
let navType
function Where() {
  const l = useLocation()
  nav = useNavigate()
  navType = useNavigationType()
  return <div data-testid="where">{l.pathname}{l.search}</div>
}

const OPEN = { cohorts: ['terminal-next'], isPaid: true }

function setViewport(width) {
  window.matchMedia = (query) => {
    const max = /max-width:\s*(\d+)px/.exec(query)
    const min = /min-width:\s*(\d+)px/.exec(query)
    const matches = (!max || width <= Number(max[1])) && (!min || width >= Number(min[1]))
    return { matches, media: query, onchange: null, addListener() {}, removeListener() {},
      addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false } }
  }
}

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
const notice = () => screen.queryByTestId('terminal-notice')?.textContent || ''
const settle = () => act(async () => { for (let i = 0; i < 6; i += 1) await Promise.resolve() })

const panels = (specs, focus = 0, count = specs.length) => JSON.stringify({ v: 2, count, focus,
  panels: specs.map((s, i) => ({ id: `p${i + 1}`, ...s })) })

beforeEach(() => {
  store.prefs = {}
  store.writes = []
  saveTiming.debounceMs = 0
  try { window.localStorage.clear(); window.sessionStorage.clear() } catch { /* */ }
  global.fetch = vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) }))
  setViewport(1400)
})
afterEach(() => cleanup())

describe('the URL history entry belongs to the command that was typed', () => {
  it('a refused typed command does not turn the next panel click into a Back-button entry', async () => {
    store.prefs = { charts_workspace_groups: JSON.stringify({ A: 'NVDA', B: 'AMD' }),
      terminal_layout: panels([{ code: 'DES', channel: 'A' }, { code: 'CN', channel: 'B' }]) }
    renderAt(['/terminal'])
    await settle()
    expect(params().get('cmd')).toBe('NVDA DES')
    await type('NVDA FOO')                                   // refused: nothing opened
    expect(notice()).toMatch(/Unknown function "FOO" for NVDA/)
    await act(async () => { fireEvent.mouseDown(screen.getByTestId('terminal-panel-1')) })
    expect(params().get('cmd')).toBe('AMD CN')
    expect(navType).toBe('REPLACE')                           // a click is not a new page
  })

  it('a typed command that opens a panel still earns its own Back entry', async () => {
    store.prefs = { charts_workspace_groups: JSON.stringify({ A: 'NVDA' }),
      terminal_layout: panels([{ code: 'DES', channel: 'A' }]) }
    renderAt(['/terminal'])
    await settle()
    await type('TSLA GP')
    expect(params().get('cmd')).toBe('TSLA GP')
    expect(navType).toBe('PUSH')
  })
})

describe('undo close never hides a panel in silence', () => {
  it('on a full board, re-opening a panel says which one moved off the board', async () => {
    store.prefs = { charts_workspace_groups: JSON.stringify({ A: 'NVDA' }),
      terminal_layout: panels([{ code: 'DES', channel: 'A' }, { code: 'GP', channel: 'A' },
        { code: 'CN', channel: 'A' }, { code: 'FA', channel: 'A' }]) }
    renderAt(['/terminal'])
    await settle()
    await act(async () => { fireEvent.click(screen.getByTestId('terminal-close-1')) })   // GP goes
    await act(async () => { fireEvent.click(screen.getByTestId('terminal-count-4')) })   // a 4th slot again
    const fourth = code(3)
    await act(async () => { fireEvent.click(screen.getByTestId('terminal-undo-close')) })
    expect(code(1)).toBe('GP')
    expect(notice()).toMatch(/Re-opened GP in panel 2/)
    expect(notice()).toContain(`${fourth} moved off the board to make room`)
    expect(notice()).toMatch(/close a panel to bring it back/i)
  })

  it('with room on the board, undo says where the panel came back', async () => {
    store.prefs = { charts_workspace_groups: JSON.stringify({ A: 'NVDA' }),
      terminal_layout: panels([{ code: 'DES', channel: 'A' }, { code: 'GP', channel: 'A' }]) }
    renderAt(['/terminal'])
    await settle()
    await act(async () => { fireEvent.click(screen.getByTestId('terminal-close-1')) })
    await act(async () => { fireEvent.click(screen.getByTestId('terminal-notice-undo-close')) })
    expect(code(1)).toBe('GP')
    expect(notice()).toMatch(/Re-opened GP in panel 2\./)
    expect(notice()).not.toMatch(/moved off/)
  })

  it('a11y (audit 2026-10-06): closing from the panel\'s own button lands focus on Undo, not <body>', async () => {
    store.prefs = { charts_workspace_groups: JSON.stringify({ A: 'NVDA' }),
      terminal_layout: panels([{ code: 'DES', channel: 'A' }, { code: 'GP', channel: 'A' }]) }
    renderAt(['/terminal'])
    await settle()
    // the polite live region is mounted BEFORE anything is said (an inserted one is not announced)
    const announce = screen.getByTestId('terminal-notice-announce')
    expect(announce.getAttribute('role')).toBe('status')
    expect(announce.textContent).toBe('')
    const close = screen.getByTestId('terminal-close-1')
    close.focus()
    expect(document.activeElement).toBe(close)
    await act(async () => { fireEvent.click(close) })
    // the button that had focus is gone; the rAF hand-off puts it on the notice's Undo
    await act(async () => { await new Promise((r) => requestAnimationFrame(() => r())) })
    expect(document.activeElement).toBe(screen.getByTestId('terminal-notice-undo-close'))
    // …and the same, already-mounted region now carries what happened
    expect(screen.getByTestId('terminal-notice-announce')).toBe(announce)
    expect(announce.textContent).toBe('Closed GP.')
  })
})

describe('recents and favourites say when they cannot do what was asked', () => {
  it('a refused command is not recorded as a function that ran', async () => {
    renderAt(['/terminal'])
    await settle()
    await type('NVDA RES EXTRA')                              // refused: a door cannot carry EXTRA
    expect(notice()).toMatch(/Not applied: "EXTRA"/)
    await type('NVDA DASH')                                   // refused: DASH is market-wide
    await act(async () => { fireEvent.click(screen.getByTestId('terminal-recents-button')) })
    expect(screen.getByTestId('terminal-recents-menu')).toHaveTextContent('Nothing run yet.')
  })

  it('a 17th favourite is refused out loud, not dropped', async () => {
    const favs = FUNCTIONS.map((f) => f.code).filter((c) => c !== 'GP').slice(0, FAVORITES_MAX)
    store.prefs = { terminal_boards: JSON.stringify({ ...emptyLibrary(), favorites: favs }) }
    window.localStorage.setItem(FUNCTION_RECENTS_KEY, JSON.stringify(['GP']))
    renderAt(['/terminal'])
    await settle()
    await act(async () => { fireEvent.click(screen.getByTestId('terminal-recents-button')) })
    await act(async () => { fireEvent.click(screen.getByTestId('terminal-fav-GP')) })
    const note = screen.getByTestId('terminal-fav-note')
    expect(note).toHaveTextContent(`You have ${FAVORITES_MAX} favourites`)
    expect(note).toHaveTextContent('Unstar one first')
    expect(JSON.parse(store.prefs.terminal_boards).favorites).toHaveLength(FAVORITES_MAX)
  })

  it('"Save to my boards" on an unreadable library says it did not save', async () => {
    store.prefs = { terminal_boards: '{not json' }
    const token = encodeShare('Desk', DEFAULT_LAYOUT, { A: 'NVDA' })
    renderAt([`/terminal?board=${token}`])
    await settle()
    await act(async () => { fireEvent.click(screen.getByTestId('terminal-notice-save-shared')) })
    expect(notice()).toMatch(/could not be read/)
    expect(notice()).toMatch(/not saved/)
    expect(store.prefs.terminal_boards).toBe('{not json')    // and nothing was written over it
  })

  it('saving under an existing name says it replaced that board', async () => {
    const lib = saveBoard(emptyLibrary(), 'Desk', DEFAULT_LAYOUT, {}).library
    store.prefs = { terminal_boards: JSON.stringify(lib) }
    renderAt(['/terminal'])
    await settle()
    await act(async () => { fireEvent.click(screen.getByTestId('terminal-boards-button')) })
    fireEvent.change(screen.getByTestId('terminal-board-name'), { target: { value: 'desk' } })
    await act(async () => { fireEvent.click(screen.getByTestId('terminal-board-save')) })
    // said inside the sheet (it covers the notice line), and on the notice line too
    expect(screen.getByTestId('terminal-board-saved')).toHaveTextContent('Replaced your board desk with this one')
    expect(notice()).toMatch(/Replaced your board desk/)
  })
})

describe('share classes are one security', () => {
  it('a board preset set for BRK.B opens when the member types brk-b', async () => {
    const saved = saveBoard(emptyLibrary(), 'Berkshire', DEFAULT_LAYOUT, {})
    store.prefs = { terminal_boards: JSON.stringify(setPreset(saved.library, 'BRK.B', saved.board.id)) }
    renderAt(['/terminal'])
    await settle()
    await type('brk-b')
    expect(notice()).toMatch(/Opened Berkshire for BRK-B/)
  })

  it('a lowercase argument is stored and shown upper-case, so history and the URL agree', async () => {
    store.prefs = { charts_workspace_groups: JSON.stringify({ A: 'NVDA' }),
      terminal_layout: panels([{ code: 'DES', channel: 'A' }]) }
    renderAt(['/terminal'])
    await settle()
    await type('nvda gp w')
    expect(params().get('cmd')).toBe('NVDA GP W')
    expect(screen.getByTestId('terminal-panel-0')).toHaveTextContent('NVDA GP W')
  })
})

describe('phone: the panel switcher tells two panels of the same function apart', () => {
  it('each tab names its security as well as its code', async () => {
    setViewport(390)
    store.prefs = { charts_workspace_groups: JSON.stringify({ A: 'NVDA', B: 'AMD' }),
      terminal_layout: panels([{ code: 'DES', channel: 'A' }, { code: 'DES', channel: 'B' }]) }
    renderAt(['/terminal'])
    await settle()
    expect(screen.getByTestId('terminal-phone-switch-0')).toHaveTextContent('NVDA DES')
    expect(screen.getByTestId('terminal-phone-switch-1')).toHaveTextContent('AMD DES')
  })
})

describe('copy: no internal names, and every dead end says what to do', () => {
  it('a URL-owning panel redirect names the function, never its internal panel id', async () => {
    store.prefs = { charts_workspace_groups: JSON.stringify({ A: 'NVDA' }),
      terminal_layout: panels([{ code: 'SCR', channel: null }, { code: 'DES', channel: 'A' }], 1) }
    renderAt(['/terminal'])
    await settle()
    await type('@2 SCR')
    expect(notice()).toMatch(/Stock screener is already open in panel 1; @2 was redirected there/)
    expect(notice()).not.toMatch(/surface[A-Z]/)
  })

  it('Alt+3 on a two-panel board says the panel is not on screen, and how to add it', async () => {
    store.prefs = { charts_workspace_groups: JSON.stringify({ A: 'NVDA' }),
      terminal_layout: panels([{ code: 'DES', channel: 'A' }, { code: 'GP', channel: 'A' }]) }
    renderAt(['/terminal'])
    await settle()
    await act(async () => { fireEvent.keyDown(window, { code: 'Digit3', key: '3', altKey: true }) })
    expect(notice()).toMatch(/Panel 3 is not on screen: this board shows 2\. Choose 3 panels to add it\./)
    await act(async () => { fireEvent.keyDown(window, { code: 'Digit2', key: '2', altKey: true }) })
    expect(screen.getByTestId('terminal-panel-1').dataset.focused).toBe('true')
  })

  it('a rail entry that leaves the terminal says so on hover', async () => {
    renderAt(['/terminal'])
    await settle()
    expect(screen.getByTestId('terminal-rail-DASH').getAttribute('title')).toMatch(/opens a page outside the terminal/)
    expect(screen.getByTestId('terminal-rail-RES').getAttribute('title')).toMatch(/opens a page outside the terminal/)
    expect(screen.getByTestId('terminal-rail-GP').getAttribute('title')).not.toMatch(/outside/)
    expect(screen.getByTestId('terminal-rail-CAL').getAttribute('title')).not.toMatch(/outside/)
  })
})

describe('phone: the echo is never cut off where it warns', () => {
  it('the full echo is on the element (title) and the phone stylesheet lets it wrap', async () => {
    const fs = await import('node:fs')
    const css = fs.readFileSync(`${process.cwd()}/src/pages/terminal/TerminalShell.module.css`, 'utf8')
    const phone = css.slice(css.indexOf('@media (max-width: 640px)'))
    const rule = /\.echoText\s*\{([^}]*)\}/.exec(phone)
    expect(rule?.[1]).toMatch(/white-space:\s*normal/)
    renderAt(['/terminal'])
    await settle()
    fireEvent.change(screen.getByTestId('terminal-command'), { target: { value: 'CAL FOO' } })
    const text = screen.getByTestId('terminal-echo').querySelector('span')
    expect(text.getAttribute('title')).toBe(text.textContent)
    expect(text.textContent).toMatch(/Not applied: "FOO"/)
  })
})
