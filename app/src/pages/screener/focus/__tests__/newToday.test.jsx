// newToday.test.jsx — "New today" in the Focus list (spec 2026-10-16 §1): the row pill,
// the "N new · M dropped" head line, and the New only filter, wired through FocusScreener.
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SWRConfig } from 'swr'
import { vi, beforeEach, expect, test } from 'vitest'
vi.mock('../../../../components/StockChart', () => ({ default: p => <div data-testid="stockchart" data-sym={p.sym} /> }))
vi.mock('../../shell/ScannerShell', () => ({ default: () => <div data-testid="table-mode" /> }))
vi.mock('../../../../hooks/useRealtimePrices', () => ({ default: () => ({ prices: {} }) }))
vi.mock('../../../../hooks/useNeighborWarm', () => ({ useNeighborWarm: () => {} }))
vi.mock('../../../../utils/prefetchBars', () => ({ prefetchBars: () => {}, prefetchBarsToIDB: () => {}, warmMemFromIDB: () => {} }))
import ResultList from '../ResultList'
import NewTodayLine from '../NewTodayLine'
import FocusScreener from '../FocusScreener'
import { SPEC_PARAM, encodeSpec } from '../../shell/specUrl'
import { AuthContext } from '../../../../context/AuthContext'

const row = t => ({ ticker: t, price: 10, chg_pct_1d: 1, base_render: 'Flat Base', vol_ratio: 1 })
const props = rows => ({ rows, index: 0, onSelect: vi.fn(), onKeyDown: vi.fn(), livePrices: {}, radar: new Set(), sortLabel: 'RS rank', total: rows.length, hasMore: false, onLoadMore: vi.fn(), isLoading: false })
const ok = (entered, exited) => ({ state: 'ok', entered, exited, new_since_label: 'New since Oct 14 close' })

// ── the pieces ───────────────────────────────────────────────────────────────
test('a row in the new set wears a New pill and the others do not', () => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })))
  render(<ResultList {...props([row('AAA'), row('BBB')])} newSet={new Set(['AAA'])} />)
  expect(screen.getByTestId('focus-row-AAA')).toHaveTextContent('New')
  expect(screen.getByTestId('focus-row-BBB')).not.toHaveTextContent('New')
  vi.unstubAllGlobals()
})

test('the head line counts new and dropped and names the session', () => {
  render(<NewTodayLine nt={ok(['A', 'B', 'C'], ['X', 'Y'])} newOnly={false} onToggleNewOnly={() => {}} />)
  expect(screen.getByRole('button', { name: /3 new/ })).toHaveAttribute('title', 'New since Oct 14 close')
  expect(screen.getByRole('button', { name: /2 dropped/ })).toBeInTheDocument()
})

test('dropped opens a list capped at 12 with a remainder', () => {
  const exited = Array.from({ length: 15 }, (_, i) => `T${i}`)
  render(<NewTodayLine nt={ok([], exited)} newOnly={false} onToggleNewOnly={() => {}} />)
  fireEvent.click(screen.getByRole('button', { name: /15 dropped/ }))
  expect(screen.getByText('T0')).toBeInTheDocument()
  expect(screen.queryByText('T12')).toBeNull()
  expect(screen.getByText('+3 more')).toBeInTheDocument()
})

test('New only is a pressed toggle', () => {
  const onToggle = vi.fn()
  render(<NewTodayLine nt={ok(['A'], [])} newOnly onToggleNewOnly={onToggle} />)
  const b = screen.getByRole('button', { name: /1 new/ })
  expect(b).toHaveAttribute('aria-pressed', 'true')
  fireEvent.click(b)
  expect(onToggle).toHaveBeenCalledTimes(1)
})

test('a live screen says so and draws no counts', () => {
  render(<NewTodayLine nt={{ state: 'live_screen' }} newOnly={false} onToggleNewOnly={() => {}} />)
  expect(screen.getByText('New markers follow the overnight build; this screen is live')).toBeInTheDocument()
  expect(screen.queryByRole('button')).toBeNull()
})

test.each(['no_history', 'unsaved', 'too_wide'])('%s renders nothing', state => {
  const { container } = render(<NewTodayLine nt={{ state }} newOnly={false} onToggleNewOnly={() => {}} />)
  expect(container).toBeEmptyDOMElement()
})

// ── wired through FocusScreener ─────────────────────────────────────────────
const META = { filters: [{ key: 'rs_rank', label: 'RS Rank', category: 'technical', type: 'range', presets: [{ label: 'Any' }] }],
  categories: [{ key: 'technical', label: 'Technical' }], views: [{ key: 'overview', columns: ['ticker', 'price'] }] }
