// Screenshot workspace (owner 11-16): the /charts top-row button, end to end through the real
// ChartsWorkspace with the capture module mocked. Mock setup copied from ChartsWorkspace.test.jsx.
import { render, screen, act, fireEvent, waitFor } from '@testing-library/react'
import { vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

const shot = vi.hoisted(() => ({
  captureWorkspace: vi.fn(),
  copyPng: vi.fn(async () => true),
  downloadBlob: vi.fn(),
}))
vi.mock('./workspaceShot', () => shot)

// Mock the widget host + heavy children so we don't bring in real widget
// internals. WidgetHost surfaces the widget type so tests can assert which
// widgets are on the board.
const hostReady = vi.hoisted(() => new Map())
vi.mock('./WidgetHost', () => ({
  // `data-mounted` surfaces the S1 CP3 mount-cap prop for
  // test_board_mount_count_is_bounded_by_staggered_mount below; every other
  // existing test reads only `data-testid` and is unaffected by the addition.
  // `data-watchkey` surfaces a watchlist widget's opts.watchKey for the A12 CP2
  // ?openWatchlist= tests below; every other test still reads only `data-testid`.
  // `data-themeset` surfaces a themes widget's opts.themeSetId for the TERM-038 ?openThemeSet= tests.
  default: ({ widget, mounted, onPanelReady }) => { hostReady.set(widget.id, onPanelReady); return <div data-testid={`body-${widget.type}`} data-mounted={String(mounted)} data-watchkey={widget.opts?.watchKey || ''} data-themeset={widget.opts?.themeSetId || ''}>{widget.type}</div> },
}))
vi.mock('./mobile/MobileChartsApp', () => ({ default: () => <div data-testid="mobile-charts-app">MOBILE</div> }))
vi.mock('./grid/MultiChartGrid', () => ({ default: () => <div data-testid="multichart-grid">GRID</div> }))
vi.mock('./grid/MultiChartMenu', () => ({ default: () => <div data-testid="multichart-menu">MC MENU</div> }))

// Mock react-grid-layout — render children directly so we can assert
// what's in the DOM. The library's drag/resize behavior is its own
// concern; integration is verified in manual smoke.
vi.mock('react-grid-layout', () => ({
  Responsive: ({ children, onLayoutChange }) => (
    <div data-testid="rgl-responsive">
      <button data-testid="rgl-fire-change" onClick={() => onLayoutChange && onLayoutChange([{ i: 'fake', x: 0, y: 0, w: 6, h: 6 }])}>fire</button>
      {children}
    </div>
  ),
  WidthProvider: (C) => C,
}))

// Mock usePreferences — control returned prefs, capture setPref calls.
// (useMultiChartState consumes the same mock, so seeding `multichart_state`
// here drives the grid mode through the REAL hook.)
const setPref = vi.fn()
let mockPrefs = {}
// The prefs fetch is ASYNC in the real app, and that gap is where a layout can
// be overwritten by a board that has not loaded yet — so tests need to be able
// to hold the workspace in that state.
let mockPrefsLoading = false
vi.mock('../../hooks/usePreferences', () => ({
  default: () => ({ prefs: mockPrefs, setPref, loading: mockPrefsLoading }),
  // Named export used by ChartsWorkspace to read chart_settings when saving a
  // template — mirror the real parse-defensively implementation.
  parsePref: (raw, fallback) => {
    if (raw == null) return fallback
    if (typeof raw !== 'string') return raw
    try { return JSON.parse(raw) } catch { return fallback }
  },
}))

// Mock useMediaQuery — default desktop (false); individual tests override.
let mqMatches = false
vi.mock('../../hooks/useMediaQuery', () => ({
  default: () => mqMatches,
}))

// Mock useAuth — ChartsWorkspace reads user.role for the admin-only bits.
let mockUser = { id: 1, role: 'user' }
let mockAddressSpace = false   // TERM-038: the address-space flag the auth payload carries
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: mockUser, addressSpaceEnabled: mockAddressSpace }),
}))

// Mock useChartLayouts — named layout templates (prebuilt + personal). The
// "default template applies on first visit" behavior gates on isLoading.
let mockLayouts = { global: [], mine: [], isLoading: false, saveLayout: vi.fn(async () => ({})), deleteLayout: vi.fn(async () => {}) }
vi.mock('../../hooks/useChartLayouts', () => ({
  default: () => ({
    global: mockLayouts.global,
    mine: mockLayouts.mine,
    isLoading: mockLayouts.isLoading,
    saveLayout: (...args) => mockLayouts.saveLayout(...args),
    deleteLayout: (...args) => mockLayouts.deleteLayout(...args),
    refresh: () => {},
  }),
}))

import ChartsWorkspace from './ChartsWorkspace'

function renderWS() {
  return render(<MemoryRouter><ChartsWorkspace /></MemoryRouter>)
}
const BLOB = new Blob(['png'], { type: 'image/png' })

