// UCT Terminal — reordering panels (daily-use leftover #2). Three doors onto ONE move:
// drag a panel's handle onto another panel (mouse), the handle's "Move to panel N" menu (touch:
// HTML5 drag never fires there; also the click path on desktop), and ←/→ on the focused handle
// (keyboard; Alt+Shift+[ / ] still moves the focused panel). Every assertion reads the rendered
// board and the SAVED layout, with a control showing the order before the move.
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
import { DEFAULT_LAYOUT, reorderPanel, setCount } from './boardModel'

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
const order = () => [0, 1, 2, 3].map(code).filter(Boolean)
const savedOrder = () => {
  const l = JSON.parse(store.prefs.terminal_layout)
  return l.panels.slice(0, l.count).map((p) => p.code)
}
const layoutWrites = () => store.writes.filter(([k]) => k === 'terminal_layout').length
const grip = (i) => screen.queryByTestId(`terminal-grip-${i}`)
/** A stand-in DataTransfer: jsdom has none. */
function dataTransfer() {
  const data = {}
  return { data, effectAllowed: '', dropEffect: '', setData: (t, v) => { data[t] = v }, getData: (t) => data[t] || '' }
}

beforeEach(() => {
  saveTiming.debounceMs = 0
  try { window.sessionStorage.clear() } catch { /* */ }
  try { window.localStorage.clear() } catch { /* */ }
  store.prefs = {}
  store.writes = []
  setViewport(1400)
})
afterEach(() => cleanup())

describe('reorderPanel (the one move every door uses)', () => {
  const board = setCount(DEFAULT_LAYOUT, 4)
  const codes = (l) => l.panels.slice(0, l.count).map((p) => p.code)

  it('takes the panel out and re-inserts it; the ones between shift; focus follows', () => {
    const before = codes(board)
    const r = reorderPanel(board, 0, 2)
    expect(r.ok).toBe(true)
    expect(codes(r.layout)).toEqual([before[1], before[2], before[0], before[3]])
    expect(r.layout.focus).toBe(2)
    expect(codes(reorderPanel(r.layout, 2, 0).layout)).toEqual(before)   // the inverse restores it
  })

  it('refuses a slot off the board, the same slot, or a non-integer, and never touches parked panels', () => {
    const three = setCount(DEFAULT_LAYOUT, 3)
    expect(reorderPanel(three, 0, 3).ok).toBe(false)                     // slot 4 is parked
    expect(reorderPanel(three, 1, 1).ok).toBe(false)
    expect(reorderPanel(three, -1, 0).ok).toBe(false)
    expect(reorderPanel(three, 0.5, 1).ok).toBe(false)
    expect(reorderPanel(three, 2, 0).layout.panels.slice(3)).toEqual(three.panels.slice(3))
  })
})

describe('drag a panel onto another (mouse)', () => {
  it('dropping panel 1 on panel 3 moves it there, saves the order, and says so', async () => {
    seedBoard()
    renderShell()
    expect(order()).toEqual(['GP', 'FA', 'CN'])                           // control
    const dt = dataTransfer()
    await act(async () => { fireEvent.dragStart(grip(0), { dataTransfer: dt }) })
    expect(dt.data['application/x-uct-terminal-panel']).toBe('p1')
    expect(panel(0).className).toMatch(/panelDragging/)
    await act(async () => { fireEvent.dragOver(panel(2), { dataTransfer: dt }) })
    expect(panel(2).getAttribute('data-drop-target')).toBe('true')
    expect(panel(1).getAttribute('data-drop-target')).toBeNull()
    await act(async () => { fireEvent.drop(panel(2), { dataTransfer: dt }) })
    expect(order()).toEqual(['FA', 'CN', 'GP'])
    expect(savedOrder()).toEqual(['FA', 'CN', 'GP'])
    expect(JSON.parse(store.prefs.terminal_layout).panels[3].code).toBe('CAL') // parked stays parked
    expect(notice()).toBe('Moved GP to panel 3.')
    expect(panel(2).getAttribute('data-focused')).toBe('true')            // focus followed it
    expect(panel(2).getAttribute('data-drop-target')).toBeNull()          // the outline clears
  })

  it('dragging the last panel onto the first moves it to the front', async () => {
    seedBoard()
    renderShell()
    const dt = dataTransfer()
    await act(async () => { fireEvent.dragStart(grip(2), { dataTransfer: dt }) })
    await act(async () => { fireEvent.dragOver(panel(0), { dataTransfer: dt }) })
    await act(async () => { fireEvent.drop(panel(0), { dataTransfer: dt }) })
    expect(order()).toEqual(['CN', 'GP', 'FA'])
  })

  it('CONTROL: dropping a panel on itself, or ending a drag over nothing, changes nothing and writes nothing', async () => {
    seedBoard()
    renderShell()
    const before = layoutWrites()
    const dt = dataTransfer()
    await act(async () => { fireEvent.dragStart(grip(1), { dataTransfer: dt }) })
    await act(async () => { fireEvent.dragOver(panel(1), { dataTransfer: dt }) })
    await act(async () => { fireEvent.drop(panel(1), { dataTransfer: dt }) })
    await act(async () => { fireEvent.dragStart(grip(1), { dataTransfer: dt }) })
    await act(async () => { fireEvent.dragEnd(grip(1), { dataTransfer: dt }) })
    expect(order()).toEqual(['GP', 'FA', 'CN'])
    expect(layoutWrites()).toBe(before)
    expect(panel(1).className).not.toMatch(/panelDragging/)
  })

  it('CONTROL: a drag that is not a panel (a file, a link) is not taken as a move', async () => {
    seedBoard()
    renderShell()
    const dt = dataTransfer()
    await act(async () => { fireEvent.dragOver(panel(0), { dataTransfer: dt }) })
    expect(panel(0).getAttribute('data-drop-target')).toBeNull()
    await act(async () => { fireEvent.drop(panel(0), { dataTransfer: dt }) })
    expect(order()).toEqual(['GP', 'FA', 'CN'])
  })

  it('the handle is draggable and names every way to move', () => {
    seedBoard()
    renderShell()
    expect(grip(0).getAttribute('draggable')).toBe('true')
    expect(grip(0).getAttribute('aria-label')).toMatch(/drag it, choose a place, or press the left and right arrows/)
    expect(grip(0).getAttribute('aria-keyshortcuts')).toBe('Alt+Shift+[ Alt+Shift+]')
  })
})

