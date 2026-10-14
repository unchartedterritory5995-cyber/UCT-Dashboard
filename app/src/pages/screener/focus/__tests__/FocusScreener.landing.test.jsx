// Task 7: where a bare first open lands. Owner decision 1 / P1 (first pinned screen with >= 10
// matches, else the first pinned) and Perf 3 (seeded from the last-known pins, reconciled when the
// server answers unless the member has touched the page).
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SWRConfig } from 'swr'
import { vi, beforeEach, expect, test } from 'vitest'
vi.mock('../../../../components/StockChart', () => ({ default: p => <div data-testid="stockchart" data-sym={p.sym} /> }))
vi.mock('../../shell/ScannerShell', () => ({ default: () => <div data-testid="table-mode" /> }))
vi.mock('../../../../hooks/useRealtimePrices', () => ({ default: () => ({ prices: {} }) }))
vi.mock('../../../../hooks/useNeighborWarm', () => ({ useNeighborWarm: () => {} }))
vi.mock('../../../../utils/prefetchBars', () => ({ prefetchBars: () => {}, prefetchBarsToIDB: () => {}, warmMemFromIDB: () => {} }))
import FocusScreener from '../FocusScreener'
import { AuthContext } from '../../../../context/AuthContext'
import { __resetCountCache } from '../useLazyCounts'
import { landingSeedKey } from '../landing'

const META = { filters: [], categories: [], views: [{ key: 'overview', columns: ['ticker', 'price'] }] }
const rows = [{ ticker: 'MU', price: 956.12, chg_pct_1d: -3.7, base_render: 'Flat Base', vol_ratio: 0.8 },
  { ticker: 'ECO', price: 99.48, chg_pct_1d: 0.9, base_render: 'Gap-up', vol_ratio: 1 }]
const scr = (id, name, min) => ({ id, name, spec: { filters: [{ key: 'rs_rank', op: 'gte', min }] } })
const THIN = scr('starter_thin', 'Thin screen', 95)
const WIDE = scr('starter_wide', 'Wide screen', 70)
const OTHER = scr('starter_other', 'Other screen', 50)
// matches per screen, by its rs_rank floor (undefined = the count never answers)
let countsByMin
let starters
let savedDelay
let fail
const minOf = spec => (spec.filters || []).find(f => f.key === 'rs_rank')?.min
beforeEach(() => {
  __resetCountCache()
  localStorage.clear()
  window.history.replaceState(null, '', '/')
  countsByMin = { 95: 3, 70: 40, 50: 12 }
  uid = 'member-a'
  starters = [THIN, WIDE]
  savedDelay = 0
  fail = false
  globalThis.fetch = vi.fn(async (u, o) => {
    const url = String(u)
    if (url.startsWith('/api/screener/meta')) return { ok: true, json: async () => META }
    if (url === '/api/screener/scan') return { ok: true, json: async () => ({ rows, total: rows.length, page: 1 }) }
    if (url === '/api/screener/count') return { ok: true, json: async () => ({ count: rows.length }) }
    if (url === '/api/screener/count/batch') {
      const specs = JSON.parse(o.body).specs
      if (fail || specs.some(sp => countsByMin[minOf(sp)] === undefined)) return new Promise(() => {})
      return { ok: true, json: async () => ({ counts: specs.map(sp => ({ count: countsByMin[minOf(sp)] })) }) }
    }
    if (url.startsWith('/api/screener/saved-screens')) {
      const body = { ok: true, json: async () => ({ saved: [], starters }) }
      return savedDelay ? new Promise(r => setTimeout(() => r(body), savedDelay)) : body
    }
    return { ok: true, json: async () => ([]) }
  })
})
let uid
const mount = () => render(<MemoryRouter><AuthContext.Provider value={{ user: uid ? { id: uid } : null }}>
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}><FocusScreener /></SWRConfig>
</AuthContext.Provider></MemoryRouter>)
const scanMins = () => fetch.mock.calls.filter(([u]) => String(u) === '/api/screener/scan').map(([, o]) => minOf(JSON.parse(o.body)))
const pin = ids => localStorage.setItem('uct.screener.pinned', JSON.stringify(ids))
const seed = (items, who = 'member-a') => localStorage.setItem(landingSeedKey(who), JSON.stringify(items))

