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
import { BOARD_PREF, BOARD_PREF_TABLET, PRESETS, TABLET_PRESETS, sanitize, serialize, pickLayout } from '../board/boardModel'
import { PLAIN_STARTERS } from './rsScreensFixture'

const META = { filters: [{ key: 'rs_rank', label: 'RS Rank', category: 'technical', type: 'range', presets: [{ label: 'Any' }] }],
  categories: [{ key: 'technical', label: 'Technical' }], views: [{ key: 'overview', columns: ['ticker', 'price'] }] }
const ROWS = [
  { ticker: 'MU', company: 'Micron', price: 956.12, chg_pct_1d: -3.7, base_render: 'Flat Base', vol_ratio: 0.8, rs_rank: 94, industry: 'Semiconductors', sector: 'Technology' },
  { ticker: 'ECO', company: 'Okeanis', price: 99.48, chg_pct_1d: 0.9, base_render: 'Gap-up', vol_ratio: 1, rs_rank: 97, industry: 'Shipping', sector: 'Industrials' },
]
let stored
let wide
let tabletSize
let heightSpy
const prefWrites = () => fetch.mock.calls.filter(([u, o]) => String(u).startsWith('/api/auth/preferences') && o?.method === 'POST').map(([, o]) => JSON.parse(o.body))

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  window.history.replaceState(null, '', '/')

  stored = {}
  wide = true
  tabletSize = false
  window.matchMedia = q => ({ matches: q === MQ.desktop ? wide : q === MQ.tablet ? tabletSize : false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })
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

