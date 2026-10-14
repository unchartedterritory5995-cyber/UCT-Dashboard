// FocusScreener.answers.test.jsx — polish round 2026-10-14: a scan answer belongs to the screen
// that asked for it (S1), the list is dimmed while the new screen's answer is pending (B3), undo
// survives a 0→0 step (B6), the screen name survives remounts and back/forward (B8/N2), Enter
// writes the URL before leaving (N3), and a later page never repeats a ticker (N1).
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { SWRConfig } from 'swr'
import { vi, beforeEach, expect, test } from 'vitest'
vi.mock('../../../../components/StockChart', () => ({ default: p => <div data-testid="stockchart" data-sym={p.sym} /> }))
vi.mock('../../shell/ScannerShell', () => ({ default: p => <div data-testid="table-mode">{p.toolbarLead}</div> }))
vi.mock('../../../../hooks/useRealtimePrices', () => ({ default: () => ({ prices: {} }) }))
vi.mock('../../../../hooks/useNeighborWarm', () => ({ useNeighborWarm: () => {} }))
vi.mock('../../../../utils/prefetchBars', () => ({ prefetchBars: () => {}, prefetchBarsToIDB: () => {}, warmMemFromIDB: () => {} }))
import FocusScreener from '../FocusScreener'
import { SPEC_PARAM, DEFAULT_SORT, encodeSpec, decodeSpec } from '../../shell/specUrl'

const META = { filters: [{ key: 'rs_rank', label: 'RS Rank', category: 'technical', type: 'range', presets: [{ label: 'Any' }] }],
  categories: [{ key: 'technical', label: 'Technical' }], views: [{ key: 'overview', columns: ['ticker', 'price'] }] }
const rowsX = [{ ticker: 'MU', price: 956.12, chg_pct_1d: -3.7, base_render: 'Flat Base', vol_ratio: 0.8, rs_rank: 94 },
  { ticker: 'ECO', price: 99.48, chg_pct_1d: 0.9, base_render: 'Gap-up', vol_ratio: 1, rs_rank: 97 }]
const AAA = { ticker: 'AAA', price: 10, chg_pct_1d: 1, base_render: 'Flat Base', vol_ratio: 1 }
const UCT = { op: 'eq', value: 'uct', label: 'UCT Universe' }
const RS90 = { op: 'gte', min: 90 }
let extra = () => null
function route(url, opts) {
  const hit = extra(url, opts)
  if (hit) return hit
  if (url.startsWith('/api/screener/meta')) return { ok: true, json: async () => META }
  if (url === '/api/screener/scan') return { ok: true, json: async () => ({ rows: rowsX, total: rowsX.length, page: 1, snapshot_date: '2026-10-12' }) }
  if (url === '/api/screener/count') return { ok: true, json: async () => ({ count: 2 }) }
  if (url.startsWith('/api/screener/saved-screens')) return { ok: true, json: async () => ({ saved: [], starters: [] }) }
  if (url.startsWith('/api/screener/to-watchlist') || url.startsWith('/api/screener/save-fork') || url.startsWith('/api/exports/quota')) {
    return { ok: false, status: 404, json: async () => ({ detail: 'Not Found' }) }
  }
  return { ok: true, json: async () => ([]) }
}
beforeEach(() => {
  extra = () => null
  localStorage.clear()
  sessionStorage.clear()
  window.history.replaceState(null, '', '/')
  globalThis.fetch = vi.fn(async (u, o) => route(String(u), o))
})
const mount = () => render(<MemoryRouter><SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}><FocusScreener /></SWRConfig></MemoryRouter>)
function Where() { return <span data-testid="location">{useLocation().pathname}</span> }
const mountAt = () => render(<MemoryRouter><SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}><FocusScreener /><Where /></SWRConfig></MemoryRouter>)
const scanBodies = () => fetch.mock.calls.filter(([u]) => String(u) === '/api/screener/scan').map(([, o]) => JSON.parse(o.body))
const sleep = ms => new Promise(r => setTimeout(r, ms))
const keysOf = body => (body.filters || []).map(f => f.key).sort()
// Back/forward to an encoded screen: what the browser does, as useScreenSpec hears it.
const goTo = filters => act(() => {
  window.history.pushState(null, '', `/?${SPEC_PARAM}=${encodeSpec({ filters, sort: { ...DEFAULT_SORT }, view: 'overview' })}`)
  window.dispatchEvent(new PopStateEvent('popstate'))
})
const scanReply = (rows, total = rows.length) => ({ ok: true, json: async () => ({ rows, total, page: 1, snapshot_date: '2026-10-12' }) })