test('P1: lands on the first pinned screen with at least 10 matches, and scans only it', async () => {
  pin([THIN.id, WIDE.id])
  mount()
  await waitFor(() => expect(screen.getByRole('button', { name: /Wide screen/ })).toBeInTheDocument())
  await waitFor(() => screen.getByTestId('focus-row-MU'))
  await new Promise(r => setTimeout(r, 400))
  expect(scanMins()).toEqual([70])
})
test('P1: when no pinned screen has 10 matches, lands on the first pinned', async () => {
  countsByMin = { 95: 3, 70: 9 }
  pin([THIN.id, WIDE.id])
  mount()
  await waitFor(() => expect(screen.getByRole('button', { name: /Thin screen/ })).toBeInTheDocument())
  await waitFor(() => expect(scanMins()).toEqual([95]))
})
test('P1: exactly 10 is enough', async () => {
  countsByMin = { 95: 10, 70: 40 }
  pin([THIN.id, WIDE.id])
  mount()
  await waitFor(() => expect(screen.getByRole('button', { name: /Thin screen/ })).toBeInTheDocument())
})
test('P1: counts that never answer do not hold the page past the landing cap: first pinned', async () => {
  fail = true
  pin([THIN.id, WIDE.id])
  mount()
  await new Promise(r => setTimeout(r, 400))
  expect(scanMins()).toEqual([])
  await waitFor(() => expect(screen.getByRole('button', { name: /Thin screen/ })).toBeInTheDocument(), { timeout: 5000 })
  await waitFor(() => expect(scanMins()).toEqual([95]))
}, 10000)

test('Perf 3: with last-known pins, the scan starts before the saved screens answer', async () => {
  seed([WIDE])
  pin([WIDE.id])
  savedDelay = 1500
  mount()
  await waitFor(() => expect(scanMins()).toEqual([70]), { timeout: 1000 })
  // the saved screens have not answered yet
  expect(screen.getByRole('button', { name: /Wide screen/ })).toBeInTheDocument()
  await new Promise(r => setTimeout(r, 1700))
  // the server agreed: nothing is asked again
  expect(scanMins()).toEqual([70])
}, 10000)
test('Perf 3: the server answer replaces the seeded choice when the member has not interacted', async () => {
  seed([WIDE])
  starters = [WIDE, OTHER]
  pin([OTHER.id, WIDE.id])     // the server's pins now put Other first (12 matches)
  savedDelay = 700
  mount()
  await waitFor(() => expect(scanMins()).toEqual([70]))
  await waitFor(() => expect(screen.getByRole('button', { name: /Other screen/ })).toBeInTheDocument(), { timeout: 3000 })
  await waitFor(() => expect(scanMins().at(-1)).toBe(50))
  // and the new answer is what the next open starts from
  expect(JSON.parse(localStorage.getItem(landingSeedKey('member-a'))).map(x => x.id)).toEqual([OTHER.id, WIDE.id])
}, 10000)
test('Perf 3: no switch once the member has interacted', async () => {
  seed([WIDE])
  starters = [WIDE, OTHER]
  pin([OTHER.id, WIDE.id])
  savedDelay = 700
  mount()
  await waitFor(() => screen.getByTestId('focus-row-MU'))
  fireEvent.keyDown(screen.getByRole('listbox'), { key: 'ArrowDown' })
  expect(screen.getByTestId('stockchart')).toHaveAttribute('data-sym', 'ECO')
  await waitFor(() => expect(fetch.mock.calls.some(([u]) => String(u).startsWith('/api/screener/saved-screens'))).toBe(true))
  await new Promise(r => setTimeout(r, 1500))   // the server has answered by now
  expect(screen.getByRole('button', { name: /Wide screen/ })).toBeInTheDocument()
  expect(scanMins()).toEqual([70])
  expect(screen.getByTestId('stockchart')).toHaveAttribute('data-sym', 'ECO')
}, 10000)
test('Perf 3: an unreadable seed is ignored; the page waits for the server as before', async () => {
  localStorage.setItem(landingSeedKey('member-a'), '{not json')
  pin([WIDE.id])
  savedDelay = 500
  mount()
  await new Promise(r => setTimeout(r, 300))
  expect(scanMins()).toEqual([])
  await waitFor(() => expect(scanMins()).toEqual([70]))
})

