// FocusScreener.test.jsx — the orchestrator, integrated with the network mocked at fetch.
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SWRConfig } from 'swr'
import { vi, beforeEach, expect, test } from 'vitest'
vi.mock('../../../../components/StockChart', () => ({ default: p => <div data-testid="stockchart" data-sym={p.sym} /> }))
vi.mock('../../shell/ScannerShell', () => ({ default: p => <div data-testid="table-mode">{p.toolbarLead}</div> }))
vi.mock('../../../../hooks/useRealtimePrices', () => ({ default: () => ({ prices: {} }) }))
vi.mock('../../../../hooks/useNeighborWarm', () => ({ useNeighborWarm: () => {} }))
vi.mock('../../../../utils/prefetchBars', () => ({ prefetchBars: () => {}, prefetchBarsToIDB: () => {}, warmMemFromIDB: () => {} }))
import FocusScreener from '../FocusScreener'
import { SPEC_PARAM, encodeSpec, decodeSpec } from '../../shell/specUrl'
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
  // Table mode's code is fetched on demand: it is not there in the same frame as the click
  expect(screen.queryByTestId('table-mode')).toBeNull()
  expect(await screen.findByTestId('table-mode')).toBeInTheDocument()
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
  // focus is back on the results, so the next W goes to the new list
  expect(document.activeElement).toBe(screen.getByRole('listbox'))
  fireEvent.keyDown(document.activeElement, { key: 'w' })
  await waitFor(() => expect(posts).toEqual(['/api/watchlists/wl-1/items', '/api/watchlists/wl-2/items']))
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

// A meta whose view mixes numeric and text columns, and whose library carries the Base Structure filter.
const META_RICH = { ...META, views: [{ key: 'overview', columns: ['ticker', 'company', 'price', 'sector', 'base_render', 'vol_ratio'] }],
  filters: [...META.filters,
    { key: 'price', label: 'Price', category: 'technical', type: 'range', presets: [{ label: 'Any' }] },
    { key: 'vol_ratio', label: 'Volume Ratio', category: 'technical', type: 'range', presets: [{ label: 'Any' }] },
    { key: 'sector', label: 'Sector', category: 'technical', type: 'enum', presets: [{ label: 'Any' }] },
    { key: 'base_structure', label: 'Base Structure', category: 'technical', type: 'enum', presets: [
      { label: 'Any' }, { label: 'Pocket Pivot', op: 'contains', value: ',pocket-pivot,' }] }] }
const richMeta = url => (url.startsWith('/api/screener/meta') ? { ok: true, json: async () => META_RICH } : null)

