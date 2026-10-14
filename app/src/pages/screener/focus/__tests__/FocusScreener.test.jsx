// FocusScreener.test.jsx — the orchestrator, integrated with the network mocked at fetch.
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SWRConfig } from 'swr'
import { vi, beforeEach, expect, test } from 'vitest'
vi.mock('../../../../components/StockChart', () => ({ default: p => <div data-testid="stockchart" data-sym={p.sym} /> }))
vi.mock('../../shell/ScannerShell', () => ({ default: () => <div data-testid="table-mode" /> }))
vi.mock('../../../../hooks/useRealtimePrices', () => ({ default: () => ({ prices: {} }) }))
vi.mock('../../../../hooks/useNeighborWarm', () => ({ useNeighborWarm: () => {} }))
vi.mock('../../../../utils/prefetchBars', () => ({ prefetchBars: () => {} }))
import FocusScreener from '../FocusScreener'
import { SPEC_PARAM, encodeSpec } from '../../shell/specUrl'
import { AuthContext } from '../../../../context/AuthContext'

const META = { filters: [{ key: 'rs_rank', label: 'RS Rank', category: 'technical', type: 'range', presets: [{ label: 'Any' }] }],
  categories: [{ key: 'technical', label: 'Technical' }], views: [{ key: 'overview', columns: ['ticker', 'price'] }] }
const rowsA = [{ ticker: 'MU', price: 956.12, chg_pct_1d: -3.7, base_render: 'Flat Base', vol_ratio: 0.8, rs_rank: 94 },
  { ticker: 'ECO', price: 99.48, chg_pct_1d: 0.9, base_render: 'Gap-up', vol_ratio: 1, rs_rank: 97 }]
const LISTS = [{ id: 'wl-1', name: 'Core', is_flagged_list: 0, is_prebuilt: 0 }, { id: 'wl-2', name: 'Swing', is_flagged_list: 0, is_prebuilt: 0 }]
let scanRows = rowsA
let extra = () => null
function route(url, opts) {
  const hit = extra(url, opts)
  if (hit) return hit
  if (url.startsWith('/api/screener/meta')) return { ok: true, json: async () => META }
  if (url === '/api/screener/scan') return { ok: true, json: async () => ({ rows: scanRows, total: scanRows.length, page: 1, snapshot_date: '2026-10-12' }) }
  if (url === '/api/screener/count') return { ok: true, json: async () => ({ count: scanRows.length }) }
  if (url.startsWith('/api/screener/saved-screens')) return { ok: true, json: async () => ({ saved: [], starters: [] }) }
  if (url.startsWith('/api/screener/to-watchlist') || url.startsWith('/api/screener/save-fork') || url.startsWith('/api/exports/quota')) {
    return { ok: false, status: 404, json: async () => ({ detail: 'Not Found' }) }
  }
  return { ok: true, json: async () => ([]) }
}
beforeEach(() => {
  scanRows = rowsA
  extra = () => null
  localStorage.clear()
  window.history.replaceState(null, '', '/')
  globalThis.fetch = vi.fn(async (u, o) => route(String(u), o))
})
const mount = () => render(<MemoryRouter><SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}><FocusScreener /></SWRConfig></MemoryRouter>)
const scanBodies = () => fetch.mock.calls.filter(([u]) => String(u) === '/api/screener/scan').map(([, o]) => JSON.parse(o.body))