test('Perf 3: a seed is per member: member B never lands on the seed member A left saved screen', async () => {
  const mine = { id: 42, name: 'A private screen', kind: 'saved', spec: { filters: [{ key: 'rs_rank', op: 'gte', min: 50 }] } }
  seed([mine], 'member-a')
  uid = 'member-b'
  pin([WIDE.id])
  savedDelay = 500
  mount()
  await new Promise(r => setTimeout(r, 300))
  expect(scanMins()).toEqual([])            // B has no seed: nothing starts before the server
  await waitFor(() => expect(scanMins()).toEqual([70]))
  expect(screen.queryByRole('button', { name: /A private screen/ })).toBeNull()
  // and B's answer is kept under B, never over A's
  expect(JSON.parse(localStorage.getItem(landingSeedKey('member-a')))[0].id).toBe(42)
  expect(JSON.parse(localStorage.getItem(landingSeedKey('member-b')))[0].id).toBe(WIDE.id)
})
test('Perf 3: without a signed-in member no seed is read or written', async () => {
  seed([OTHER], 'undefined')
  uid = null
  pin([WIDE.id])
  savedDelay = 400
  mount()
  await new Promise(r => setTimeout(r, 250))
  expect(scanMins()).toEqual([])
  await waitFor(() => expect(scanMins()).toEqual([70]))
  expect(Object.keys(localStorage).filter(k => k.startsWith('uct.screener.landingSeed'))).toEqual([landingSeedKey('undefined')])
})
test('Perf 3: a server answer that lands after the landing cap never switches the screen', async () => {
  seed([WIDE])
  starters = [WIDE, OTHER]
  pin([OTHER.id])          // the late server would choose Other whatever the counts say
  savedDelay = 3400
  mount()
  await waitFor(() => expect(scanMins()).toEqual([70]))
  await waitFor(() => expect(fetch.mock.calls.some(([u]) => String(u).startsWith('/api/screener/saved-screens'))).toBe(true))
  await new Promise(r => setTimeout(r, 4200))   // past the cap and past the late answer
  expect(screen.getByRole('button', { name: /Wide screen/ })).toBeInTheDocument()
  expect(scanMins()).toEqual([70])
}, 12000)
test('Perf 3: scrolling the list counts as interaction: no switch', async () => {
  seed([WIDE])
  starters = [WIDE, OTHER]
  pin([OTHER.id, WIDE.id])
  savedDelay = 700
  mount()
  await waitFor(() => screen.getByTestId('focus-row-MU'))
  fireEvent.wheel(screen.getByRole('listbox'), { deltaY: 120 })
  await new Promise(r => setTimeout(r, 1500))
  expect(screen.getByRole('button', { name: /Wide screen/ })).toBeInTheDocument()
  expect(scanMins()).toEqual([70])
}, 10000)
test('Perf 3: a scroll event (no wheel) on the list counts too', async () => {
  seed([WIDE])
  starters = [WIDE, OTHER]
  pin([OTHER.id, WIDE.id])
  savedDelay = 700
  mount()
  await waitFor(() => screen.getByTestId('focus-row-MU'))
  fireEvent.scroll(screen.getByRole('listbox'))
  await new Promise(r => setTimeout(r, 1500))
  expect(scanMins()).toEqual([70])
}, 10000)

test('Minor 3: a kept seeded screen whose server copy changed reads as edited, never as the current version', async () => {
  seed([WIDE])                                     // the seed holds Wide at rs_rank >= 70
  const WIDE_NOW = scr(WIDE.id, 'Wide screen', 75)  // the server's Wide is now >= 75
  countsByMin = { 70: 40, 75: 30 }
  starters = [WIDE_NOW]
  pin([WIDE.id])
  savedDelay = 3400                                // past the cap: the seeded spec is kept
  mount()
  await waitFor(() => expect(scanMins()).toEqual([70]))
  await waitFor(() => expect(screen.getByRole('button', { name: /Wide screen \(edited\)/ })).toBeInTheDocument(), { timeout: 6000 })
  expect(scanMins()).toEqual([70])
}, 12000)
test('Minor 3: a kept seeded screen the server still has unchanged is not marked edited', async () => {
  seed([WIDE])
  pin([WIDE.id])
  savedDelay = 3400
  mount()
  await waitFor(() => expect(scanMins()).toEqual([70]))
  await waitFor(() => expect(fetch.mock.calls.some(([u]) => String(u).startsWith('/api/screener/saved-screens'))).toBe(true))
  await new Promise(r => setTimeout(r, 4000))
  expect(screen.getByRole('button', { name: /Wide screen/ })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /edited/ })).toBeNull()
}, 12000)