describe('the Move menu (the non-drag door: touch, and a click on desktop)', () => {
  it('desktop: clicking the handle lists the slots; choosing one moves the panel', async () => {
    seedBoard()
    renderShell()
    await act(async () => { fireEvent.click(grip(2)) })
    const menu = screen.getByRole('menu')
    expect(within(menu).getByText('Move CN (panel 3)')).toBeTruthy()
    expect(within(menu).getByText('Panel 3 (here now)')).toBeTruthy()
    await act(async () => { fireEvent.click(within(menu).getByText('To panel 1 (where GP is now)')) })
    expect(order()).toEqual(['CN', 'GP', 'FA'])
    expect(savedOrder()).toEqual(['CN', 'GP', 'FA'])
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('choosing "here now" moves nothing', async () => {
    seedBoard()
    renderShell()
    await act(async () => { fireEvent.click(grip(1)) })
    await act(async () => { fireEvent.click(screen.getByText('Panel 2 (here now)')) })
    expect(order()).toEqual(['GP', 'FA', 'CN'])
  })

  it('phone: the same handle opens the list as a sheet and the move lands (no drag needed)', async () => {
    setViewport(400)
    seedBoard()
    renderShell()
    expect(grip(0)).toBeTruthy()
    await act(async () => { fireEvent.click(grip(0)) })
    await act(async () => { fireEvent.click(screen.getByText('To panel 2 (where FA is now)')) })
    expect(savedOrder()).toEqual(['FA', 'GP', 'CN'])
    // The phone tab row follows the new order, and the moved panel stays the one on screen.
    expect(screen.getByTestId('terminal-phone-switch-1').getAttribute('aria-selected')).toBe('true')
  })
})

describe('the keyboard on the handle', () => {
  it('→ moves the panel one place right and keeps focus on its handle; ← moves it back', async () => {
    seedBoard()
    renderShell()
    act(() => { grip(0).focus() })
    await act(async () => { fireEvent.keyDown(grip(0), { key: 'ArrowRight' }) })
    expect(order()).toEqual(['FA', 'GP', 'CN'])
    await act(async () => { await new Promise((r) => requestAnimationFrame(r)) })
    expect(document.activeElement?.getAttribute('data-grip-id')).toBe('p1')
    await act(async () => { fireEvent.keyDown(grip(1), { key: 'ArrowLeft' }) })
    expect(order()).toEqual(['GP', 'FA', 'CN'])
  })

  it('← on the first panel says why nothing moved', async () => {
    seedBoard()
    renderShell()
    await act(async () => { fireEvent.keyDown(grip(0), { key: 'ArrowLeft' }) })
    expect(order()).toEqual(['GP', 'FA', 'CN'])
    expect(notice()).toBe('GP is already the first panel.')
  })

  it('CONTROL: an arrow with a modifier is left alone (Alt+arrows belong to the browser)', async () => {
    seedBoard()
    renderShell()
    await act(async () => { fireEvent.keyDown(grip(0), { key: 'ArrowRight', altKey: true }) })
    expect(order()).toEqual(['GP', 'FA', 'CN'])
  })

  it('Alt+Shift+] still moves the focused panel (the existing key)', async () => {
    seedBoard()
    renderShell()
    await alt('BracketRight', { shiftKey: true })
    expect(order()).toEqual(['FA', 'GP', 'CN'])
  })
})

describe('when there is nothing to reorder', () => {
  it('a one-panel board shows no handle', () => {
    seedBoard({ count: 1 })
    renderShell()
    expect(grip(0)).toBeNull()
  })
})

