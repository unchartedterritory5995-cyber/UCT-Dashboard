// phoneSheet.test.jsx — Screener Focus on phones (spec 2026-10-16 s3): list first, a tap opens
// the chart full screen, the header steps stocks, Back returns to the same row. The phone vs
// tablet decision is made at TAP time from window.matchMedia, so the mock below answers by a
// width the test can change, and can fire a `change` (a phone rotated to landscape).
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SWRConfig } from 'swr'
import { vi, beforeEach, afterEach, expect, test } from 'vitest'
vi.mock('../../../../components/StockChart', () => ({ default: p => <div data-testid="stockchart" data-sym={p.sym} /> }))
vi.mock('../../shell/ScannerShell', () => ({ default: () => <div data-testid="table-mode" /> }))
vi.mock('../../../../hooks/useRealtimePrices', () => ({ default: () => ({ prices: {} }) }))
vi.mock('../../../../hooks/useNeighborWarm', () => ({ useNeighborWarm: () => {} }))
vi.mock('../../../../utils/prefetchBars', () => ({ prefetchBars: () => {}, prefetchBarsToIDB: () => {}, warmMemFromIDB: () => {} }))
import FocusScreener from '../FocusScreener'
import ScreenMenu from '../ScreenMenu'
import { SWIPE_MIN_PX } from '../PhoneChartSheet'

const META = { filters: [{ key: 'rs_rank', label: 'RS Rank', category: 'technical', type: 'range', presets: [{ label: 'Any' }] }],
  categories: [{ key: 'technical', label: 'Technical' }], views: [{ key: 'overview', columns: ['ticker', 'price'] }] }
const row = (ticker, price) => ({ ticker, price, chg_pct_1d: 0.5, base_render: 'Flat Base', vol_ratio: 1, rs_rank: 90 })
const ROWS = [row('MU', 10), row('ECO', 20), row('NVDA', 30)]
let pages = { 1: ROWS }
let total = 3
function route(url, opts) {
  if (url.startsWith('/api/screener/meta')) return { ok: true, json: async () => META }
  if (url === '/api/screener/scan') {
    const page = JSON.parse(opts.body).page || 1
    return { ok: true, json: async () => ({ rows: pages[page] || [], total, page, snapshot_date: '2026-10-15' }) }
  }
  if (url === '/api/screener/count') return { ok: true, json: async () => ({ count: total }) }
  if (url.startsWith('/api/screener/saved-screens')) return { ok: true, json: async () => ({ saved: [], starters: [] }) }
  if (url.startsWith('/api/screener/to-watchlist') || url.startsWith('/api/screener/save-fork') || url.startsWith('/api/exports/quota')) {
    return { ok: false, status: 404, json: async () => ({ detail: 'Not Found' }) }
  }
  return { ok: true, json: async () => ([]) }
}

// matchMedia by width. Pointer and hover queries answer false, so the joystick hub stays out.
const realMatchMedia = window.matchMedia
let width = 390
let listeners = []
function installMatchMedia() {
  const answer = query => {
    if (/pointer|hover/.test(query)) return false
    const max = /max-width:\s*(\d+)px/.exec(query)
    const min = /min-width:\s*(\d+)px/.exec(query)
    return (!max || width <= Number(max[1])) && (!min || width >= Number(min[1]))
  }
  window.matchMedia = query => {
    const mql = {
      media: query,
      get matches() { return answer(query) },
      addEventListener: (t, fn) => { if (t === 'change') listeners.push({ query, fn }) },
      removeEventListener: (t, fn) => { listeners = listeners.filter(l => l.fn !== fn) },
      addListener: fn => listeners.push({ query, fn }),
      removeListener: fn => { listeners = listeners.filter(l => l.fn !== fn) },
    }
    return mql
  }
}
function resizeTo(px) {
  width = px
  act(() => { for (const l of [...listeners]) l.fn({ matches: window.matchMedia(l.query).matches, media: l.query }) })
}