const ROWS = [row('MU'), row('ECO'), row('APLS')]
let diff = ok(['ECO', 'APLS'], ['ZZZ'])
function route(url) {
  if (url === '/api/screener/membership-diff') return { ok: true, json: async () => diff }
  if (url.startsWith('/api/screener/meta')) return { ok: true, json: async () => META }
  if (url === '/api/screener/scan') return { ok: true, json: async () => ({ rows: ROWS, total: ROWS.length, page: 1, snapshot_date: '2026-10-15' }) }
  if (url === '/api/screener/count') return { ok: true, json: async () => ({ count: ROWS.length }) }
  if (url.startsWith('/api/screener/saved-screens')) return { ok: true, json: async () => ({ saved: [], starters: [] }) }
  if (url.startsWith('/api/exports/quota')) return { ok: false, status: 404, json: async () => ({}) }
  return { ok: true, json: async () => ([]) }
}
beforeEach(() => {
  diff = ok(['ECO', 'APLS'], ['ZZZ'])
  localStorage.clear()
  window.history.replaceState(null, '', '/')
  globalThis.fetch = vi.fn(async u => route(String(u)))
})
const mount = (auth = { screenerNewTodayEnabled: true }) => render(
  <MemoryRouter><AuthContext.Provider value={auth}>
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}><FocusScreener /></SWRConfig>
  </AuthContext.Provider></MemoryRouter>)
const diffBodies = () => fetch.mock.calls.filter(([u]) => String(u) === '/api/screener/membership-diff').map(([, o]) => JSON.parse(o.body))

test('flag off: nothing is asked and nothing is drawn', async () => {
  mount({ screenerNewTodayEnabled: false })
  await waitFor(() => screen.getByTestId('focus-row-MU'))
  expect(diffBodies()).toEqual([])
  expect(screen.queryByRole('button', { name: /new$/ })).toBeNull()
  expect(screen.getByTestId('focus-row-ECO')).not.toHaveTextContent('New')
})

test('flag on: the new rows wear the pill and the head line counts them', async () => {
  mount()
  expect(await screen.findByRole('button', { name: '2 new' })).toHaveAttribute('aria-pressed', 'false')
  expect(screen.getByRole('button', { name: '1 dropped' })).toBeInTheDocument()
  expect(screen.getByTestId('focus-row-ECO')).toHaveTextContent('New')
  expect(screen.getByTestId('focus-row-MU')).not.toHaveTextContent('New')
})

test('the diff asks with the criteria as a filter LIST (the shape the server hashes), never sort or view', async () => {
  window.history.replaceState(null, '', `/?${SPEC_PARAM}=${encodeSpec({ filters: { rs_rank: { op: 'gte', min: 80 } } })}`)
  mount()
  await screen.findByRole('button', { name: '2 new' })
  const body = diffBodies().at(-1)
  expect(Object.keys(body.spec).sort()).toEqual(['filters', 'logic', 'rank'])
  expect(body.spec.filters).toEqual([{ key: 'rs_rank', op: 'gte', min: 80 }])
})

test('New only lists the new rows, and the selection steps through exactly those', async () => {
  mount()
  fireEvent.click(await screen.findByRole('button', { name: '2 new' }))
  expect(screen.getByRole('button', { name: '2 new' })).toHaveAttribute('aria-pressed', 'true')
  expect(screen.queryByTestId('focus-row-MU')).toBeNull()
  expect(screen.getByTestId('focus-row-ECO')).toBeInTheDocument()
  expect(screen.getByTestId('focus-row-APLS')).toBeInTheDocument()
  // The chart follows the FILTERED list: row 0 is ECO, and ↓ lands on APLS, never on MU.
  expect(screen.getByTestId('stockchart')).toHaveAttribute('data-sym', 'ECO')
  fireEvent.keyDown(screen.getByRole('listbox'), { key: 'ArrowDown' })
  expect(screen.getByTestId('stockchart')).toHaveAttribute('data-sym', 'APLS')
  expect(screen.getByText('2 of 2')).toBeInTheDocument()
  // Off again: every row is back.
  fireEvent.click(screen.getByRole('button', { name: '2 new' }))
  expect(screen.getByTestId('focus-row-MU')).toBeInTheDocument()
})

test('a screen with no history draws no line and no pills', async () => {
  diff = { state: 'no_history' }
  mount()
  await waitFor(() => expect(diffBodies().length).toBeGreaterThan(0))
  await waitFor(() => screen.getByTestId('focus-row-ECO'))
  expect(screen.queryByRole('button', { name: /new$/ })).toBeNull()
  expect(screen.getByTestId('focus-row-ECO')).not.toHaveTextContent('New')
})