test('an answer for screen A that lands after the switch to B is dropped: never shown, the list waits for B', async () => {
  let releaseA = null
  extra = (url, opts) => {
    if (url !== '/api/screener/scan') return null
    const keys = keysOf(JSON.parse(opts.body))
    if (keys.includes('rs_rank')) return new Promise(() => {}) // B, still on its way
    if (keys.includes('universe')) return new Promise(r => { releaseA = () => r(scanReply([AAA])) }) // A, held
    return null
  }
  mount()
  await waitFor(() => screen.getByTestId('focus-row-MU'))
  await sleep(350) // past the quiet window: the switch to A fires at once
  goTo({ universe: UCT })
  await waitFor(() => expect(releaseA).toBeTypeOf('function'))
  goTo({ universe: UCT, rs_rank: RS90 }) // inside the window: B waits on the debounce
  await act(async () => { releaseA() })
  await sleep(50)
  expect(screen.queryByTestId('focus-row-AAA')).toBeNull()
  expect(screen.getByTestId('focus-row-MU')).toBeInTheDocument()
  expect(screen.getByRole('listbox')).toHaveAttribute('aria-busy', 'true')
  expect(screen.getByTestId('screen-count')).toHaveTextContent('…')
  // the why strip still reads the listed screen's criteria (no RS Rank line over X's rows)
  expect(within(screen.getByTestId('focus-chart-pane')).queryByText(/RS Rank/)).toBeNull()
  // Minor 5: the pane's row actions say they are waiting
  for (const name of ['Flag', 'Add to watchlist']) {
    const b = within(screen.getByTestId('focus-chart-pane')).getByRole('button', { name })
    expect(b).toHaveAttribute('aria-disabled', 'true')
    expect(b.className).toMatch(/btnBusy/)
  }
})