test('the sort control is a menu of the sortable columns; picking one sorts, the last item reverses', async () => {
  extra = richMeta
  mount()
  await waitFor(() => screen.getByTestId('focus-row-MU'))
  fireEvent.click(screen.getByRole('button', { name: 'Sort: UCT ↓' }))
  const menu = screen.getByRole('menu', { name: 'Sort: UCT ↓' })
  // the current sort carries its direction; view columns from meta are offered
  expect(within(menu).getByRole('menuitem', { name: /UCT/ })).toHaveTextContent('↓')
  fireEvent.click(within(menu).getByRole('menuitem', { name: /^Price/ }))
  await waitFor(() => expect(scanBodies().at(-1).sort).toEqual({ key: 'price', dir: 'desc' }))
  fireEvent.click(screen.getByRole('button', { name: 'Sort: Price ↓' }))
  fireEvent.click(screen.getByRole('menuitem', { name: /Reverse order/ }))
  await waitFor(() => expect(scanBodies().at(-1).sort).toEqual({ key: 'price', dir: 'asc' }))
  expect(screen.getByRole('button', { name: 'Sort: Price ↑' })).toBeInTheDocument()
})
test('Save as a screen asks for a name inline: empty cannot save, Enter saves, Escape cancels', async () => {
  const posts = []
  extra = (url, opts) => {
    if (url === '/api/screener/saved-screens' && opts?.method === 'POST') { posts.push(JSON.parse(opts.body)); return { ok: true, json: async () => ({ id: 7, name: 'Leaders' }) } }
    return null
  }
  const prompt = vi.spyOn(window, 'prompt')
  mount()
  await waitFor(() => screen.getByTestId('focus-row-MU'))
  const trigger = screen.getByRole('button', { name: 'Save' })
  fireEvent.click(trigger)
  await waitFor(() => screen.getByRole('menuitem', { name: /Save as a screen/ }))
  fireEvent.click(screen.getByRole('menuitem', { name: /Save as a screen/ }))
  const dialog = await screen.findByRole('dialog', { name: 'Save as a screen' })
  const input = within(dialog).getByLabelText('Screen name')
  expect(document.activeElement).toBe(input)
  expect(within(dialog).getByRole('button', { name: 'Save' })).toBeDisabled()
  fireEvent.keyDown(input, { key: 'Escape' })
  expect(screen.queryByRole('dialog', { name: 'Save as a screen' })).toBeNull()
  expect(document.activeElement).toBe(trigger)
  expect(posts).toEqual([])
  fireEvent.click(trigger)
  fireEvent.click(screen.getByRole('menuitem', { name: /Save as a screen/ }))
  const again = await screen.findByRole('dialog', { name: 'Save as a screen' })
  fireEvent.change(within(again).getByLabelText('Screen name'), { target: { value: '  Leaders ' } })
  fireEvent.submit(again)
  await waitFor(() => expect(screen.getByTestId('focus-toast')).toHaveTextContent('Saved "Leaders"'))
  expect(posts).toHaveLength(1)
  expect(posts[0].name).toBe('Leaders')
  expect(prompt).not.toHaveBeenCalled()
  prompt.mockRestore()
})
test('Save as a screen stays hidden until the saved-screens read has answered', async () => {
  let release
  const gate = new Promise(res => { release = res })
  extra = url => (url.startsWith('/api/screener/saved-screens') ? gate.then(() => ({ ok: true, json: async () => ({ saved: [], starters: [] }) })) : null)
  // Arrive with a spec in the URL: a bare open holds its first scan until the saved screens answer.
  window.history.replaceState(null, '', `/?${SPEC_PARAM}=${encodeSpec({ filters: { rs_rank: { op: 'gte', min: 50 } } })}`)
  mount()
  await waitFor(() => screen.getByTestId('focus-row-MU'))
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  expect(within(screen.getByRole('menu', { name: 'Save' })).queryByRole('menuitem', { name: /Save as a screen/ })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  // the screen menu's "Save as new…" waits too
  fireEvent.click(screen.getByRole('button', { name: /Change screen/ }))
  expect(within(screen.getByRole('dialog', { name: 'Screens' })).queryByRole('button', { name: /Save as new/ })).toBeNull()
  fireEvent.keyDown(screen.getByRole('dialog', { name: 'Screens' }), { key: 'Escape' })
  release()
  await waitFor(() => {
    fireEvent.click(screen.getByRole('button', { name: /Change screen/ }))
    expect(within(screen.getByRole('dialog', { name: 'Screens' })).getByRole('button', { name: /Save as new/ })).toBeInTheDocument()
  })
  fireEvent.keyDown(screen.getByRole('dialog', { name: 'Screens' }), { key: 'Escape' })
  await waitFor(() => {
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(within(screen.getByRole('menu', { name: 'Save' })).getByRole('menuitem', { name: /Save as a screen/ })).toBeInTheDocument()
  })
})
test('Table mode keeps the how-to checklist reachable', async () => {
  localStorage.setItem('uct.screener.layout', 'table')
  render(<MemoryRouter><AuthContext.Provider value={{ howToChecklistsEnabled: true }}>
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}><FocusScreener /></SWRConfig>
  </AuthContext.Provider></MemoryRouter>)
  // Table mode is lazy-loaded: the table arrives a tick after the checklist
  expect(await screen.findByTestId('table-mode')).toBeInTheDocument()
  expect(screen.getByTestId('how-to-checklist')).toBeInTheDocument()
})
test('a later page that comes back empty ends paging (no endless load-more)', async () => {
  const pages = []
  extra = (url, opts) => {
    if (url !== '/api/screener/scan') return null
    const page = JSON.parse(opts.body).page
    pages.push(page)
    const body = { ok: true, json: async () => ({ rows: page === 1 ? rowsA : [], total: 5, page, snapshot_date: '2026-10-12' }) }
    // a later page takes a moment, as on a network: the list sees the load start and settle
    return page === 1 ? body : new Promise(res => setTimeout(() => res(body), 30))
  }
  // The sentinel is always in view: every observer reports it intersecting.
  const IO = globalThis.IntersectionObserver
  globalThis.IntersectionObserver = class { constructor(cb) { this.cb = cb } observe() { this.cb([{ isIntersecting: true }]) } disconnect() {} }
  try {
    mount()
    await waitFor(() => screen.getByTestId('focus-row-MU'))
    await waitFor(() => expect(pages).toContain(2))
    await new Promise(res => setTimeout(res, 1200))
    expect(pages.filter(p => p > 1)).toEqual([2])
    expect(screen.getByTestId('focus-row-ECO')).toBeInTheDocument()
  } finally {
    globalThis.IntersectionObserver = IO
  }
})
test('switching to Table keeps a filter change made just before', async () => {
  mount()
  await waitFor(() => screen.getByTestId('focus-row-MU'))
  await new Promise(res => setTimeout(res, 450)) // let the mount-time URL write settle
  fireEvent.click(screen.getByRole('button', { name: /Filters/ }))
  fireEvent.click(screen.getByRole('button', { name: /Universe: All stocks/ }))
  fireEvent.click(screen.getByRole('menuitem', { name: 'UCT Universe' }))
  fireEvent.click(screen.getByRole('button', { name: 'Table' }))
  const spec = decodeSpec(new URLSearchParams(window.location.search).get(SPEC_PARAM))
  expect(spec?.filters?.universe?.value).toBe('uct')
})
test('a sort key outside the visible columns is still offered, with its direction', async () => {
  const enc = encodeSpec({ filters: {}, sort: { key: 'rs_rank', dir: 'asc' } })
  window.history.replaceState(null, '', `/?${SPEC_PARAM}=${enc}`)
  mount()
  await waitFor(() => screen.getByTestId('focus-row-MU'))
  fireEvent.click(screen.getByRole('button', { name: 'Sort: RS Rank ↑' }))
  const item = within(screen.getByRole('menu', { name: 'Sort: RS Rank ↑' })).getByRole('menuitem', { name: /RS Rank/ })
  expect(item).toHaveTextContent('↑')
  fireEvent.click(screen.getByRole('menuitem', { name: /Reverse order/ }))
  await waitFor(() => expect(scanBodies().at(-1).sort).toEqual({ key: 'rs_rank', dir: 'desc' }))
})