test('owner ruling: no Table and no Map as views; the More menu offers the scan builder and nothing else of them', async () => {
  draw()
  await waitFor(() => expect(screen.getByTestId('focus-row-MU')).toBeInTheDocument())
  expect(within(screen.getByRole('group', { name: 'View' })).getAllByRole('button').map(b => b.textContent)).toEqual(['List', 'Charts'])
  fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
  const items = within(screen.getByRole('menu', { name: 'More actions' })).getAllByRole('menuitem').map(i => i.textContent)
  expect(items[0]).toBe('Scan builder')
  expect(items.join(' ')).not.toMatch(/table|map/i)
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

test('the scan builder (the older page) still opens from the More menu for that visit, and its switch offers no Map', async () => {
  localStorage.setItem('uct.screener.layout', 'table')
  draw()
  await waitFor(() => expect(screen.getByTestId('focus-row-MU')).toBeInTheDocument())
  fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
  fireEvent.click(within(screen.getByRole('menu', { name: 'More actions' })).getByRole('menuitem', { name: 'Scan builder' }))
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

test('an admin is told on the Layout menu how many shared layouts wait for review; a member is never asked', async () => {
  const base = globalThis.fetch
  const waiting = { id: 'q1', name: 'New', author: 'Dana', layout: { widgets: PRESETS[0].widgets }, uses: 0, mine: false, status: 'pending', reported: false, hidden: false, reports: 0 }
  globalThis.fetch = vi.fn(async (u, o) => (String(u) === '/api/screener/layout-gallery' && (!o?.method || o.method === 'GET')
    ? { ok: true, json: async () => ({ items: [], mine: [], queue: [waiting, { ...waiting, id: 'q2', status: 'approved', reports: 1 }, { ...waiting, id: 'q3', status: 'approved', hidden: true }] }) }
    : base(u, o)))
  const member = draw(true, { screenerLayoutGalleryEnabled: true, user: { id: 'u1', role: 'member' } })
  await waitFor(() => expect(screen.getByTestId('focus-row-MU')).toBeInTheDocument())
  fireEvent.click(screen.getByRole('button', { name: 'Layout' }))
  expect(within(screen.getByRole('menu', { name: 'Layout' })).getByRole('menuitem', { name: /Community layouts/ }).textContent).toBe('Community layouts…')
  expect(galleryCalls()).toEqual([])
  member.unmount()
  draw(true, { screenerLayoutGalleryEnabled: true, user: { id: 'u0', role: 'admin' } })
  await waitFor(() => expect(screen.getByTestId('focus-row-MU')).toBeInTheDocument())
  await waitFor(() => expect(galleryCalls()).toEqual([['GET', '/api/screener/layout-gallery', undefined]]))
  fireEvent.click(screen.getByRole('button', { name: 'Layout' }))
  await waitFor(() => expect(within(screen.getByRole('menu', { name: 'Layout' })).getByRole('menuitem', { name: /Community layouts/ }).textContent).toBe('Community layouts…2 to review'))
  // found on the live site: the count is read again after the admin shares a layout themselves
  fireEvent.click(within(screen.getByRole('menu', { name: 'Layout' })).getByRole('menuitem', { name: 'Share this layout…' }))
  const ask = await screen.findByRole('dialog', { name: 'Share this layout' })
  fireEvent.change(within(ask).getByLabelText('Layout name'), { target: { value: 'Mine' } })
  fireEvent.click(within(ask).getByRole('button', { name: 'Share' }))
  await waitFor(() => expect(galleryCalls().map(c => c[0])).toEqual(['GET', 'POST', 'GET']))
})

// The scan board on a tablet (SCREENER_SCAN_BOARD_TABLET_ENABLED, on top of the board's own flag).
const onTablet = (w = 1024, h = 768) => { wide = false; tabletSize = true; window.innerWidth = w; window.innerHeight = h }

test('a tablet without the tablet flag keeps the older page; with only the tablet flag (no board flag) too', async () => {
  onTablet()
  const first = draw(true)
  await waitFor(() => expect(screen.getByTestId('focus-row-MU')).toBeInTheDocument())
  expect(page()).not.toHaveAttribute('data-board')
  first.unmount()
  draw(false, { screenerScanBoardTabletEnabled: true })
  await waitFor(() => expect(screen.getByTestId('focus-row-MU')).toBeInTheDocument())
  expect(page()).not.toHaveAttribute('data-board')
  expect(screen.queryByRole('button', { name: 'Layout' })).toBeNull()
})

test('a tablet with both flags gets the board on a tablet preset that suits how it is held, with tablet presets on the menu', async () => {
  onTablet(1024, 768)
  const first = draw(true, { screenerScanBoardTabletEnabled: true, screenerLayoutGalleryEnabled: true })
  await waitFor(() => expect(screen.getByTestId('focus-row-MU')).toBeInTheDocument())
  expect(page()).toHaveAttribute('data-board', '')
  await waitFor(() => expect(widgetsOnBoard()).toEqual(TABLET_PRESETS.find(p => p.id === 'side').widgets.map(w => w.type)))
  // no room for tabs on a tablet's top bar: the screens are the dropdown, and the switch for tabs is not offered
  expect(screen.queryByRole('tablist', { name: 'Pinned screens' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Layout' }))
  const names = within(screen.getByRole('menu', { name: 'Layout' })).getAllByRole('menuitem').map(i => i.textContent.replace(/\s+/g, ' ').trim())
  expect(names.slice(0, 3)).toEqual(['Side by side ✓ (current)', 'Stacked', 'Chart on top'])
  expect(names.some(n => /Pinned screens as tabs|Community|Share this layout|Board|Three columns|List first/.test(n))).toBe(false)
  // opening the board on its starting preset writes nothing
  expect(prefWrites().some(w => /screener_scan_board/.test(JSON.stringify(w)))).toBe(false)
  first.unmount()
  onTablet(820, 1180)
  draw(true, { screenerScanBoardTabletEnabled: true })
  await waitFor(() => expect(screen.getByTestId('focus-row-MU')).toBeInTheDocument())
  await waitFor(() => expect(widgetsOnBoard()).toEqual(['chart', 'results']))
})

test('a tablet stores its layout under its own key and never touches the desktop one; a stored tablet layout is what it opens on', async () => {
  onTablet()
  stored = { [BOARD_PREF]: serialize(pickLayout(sanitize(null), 'three')), [BOARD_PREF_TABLET]: serialize(pickLayout(sanitize(null, 'tablet'), 'top')) }
  draw(true, { screenerScanBoardTabletEnabled: true })
  await waitFor(() => expect(screen.getByTestId('focus-row-MU')).toBeInTheDocument())
  await waitFor(() => expect(widgetsOnBoard()).toEqual(['chart', 'results', 'details'])) // 'Chart on top', not the desktop's Three columns
  fireEvent.click(screen.getByRole('button', { name: 'Layout' }))
  fireEvent.click(within(screen.getByRole('menu', { name: 'Layout' })).getByRole('menuitem', { name: 'Stacked' }))
  await waitFor(() => expect(widgetsOnBoard()).toEqual(['chart', 'results']))
  await waitFor(() => expect(prefWrites().some(w => JSON.stringify(w).includes(BOARD_PREF_TABLET))).toBe(true), { timeout: 4000 })
  const writes = prefWrites().filter(w => /screener_scan_board/.test(JSON.stringify(w)))
  expect(writes.every(w => w.key === BOARD_PREF_TABLET)).toBe(true)
  expect(JSON.stringify(writes.at(-1))).toContain('\\"layoutId\\":\\"stack\\"')
})

test('the desktop is exactly as it was with the tablet flag on: desktop presets, its own key', async () => {
  draw(true, { screenerScanBoardTabletEnabled: true })
  await waitFor(() => expect(screen.getByTestId('focus-row-MU')).toBeInTheDocument())
  await waitFor(() => expect(widgetsOnBoard()).toEqual(PRESETS[0].widgets.map(w => w.type)))
  fireEvent.click(screen.getByRole('button', { name: 'Layout' }))
  fireEvent.click(within(screen.getByRole('menu', { name: 'Layout' })).getByRole('menuitem', { name: 'Three columns' }))
  await waitFor(() => expect(prefWrites().some(w => JSON.stringify(w).includes(BOARD_PREF))).toBe(true), { timeout: 4000 })
  expect(prefWrites().filter(w => /screener_scan_board/.test(JSON.stringify(w))).every(w => w.key === BOARD_PREF)).toBe(true)
})