test('A→B→C quickly with B answering last-but-one: B is never listed, and undo after C empties returns to the screen last seen with rows', async () => {
  let releaseB = null
  extra = (url, opts) => {
    if (url !== '/api/screener/scan') return null
    const keys = keysOf(JSON.parse(opts.body))
    if (keys.includes('universe') && keys.includes('rs_rank')) return new Promise(r => { releaseB = () => r(scanReply([AAA])) }) // B
    if (keys.includes('universe')) return new Promise(() => {}) // A, superseded
    if (keys.includes('rs_rank')) return scanReply([], 0) // C
    return null
  }
  mount()
  await waitFor(() => screen.getByTestId('focus-row-MU'))
  await sleep(350)
  goTo({ universe: UCT }) // A fires at once
  goTo({ universe: UCT, rs_rank: RS90 }) // B fires when the window closes
  await waitFor(() => expect(releaseB).toBeTypeOf('function'))
  goTo({ rs_rank: { op: 'gte', min: 50 } }) // C, inside B's window
  await act(async () => { releaseB() }) // B answers before C is even asked
  await sleep(50)
  expect(screen.queryByTestId('focus-row-AAA')).toBeNull()
  await waitFor(() => expect(screen.getByText(/took the list from 2 to 0/)).toBeInTheDocument())
  expect(screen.queryByTestId('focus-row-AAA')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Undo that change' }))
  await waitFor(() => screen.getByTestId('focus-row-MU'))
  expect(scanBodies().at(-1).filters).toEqual([])
})

test('row actions do nothing while the new screen is pending: Enter does not leave for the chart', async () => {
  extra = (url, opts) => (url === '/api/screener/scan' && keysOf(JSON.parse(opts.body)).includes('universe') ? new Promise(() => {}) : null)
  mountAt()
  await waitFor(() => screen.getByTestId('focus-row-MU'))
  goTo({ universe: UCT })
  await waitFor(() => expect(screen.getByRole('listbox')).toHaveAttribute('aria-busy', 'true'))
  fireEvent.keyDown(screen.getByRole('listbox'), { key: 'ArrowDown' }) // the highlight may still move
  expect(screen.getByTestId('stockchart')).toHaveAttribute('data-sym', 'ECO')
  fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Enter' })
  expect(screen.getByTestId('location')).toHaveTextContent(/^\/$/)
})

test('A→B→A: an answer for A that landed while B was current is used when the member returns to A', async () => {
  let releaseA = null
  extra = (url, opts) => {
    if (url !== '/api/screener/scan') return null
    const keys = keysOf(JSON.parse(opts.body))
    if (keys.includes('rs_rank')) return scanReply([], 0) // B
    if (keys.includes('universe')) return new Promise(r => { releaseA = () => r(scanReply([AAA])) }) // A, held
    return null
  }
  mount()
  await waitFor(() => screen.getByTestId('focus-row-MU'))
  await sleep(350)
  goTo({ universe: UCT }) // A fires at once
  await waitFor(() => expect(releaseA).toBeTypeOf('function'))
  goTo({ universe: UCT, rs_rank: RS90 }) // B queued
  await act(async () => { releaseA() }) // A lands while B is current: not listed
  await sleep(20)
  expect(screen.queryByTestId('focus-row-AAA')).toBeNull()
  goTo({ universe: UCT }) // back to A: the scan does not ask again for the spec it already sent
  await waitFor(() => screen.getByTestId('focus-row-AAA'))
  expect(screen.getByRole('listbox')).toHaveAttribute('aria-busy', 'false')
  expect(screen.getByTestId('screen-count')).toHaveTextContent('1')
  await sleep(400)
  expect(scanBodies().some(b => keysOf(b).includes('rs_rank'))).toBe(false) // B never asked
  expect(screen.getByRole('listbox')).toHaveAttribute('aria-busy', 'false')
})

test('the list is dimmed and busy while the new screen is pending, and clears when it answers', async () => {
  let releaseA = null
  extra = (url, opts) => {
    if (url !== '/api/screener/scan' || !keysOf(JSON.parse(opts.body)).includes('universe')) return null
    return new Promise(r => { releaseA = () => r(scanReply([AAA])) })
  }
  mount()
  await waitFor(() => screen.getByTestId('focus-row-MU'))
  expect(screen.getByRole('listbox')).toHaveAttribute('aria-busy', 'false')
  expect(screen.getByTestId('screen-count')).toHaveTextContent('2')
  goTo({ universe: UCT })
  await waitFor(() => expect(screen.getByRole('listbox')).toHaveAttribute('aria-busy', 'true'))
  expect(screen.getByRole('listbox').closest('[data-pending]')).not.toBeNull()
  expect(screen.getByTestId('focus-row-MU')).toBeInTheDocument() // the old rows stay, dimmed
  expect(screen.getByTestId('screen-count')).toHaveTextContent('…')
  await waitFor(() => expect(releaseA).toBeTypeOf('function'))
  await act(async () => { releaseA() })
  await waitFor(() => screen.getByTestId('focus-row-AAA'))
  expect(screen.getByRole('listbox')).toHaveAttribute('aria-busy', 'false')
  expect(screen.getByRole('listbox').closest('[data-pending]')).toBeNull()
  expect(screen.getByTestId('screen-count')).toHaveTextContent('1')
})

test('undo survives a 0→0 step and still goes back to the last screen with rows', async () => {
  extra = (url, opts) => {
    if (url !== '/api/screener/scan') return null
    return keysOf(JSON.parse(opts.body)).length ? scanReply([], 0) : null
  }
  mount()
  await waitFor(() => screen.getByTestId('focus-row-MU'))
  goTo({ universe: UCT })
  await waitFor(() => expect(screen.getByText(/took the list from 2 to 0/)).toBeInTheDocument())
  goTo({ universe: UCT, rs_rank: RS90 })
  expect(screen.getByTestId('screen-count')).toHaveTextContent('…') // the second change is pending
  await waitFor(() => expect(screen.getByTestId('screen-count')).toHaveTextContent('0')) // and has folded
  expect(scanBodies().some(b => keysOf(b).includes('rs_rank'))).toBe(true)
  expect(screen.getByText(/took the list from 2 to 0/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Undo that change' }))
  await waitFor(() => screen.getByTestId('focus-row-MU'))
  expect(scanBodies().at(-1).filters).toEqual([])
})

const STARTERS = [{ id: 'starter_momentum_leaders', name: 'Momentum leaders', spec: { filters: [{ key: 'rs_rank', op: 'gte', min: 90 }] } }]
test('the screen name survives List→Table→List and back/forward, and clears when the spec no longer matches', async () => {
  extra = url => (url.startsWith('/api/screener/saved-screens') ? { ok: true, json: async () => ({ saved: [], starters: STARTERS }) } : null)
  mount()
  await waitFor(() => expect(screen.getByRole('button', { name: /Momentum leaders/ })).toBeInTheDocument())
  fireEvent.click(screen.getByRole('button', { name: 'Table' }))
  expect(await screen.findByTestId('table-mode')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'List' }))
  await waitFor(() => screen.getByTestId('focus-row-MU'))
  expect(screen.getByRole('button', { name: /Momentum leaders/ })).toBeInTheDocument()
  // back to a screen nobody named: the old name does not stay on it
  goTo({ rs_rank: { op: 'gte', min: 55 } })
  await waitFor(() => expect(screen.getByRole('button', { name: /Custom screen/ })).toBeInTheDocument())
  expect(screen.queryByRole('button', { name: /Momentum leaders/ })).toBeNull()
  // forward to the named one again: the name comes back
  goTo({ rs_rank: RS90 })
  await waitFor(() => expect(screen.getByRole('button', { name: /Momentum leaders/ })).toBeInTheDocument())
  expect(screen.queryByRole('button', { name: /\(edited\)/ })).toBeNull()
})

test('a just-saved screen keeps its name across List→Table→List, from this tab alone', async () => {
  // The saved-screens read never lists it, so only the tab's own record can name it again.
  extra = (url, opts) => (url === '/api/screener/saved-screens' && opts?.method === 'POST'
    ? { ok: true, json: async () => ({ id: 7, name: 'Mine' }) } : null)
  window.history.replaceState(null, '', `/?${SPEC_PARAM}=${encodeSpec({ filters: { rs_rank: { op: 'gte', min: 77 } }, sort: { ...DEFAULT_SORT }, view: 'overview' })}`)
  mount()
  await waitFor(() => screen.getByTestId('focus-row-MU'))
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  fireEvent.click(await screen.findByRole('menuitem', { name: /Save as a screen/ }))
  const dialog = await screen.findByRole('dialog', { name: 'Save as a screen' })
  fireEvent.change(within(dialog).getByLabelText('Screen name'), { target: { value: 'Mine' } })
  fireEvent.submit(dialog)
  await waitFor(() => expect(screen.getByRole('button', { name: /^Mine/ })).toBeInTheDocument())
  fireEvent.click(screen.getByRole('button', { name: 'Table' }))
  fireEvent.click(screen.getByRole('button', { name: 'List' }))
  await waitFor(() => screen.getByTestId('focus-row-MU'))
  expect(screen.getByRole('button', { name: /^Mine/ })).toBeInTheDocument()
})

test('a remount on a spec that no longer matches the stored name gets no name', async () => {
  extra = url => (url.startsWith('/api/screener/saved-screens') ? { ok: true, json: async () => ({ saved: [], starters: STARTERS }) } : null)
  const { unmount } = mount()
  await waitFor(() => expect(screen.getByRole('button', { name: /Momentum leaders/ })).toBeInTheDocument())
  unmount()
  window.history.replaceState(null, '', `/?${SPEC_PARAM}=${encodeSpec({ filters: { rs_rank: { op: 'gte', min: 60 } }, sort: { ...DEFAULT_SORT }, view: 'overview' })}`)
  mount()
  await waitFor(() => screen.getByTestId('focus-row-MU'))
  await sleep(50)
  expect(screen.queryByRole('button', { name: /Momentum leaders/ })).toBeNull()
})

test('Enter writes a just-made change to the URL before it leaves for the full chart', async () => {
  mount()
  await waitFor(() => screen.getByTestId('focus-row-MU'))
  await sleep(450) // let the mount-time URL write settle
  // Timers are held from here, so the 400 ms debounced URL write cannot run on its own
  // however slow the box is: only a flush can write it. The scan's answer is a promise.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  try {
    fireEvent.click(screen.getByRole('button', { name: /Filters/ }))
    fireEvent.click(screen.getByRole('button', { name: /Universe: All stocks/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'UCT Universe' }))
    fireEvent.click(screen.getByRole('button', { name: 'Close filters' }))
    for (let i = 0; i < 10; i++) await act(async () => {}) // the new screen's answer lands
    expect(screen.getByRole('listbox')).toHaveAttribute('aria-busy', 'false')
    expect(decodeSpec(new URLSearchParams(window.location.search).get(SPEC_PARAM))?.filters?.universe).toBeUndefined()
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Enter' })
    expect(decodeSpec(new URLSearchParams(window.location.search).get(SPEC_PARAM))?.filters?.universe?.value).toBe('uct')
  } finally {
    vi.useRealTimers()
  }
})