const STARTERS = [
  { id: 'starter_momentum_leaders', name: 'Momentum leaders', spec: { filters: [{ key: 'rs_rank', op: 'gte', min: 90 }] } },
  { id: 'starter_power_play', name: 'Power play', spec: { filters: [{ key: 'rs_rank', op: 'gte', min: 70 }] } },
]
const withStarters = () => {
  extra = url => (url.startsWith('/api/screener/saved-screens') ? { ok: true, json: async () => ({ saved: [], starters: STARTERS }) } : null)
}
test('first load with no URL spec applies the first pinned screen, once', async () => {
  withStarters()
  mount()
  await waitFor(() => expect(screen.getByRole('button', { name: /Momentum leaders/ })).toBeInTheDocument())
  await waitFor(() => expect(scanBodies().some(b => (b.filters || []).some(f => f.key === 'rs_rank' && f.min === 90))).toBe(true))
  // a later filter change is not undone by a re-apply
  fireEvent.click(screen.getByRole('button', { name: /Momentum leaders/ }))
  fireEvent.click((await screen.findAllByRole('button', { name: 'Open Power play' }))[0])
  await waitFor(() => expect(scanBodies().at(-1).filters.some(f => f.min === 70)).toBe(true))
  await new Promise(r => setTimeout(r, 50))
  expect(scanBodies().at(-1).filters.some(f => f.min === 70)).toBe(true)
})
test('a bare first open sends exactly one scan, for the pinned screen (no whole-universe scan first)', async () => {
  // The saved screens answer AFTER the scan debounce, as they can in production: without the
  // hold, a whole-universe scan would already be on the wire before the pinned screen applied.
  extra = url => (url.startsWith('/api/screener/saved-screens')
    ? new Promise(r => setTimeout(() => r({ ok: true, json: async () => ({ saved: [], starters: STARTERS }) }), 450))
    : null)
  mount()
  await waitFor(() => expect(screen.getByRole('button', { name: /Momentum leaders/ })).toBeInTheDocument())
  await waitFor(() => screen.getByTestId('focus-row-MU'))
  await new Promise(r => setTimeout(r, 400)) // past the scan debounce: nothing else is coming
  const bodies = scanBodies()
  expect(bodies).toHaveLength(1)
  expect(bodies[0].filters.some(f => f.key === 'rs_rank' && f.min === 90)).toBe(true)
  // the count is held the same way: one request, for the pinned screen
  const counts = fetch.mock.calls.filter(([u]) => String(u) === '/api/screener/count').map(([, o]) => JSON.parse(o.body))
  expect(counts).toHaveLength(1)
  expect(counts[0].filters.some(f => f.key === 'rs_rank' && f.min === 90)).toBe(true)
})
test('the landing screen waits for prefs: a migrated favourite wins even when prefs answer after the screens', async () => {
  let releasePrefs
  const prefsGate = new Promise(r => { releasePrefs = r })
  extra = url => {
    if (url.startsWith('/api/screener/saved-screens')) return { ok: true, json: async () => ({ saved: [], starters: STARTERS }) }
    if (url.startsWith('/api/auth/preferences')) {
      return { ok: true, json: async () => { await prefsGate; return { screener_favorite_screens: JSON.stringify(['starter:starter_power_play']) } } }
    }
    return null
  }
  mount()
  // the saved screens have answered; the prefs have not: nothing is scanned yet
  await waitFor(() => expect(fetch.mock.calls.some(([u]) => String(u).startsWith('/api/screener/saved-screens'))).toBe(true))
  await new Promise(r => setTimeout(r, 400))
  expect(scanBodies()).toHaveLength(0)
  releasePrefs()
  await waitFor(() => expect(screen.getByRole('button', { name: /Power play/ })).toBeInTheDocument())
  await waitFor(() => expect(scanBodies()).toHaveLength(1))
  await new Promise(r => setTimeout(r, 400))
  expect(scanBodies()).toHaveLength(1)
  expect(scanBodies()[0].filters.some(f => f.key === 'rs_rank' && f.min === 70)).toBe(true)
})
test('a landing read that never answers does not hold the list forever', async () => {
  extra = url => (url.startsWith('/api/screener/saved-screens') ? new Promise(() => {}) : null)
  mount()
  await new Promise(r => setTimeout(r, 400))
  expect(scanBodies()).toHaveLength(0)
  await waitFor(() => screen.getByTestId('focus-row-MU'), { timeout: 5000 })
  expect(scanBodies()).toHaveLength(1)
}, 10000)
test('a URL spec is never overridden by the first pinned screen', async () => {
  withStarters()
  window.history.replaceState(null, '', `/?${SPEC_PARAM}=${encodeSpec({ filters: { rs_rank: { op: 'gte', min: 50 } }, sort: { key: 'price', dir: 'asc' }, view: 'overview', columns: null, rank: null, logic: null })}`)
  mount()
  await waitFor(() => screen.getByTestId('focus-row-MU'))
  await new Promise(r => setTimeout(r, 50))
  expect(screen.queryByRole('button', { name: /Momentum leaders/ })).toBeNull()
  expect(scanBodies().every(b => !(b.filters || []).some(f => f.min === 90))).toBe(true)
})

