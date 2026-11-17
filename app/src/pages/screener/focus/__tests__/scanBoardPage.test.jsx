// The Screener as a scan board (owner direction 2026-11-17), on the whole page: who gets it
// (SCREENER_SCAN_BOARD_ENABLED, on a desktop), what the page then is, and that a member's layout
// is read from and written to their preferences. Without the flag the page is today's (rsInert).
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SWRConfig } from 'swr'
import { vi, afterEach, beforeEach, expect, test } from 'vitest'
vi.mock('../../../../components/StockChart', () => ({ default: p => <div data-testid="stockchart" data-sym={p.sym} /> }))
vi.mock('../ScreenerChartWidget', () => ({ default: p => <div data-testid="chart-widget" data-sym={p.sym} data-news={p.newsMode} /> }))
vi.mock('../../shell/ScannerShell', () => ({ default: p => <div data-testid="table-mode">{p.toolbarLead}</div> }))
vi.mock('../../../../hooks/useRealtimePrices', () => ({ default: () => ({ prices: {} }) }))
vi.mock('../../../../hooks/useNeighborWarm', () => ({ useNeighborWarm: () => {} }))
vi.mock('../../../../utils/prefetchBars', () => ({ prefetchBars: () => {}, prefetchBarsToIDB: () => {}, warmMemFromIDB: () => {}, prewarmVisibleList: () => {} }))
vi.mock('../useLazyCounts', () => ({ default: () => ({}), __resetCountCache: () => {} }))
vi.mock('../useSparks', () => ({ default: () => new Map() }))
// The grid measures its host; jsdom lays nothing out, so the drop rule's module is never needed here.
vi.mock('../../../charts/ChartsWorkspace', () => ({ repackAroundMoved: ws => ws }))
import FocusScreener from '../FocusScreener'
import { AuthContext } from '../../../../context/AuthContext'

import { MQ } from '../../../../styles/breakpoints'
import { BOARD_PREF, PRESETS, sanitize, serialize, pickLayout } from '../board/boardModel'
import { PLAIN_STARTERS } from './rsScreensFixture'

const META = { filters: [{ key: 'rs_rank', label: 'RS Rank', category: 'technical', type: 'range', presets: [{ label: 'Any' }] }],
  categories: [{ key: 'technical', label: 'Technical' }], views: [{ key: 'overview', columns: ['ticker', 'price'] }] }
const ROWS = [
  { ticker: 'MU', company: 'Micron', price: 956.12, chg_pct_1d: -3.7, base_render: 'Flat Base', vol_ratio: 0.8, rs_rank: 94, industry: 'Semiconductors', sector: 'Technology' },
  { ticker: 'ECO', company: 'Okeanis', price: 99.48, chg_pct_1d: 0.9, base_render: 'Gap-up', vol_ratio: 1, rs_rank: 97, industry: 'Shipping', sector: 'Industrials' },
]
let stored
let wide
let heightSpy
const prefWrites = () => fetch.mock.calls.filter(([u, o]) => String(u).startsWith('/api/auth/preferences') && o?.method === 'POST').map(([, o]) => JSON.parse(o.body))

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  window.history.replaceState(null, '', '/')

  stored = {}
  wide = true
  window.matchMedia = q => ({ matches: q === MQ.desktop ? wide : false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })
  heightSpy = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(640)
  globalThis.fetch = vi.fn(async (u, o) => {
    const url = String(u)
    if (url.startsWith('/api/screener/meta')) return { ok: true, json: async () => META }
    if (url === '/api/screener/scan') return { ok: true, json: async () => ({ rows: ROWS, total: ROWS.length, page: JSON.parse(o.body).page || 1 }) }
    if (url === '/api/screener/count') return { ok: true, json: async () => ({ count: ROWS.length }) }
    if (url.startsWith('/api/screener/saved-screens')) return { ok: true, json: async () => ({ saved: [], starters: PLAIN_STARTERS }) }
    if (url.startsWith('/api/auth/preferences')) return { ok: true, json: async () => (o?.method === 'POST' ? { ok: true } : stored) }
    if (url.startsWith('/api/screener/to-watchlist') || url.startsWith('/api/screener/save-fork') || url.startsWith('/api/exports/quota')) {
      return { ok: false, status: 404, json: async () => ({ detail: 'Not Found' }) }
    }
    return { ok: true, json: async () => ([]) }
  })
})
afterEach(() => { heightSpy.mockRestore(); delete window.matchMedia })

const draw = (flag = true, more = {}) => render(
  <MemoryRouter><SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
    <AuthContext.Provider value={{ screenerScanBoardEnabled: flag, ...more }}><FocusScreener /></AuthContext.Provider>
  </SWRConfig></MemoryRouter>)
const page = () => screen.getByTestId('focus-screener')
const widgetsOnBoard = () => [...document.querySelectorAll('[data-testid="scan-board"] [data-widget]')].map(el => el.getAttribute('data-widget'))