test('a later page skips tickers already loaded', async () => {
  extra = (url, opts) => {
    if (url !== '/api/screener/scan') return null
    const page = JSON.parse(opts.body).page
    return { ok: true, json: async () => ({ rows: page === 1 ? rowsX : [rowsX[1], AAA], total: 3, page, snapshot_date: '2026-10-12' }) }
  }
  const IO = globalThis.IntersectionObserver
  globalThis.IntersectionObserver = class { constructor(cb) { this.cb = cb } observe() { this.cb([{ isIntersecting: true }]) } disconnect() {} }
  try {
    mount()
    await waitFor(() => screen.getByTestId('focus-row-AAA'))
    expect(screen.getAllByTestId('focus-row-ECO')).toHaveLength(1)
    expect(screen.getAllByRole('option').map(o => o.getAttribute('data-testid'))).toEqual(['focus-row-MU', 'focus-row-ECO', 'focus-row-AAA'])
  } finally {
    globalThis.IntersectionObserver = IO
  }
})

test('a failed scan for the new screen does not leave "…" in the screen button', async () => {
  extra = (url, opts) => (url === '/api/screener/scan' && keysOf(JSON.parse(opts.body)).includes('universe')
    ? { ok: false, status: 504, json: async () => ({}) } : null)
  mount()
  await waitFor(() => screen.getByTestId('focus-row-MU'))
  goTo({ universe: UCT })
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent("The screen didn't load"))
  expect(screen.getByTestId('screen-count')).not.toHaveTextContent('…')
})