test('B9: sort offers numeric columns only, by the type meta gives each column', async () => {
  extra = richMeta
  mount()
  await waitFor(() => screen.getByTestId('focus-row-MU'))
  fireEvent.click(screen.getByRole('button', { name: 'Sort: UCT ↓' }))
  const names = within(screen.getByRole('menu', { name: 'Sort: UCT ↓' })).getAllByRole('menuitem').map(m => m.textContent)
  expect(names.some(n => n.startsWith('Price'))).toBe(true)
  // plain words: the sort menu reads the same label module as the chart pane
  expect(names.some(n => n.startsWith('Volume vs avg'))).toBe(true)
  // text columns never sort ("Structure ↓" ran Z to A)
  for (const text of ['Sector', 'Structure', 'Ticker', 'Company']) expect(names.some(n => n.startsWith(text))).toBe(false)
})
test('B2: a structure screen leads each row with the structure it was screened for', async () => {
  extra = richMeta
  scanRows = [{ ticker: 'UDB', price: 97, chg_pct_1d: 1, base_render: 'Ugly Double Bottom (Pocket Pivot) +1', vol_ratio: 1.1, base_pivot_px: 100 }]
  const enc = encodeSpec({ filters: { base_structure: { op: 'contains', value: ',pocket-pivot,' } }, sort: { key: 'uct_composite', dir: 'desc' } })
  window.history.replaceState(null, '', `/?${SPEC_PARAM}=${enc}`)
  mount()
  await waitFor(() => expect(screen.getByTestId('focus-row-UDB')).toHaveTextContent('Pocket Pivot · also Ugly Double Bottom'))
  expect(screen.getByTestId('pane-setup')).toHaveTextContent('Pocket Pivot · also Ugly Double Bottom')
})
test('B2: without a structure filter the row leads with the render head', async () => {
  extra = richMeta
  scanRows = [{ ticker: 'UDB', price: 97, chg_pct_1d: 1, base_render: 'Ugly Double Bottom (Pocket Pivot)', vol_ratio: 1.1 }]
  mount()
  await waitFor(() => screen.getByTestId('focus-row-UDB'))
  expect(screen.getByTestId('focus-row-UDB')).toHaveTextContent('Ugly Double Bottom')
  expect(screen.getByTestId('focus-row-UDB')).not.toHaveTextContent('also')
})

