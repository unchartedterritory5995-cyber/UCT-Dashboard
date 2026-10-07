// UCT Terminal — the panel-count key (daily-use leftover #3). The 2026-10-06 daily-use audit
// left "Panel count: buttons 1-4 on the bar, no key (Alt+Shift+digit is free if wanted)", so
// Alt+Shift+1..4 sets the board's panel count, says the new count, and the bar's buttons show
// it. Driven as real keydowns on window through the shortcut registry's own listener.
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
import { SHORTCUTS, chordMatches } from '../command/shortcutRegistry'
import { HELP_SHORTCUT_IDS, chordLabel } from './panels/HelpPanel'

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
const shown = () => [0, 1, 2, 3].map(code).filter(Boolean)
const savedCount = () => JSON.parse(store.prefs.terminal_layout).count
const pressed = (prefix = 'terminal-count-') => [1, 2, 3, 4]
  .filter((n) => screen.getByTestId(`${prefix}${n}`).getAttribute('aria-pressed') === 'true')

beforeEach(() => {
  saveTiming.debounceMs = 0
  try { window.sessionStorage.clear() } catch { /* */ }
  try { window.localStorage.clear() } catch { /* */ }
  store.prefs = {}
  store.writes = []
  setViewport(1400)
})
afterEach(() => cleanup())

describe('Alt+Shift+1..4 sets the panel count', () => {
  it('Alt+Shift+4 shows four panels, saves it, presses the 4 button and says the count', async () => {
    seedBoard()
    renderShell()
    expect(shown()).toEqual(['GP', 'FA', 'CN'])                            // control: three
    expect(pressed()).toEqual([3])
    await alt('Digit4', { shiftKey: true, key: '$' })
    expect(shown()).toEqual(['GP', 'FA', 'CN', 'CAL'])                     // the parked panel returns
    expect(savedCount()).toBe(4)
    expect(pressed()).toEqual([4])
    expect(notice()).toBe('This board now shows 4 panels.')
  })

  it('Alt+Shift+1 and Alt+Shift+2 shrink the board (one panel says "panel")', async () => {
    seedBoard()
    renderShell()
    await alt('Digit1', { shiftKey: true, key: '!' })
    expect(shown()).toEqual(['GP'])
    expect(notice()).toBe('This board now shows 1 panel.')
    await alt('Digit2', { shiftKey: true, key: '@' })
    expect(shown()).toEqual(['GP', 'FA'])
    expect(savedCount()).toBe(2)
  })

  it('the count the board already shows says so and writes nothing', async () => {
    seedBoard()
    renderShell()
    const before = store.writes.length
    await alt('Digit3', { shiftKey: true, key: '#' })
    expect(notice()).toBe('This board already shows 3 panels.')
    expect(store.writes.length).toBe(before)
  })

  it('CONTROL: Alt+3 without Shift still FOCUSES panel 3 and leaves the count alone', async () => {
    seedBoard()
    renderShell()
    await alt('Digit3')
    expect(panel(2).getAttribute('data-focused')).toBe('true')
    expect(savedCount()).toBe(3)
    expect(shown()).toEqual(['GP', 'FA', 'CN'])
  })

  it('works from the command line (where a terminal user\'s focus lives)', async () => {
    seedBoard()
    renderShell()
    const input = screen.getByTestId('terminal-command')
    act(() => { input.focus() })
    await act(async () => { fireEvent.keyDown(input, { code: 'Digit2', key: '@', altKey: true, shiftKey: true }) })
    expect(shown()).toEqual(['GP', 'FA'])
  })

  it('on a phone the switcher\'s count buttons follow the key', async () => {
    setViewport(400)
    seedBoard()
    renderShell()
    await alt('Digit2', { shiftKey: true, key: '@' })
    expect(pressed('terminal-phone-count-')).toEqual([2])
    expect(screen.getAllByTestId(/^terminal-phone-switch-/)).toHaveLength(2)
  })

  it('CONTROL: under an open sheet the key changes nothing (it would change the board behind a modal)', async () => {
    seedBoard()
    renderShell()
    await alt('KeyO')                                                     // open Boards
    await alt('Digit4', { shiftKey: true, key: '$' })
    expect(savedCount()).toBe(3)
  })
})

describe('the key is declared, printed and shown on the buttons', () => {
  it('the registry declares Alt+Shift+1..4 on the physical digit, Ctrl/Cmd forbidden', () => {
    for (const n of [1, 2, 3, 4]) {
      const d = SHORTCUTS.find((s) => s.id === `terminal.count${n}`)
      expect(d).toBeTruthy()
      expect(chordLabel(d)).toBe(`Alt+Shift+${n}`)
      expect(chordMatches(d.chord, { code: `Digit${n}`, key: '!', altKey: true, shiftKey: true })).toBe(true)
      expect(chordMatches(d.chord, { code: `Digit${n}`, key: String(n), altKey: true, shiftKey: false })).toBe(false)
      expect(chordMatches(d.chord, { code: `Digit${n}`, key: '!', altKey: true, shiftKey: true, ctrlKey: true })).toBe(false)
      expect(HELP_SHORTCUT_IDS).toContain(d.id)
    }
  })

  it('each count button names its key, and the group says the current count', () => {
    seedBoard()
    renderShell()
    const b = screen.getByTestId('terminal-count-2')
    expect(b.getAttribute('aria-keyshortcuts')).toBe('Alt+Shift+2')
    expect(b.getAttribute('title')).toBe('Show 2 panels (Alt+Shift+2)')
    expect(screen.getByRole('group', { name: 'Panels: this board shows 3' })).toBeTruthy()
  })

  it('the keyboard sheet (Alt+/) lists the panel-count keys', async () => {
    seedBoard()
    renderShell()
    await alt('Slash', { key: '/' })
    expect(screen.getAllByText('Alt+Shift+4').length).toBeGreaterThan(0)
  })
})