test('with the flag, on a desktop: the page is the board on its first preset', async () => {
  draw()
  await waitFor(() => expect(screen.getByTestId('focus-row-MU')).toBeInTheDocument())
  expect(page()).toHaveAttribute('data-board', '')
  await waitFor(() => expect(widgetsOnBoard()).toEqual(PRESETS[0].widgets.map(w => w.type)))
  // the Results widget: a titled card with one-line rows
  const results = document.querySelector('[data-widget="results"]')
  expect(results.querySelector('[data-board-rows]')).toHaveAttribute('data-board-rows', 'line')
  expect(results).toHaveTextContent('Power plays2 stocks')
  // the chart is bare (the details widget carries the rest) and hands News to that widget's tab
  expect(screen.getByTestId('focus-chart-pane')).toHaveAttribute('data-chrome', 'bare')
  expect(screen.getByTestId('chart-widget')).toHaveAttribute('data-news', 'portal')
  expect(within(screen.getByTestId('board-details')).getAllByRole('tab').map(t => t.textContent)).toEqual(["Why it's here", 'News'])
  // pinned screens are tabs, the open one selected; the picker reads "All screens"
  const tabs = within(screen.getByRole('tablist', { name: 'Pinned screens' })).getAllByRole('tab')
  expect(tabs.find(t => t.getAttribute('aria-selected') === 'true')).toHaveTextContent('Power plays')
  expect(screen.getByRole('button', { name: /Change screen/ })).toHaveTextContent('All screens')
})

test('owner ruling: the view switch offers List and Charts; Table and Map open from the More menu', async () => {
  draw()
  await waitFor(() => expect(screen.getByTestId('focus-row-MU')).toBeInTheDocument())
  expect(within(screen.getByRole('group', { name: 'View' })).getAllByRole('button').map(b => b.textContent)).toEqual(['List', 'Charts'])
  fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
  expect(within(screen.getByRole('menu', { name: 'More actions' })).getAllByRole('menuitem').slice(0, 2).map(i => i.textContent)).toEqual(['Table view', 'Map view'])
})

test('without the flag, and with it on a phone or a tablet, the page is not the board', async () => {
  const first = draw(false)
  await waitFor(() => expect(screen.getByTestId('focus-row-MU')).toBeInTheDocument())
  expect(page()).not.toHaveAttribute('data-board')
  expect(screen.queryByRole('button', { name: 'Layout' })).toBeNull()
  expect(screen.queryByTestId('scan-board')).toBeNull()
  expect(within(screen.getByRole('group', { name: 'View' })).getAllByRole('button').map(b => b.textContent)).toEqual(['List', 'Charts', 'Map', 'Table'])
  expect(prefWrites().some(w => JSON.stringify(w).includes(BOARD_PREF))).toBe(false)
  first.unmount()
  wide = false
  draw(true)
  await waitFor(() => expect(screen.getByTestId('focus-row-MU')).toBeInTheDocument())
  expect(page()).not.toHaveAttribute('data-board')
  expect(screen.queryByRole('button', { name: 'Layout' })).toBeNull()
})

test('a member\'s stored layout is what the board opens on', async () => {
  stored = { [BOARD_PREF]: serialize({ ...pickLayout(sanitize(null), 'three'), spark: true }) }
  draw()
  await waitFor(() => expect(screen.getByTestId('focus-row-MU')).toBeInTheDocument())
  await waitFor(() => expect(widgetsOnBoard()).toEqual(['screens', 'results', 'chart', 'news']))
  expect(screen.getByRole('navigation', { name: 'Screens' })).toBeInTheDocument()
  // this layout has a News widget of its own and no details widget: the chart keeps its strip
  expect(screen.getByTestId('focus-chart-pane')).toHaveAttribute('data-chrome', 'slim')
  expect(screen.queryByTestId('board-details')).toBeNull()
})

test('picking a preset changes the board and writes the layout to the preferences; Customize is never stored', async () => {
  draw()
  await waitFor(() => expect(screen.getByTestId('focus-row-MU')).toBeInTheDocument())
  await waitFor(() => expect(widgetsOnBoard()).toHaveLength(3))
  expect(prefWrites().some(w => JSON.stringify(w).includes(BOARD_PREF))).toBe(false) // drawing the default writes nothing
  fireEvent.click(screen.getByRole('button', { name: 'Layout' }))
  fireEvent.click(within(screen.getByRole('menu', { name: 'Layout' })).getByRole('menuitem', { name: 'Three columns' }))
  await waitFor(() => expect(widgetsOnBoard()).toEqual(['screens', 'results', 'chart', 'news']))
  fireEvent.click(screen.getByRole('button', { name: 'Layout' }))
  fireEvent.click(within(screen.getByRole('menu', { name: 'Layout' })).getByRole('menuitem', { name: 'Customize layout' }))
  expect(await screen.findByRole('region', { name: 'Customize layout' })).toBeInTheDocument()
  await waitFor(() => expect(prefWrites().some(w => JSON.stringify(w).includes(BOARD_PREF))).toBe(true), { timeout: 4000 })
  const text = JSON.stringify(prefWrites().filter(w => JSON.stringify(w).includes(BOARD_PREF)).at(-1))
  expect(text).toContain('\\"layoutId\\":\\"three\\"')
  expect(text).not.toContain('edit')
})

