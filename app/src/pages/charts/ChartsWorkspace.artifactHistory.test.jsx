// COV-06 through the REAL workspace: restoring the layout you are IN.
//
// ⛔ The hazard: the open layout auto-saves the board on screen, and every
// layout switch FLUSHES that save first. A restore that reopened the layout the
// ordinary way would flush the replaced board into the library over the restore
// it was about to show. Same mock shape as VersionHistory.workspace.test.jsx.
import { render, screen, act, fireEvent } from '@testing-library/react'
import { vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

vi.mock('./WidgetHost', () => ({
  default: ({ widget }) => <div data-testid={`body-${widget.type}`}>{widget.type}</div>,
}))
vi.mock('./mobile/MobileChartsApp', () => ({ default: () => <div data-testid="mobile-charts-app">MOBILE</div> }))
vi.mock('./grid/MultiChartGrid', () => ({ default: () => <div data-testid="multichart-grid">GRID</div> }))
vi.mock('./grid/MultiChartMenu', () => ({ default: () => <div data-testid="multichart-menu">MC MENU</div> }))
vi.mock('react-grid-layout', () => ({
  Responsive: ({ children }) => <div data-testid="rgl-responsive">{children}</div>,
  WidthProvider: (C) => C,
}))

const setPref = vi.fn()
let mockPrefs = {}
vi.mock('../../hooks/usePreferences', () => ({
  default: () => ({ prefs: mockPrefs, setPref, loading: false }),
  parsePref: (raw, fallback) => {
    if (raw == null) return fallback
    if (typeof raw !== 'string') return raw
    try { return JSON.parse(raw) } catch { return fallback }
  },
  refreshPreferences: vi.fn(),
}))
vi.mock('../../hooks/useMediaQuery', () => ({ default: () => false }))
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 1, role: 'user' } }) }))

const saveLayout = vi.fn(async () => ({}))
let mine = []
const adoptRow = vi.fn((row) => { mine = mine.map(t => (t.id === row.id ? row : t)) })
vi.mock('../../hooks/useChartLayouts', () => ({
  default: () => ({
    global: [], mine, isLoading: false,
    saveLayout, renameLayout: async () => ({}), deleteLayout: async () => {}, adoptRow, refresh: () => {},
  }),
}))

import ChartsWorkspace from './ChartsWorkspace'

const W = (id, type, x) => ({ id, type, color: 'A', x, y: 0, w: 12, h: 20, opts: {} })
const STORED = { widgets: [W('c1', 'chart', 0), W('w1', 'watchlist', 12)], cols: 24, version: 1 }
// The board on screen: the same widgets, moved — so the open layout is DIRTY and a flush would save it.
const ON_SCREEN = { widgets: [W('c1', 'chart', 12), W('w1', 'watchlist', 0)], cols: 24, version: 1 }
// The version being restored.
const RESTORED = { widgets: [W('s1', 'scanner', 0)], cols: 24, version: 1 }

const res = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body })
async function flush() {
  await act(async () => { for (let i = 0; i < 12; i += 1) await Promise.resolve() })
}

beforeEach(() => {
  setPref.mockReset(); saveLayout.mockClear(); adoptRow.mockClear()
  mine = [{ id: 7, name: 'Swing', scope: 'user', layout: STORED }]
  mockPrefs = {
    charts_workspace_layout: JSON.stringify(ON_SCREEN),
    charts_active_template: JSON.stringify({ id: 7, name: 'Swing', scope: 'user' }),
    charts_layout_dock: JSON.stringify({ pins: [7], known: [7], hidden: false }),
  }
  global.fetch = vi.fn(async (url) => {
    if (url === '/api/artifact-versions/status') return res(200, { enabled: true })
    if (url === '/api/artifact-versions/layout/7') return res(200, { versions: [
      { version: 2, source: 'save', created_at: 1_800_000_100 },
      { version: 1, source: 'save', created_at: 1_800_000_000 },
    ] })
    if (url === '/api/artifact-versions/layout/7/restore') {
      return res(200, { appended: true, version: 3, artifact: { id: 7, name: 'Swing', scope: 'user', layout: RESTORED } })
    }
    return res(404, {})
  })
})
afterEach(() => { vi.useRealTimers(); delete global.fetch })

test('restoring the OPEN layout shows the restored board and never saves the replaced one over it', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  render(<MemoryRouter><ChartsWorkspace /></MemoryRouter>)
  await flush()
  expect(screen.getByTestId('body-watchlist')).toBeInTheDocument()

  fireEvent.contextMenu(screen.getByRole('button', { name: 'Swing' }))
  await flush()
  fireEvent.click(screen.getByTestId('layout-history-open'))
  await flush()
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Restore version 1' })) })
  await flush()

  expect(adoptRow).toHaveBeenCalledWith(expect.objectContaining({ id: 7, layout: RESTORED }))
  expect(screen.getByTestId('body-scanner')).toBeInTheDocument()
  expect(screen.queryByTestId('body-watchlist')).toBeNull()
  act(() => { vi.advanceTimersByTime(1500) })
  await flush()
  const savedBoards = saveLayout.mock.calls.map(([arg]) => arg.layout.widgets.map(w => w.id))
  expect(savedBoards.filter(ids => ids.includes('w1'))).toEqual([])
})
