// app/src/pages/charts/ChartsWorkspace.switchRenders.test.jsx
//
// ─── A SYMBOL SWITCH RE-RENDERS WHAT SHOWS THE SYMBOL, NOT THE BOARD (switch render cuts, 2026-11-20) ──
//
// Measured on production (a render probe on the flip proof, 2026-11-20): a watchlist pick re-rendered the
// WHOLE /charts board, its body, the grid, every widget host and every widget under them, before the
// charts' own requested symbol had even moved. The colour groups' symbols were board state. They are a
// store now (groupSymsStore.js) and `useWorkspace()` subscribes only the renders that read `groupSyms`.
//
// On the real ChartsWorkspace (widget hosts stubbed, the symbolSave harness): a pick re-renders the
// widget that prints the linked symbol, and neither the board, the widget hosts, nor a widget that only
// takes `setGroupSym`. What the reader prints is the new symbol, and a reader that reads it only in a
// handler gets the current one.
import { render, screen, act } from '@testing-library/react'
import { vi, describe, test, expect, beforeEach, afterEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

const N = vi.hoisted(() => ({ board: 0, host: 0, reader: 0, nonReader: 0, handlerSaw: null }))
vi.mock('./useExtraGroupsEnabled', async (orig) => {
  const m = await orig()
  // ⭐ THE BOARD'S RENDER COUNTER: ChartsWorkspaceBoard calls this hook once per render of its body
  // (the stub widgets below do not call it).
  return { ...m, default: (...a) => { N.board++; return m.default(...a) } }
})
vi.mock('./WidgetHost', async () => {
  const { useWorkspace } = await import('./WorkspaceContext')
  function Reader({ color }) {
    const { groupSyms } = useWorkspace()
    N.reader++
    return <span data-testid="shown">{groupSyms[color] || '-'}</span>
  }
  function NonReader({ color }) {
    const ws = useWorkspace()
    N.nonReader++
    return (
      <>
        <button data-testid="pick" onClick={() => ws.setGroupSym(color, 'BBB')}>pick</button>
        <button data-testid="peek" onClick={() => { N.handlerSaw = ws.groupSyms[color] }}>peek</button>
      </>
    )
  }
  function StubHost({ widget }) {
    N.host++
    return <div><Reader color={widget.color} /><NonReader color={widget.color} /></div>
  }
  return { default: StubHost }
})
vi.mock('./mobile/MobileChartsApp', () => ({ default: () => <div>MOBILE</div> }))
vi.mock('./grid/MultiChartGrid', () => ({ default: () => <div>GRID</div> }))
vi.mock('./grid/MultiChartMenu', () => ({ default: () => <div>MC MENU</div> }))
vi.mock('react-grid-layout', () => ({
  Responsive: ({ children }) => <div data-testid="rgl-responsive">{children}</div>,
  WidthProvider: (C) => C,
}))
const setPref = vi.fn()
let mockPrefs = {}
vi.mock('../../hooks/usePreferences', () => ({
  default: () => ({ prefs: mockPrefs, setPref, setPrefMerged: vi.fn(), loading: false }),
  parsePref: (raw, fallback) => {
    if (raw == null) return fallback
    if (typeof raw !== 'string') return raw
    try { return JSON.parse(raw) } catch { return fallback }
  },
  refreshPreferences: vi.fn(),
  whenWritesSettle: () => Promise.resolve(),
}))
vi.mock('../../hooks/useMediaQuery', () => ({ default: () => false }))
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 1, role: 'user' } }) }))
vi.mock('../../hooks/useChartLayouts', () => ({
  default: () => ({ global: [], mine: [], isLoading: false, saveLayout: async () => ({}), deleteLayout: async () => {}, refresh: () => {} }),
}))

import ChartsWorkspace from './ChartsWorkspace'
import { publishPrefsUser, __resetPrefsSessionForTests } from '../../lib/prefsSession'

const BOARD = JSON.stringify({ widgets: [{ id: 'w1', type: 'scanner', color: 'C', x: 0, y: 0, w: 24, h: 20, opts: {} }], cols: 24, version: 1 })

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  setPref.mockReset()
  localStorage.clear()
  __resetPrefsSessionForTests()
  publishPrefsUser('A')
  mockPrefs = { charts_workspace_layout: BOARD, charts_workspace_groups: JSON.stringify({ A: null, B: null, C: 'AAA', D: null }) }
  globalThis.fetch = vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) }))
  Object.assign(N, { board: 0, host: 0, reader: 0, nonReader: 0, handlerSaw: null })
})
afterEach(() => {
  vi.useRealTimers()
  delete globalThis.fetch
  __resetPrefsSessionForTests()
  window.history.replaceState({}, '', '/')
})

describe('a symbol switch on the board', () => {
  test('re-renders the widget that prints the symbol, and not the board, the hosts or a non-reader', () => {
    window.history.replaceState({}, '', '/charts')
    render(<MemoryRouter><ChartsWorkspace /></MemoryRouter>)
    act(() => { vi.advanceTimersByTime(50) })
    expect(screen.getByTestId('shown').textContent).toBe('AAA')
    expect(N.board, 'the board mounted').toBeGreaterThan(0)
    const before = { ...N }
    act(() => { screen.getByTestId('pick').click() })
    expect(screen.getByTestId('shown').textContent).toBe('BBB')
    expect(N.reader - before.reader, 'the reader re-rendered once').toBe(1)
    expect(N.board - before.board, 'board renders on a switch').toBe(0)
    expect(N.host - before.host, 'widget-host renders on a switch').toBe(0)
    expect(N.nonReader - before.nonReader, 'renders of a widget that only takes setGroupSym').toBe(0)
    // a handler reading the symbol (a non-reader re-rendered for nothing) gets the current one
    act(() => { screen.getByTestId('peek').click() })
    expect(N.handlerSaw).toBe('BBB')
  })
})