// ── wiring from Tasks 6 and 8 ─────────────────────────────────────────────────
test('"Skip to results" moves focus to the results list', async () => {
  mount()
  await waitFor(() => screen.getByTestId('focus-row-MU'))
  const link = screen.getByRole('link', { name: 'Skip to results' })
  // first of the page's skip links, before "Skip to save results"
  expect(screen.getAllByRole('link').filter(l => /^Skip to/.test(l.textContent))[0]).toBe(link)
  fireEvent.click(link)
  expect(document.activeElement).toBe(screen.getByRole('listbox'))
})
test('"?" opens the shortcuts sheet from the page root, and Help offers it with the ? hint', async () => {
  mount()
  await waitFor(() => screen.getByTestId('focus-row-MU'))
  expect(screen.queryByRole('dialog', { name: 'Keyboard shortcuts' })).toBeNull()
  fireEvent.keyDown(screen.getByRole('listbox'), { key: '?' })
  const sheet = await screen.findByRole('dialog', { name: 'Keyboard shortcuts' })
  expect(within(sheet).getByTestId('focus-shortcuts')).toHaveTextContent('Show this list')
})
test('Save is on the bar but disabled until the list has answered', async () => {
  let release
  const gate = new Promise(r => { release = r })
  // the held answer is the ordinary one: `extra` steps aside once released, so route() cannot recurse
  let held = true
  extra = url => (held && url === '/api/screener/scan' ? gate.then(() => { held = false; return route(url) }) : null)
  mount()
  const save = await screen.findByRole('button', { name: 'Save' })
  expect(save).toHaveAttribute('aria-disabled', 'true')
  fireEvent.click(save)
  expect(screen.queryByRole('menuitem', { name: /Save as a screen/ })).toBeNull()
  release()
  await waitFor(() => screen.getByTestId('focus-row-MU'))
  expect(screen.getByRole('button', { name: 'Save' })).not.toHaveAttribute('aria-disabled')
})
test('the screen button says "Loading screen…" until the landing screen is chosen', async () => {
  extra = url => (url.startsWith('/api/screener/saved-screens') ? new Promise(() => {}) : null)
  mount()
  await waitFor(() => expect(screen.getByText('Loading screen…')).toBeInTheDocument())
  expect(screen.queryByText('Custom screen')).toBeNull()
  await waitFor(() => screen.getByTestId('focus-row-MU'), { timeout: 5000 })
  expect(screen.queryByText('Loading screen…')).toBeNull()
}, 10000)
test('Table mode has ONE bar: the List|Table switch leads the table toolbar', async () => {
  mount()
  await waitFor(() => screen.getByTestId('focus-row-MU'))
  fireEvent.click(screen.getByRole('button', { name: 'Table' }))
  const table = await screen.findByTestId('table-mode')
  expect(within(table).getByRole('button', { name: 'List' })).toBeInTheDocument()
  expect(within(table).getByRole('button', { name: 'Table' })).toBeInTheDocument()
  expect(screen.getAllByRole('button', { name: 'List' })).toHaveLength(1)
  expect(screen.queryByRole('banner')).toBeNull()
})
const emptyAt = sp => {
  scanRows = []
  window.history.replaceState(null, '', `/?${SPEC_PARAM}=${encodeSpec(sp)}`)
}
test('an empty result offers removable pills built from the screen that came back empty', async () => {
  emptyAt({ filters: { rs_rank: { op: 'gte', min: 90 } } })
  mount()
  await screen.findByRole('button', { name: /^Remove RS Rank/ })
  await new Promise(r => setTimeout(r, 400)) // past the scan debounce: the screen has settled
  fireEvent.click(screen.getByRole('button', { name: /^Remove RS Rank/ }))
  await waitFor(() => expect(scanBodies().at(-1).filters.some(f => f.key === 'rs_rank')).toBe(false))
})
test('saving a screen that matches nothing says it will still rerun nightly', async () => {
  emptyAt({ filters: { rs_rank: { op: 'gte', min: 90 } } })
  mount()
  await screen.findByRole('button', { name: /^Remove RS Rank/ })
  await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).not.toHaveAttribute('aria-disabled'))
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  fireEvent.click(await screen.findByRole('menuitem', { name: /Save as a screen/ }))
  const dialog = await screen.findByRole('dialog', { name: 'Save as a screen' })
  expect(within(dialog).getByTestId('name-dialog-note')).toHaveTextContent('Nothing matches this screen today')
})
test('saving a screen with matches carries no zero-match note', async () => {
  mount()
  await waitFor(() => screen.getByTestId('focus-row-MU'))
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  fireEvent.click(await screen.findByRole('menuitem', { name: /Save as a screen/ }))
  const dialog = await screen.findByRole('dialog', { name: 'Save as a screen' })
  expect(within(dialog).queryByTestId('name-dialog-note')).toBeNull()
})