beforeEach(() => {
  pages = { 1: ROWS }
  total = 3
  width = 390
  listeners = []
  installMatchMedia()
  localStorage.clear()
  window.history.replaceState(null, '', '/')
  globalThis.fetch = vi.fn(async (u, o) => route(String(u), o))
})
afterEach(() => { window.matchMedia = realMatchMedia })

const mount = () => render(<MemoryRouter><SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}><FocusScreener /></SWRConfig></MemoryRouter>)
const ready = async () => { await waitFor(() => screen.getByTestId('focus-row-NVDA')) }
const sheet = () => screen.queryByRole('dialog', { name: /^(MU|ECO|NVDA)$/ })
const sheetPane = () => within(sheet()).getByTestId('focus-chart-pane')
const swipe = (el, dy, dx = 0) => {
  fireEvent.pointerDown(el, { pointerId: 1, clientX: 100, clientY: 300 })
  fireEvent.pointerMove(el, { pointerId: 1, clientX: 100 + dx, clientY: 300 + dy })
  fireEvent.pointerUp(el, { pointerId: 1, clientX: 100 + dx, clientY: 300 + dy })
}

test('1. tapping row 2 opens a full-screen dialog named for that stock, with its chart pane', async () => {
  mount(); await ready()
  expect(sheet()).toBeNull()
  fireEvent.click(screen.getByTestId('focus-row-ECO'))
  const d = screen.getByRole('dialog', { name: 'ECO' })
  expect(within(d).getByTestId('focus-chart-pane')).toHaveAttribute('aria-label', 'ECO chart')
  expect(within(d).getByTestId('stockchart')).toHaveAttribute('data-sym', 'ECO')
  // ONE chart while the sheet is open: the inline pane does not also run one.
  expect(screen.getAllByTestId('stockchart')).toHaveLength(1)
  expect(screen.getAllByTestId('focus-chart-pane')).toHaveLength(1)
})

test('2. Next stock steps to row 3 (pane and list), Previous stock steps back', async () => {
  mount(); await ready()
  fireEvent.click(screen.getByTestId('focus-row-ECO'))
  fireEvent.click(within(sheet()).getByRole('button', { name: 'Next stock' }))
  expect(sheetPane()).toHaveAttribute('aria-label', 'NVDA chart')
  expect(screen.getByRole('dialog', { name: 'NVDA' })).toBeInTheDocument()
  expect(screen.getByTestId('focus-row-NVDA')).toHaveAttribute('aria-selected', 'true')
  fireEvent.click(within(sheet()).getByRole('button', { name: 'Previous stock' }))
  expect(sheetPane()).toHaveAttribute('aria-label', 'ECO chart')
  expect(screen.getByTestId('focus-row-ECO')).toHaveAttribute('aria-selected', 'true')
})

test('2b. Previous stock is disabled on the first row', async () => {
  mount(); await ready()
  fireEvent.click(screen.getByTestId('focus-row-MU'))
  expect(within(sheet()).getByRole('button', { name: 'Previous stock' })).toBeDisabled()
  expect(within(sheet()).getByRole('button', { name: 'Next stock' })).not.toBeDisabled()
})

test('3. a swipe up on the header strip steps next; the same gesture on the chart body does not', async () => {
  mount(); await ready()
  fireEvent.click(screen.getByTestId('focus-row-ECO'))
  // the chart body (a price-axis drag) never steps
  swipe(sheetPane(), -80)
  swipe(within(sheet()).getByTestId('stockchart'), -80)
  expect(sheetPane()).toHaveAttribute('aria-label', 'ECO chart')
  // a short or sideways drag on the strip does not step either
  const strip = within(sheet()).getByTestId('phone-sheet-strip')
  swipe(strip, -(SWIPE_MIN_PX - 5))
  swipe(strip, -80, 60)
  expect(sheetPane()).toHaveAttribute('aria-label', 'ECO chart')
  // a deliberate swipe up on the strip: next
  swipe(strip, -80)
  expect(sheetPane()).toHaveAttribute('aria-label', 'NVDA chart')
  // and a swipe down: previous
  swipe(strip, 80)
  expect(sheetPane()).toHaveAttribute('aria-label', 'ECO chart')
})

