// Task 7: where a bare first open lands. Owner decision (speed-3): the member's last-used screen, or the first pinned
// screen for a first-timer, never waiting on counts and Perf 3 (seeded from the last-known pins, reconciled when the
// server answers unless the member has touched the page).
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SWRConfig } from 'swr'
import { vi, beforeEach, expect, test } from 'vitest'
vi.mock('../../../../components/StockChart', () => ({ default: p => <div data-testid="stockchart" data-sym={p.sym} /> }))
// The pane's chart is the /charts Chart widget (ScreenerChartWidget); these tests are about which
// stock it is handed, so the host is stubbed at its boundary.
vi.mock('../ScreenerChartWidget', () => ({ default: p => <div data-testid="stockchart" data-sym={p.sym} data-phone={p.phone ? '1' : undefined} /> }))
vi.mock('../../shell/ScannerShell', () => ({ default: () => <div data-testid="table-mode" /> }))
vi.mock('../../../../hooks/useRealtimePrices', () => ({ default: () => ({ prices: {} }) }))
vi.mock('../../../../hooks/useNeighborWarm', () => ({ useNeighborWarm: () => {} }))
vi.mock('../../../../utils/prefetchBars', () => ({ prefetchBars: () => {}, prefetchBarsToIDB: () => {}, warmMemFromIDB: () => {}, prewarmVisibleList: () => {} }))
import FocusScreener from '../FocusScreener'
import { AuthContext } from '../../../../context/AuthContext'
import { __resetCountCache } from '../useLazyCounts'
import { landingSeedKey, lastScreenKey } from '../landing'

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
let metaGate
let fail
let savedFails
let savedRows
const minOf = spec => (spec.filters || []).find(f => f.key === 'rs_rank')?.min
beforeEach(() => {
  __resetCountCache()
  localStorage.clear()
  window.history.replaceState(null, '', '/')
  countsByMin = { 95: 3, 70: 40, 50: 12 }
  uid = 'member-a'
  starters = [THIN, WIDE]
  savedDelay = 0
  metaGate = null
  fail = false
  savedFails = false
  savedRows = []
  globalThis.fetch = vi.fn(async (u, o) => {
    const url = String(u)
    if (url.startsWith('/api/screener/meta')) {
      const body = { ok: true, json: async () => META }
      return metaGate ? metaGate.then(() => body) : body
    }
    if (url === '/api/screener/scan') return { ok: true, json: async () => ({ rows, total: rows.length, page: 1 }) }
    if (url === '/api/screener/count') return { ok: true, json: async () => ({ count: rows.length }) }
    if (url === '/api/screener/count/batch') {
      const specs = JSON.parse(o.body).specs
      if (fail || specs.some(sp => countsByMin[minOf(sp)] === undefined)) return new Promise(() => {})
      return { ok: true, json: async () => ({ counts: specs.map(sp => ({ count: countsByMin[minOf(sp)] })) }) }
    }
    if (url.startsWith('/api/screener/saved-screens')) {
      if (savedFails) return { ok: false, status: 500, json: async () => ({}) }
      const body = { ok: true, json: async () => ({ saved: savedRows, starters }) }
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

const openMenu = async () => {
  await waitFor(() => screen.getByRole('button', { name: /Change screen/ }))
  fireEvent.click(screen.getByRole('button', { name: /Change screen/ }))
}
test('owner decision: a first-timer lands on the first pinned screen without waiting for any count', async () => {
  fail = true                     // /count/batch never answers
  pin([THIN.id, WIDE.id])
  mount()
  await waitFor(() => expect(scanMins()).toEqual([95]), { timeout: 800 })
  expect(screen.getByRole('button', { name: /Thin screen/ })).toBeInTheDocument()
}, 6000)
test('owner decision: the landing scan does not ask for per-screen counts first', async () => {
  pin([THIN.id, WIDE.id])
  mount()
  await waitFor(() => expect(scanMins()).toEqual([95]))
  expect(fetch.mock.calls.some(([u]) => String(u) === '/api/screener/count/batch')).toBe(false)
})
test('owner decision: a returning member lands at once on the last-used screen, before the saved screens answer', async () => {
  localStorage.setItem(lastScreenKey('member-a'), JSON.stringify({ ...OTHER, kind: 'starter' }))
  starters = [THIN, WIDE, OTHER]
  pin([THIN.id, WIDE.id])
  savedDelay = 1500
  fail = true
  mount()
  await waitFor(() => expect(scanMins()).toEqual([50]), { timeout: 800 })
  expect(screen.getByRole('button', { name: /Other screen/ })).toBeInTheDocument()
  await new Promise(r => setTimeout(r, 1700))
  expect(scanMins()).toEqual([50])
}, 10000)
test('owner decision: picking a screen makes it the last-used; a member who only landed records nothing', async () => {
  pin([THIN.id, WIDE.id])
  mount()
  await waitFor(() => expect(scanMins()).toEqual([95]))
  expect(localStorage.getItem(lastScreenKey('member-a'))).toBeNull()
  await openMenu()
  fireEvent.click(await screen.findByRole('button', { name: /Open Wide screen/ }))
  await waitFor(() => expect(scanMins().at(-1)).toBe(70))
  expect(JSON.parse(localStorage.getItem(lastScreenKey('member-a')))).toMatchObject({ id: WIDE.id, name: 'Wide screen' })
})
test('owner decision: a last-used screen the server no longer has falls back to the default', async () => {
  const gone = { id: 99, name: 'Deleted screen', kind: 'saved', spec: { filters: [{ key: 'rs_rank', op: 'gte', min: 50 }] } }
  localStorage.setItem(lastScreenKey('member-a'), JSON.stringify(gone))
  pin([THIN.id])
  savedDelay = 300
  mount()
  await waitFor(() => expect(scanMins()[0]).toBe(50))     // lands at once on it
  await waitFor(() => expect(screen.getByRole('button', { name: /Thin screen/ })).toBeInTheDocument(), { timeout: 2000 })
  await waitFor(() => expect(scanMins().at(-1)).toBe(95))
}, 8000)
test('owner decision: a last-used screen is per member', async () => {
  localStorage.setItem(lastScreenKey('member-a'), JSON.stringify({ ...OTHER, kind: 'starter' }))
  uid = 'member-b'
  starters = [THIN, WIDE, OTHER]
  pin([WIDE.id])
  mount()
  await waitFor(() => expect(scanMins()).toEqual([70]))
  expect(screen.queryByRole('button', { name: /Other screen/ })).toBeNull()
})
test('owner decision: the screen count still arrives after the page has landed', async () => {
  pin([WIDE.id])
  mount()
  await waitFor(() => expect(scanMins()).toEqual([70]))
  await waitFor(() => expect(screen.getByTestId('screen-count')).toHaveTextContent('2'))
})

const GONE = { id: 99, name: 'Deleted screen', kind: 'saved', spec: { filters: [{ key: 'rs_rank', op: 'gte', min: 50 }] } }
test('review: a deleted last-used screen stops being named once a member scrolled before the answer', async () => {
  localStorage.setItem(lastScreenKey('member-a'), JSON.stringify(GONE))
  pin([THIN.id])
  savedDelay = 700
  mount()
  await waitFor(() => screen.getByTestId('focus-row-MU'))
  fireEvent.wheel(screen.getByRole('listbox'), { deltaY: 120 })
  await waitFor(() => expect(screen.getByRole('button', { name: /Custom screen/ })).toBeInTheDocument(), { timeout: 2500 })
  expect(scanMins()).toEqual([50])
}, 8000)
test('review: a deleted last-used screen answered past the cap stops being named', async () => {
  localStorage.setItem(lastScreenKey('member-a'), JSON.stringify(GONE))
  pin([THIN.id])
  savedDelay = 3400
  mount()
  await waitFor(() => expect(scanMins()).toEqual([50]))
  await waitFor(() => expect(screen.getByRole('button', { name: /Custom screen/ })).toBeInTheDocument(), { timeout: 6000 })
  expect(scanMins()).toEqual([50])
}, 12000)
test('review: a last-used screen whose server copy changed reads as edited once past the cap', async () => {
  localStorage.setItem(lastScreenKey('member-a'), JSON.stringify({ ...WIDE, kind: 'starter' }))
  starters = [scr(WIDE.id, 'Wide screen', 75)]
  pin([WIDE.id])
  savedDelay = 3400
  mount()
  await waitFor(() => expect(scanMins()).toEqual([70]))
  await waitFor(() => expect(screen.getByRole('button', { name: /Wide screen \(edited\)/ })).toBeInTheDocument(), { timeout: 6000 })
  expect(scanMins()).toEqual([70])
}, 12000)

test('review: a failed saved-screens read keeps the member on their screen', async () => {
  localStorage.setItem(lastScreenKey('member-a'), JSON.stringify({ ...OTHER, kind: 'starter' }))
  savedFails = true
  pin([THIN.id])
  mount()
  await waitFor(() => expect(scanMins()).toEqual([50]))
  await new Promise(r => setTimeout(r, 800))
  expect(screen.getByRole('button', { name: /Other screen/ })).toBeInTheDocument()
  expect(scanMins()).toEqual([50])
}, 6000)

test('review: an untouched last-used screen takes the server copy, and remembers it', async () => {
  localStorage.setItem(lastScreenKey('member-a'), JSON.stringify({ ...WIDE, kind: 'starter' }))
  starters = [scr(WIDE.id, 'Wide screen', 75)]
  countsByMin = { 70: 40, 75: 30 }
  pin([WIDE.id])
  savedDelay = 300
  mount()
  await waitFor(() => expect(scanMins()).toEqual([70, 75]), { timeout: 2000 })
  expect(screen.queryByRole('button', { name: /edited/ })).toBeNull()
  expect(JSON.parse(localStorage.getItem(lastScreenKey('member-a'))).spec.filters[0].min).toBe(75)
}, 6000)
test('review: Save changes is what the next open lands on', async () => {
  const MINE = { id: 7, name: 'Mine', kind: 'saved', spec: { filters: [{ key: 'rs_rank', op: 'gte', min: 70 }] } }
  savedRows = [MINE]
  localStorage.setItem(lastScreenKey('member-a'), JSON.stringify(MINE))
  pin([THIN.id])
  mount()
  await waitFor(() => screen.getByTestId('focus-row-MU'))
  await waitFor(() => screen.getByRole('button', { name: /^Mine/ }))
  fireEvent.click(screen.getByRole('button', { name: /^Filters/ }))
  const drawer = await screen.findByRole('dialog', { name: 'Filters' })
  fireEvent.click(within(drawer).getAllByRole('button', { name: 'Clear all' })[0])
  await waitFor(() => screen.getByRole('button', { name: /Mine \(edited\)/ }))
  fireEvent.click(screen.getByRole('button', { name: /Mine \(edited\)/ }))
  fireEvent.click(await screen.findByRole('button', { name: /Save changes to/ }))
  await waitFor(() => expect(JSON.parse(localStorage.getItem(lastScreenKey('member-a'))).spec.filters || []).toEqual([]))
}, 8000)

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

// Speed pass: a filter registry that answers AFTER the landing scan fired used to move `columns`
// inside the spec's JSON, so the same screen read as a new spec and was asked for a second time
// (2 of 3 runs measured on production, ~2.5 s of server time each).
test('the screen is asked for once when the filter registry answers after the landing scan', async () => {
  pin([WIDE.id])
  let answerMeta
  metaGate = new Promise(r => { answerMeta = r })
  mount()
  await waitFor(() => expect(scanMins()).toEqual([70]))
  answerMeta()
  await new Promise(r => setTimeout(r, 800))
  expect(scanMins()).toEqual([70])
}, 10000)