beforeEach(() => {
  setPref.mockReset()
  mockPrefs = {}
  mockPrefsLoading = false
  mqMatches = false
  mockUser = { id: 1, role: 'user' }
  mockLayouts = { global: [], mine: [], isLoading: false, saveLayout: vi.fn(async () => ({})), deleteLayout: vi.fn(async () => {}) }
  shot.captureWorkspace.mockReset()
  shot.copyPng.mockReset(); shot.copyPng.mockResolvedValue(true)
  shot.downloadBlob.mockReset()
  URL.createObjectURL = vi.fn(() => 'blob:thumb')
  URL.revokeObjectURL = vi.fn()
})

const shotBtn = () => screen.getByRole('button', { name: 'Screenshot workspace' })

test('the top row carries a "Screenshot workspace" button, left of the Merge toggle', () => {
  renderWS()
  const header = document.querySelector('header')
  const btn = shotBtn()
  expect(header.contains(btn)).toBe(true)
  expect(btn.getAttribute('title')).toBe('Screenshot workspace')
  const merge = screen.getByRole('button', { name: /merge widgets/i })
  // eslint-disable-next-line no-bitwise
  expect(btn.compareDocumentPosition(merge) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
})

test('capture targets the board <main> — not the top row, the site rail or the Layout Dock', async () => {
  shot.captureWorkspace.mockResolvedValue({ blob: BLOB, width: 3200, height: 1800, filename: 'UCT-workspace-My-board-2026-11-16-0905.png' })
  renderWS()
  await act(async () => { fireEvent.click(shotBtn()) })
  await waitFor(() => expect(shot.captureWorkspace).toHaveBeenCalledTimes(1))
  const [board, opts] = shot.captureWorkspace.mock.calls[0]
  expect(board.tagName).toBe('MAIN')
  expect(board.querySelector('header')).toBeNull()
  expect(board.contains(document.querySelector('header'))).toBe(false)
  expect(board.contains(shotBtn())).toBe(false)
  expect(board.querySelector('[data-testid="rgl-responsive"]')).toBeTruthy()
  expect(typeof opts.layoutName).toBe('string')
  expect(opts.layoutName.length).toBeGreaterThan(0)
  expect(Array.isArray(opts.excludeClasses)).toBe(true)
  // the menu: a thumbnail, the size, Copy image + Download PNG
  expect(await screen.findByAltText('Workspace screenshot preview')).toBeTruthy()
  expect(screen.getByText('3200 × 1800')).toBeTruthy()
})

test('Copy image writes the PNG; Download PNG saves it under the capture file name', async () => {
  shot.captureWorkspace.mockResolvedValue({ blob: BLOB, width: 3200, height: 1800, filename: 'UCT-workspace-My-board-2026-11-16-0905.png' })
  renderWS()
  await act(async () => { fireEvent.click(shotBtn()) })
  const copy = await screen.findByRole('menuitem', { name: /copy image/i })
  await act(async () => { fireEvent.click(copy) })
  expect(shot.copyPng).toHaveBeenCalledWith(BLOB)
  expect(await screen.findByText('Copied')).toBeTruthy()
  await act(async () => { fireEvent.click(screen.getByRole('menuitem', { name: /download png/i })) })
  expect(shot.downloadBlob).toHaveBeenCalledWith(BLOB, 'UCT-workspace-My-board-2026-11-16-0905.png')
  expect(await screen.findByText('Saved')).toBeTruthy()
})

test('a copy the browser refuses says so instead of claiming success', async () => {
  shot.captureWorkspace.mockResolvedValue({ blob: BLOB, width: 10, height: 10, filename: 'f.png' })
  shot.copyPng.mockResolvedValue(false)
  renderWS()
  await act(async () => { fireEvent.click(shotBtn()) })
  const copy = await screen.findByRole('menuitem', { name: /copy image/i })
  await act(async () => { fireEvent.click(copy) })
  expect(await screen.findByText(/use Download PNG/)).toBeTruthy()
  expect(screen.queryByText('Copied')).toBeNull()
})

test('a failed capture shows "Couldn’t capture — try again" and never throws', async () => {
  shot.captureWorkspace.mockRejectedValue(new Error('SecurityError: tainted canvas'))
  renderWS()
  await act(async () => { fireEvent.click(shotBtn()) })
  expect(await screen.findByText('Couldn’t capture — try again')).toBeTruthy()
  expect(screen.queryByRole('menuitem', { name: /copy image/i })).toBeNull()
})

test('Esc and a click outside close the menu', async () => {
  shot.captureWorkspace.mockResolvedValue({ blob: BLOB, width: 10, height: 10, filename: 'f.png' })
  renderWS()
  await act(async () => { fireEvent.click(shotBtn()) })
  await screen.findByTestId('workspace-shot-menu')
  act(() => { fireEvent.keyDown(document, { key: 'Escape' }) })
  expect(screen.queryByTestId('workspace-shot-menu')).toBeNull()
  await act(async () => { fireEvent.click(shotBtn()) })
  await screen.findByTestId('workspace-shot-menu')
  act(() => { fireEvent.pointerDown(document.querySelector('main')) })
  expect(screen.queryByTestId('workspace-shot-menu')).toBeNull()
})

test('the phone shell has no screenshot button (desktop only)', () => {
  mqMatches = true
  renderWS()
  expect(screen.queryByRole('button', { name: 'Screenshot workspace' })).toBeNull()
})