test('3b. pressing a strip button never captures the pointer (a captured click goes to the strip, not the button)', async () => {
  // Production 2026-10-17, 390 px: a touch tap on Next stepped but a mouse click did nothing,
  // because the strip captured the pointer on press and Chromium retargets the captured click.
  // jsdom does not retarget, so the guard is asserted directly: a press, and a press with
  // movement inside the drag slop, must not capture; a real drag must.
  const spy = vi.fn()
  const orig = HTMLElement.prototype.setPointerCapture
  HTMLElement.prototype.setPointerCapture = spy
  try {
    mount(); await ready()
    fireEvent.click(screen.getByTestId('focus-row-ECO'))
    const strip = within(sheet()).getByTestId('phone-sheet-strip')
    const next = within(sheet()).getByRole('button', { name: 'Next stock' })
    fireEvent.pointerDown(next, { pointerId: 7, clientX: 300, clientY: 40 })
    fireEvent.pointerMove(next, { pointerId: 7, clientX: 301, clientY: 44 })
    fireEvent.pointerUp(next, { pointerId: 7, clientX: 301, clientY: 44 })
    expect(spy).not.toHaveBeenCalled()
    fireEvent.click(next)
    expect(sheetPane()).toHaveAttribute('aria-label', 'NVDA chart')
    fireEvent.pointerDown(strip, { pointerId: 8, clientX: 200, clientY: 200 })
    fireEvent.pointerMove(strip, { pointerId: 8, clientX: 200, clientY: 170 })
    expect(spy).toHaveBeenCalledWith(8)
    fireEvent.pointerCancel(strip, { pointerId: 8 })
  } finally {
    HTMLElement.prototype.setPointerCapture = orig
  }
})

test('4. Back to list closes the sheet; row 3 is still selected and the list has focus', async () => {
  mount(); await ready()
  fireEvent.click(screen.getByTestId('focus-row-ECO'))
  fireEvent.click(within(sheet()).getByRole('button', { name: 'Next stock' }))
  fireEvent.click(within(sheet()).getByRole('button', { name: 'Back to list' }))
  expect(sheet()).toBeNull()
  expect(screen.getByTestId('focus-row-NVDA')).toHaveAttribute('aria-selected', 'true')
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('listbox', { name: 'Screen results' })))
})

test('5. at the last loaded row with more to load, Next loads more, stays open and steps onto it', async () => {
  pages = { 1: ROWS.slice(0, 2), 2: [ROWS[2]] }
  total = 3
  mount()
  await waitFor(() => screen.getByTestId('focus-row-ECO'))
  fireEvent.click(screen.getByTestId('focus-row-ECO'))
  const next = within(sheet()).getByRole('button', { name: 'Next stock' })
  expect(next).not.toBeDisabled()
  fireEvent.click(next)
  await waitFor(() => expect(fetch.mock.calls.some(([u, o]) => String(u) === '/api/screener/scan' && JSON.parse(o.body).page === 2)).toBe(true))
  expect(sheet()).not.toBeNull()
  await waitFor(() => expect(sheetPane()).toHaveAttribute('aria-label', 'NVDA chart'))
})

test('5b. at the last row with nothing more to load, Next stock is disabled and does not close', async () => {
  mount(); await ready()
  fireEvent.click(screen.getByTestId('focus-row-NVDA'))
  const next = within(sheet()).getByRole('button', { name: 'Next stock' })
  expect(next).toBeDisabled()
  fireEvent.click(next)
  expect(sheetPane()).toHaveAttribute('aria-label', 'NVDA chart')
})

test('6. Escape closes the sheet', async () => {
  mount(); await ready()
  fireEvent.click(screen.getByTestId('focus-row-ECO'))
  expect(sheet()).not.toBeNull()
  fireEvent.keyDown(document.activeElement || document.body, { key: 'Escape' })
  expect(sheet()).toBeNull()
  expect(screen.getByTestId('focus-row-ECO')).toHaveAttribute('aria-selected', 'true')
})