// -- Task 3 --
test('S2: a ranked screen shows its top_n everywhere a count is shown, never the eligible total', async () => {
  window.history.replaceState(null, '', `/?${SPEC_PARAM}=${encodeSpec({ filters: {}, rank: { criteria: [{ key: 'uct_composite', weight: 1 }], top_n: 50 } })}`)
  extra = url => {
    if (url === '/api/screener/scan') return { ok: true, json: async () => ({ rows: rowsA, total: 312, page: 1, snapshot_date: '2026-10-12' }) }
    if (url === '/api/screener/count') return { ok: true, json: async () => ({ count: 312 }) }
    return null
  }
  mount()
  await waitFor(() => screen.getByTestId('focus-row-MU'))
  expect(screen.getByTestId('screen-count')).toHaveTextContent('50')
  expect(screen.getByText('1 of 50')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /Filters/ }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Show 50 stocks' })).toBeInTheDocument())
  fireEvent.click(screen.getByRole('button', { name: 'Show 50 stocks' }))
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  extra = () => null
  expect(screen.queryByText(/312/)).toBeNull()
})
test('S4: a count that failed reads "Count unavailable" in the drawer, never 0', async () => {
  extra = url => (url === '/api/screener/count' ? { ok: false, status: 500, json: async () => ({ detail: 'boom' }) } : null)
  mount()
  await waitFor(() => screen.getByTestId('focus-row-MU'))
  fireEvent.click(screen.getByRole('button', { name: /Filters/ }))
  await waitFor(() => expect(screen.getByTestId('drawer-count-note')).toHaveTextContent('Count unavailable'))
  expect(screen.getByRole('button', { name: 'Show stocks' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /Show 0/ })).toBeNull()
})
