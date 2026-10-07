// UCT Terminal — the daily-use keyboard layer (2026-10-06 audit,
// docs/terminal-research/06-ux-and-information-architecture/daily-use-audit-2026-10-06.md).
// Every key is driven as a real keydown on window (the registry's own listener), and every
// assertion reads the rendered board: data-code, data-channel, hidden, the notice text. Each
// behaviour carries a CONTROL that shows the board before (or without) the key looks different,
// so a key that does nothing cannot pass.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
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
import { DEFAULT_LAYOUT } from './boardModel'
import { SHORTCUTS } from '../command/shortcutRegistry'
import { HELP_SHORTCUT_IDS } from './panels/HelpPanel'

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

/** A three-panel board: GP and FA follow group A (NVDA), CN follows group B (SPY); a fourth
 *  panel (CAL) sits off the board. Group A has looked at AMD and TSLA before. */
function seedBoard(over = {}) {
  const channels = DEFAULT_LAYOUT.channels.map((c) => (c.id === 'A' ? { ...c, history: ['NVDA', 'AMD', 'TSLA'] } : c))
  const panels = [
    { id: 'p1', code: 'GP', channel: 'A', sym: null, args: [] },
    { id: 'p2', code: 'FA', channel: 'A', sym: null, args: [] },
    { id: 'p3', code: 'CN', channel: 'B', sym: null, args: [] },
    { id: 'p4', code: 'CAL', channel: null, sym: null, args: [] },
  ]
  store.prefs = {
    terminal_layout: JSON.stringify({ ...DEFAULT_LAYOUT, count: 3, focus: 0, channels, panels, closed: [], ...over }),
    charts_workspace_groups: JSON.stringify({ A: 'NVDA', B: 'SPY' }),
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

const alt = async (code, extra = {}) => {
  await act(async () => { fireEvent.keyDown(window, { code, key: code.replace(/^Key|^Digit/, '').toLowerCase(), altKey: true, ...extra }) })
}
const panel = (i) => screen.queryByTestId(`terminal-panel-${i}`)
const code = (i) => panel(i)?.getAttribute('data-code')
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

describe('Shift+Enter: switch the ticker, keep the functions', () => {
  it('a bare ticker on Shift+Enter re-points group A and every panel keeps its function', async () => {
    seedBoard()
    renderShell()
    expect(screen.getByTestId('stub-Chart')).toHaveTextContent('Chart:NVDA')
    const input = screen.getByTestId('terminal-command')
    fireEvent.change(input, { target: { value: 'AMD' } })
    await act(async () => { fireEvent.keyDown(input, { key: 'Enter', shiftKey: true }) })
    expect(code(0)).toBe('GP')
    expect(code(1)).toBe('FA')
    expect(screen.getByTestId('stub-Chart')).toHaveTextContent('Chart:AMD')
    expect(screen.getByTestId('stub-Financials')).toHaveTextContent('Financials:AMD')
    expect(notice()).toBe('Loaded AMD into Group A: panels 1, 2 kept their functions.')
  })

  it('CONTROL: plain Enter on the same bare ticker still turns the focused panel into DES', async () => {
    seedBoard()
    renderShell()
    const input = screen.getByTestId('terminal-command')
    fireEvent.change(input, { target: { value: 'AMD' } })
    await act(async () => { fireEvent.keyDown(input, { key: 'Enter' }) })
    expect(code(0)).toBe('DES')
  })
})

describe('panel keys', () => {
  it('Alt+M maximises the focused panel, Alt+2 flips to panel 2 full size, Alt+M restores', async () => {
    seedBoard()
    renderShell()
    const grid = screen.getByTestId('terminal-grid')
    expect(grid.getAttribute('data-count')).toBe('3')                 // control: the full board
    expect(panel(1).hidden).toBe(false)
    await alt('KeyM')
    expect(grid.getAttribute('data-count')).toBe('1')
    expect(grid.getAttribute('data-maximised')).toBe('true')
    expect(panel(0).hidden).toBe(false)
    expect(panel(1).hidden).toBe(true)
    expect(screen.getByTestId('terminal-restore-board')).toHaveTextContent('Show all 3 panels')
    expect(screen.getByTestId('terminal-max-0').getAttribute('aria-pressed')).toBe('true')
    await alt('Digit2')
    expect(panel(0).hidden).toBe(true)
    expect(panel(1).hidden).toBe(false)
    await alt('KeyM')
    expect(grid.getAttribute('data-count')).toBe('3')
    expect(panel(0).hidden).toBe(false)
    expect(screen.queryByTestId('terminal-restore-board')).toBeNull()
  })

  it('the maximise is a view, not a save: the stored board still shows three panels', async () => {
    seedBoard()
    renderShell()
    await alt('KeyM')
    expect(JSON.parse(store.prefs.terminal_layout).count).toBe(3)
  })

  it('the header button maximises THAT panel, and the bar button restores', async () => {
    seedBoard()
    renderShell()
    await act(async () => { fireEvent.mouseDown(panel(2)); fireEvent.click(screen.getByTestId('terminal-max-2')) })
    expect(panel(2).hidden).toBe(false)
    expect(panel(0).hidden).toBe(true)
    await act(async () => { fireEvent.click(screen.getByTestId('terminal-restore-board')) })
    expect(panel(0).hidden).toBe(false)
  })

  it('Alt+X closes the focused panel and Alt+Z brings it back in its slot', async () => {
    seedBoard()
    renderShell()
    await alt('KeyX')
    expect(code(0)).toBe('FA')
    expect(panel(2)).toBeNull()
    expect(notice()).toContain('Closed GP.')
    await alt('KeyZ')
    expect(code(0)).toBe('GP')
    expect(code(2)).toBe('CN')
  })

  it('CONTROL: Alt+Z with nothing closed says so and changes nothing', async () => {
    seedBoard()
    renderShell()
    await alt('KeyZ')
    expect(notice()).toBe('Nothing to re-open: no panel has been closed on this board.')
    expect([code(0), code(1), code(2)]).toEqual(['GP', 'FA', 'CN'])
  })

  it('Alt+X on a one-panel board refuses, out loud', async () => {
    seedBoard({ count: 1 })
    renderShell()
    await alt('KeyX')
    expect(code(0)).toBe('GP')
    expect(notice()).toBe('The last panel on a board cannot close.')
  })

  it('Alt+C duplicates the focused panel beside it', async () => {
    seedBoard()
    renderShell()
    expect(panel(3)).toBeNull()
    await alt('KeyC')
    expect([code(0), code(1), code(2), code(3)]).toEqual(['GP', 'GP', 'FA', 'CN'])
    expect(panel(1).getAttribute('data-focused')).toBe('true')
  })

  it('Alt+Shift+] moves the focused panel right and focus follows; Alt+] only moves focus', async () => {
    seedBoard()
    renderShell()
    await alt('BracketRight')                                           // control: no Shift
    expect([code(0), code(1)]).toEqual(['GP', 'FA'])
    expect(panel(1).getAttribute('data-focused')).toBe('true')
    await alt('BracketLeft')
    await alt('BracketRight', { shiftKey: true })
    expect([code(0), code(1)]).toEqual(['FA', 'GP'])
    expect(panel(1).getAttribute('data-focused')).toBe('true')
    expect(notice()).toBe('Moved GP to panel 2.')
    expect(JSON.parse(store.prefs.terminal_layout).panels.slice(0, 2).map((p) => p.code)).toEqual(['FA', 'GP'])
  })

  it('Alt+Shift+[ on the first panel refuses instead of wrapping', async () => {
    seedBoard()
    renderShell()
    await alt('BracketLeft', { shiftKey: true })
    expect(code(0)).toBe('GP')
    expect(notice()).toBe('GP is already the first panel.')
  })

  it('Alt+L steps the focused panel to the next group and the panel follows its security', async () => {
    seedBoard()
    store.prefs = { ...store.prefs, charts_workspace_groups: JSON.stringify({ A: 'NVDA', B: 'SPY', D: 'QQQ' }) }
    renderShell()
    expect(panel(0).getAttribute('data-channel')).toBe('A')
    await alt('KeyL')
    expect(panel(0).getAttribute('data-channel')).toBe('B')
    expect(screen.getByTestId('stub-Chart')).toHaveTextContent('Chart:SPY')
    expect(notice()).toBe('Panel 1 now follows Group B (SPY).')
    await alt('KeyL')
    expect(notice()).toBe('Panel 1 now follows Group C.')               // a group with no security
    await alt('KeyL'); await alt('KeyL')                               // D (QQQ), then not linked
    expect(panel(0).getAttribute('data-channel')).toBe('')
    expect(notice()).toBe('Panel 1 is not linked now; it keeps QQQ.')
    expect(screen.getByTestId('stub-Chart')).toHaveTextContent('Chart:QQQ')
    await alt('KeyL')
    expect(panel(0).getAttribute('data-channel')).toBe('A')
  })

  it('Alt+L on a panel that follows no security says why', async () => {
    seedBoard({ panels: [{ id: 'p4', code: 'CAL', channel: null, sym: null, args: [] },
      { id: 'p1', code: 'GP', channel: 'A', sym: null, args: [] }], count: 2 })
    renderShell()
    await alt('KeyL')
    expect(notice()).toBe('CAL does not follow a security, so it has no group to change.')
  })

  it('panel keys do nothing under an open sheet (the board is behind a modal)', async () => {
    seedBoard()
    renderShell()
    await alt('KeyO')
    expect(screen.getByTestId('terminal-boards-menu')).toBeTruthy()
    await alt('KeyX')
    expect([code(0), code(1), code(2)]).toEqual(['GP', 'FA', 'CN'])
  })
})

describe('sheets on one key', () => {
  it('Alt+O toggles Boards, Alt+R opens Recents, Alt+/ shows the keyboard sheet', async () => {
    seedBoard()
    renderShell()
    expect(screen.queryByTestId('terminal-boards-menu')).toBeNull()      // control
    await alt('KeyO')
    expect(screen.getByTestId('terminal-boards-menu')).toBeTruthy()
    await alt('KeyO')
    expect(screen.queryByTestId('terminal-boards-menu')).toBeNull()
    await alt('KeyR')
    expect(screen.getByTestId('terminal-recents-menu')).toBeTruthy()
    await alt('KeyR')
    expect(screen.queryByTestId('terminal-keys-sheet')).toBeNull()
    await alt('Slash')
    const sheet = screen.getByTestId('terminal-keys-sheet')
    expect(within(sheet).getByText('Alt+M')).toBeTruthy()
    expect(within(sheet).getByText('Alt+Shift+]')).toBeTruthy()
    expect(within(sheet).getByText('Shift+Enter')).toBeTruthy()
  })

  it('the keyboard sheet lists EVERY terminal binding the registry declares (none forgotten)', async () => {
    const declared = SHORTCUTS.filter((d) => d.id.startsWith('terminal.')).map((d) => d.id)
    expect(declared.length).toBeGreaterThan(15)                          // non-vacuity
    for (const id of declared) expect(HELP_SHORTCUT_IDS).toContain(id)
    seedBoard()
    renderShell()
    await alt('Slash')
    const rows = within(screen.getByTestId('terminal-help-keys')).getAllByRole('row')
    expect(rows).toHaveLength(HELP_SHORTCUT_IDS.length)
  })

  it('every bar and panel action names its key for assistive tech', () => {
    seedBoard()
    renderShell()
    expect(screen.getByTestId('terminal-boards-button').getAttribute('aria-keyshortcuts')).toBe('Alt+O')
    expect(screen.getByTestId('terminal-recents-button').getAttribute('aria-keyshortcuts')).toBe('Alt+R')
    expect(screen.getByTestId('terminal-close-0').getAttribute('aria-keyshortcuts')).toBe('Alt+X')
    expect(screen.getByTestId('terminal-dup-0').getAttribute('aria-keyshortcuts')).toBe('Alt+C')
    expect(screen.getByTestId('terminal-group-0').getAttribute('aria-keyshortcuts')).toBe('Alt+L')
    expect(screen.getByTestId('terminal-max-0').getAttribute('aria-label')).toBe('Maximise panel 1')
  })
})

describe('recent tickers reach the command line', () => {
  it('a ticker the board viewed is suggested on the first keystrokes, before any search answers', async () => {
    seedBoard()
    renderShell()
    const input = screen.getByTestId('terminal-command')
    await act(async () => { input.focus(); fireEvent.change(input, { target: { value: 'AM' } }) })
    const rows = [...screen.getByTestId('terminal-suggestions').querySelectorAll('li')].map((li) => li.textContent)
    expect(rows.some((r) => r.startsWith('AMD') && r.includes('recently viewed'))).toBe(true)
  })
})

describe('phone: the panel tabs are real ARIA tabs', () => {
  it('←/→ move between panels with one Tab stop, wrapping at the ends', async () => {
    setViewport(390)
    seedBoard()
    renderShell()
    const tab = (i) => screen.getByTestId(`terminal-phone-switch-${i}`)
    expect(tab(0).getAttribute('tabindex')).toBe('0')
    expect(tab(1).getAttribute('tabindex')).toBe('-1')                   // control: one stop
    expect(tab(0).getAttribute('aria-controls')).toBe(panel(0).id)
    act(() => { tab(0).focus() })
    await act(async () => { fireEvent.keyDown(tab(0), { key: 'ArrowRight' }) })
    expect(tab(1).getAttribute('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(tab(1))
    expect(panel(1).hidden).toBe(false)
    expect(panel(0).hidden).toBe(true)
    await act(async () => { fireEvent.keyDown(tab(1), { key: 'ArrowLeft' }) })
    await act(async () => { fireEvent.keyDown(tab(0), { key: 'ArrowLeft' }) })
    expect(tab(2).getAttribute('aria-selected')).toBe('true')
    await act(async () => { fireEvent.keyDown(tab(2), { key: 'Home' }) })
    expect(tab(0).getAttribute('aria-selected')).toBe('true')
  })

  it('no maximise control on a phone (it already shows one panel)', () => {
    setViewport(390)
    seedBoard()
    renderShell()
    expect(screen.queryByTestId('terminal-max-0')).toBeNull()
  })
})