test('6b. the browser Back closes the sheet and stays on the screener', async () => {
  // A bubble-phase popstate listener registered first (as the router's and useScreenSpec's are):
  // the Back that only closes the sheet must not reach it, or the screen is re-read and paging resets.
  const other = vi.fn()
  window.addEventListener('popstate', other)
  mount(); await ready()
  fireEvent.click(screen.getByTestId('focus-row-ECO'))
  expect(sheet()).not.toBeNull()
  act(() => { window.dispatchEvent(new PopStateEvent('popstate', { state: null })) })
  window.removeEventListener('popstate', other)
  expect(other).not.toHaveBeenCalled()
  expect(sheet()).toBeNull()
  expect(screen.getByTestId('focus-screener')).toBeInTheDocument()
  expect(screen.getByTestId('focus-row-ECO')).toHaveAttribute('aria-selected', 'true')
})

test('7. tablet (matchMedia not matching): a tap selects in place and opens no dialog', async () => {
  width = 820
  mount(); await ready()
  fireEvent.click(screen.getByTestId('focus-row-ECO'))
  expect(sheet()).toBeNull()
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(screen.getByTestId('focus-row-ECO')).toHaveAttribute('aria-selected', 'true')
  expect(screen.getByTestId('focus-chart-pane')).toHaveAttribute('aria-label', 'ECO chart')
})

test('8. rotating to landscape (a change to non-matching) closes the sheet; the selection is unchanged', async () => {
  mount(); await ready()
  fireEvent.click(screen.getByTestId('focus-row-ECO'))
  fireEvent.click(within(sheet()).getByRole('button', { name: 'Next stock' }))
  expect(sheet()).not.toBeNull()
  resizeTo(900)
  expect(sheet()).toBeNull()
  expect(screen.getByTestId('focus-row-NVDA')).toHaveAttribute('aria-selected', 'true')
  // the side pane shows the same stock
  expect(screen.getByTestId('focus-chart-pane')).toHaveAttribute('aria-label', 'NVDA chart')
})

// ── the screen picker on a phone ─────────────────────────────────────────────
const STARTERS = [{ id: 's1', name: 'Leaders', description: 'Top RS', spec: { filters: [] } }]
const menu = (props = {}) => render(<SWRConfig value={{ provider: () => new Map() }}>
  <ScreenMenu currentName="Leaders" starters={STARTERS} onApply={() => {}} onTogglePin={() => {}} onNewScreen={() => {}} {...props} /></SWRConfig>)

test('9. on a phone the screen picker opens as a bottom sheet with its name and search box', async () => {
  const onApply = vi.fn()
  menu({ onApply })
  fireEvent.click(screen.getByRole('button', { name: /Change screen/ }))
  const d = screen.getByRole('dialog', { name: 'Screens' })
  expect(d.closest('[data-sheet-panel]')).toBe(d)
  expect(within(d).getByRole('searchbox', { name: 'Search screens' })).toBeInTheDocument()
  // a tap inside the portalled sheet is not an "outside" tap: the sheet stays open
  fireEvent.pointerDown(within(d).getByRole('searchbox', { name: 'Search screens' }))
  expect(screen.getByRole('dialog', { name: 'Screens' })).toBeInTheDocument()
  fireEvent.click(within(d).getByRole('button', { name: 'Open Leaders' }))
  expect(onApply).toHaveBeenCalled()
  expect(screen.queryByRole('dialog', { name: 'Screens' })).toBeNull()
})

test('9b. on a tablet the screen picker stays the anchored popover', async () => {
  width = 820
  menu()
  fireEvent.click(screen.getByRole('button', { name: /Change screen/ }))
  const d = screen.getByRole('dialog', { name: 'Screens' })
  expect(d.hasAttribute('data-sheet-panel')).toBe(false)
})
