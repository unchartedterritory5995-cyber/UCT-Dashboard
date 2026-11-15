// RS screens (unit U5): a screen whose starter carries NONE of the new fields (`hidden`,
// `controls`, `row`, `empty`) renders exactly as it did before the unit.
//
// The snapshots beside this file were written from the code BEFORE any U5 change (the first
// commit of the unit), so they are the pre-unit DOM, not a restatement of the new code. They
// move only when today's product moves on purpose.
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SWRConfig } from 'swr'
import { vi, beforeEach, expect, test } from 'vitest'
vi.mock('../../../../components/StockChart', () => ({ default: p => <div data-testid="stockchart" data-sym={p.sym} /> }))
vi.mock('../ScreenerChartWidget', () => ({ default: p => <div data-testid="stockchart" data-sym={p.sym} /> }))
vi.mock('../../shell/ScannerShell', () => ({ default: () => <div data-testid="table-mode" /> }))
vi.mock('../../../../hooks/useRealtimePrices', () => ({ default: () => ({ prices: {} }) }))
vi.mock('../../../../hooks/useNeighborWarm', () => ({ useNeighborWarm: () => {} }))
vi.mock('../../../../utils/prefetchBars', () => ({ prefetchBars: () => {}, prefetchBarsToIDB: () => {}, warmMemFromIDB: () => {}, prewarmVisibleList: () => {} }))
const lazy = vi.hoisted(() => ({ counts: {} }))
vi.mock('../useLazyCounts', () => ({ default: () => lazy.counts, __resetCountCache: () => {} }))
import FocusScreener from '../FocusScreener'
import ResultList from '../ResultList'
import ScreenMenu from '../ScreenMenu'
import { PLAIN_STARTERS } from './rsScreensFixture'

const META = { filters: [{ key: 'rs_rank', label: 'RS Rank', category: 'technical', type: 'range', presets: [{ label: 'Any' }] }],
  categories: [{ key: 'technical', label: 'Technical' }], views: [{ key: 'overview', columns: ['ticker', 'price'] }] }
const ROWS = [
  { ticker: 'MU', company: 'Micron', price: 956.12, chg_pct_1d: -3.7, base_render: 'Flat Base', vol_ratio: 0.8, rs_rank: 94, industry: 'Semiconductors', sector: 'Technology' },
  { ticker: 'ECO', company: 'Okeanis', price: 99.48, chg_pct_1d: 0.9, base_render: 'Gap-up', vol_ratio: 1, rs_rank: 97, industry: 'Shipping', sector: 'Industrials' },
  { ticker: 'DAWN', price: null, chg_pct_1d: null, base_render: null, vol_ratio: 1 },
]
// The column request of the list before the unit (REQUIRED_COLS + LIST_COLUMNS + the checkable filter keys).
const LEGACY_COLUMNS = ['ticker', 'company', 'price', 'chg_pct_1d', 'base_render', 'base_pivot_px', 'vol_ratio', 'rvol_live', 'rs_rank',
  'market_cap', 'adr_pct', 'industry', 'sector', 'next_earnings_date', 'bars_asof', 'security_type']

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  window.history.replaceState(null, '', '/')
  globalThis.fetch = vi.fn(async (u, o) => {
    const url = String(u)
    if (url.startsWith('/api/screener/meta')) return { ok: true, json: async () => META }
    if (url === '/api/screener/scan') return { ok: true, json: async () => ({ rows: ROWS, total: ROWS.length, page: JSON.parse(o.body).page || 1 }) }
    if (url === '/api/screener/count') return { ok: true, json: async () => ({ count: ROWS.length }) }
    if (url.startsWith('/api/screener/saved-screens')) return { ok: true, json: async () => ({ saved: [], starters: PLAIN_STARTERS }) }
    if (url.startsWith('/api/auth/preferences')) return { ok: true, json: async () => ({}) }
    if (url.startsWith('/api/screener/to-watchlist') || url.startsWith('/api/screener/save-fork') || url.startsWith('/api/exports/quota')) {
      return { ok: false, status: 404, json: async () => ({ detail: 'Not Found' }) }
    }
    return { ok: true, json: async () => ([]) }
  })
})
const scanBodies = () => fetch.mock.calls.filter(([u]) => String(u) === '/api/screener/scan').map(([, o]) => JSON.parse(o.body))

test('the result list of a plain screen is the pre-unit DOM', () => {
  const { container } = render(<ResultList rows={ROWS} index={1} onSelect={() => {}} onKeyDown={() => {}} livePrices={{ MU: { price: 960.5, change_pct: -3.3 } }}
    radar={new Set(['MU'])} sortLabel="RS Rank ↓" total={214} hasMore={false} onLoadMore={() => {}} isLoading={false} showCompany
    newSet={new Set(['ECO'])} headExtra={<span>head extra</span>} />)
  expect(container.innerHTML).toMatchSnapshot()
})

test('the screen menu of plain starters is the pre-unit DOM', () => {
  const props = { currentName: 'Power plays', currentId: 'starter_power_play', count: 12, isEdited: false, starters: PLAIN_STARTERS,
    saved: [{ id: 5, name: 'Semis on watch', spec: { filters: [] } }], pinned: ['starter_power_play'], onTogglePin: () => {}, onApply: () => {},
    onSaveChanges: null, onSaveAsNew: () => {}, onRename: null, onNewScreen: () => {}, myScans: [], onUseScan: () => {} }
  const { container } = render(<ScreenMenu {...props} />)
  fireEvent.click(screen.getByRole('button', { name: /Power plays/ }))
  expect(container.innerHTML).toMatchSnapshot()
  fireEvent.change(screen.getByRole('searchbox', { name: 'Search screens' }), { target: { value: 'tight' } })
  expect(screen.getByRole('dialog', { name: 'Screens' }).innerHTML).toMatchSnapshot()
})

test('the page of a plain starter is the pre-unit DOM, and asks for the pre-unit columns', async () => {
  const { container } = render(<MemoryRouter><SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}><FocusScreener /></SWRConfig></MemoryRouter>)
  await waitFor(() => expect(screen.getByTestId('focus-row-MU')).toBeInTheDocument())
  // A bare first open lands on the first default pin the payload carries.
  await waitFor(() => expect(screen.getByRole('button', { name: /Power plays, 3 matches\. Change screen/ })).toBeInTheDocument())
  await waitFor(() => expect(scanBodies().at(-1).filters.some(f => f.key === 'rs_rank' && f.min === 85)).toBe(true))
  expect(scanBodies().at(-1).columns).toEqual(LEGACY_COLUMNS)
  const page = container.querySelector('[data-testid="focus-screener"]')
  // The page's own rows, top to bottom: nothing new sits between the top bar and the body.
  expect([...page.children].map(el => `${el.tagName.toLowerCase()}${el.getAttribute('data-testid') ? `[${el.getAttribute('data-testid')}]` : ''}.${el.className}`)).toMatchSnapshot()
  expect(container.querySelector('#focus-results').parentElement.innerHTML).toMatchSnapshot()
  expect(screen.getByTestId('focus-chart-pane').innerHTML).toMatchSnapshot()
  fireEvent.click(screen.getByRole('button', { name: 'Help' }))
  expect(screen.getByRole('menu', { name: 'Help' }).innerHTML).toMatchSnapshot()
})