test('Important 1: a failed scan for the new screen shows no number in the screen button, never the old one', async () => {
  extra = (url, opts) => (url === '/api/screener/scan' && keysOf(JSON.parse(opts.body)).includes('universe')
    ? { ok: false, status: 503, json: async () => ({}) } : null)
  mount()
  await waitFor(() => screen.getByTestId('focus-row-MU'))
  await waitFor(() => expect(screen.getByTestId('screen-count')).toHaveTextContent('2'))
  goTo({ universe: UCT })
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent("The screen didn't load"))
  expect(screen.getByTestId('screen-count').textContent).toBe('')
  const label = screen.getByTestId('screen-count').closest('button').getAttribute('aria-label')
  expect(label).not.toMatch(/[0-9]/)
  expect(label).not.toMatch(/matches/)
})
test('Important 1: while the new screen is pending the Save menu offers no frozen list of the old one', async () => {
  extra = (url, opts) => {
    if (url === '/api/screener/save-fork') return { ok: true, json: async () => ({ choices: [{ id: 'frozen_list', available: true }, { id: 'definition', available: true }] }) }
    if (url === '/api/screener/to-watchlist') return { ok: true, json: async () => ({ available: true, max_symbols: 500 }) }
    if (url === '/api/screener/scan' && keysOf(JSON.parse(opts.body)).includes('universe')) return new Promise(() => {})
    return null
  }
  mount()
  await waitFor(() => screen.getByTestId('focus-row-MU'))
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(screen.getByRole('menuitem', { name: /Save today/ })).toBeInTheDocument())
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  await sleep(350)
  goTo({ universe: UCT })
  await waitFor(() => expect(screen.getByRole('listbox')).toHaveAttribute('aria-busy', 'true'))
  if (!screen.queryByRole('menu', { name: 'Save' })) fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  const menu = screen.getByRole('menu', { name: 'Save' })
  expect(within(menu).queryByRole('menuitem', { name: /Save today/ })).toBeNull()
})
test('Minor 2: a dropped answer never describes the listed screen: its coverage note stays the listed one', async () => {
  let releaseA = null
  extra = (url, opts) => {
    if (url !== '/api/screener/scan') return null
    const keys = keysOf(JSON.parse(opts.body))
    if (keys.includes('rs_rank')) return new Promise(() => {})
    if (keys.includes('universe')) {
      return new Promise(r => { releaseA = () => r({ ok: true, json: async () => ({ rows: [AAA], total: 1, page: 1, snapshot_date: '2026-10-12', coverage: { evaluated: 10, answered: 5, dropped: 5, not_computable: 0 } }) }) })
    }
    return null
  }
  mount()
  await waitFor(() => screen.getByTestId('focus-row-MU'))
  await sleep(350)
  goTo({ universe: UCT })
  await waitFor(() => expect(releaseA).toBeTypeOf('function'))
  goTo({ universe: UCT, rs_rank: RS90 })
  await act(async () => { releaseA() })
  await sleep(50)
  expect(screen.getByTestId('focus-row-MU')).toBeInTheDocument()
  expect(screen.queryByText(/could not be checked/)).toBeNull()
})
test('Minor 2: after a scan error the old screen coverage note is gone with its list', async () => {
  extra = (url, opts) => {
    if (url !== '/api/screener/scan') return null
    if (keysOf(JSON.parse(opts.body)).includes('universe')) return { ok: false, status: 504, json: async () => ({}) }
    return { ok: true, json: async () => ({ rows: rowsX, total: 2, page: 1, snapshot_date: '2026-10-12', coverage: { evaluated: 10, answered: 7, dropped: 3, not_computable: 0 } }) }
  }
  mount()
  await waitFor(() => expect(screen.getByText(/3 stocks could not be checked/)).toBeInTheDocument())
  goTo({ universe: UCT })
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent("The screen didn't load"))
  expect(screen.queryByText(/could not be checked/)).toBeNull()
})