// Found on the live site 2026-11-17: the owner's last-used view was Table, so the page opened on
// the old Table page and the board never showed.
test('a Table or Map view remembered from an earlier visit does not decide where the board page opens', async () => {
  for (const was of ['table', 'map']) {
    localStorage.setItem('uct.screener.layout', was)
    const drawn = draw()
    await waitFor(() => expect(screen.getByTestId('focus-row-MU')).toBeInTheDocument())
    expect(page()).toHaveAttribute('data-board', '')
    expect(screen.queryByTestId('table-mode')).toBeNull()
    expect(within(screen.getByRole('group', { name: 'View' })).getAllByRole('button').map(b => b.textContent)).toEqual(['List', 'Charts'])
    drawn.unmount()
  }
})

test('Table view still opens from the More menu for that visit, and its switch offers no Map', async () => {
  localStorage.setItem('uct.screener.layout', 'table')
  draw()
  await waitFor(() => expect(screen.getByTestId('focus-row-MU')).toBeInTheDocument())
  fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
  fireEvent.click(within(screen.getByRole('menu', { name: 'More actions' })).getByRole('menuitem', { name: 'Table view' }))
  const table = await screen.findByTestId('table-mode')
  expect(within(table).getAllByRole('button').map(b => b.textContent)).toEqual(['List', 'Charts', 'Table'])
})

test('without the flag a remembered Table view opens as it always did, with the full switch', async () => {
  localStorage.setItem('uct.screener.layout', 'table')
  draw(false)
  const table = await screen.findByTestId('table-mode')
  expect(within(table).getAllByRole('button').map(b => b.textContent)).toEqual(['List', 'Charts', 'Map', 'Table'])
})

// Community layouts (SCREENER_LAYOUT_GALLERY_ENABLED), on the page.
const galleryCalls = () => fetch.mock.calls.filter(([u]) => String(u).startsWith('/api/screener/layout-gallery')).map(([u, o]) => [o?.method || 'GET', String(u), o?.body ? JSON.parse(o.body) : undefined])

test('without the community flag the Layout menu has no sharing entries and the server is never asked', async () => {
  draw()
  await waitFor(() => expect(screen.getByTestId('focus-row-MU')).toBeInTheDocument())
  fireEvent.click(screen.getByRole('button', { name: 'Layout' }))
  expect(within(screen.getByRole('menu', { name: 'Layout' })).queryByRole('menuitem', { name: /Community|Share/ })).toBeNull()
  expect(galleryCalls()).toEqual([])
})

test('with it: Share sends the name and the arrangement only; Community layouts opens the window', async () => {
  draw(true, { screenerLayoutGalleryEnabled: true })
  await waitFor(() => expect(screen.getByTestId('focus-row-MU')).toBeInTheDocument())
  await waitFor(() => expect(widgetsOnBoard()).toHaveLength(3))
  fireEvent.click(screen.getByRole('button', { name: 'Layout' }))
  fireEvent.click(within(screen.getByRole('menu', { name: 'Layout' })).getByRole('menuitem', { name: 'Share this layout…' }))
  const ask = await screen.findByRole('dialog', { name: 'Share this layout' })
  // the member is told what leaves and what does not, before anything is sent
  expect(within(ask).getByTestId('name-dialog-info')).toHaveTextContent('Your screens and filters are not shared.')
  expect(galleryCalls()).toEqual([])
  fireEvent.change(within(ask).getByLabelText('Layout name'), { target: { value: '  My board  ' } })
  fireEvent.click(within(ask).getByRole('button', { name: 'Share' }))
  await waitFor(() => expect(galleryCalls()).toHaveLength(1))
  expect(galleryCalls()[0]).toEqual(['POST', '/api/screener/layout-gallery', { name: 'My board', layout: { widgets: PRESETS[0].widgets } }])
  fireEvent.click(screen.getByRole('button', { name: 'Layout' }))
  fireEvent.click(within(screen.getByRole('menu', { name: 'Layout' })).getByRole('menuitem', { name: 'Community layouts…' }))
  expect(await screen.findByRole('dialog', { name: 'Community layouts' })).toBeInTheDocument()
  fireEvent.click(within(screen.getByRole('dialog', { name: 'Community layouts' })).getByRole('button', { name: 'Close' }))
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Community layouts' })).toBeNull())
})

test('the community flag alone, without the board, changes nothing', async () => {
  draw(false, { screenerLayoutGalleryEnabled: true })
  await waitFor(() => expect(screen.getByTestId('focus-row-MU')).toBeInTheDocument())
  expect(screen.queryByRole('button', { name: 'Layout' })).toBeNull()
  expect(galleryCalls()).toEqual([])
})