test('list shows up and the first stock is charted', async () => {
  mount()
  await waitFor(() => expect(screen.getByTestId('focus-row-MU')).toBeInTheDocument())
  expect(screen.getByTestId('stockchart')).toHaveAttribute('data-sym', 'MU')
})
test('arrow down charts the next stock', async () => {
  mount()
  await waitFor(() => screen.getByTestId('focus-row-MU'))
  fireEvent.keyDown(screen.getByRole('listbox'), { key: 'ArrowDown' })
  expect(screen.getByTestId('stockchart')).toHaveAttribute('data-sym', 'ECO')
})
test('clicking a row charts it', async () => {
  mount()
  await waitFor(() => screen.getByTestId('focus-row-ECO'))
  fireEvent.click(screen.getByTestId('focus-row-ECO'))
  expect(screen.getByTestId('stockchart')).toHaveAttribute('data-sym', 'ECO')
})
test('table toggle swaps to the old table, and back', async () => {
  mount()
  await waitFor(() => screen.getByTestId('focus-row-MU'))
  fireEvent.click(screen.getByRole('button', { name: 'Table' }))
  expect(screen.getByTestId('table-mode')).toBeInTheDocument()
  expect(screen.queryByRole('listbox')).toBeNull()
  expect(localStorage.getItem('uct.screener.layout')).toBe('table')
  fireEvent.click(screen.getByRole('button', { name: 'List' }))
  await waitFor(() => screen.getByTestId('focus-row-MU'))
  expect(screen.queryByTestId('table-mode')).toBeNull()
})
test('a scan failure shows the error state with retry, and the list is unmounted', async () => {
  globalThis.fetch = vi.fn(async (u, o) => (String(u) === '/api/screener/scan' ? { ok: false, status: 504, json: async () => ({}) } : route(String(u), o)))
  mount()
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent("The screen didn't load"))
  expect(screen.queryByRole('listbox')).toBeNull()
  expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
})
test('try again re-runs the scan and brings the list back', async () => {
  let fail = true
  globalThis.fetch = vi.fn(async (u, o) => (String(u) === '/api/screener/scan' && fail ? { ok: false, status: 504, json: async () => ({}) } : route(String(u), o)))
  mount()
  await waitFor(() => screen.getByRole('alert'))
  fail = false
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
  await waitFor(() => screen.getByTestId('focus-row-MU'))
})
test('selection resets when the result set changes', async () => {
  mount()
  await waitFor(() => screen.getByTestId('focus-row-MU'))
  fireEvent.keyDown(screen.getByRole('listbox'), { key: 'ArrowDown' })
  expect(screen.getByTestId('stockchart')).toHaveAttribute('data-sym', 'ECO')
  // The new screen still contains ECO, but further down: a reset goes to row 0, it does not follow the ticker.
  scanRows = [{ ticker: 'ZZZ', price: 1, chg_pct_1d: 0, base_render: 'Flat Base', vol_ratio: 1 }, rowsA[1]]
  fireEvent.click(screen.getByRole('button', { name: /Filters/ }))
  fireEvent.click(screen.getByRole('button', { name: /Universe: All stocks/ }))
  fireEvent.click(screen.getByRole('menuitem', { name: 'UCT Universe' }))
  await waitFor(() => expect(screen.getByTestId('stockchart')).toHaveAttribute('data-sym', 'ZZZ'))
})
test('clear all in the drawer clears the logic tree too', async () => {
  const enc = encodeSpec({ filters: { rs_rank: { op: 'gte', min: 80 } }, logic: { any: [{ key: 'rs_rank', op: 'gte', min: 90 }] } })
  window.history.replaceState(null, '', `/?${SPEC_PARAM}=${enc}`)
  mount()
  await waitFor(() => screen.getByTestId('focus-row-MU'))
  expect(scanBodies().at(-1).logic).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: /Filters/ }))
  const drawer = screen.getByRole('dialog', { name: 'Filters' })
  expect(within(drawer).getByText('Custom criteria')).toBeInTheDocument()
  fireEvent.click(within(drawer).getAllByRole('button', { name: 'Clear all' })[0])
  expect(within(drawer).queryByText('Custom criteria')).toBeNull()
  await waitFor(() => {
    const last = scanBodies().at(-1)
    expect(last.logic).toBeUndefined()
    expect(last.filters).toEqual([])
  })
})
test('the save menu omits an outcome whose door is dark', async () => {
  mount()
  await waitFor(() => screen.getByTestId('focus-row-MU'))
  await waitFor(() => expect(fetch.mock.calls.some(([u]) => String(u) === '/api/screener/save-fork')).toBe(true))
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  const menu = screen.getByRole('menu', { name: 'Save' })
  expect(within(menu).getByRole('menuitem', { name: /Save as a screen/ })).toBeInTheDocument()
  expect(within(menu).getByRole('menuitem', { name: /Add to Notebook/ })).toBeInTheDocument()
  expect(within(menu).queryByRole('menuitem', { name: /Save today/ })).toBeNull()
  expect(within(menu).queryByRole('menuitem', { name: /Alert me/ })).toBeNull()
})
test('the save menu offers an outcome once the server says its door is open', async () => {
  extra = url => {
    if (url === '/api/screener/to-watchlist') return { ok: true, json: async () => ({ available: true, max_symbols: 500 }) }
    if (url === '/api/screener/save-fork') {
      return { ok: true, json: async () => ({ choices: [{ id: 'frozen_list', available: true }, { id: 'definition', available: true }, { id: 'standing_alert', available: false, reason: 'off' }] }) }
    }
    return null
  }
  mount()
  await waitFor(() => screen.getByTestId('focus-row-MU'))
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(within(screen.getByRole('menu', { name: 'Save' })).getByRole('menuitem', { name: /Save today/ })).toBeInTheDocument())
  // standing_alert is offered but not available: still omitted, never shown-then-failing.
  expect(within(screen.getByRole('menu', { name: 'Save' })).queryByRole('menuitem', { name: /Alert me/ })).toBeNull()
})
test('W adds the selected stock to the watchlist, and the toast offers Change list', async () => {
  const posts = []
  extra = (url, opts) => {
    if (url === '/api/watchlists?include_prebuilt=0') return { ok: true, json: async () => LISTS }
    if (/^\/api\/watchlists\/[^/]+\/items$/.test(url) && opts?.method === 'POST') { posts.push(url); return { ok: true, json: async () => ({}) } }
    return null
  }
  mount()
  await waitFor(() => screen.getByTestId('focus-row-MU'))
  await waitFor(() => expect(fetch.mock.calls.some(([u]) => String(u) === '/api/watchlists?include_prebuilt=0')).toBe(true))
  // let the watchlist read land before pressing W
  await new Promise(r => setTimeout(r, 0))
  fireEvent.keyDown(screen.getByRole('listbox'), { key: 'w' })
  const toast = await screen.findByTestId('focus-toast')
  await waitFor(() => expect(toast).toHaveTextContent('Added MU to Core'))
  expect(posts).toEqual(['/api/watchlists/wl-1/items'])
  fireEvent.click(within(toast).getByRole('button', { name: 'Change list' }))
  fireEvent.click(screen.getByRole('menuitem', { name: 'Swing' }))
  await waitFor(() => expect(screen.getByTestId('focus-toast')).toHaveTextContent('W now adds to Swing'))
  expect(localStorage.getItem('uct.screener.watchlistTarget')).toBe('wl-2')
})
test('the skip link targets the Save menu', async () => {
  mount()
  await waitFor(() => screen.getByTestId('focus-row-MU'))
  fireEvent.click(screen.getByRole('link', { name: 'Skip to save results' }))
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Save' }))
})
test('an emptying change offers to undo it', async () => {
  mount()
  await waitFor(() => screen.getByTestId('focus-row-MU'))
  scanRows = []
  fireEvent.click(screen.getByRole('button', { name: /Filters/ }))
  fireEvent.click(screen.getByRole('button', { name: /Universe: All stocks/ }))
  fireEvent.click(screen.getByRole('menuitem', { name: 'UCT Universe' }))
  fireEvent.click(screen.getByRole('button', { name: 'Close filters' }))
  await waitFor(() => expect(screen.getByText(/took the list from 2 to 0/)).toBeInTheDocument())
  scanRows = rowsA
  fireEvent.click(screen.getByRole('button', { name: 'Undo that change' }))
  await waitFor(() => screen.getByTestId('focus-row-MU'))
  expect(scanBodies().at(-1).filters).toEqual([])
})
test('the ? menu offers the how-to only when the checklist is on, and opens it in a sheet', async () => {
  const { unmount } = mount()
  await waitFor(() => screen.getByTestId('focus-row-MU'))
  fireEvent.click(screen.getByRole('button', { name: 'Help' }))
  expect(screen.queryByRole('menuitem', { name: 'How to use this screen' })).toBeNull()
  unmount()
  render(<MemoryRouter><AuthContext.Provider value={{ howToChecklistsEnabled: true }}>
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}><FocusScreener /></SWRConfig>
  </AuthContext.Provider></MemoryRouter>)
  await waitFor(() => screen.getByTestId('focus-row-MU'))
  fireEvent.click(screen.getByRole('button', { name: 'Help' }))
  fireEvent.click(screen.getByRole('menuitem', { name: 'How to use this screen' }))
  const sheet = await screen.findByRole('dialog', { name: 'How to use this screen' })
  expect(within(sheet).getAllByRole('listitem').length).toBeGreaterThan(0)
})
