// MON / W — rendered text and real behaviour against a fake network. The watchlist routes are
// served by a fake `fetch`; the live-price store and the market clock are the only hooks stood in
// for (they poll a 2 s store and a 60 s clock).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, within, cleanup, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SWRConfig } from 'swr'

const clock = vi.hoisted(() => ({ state: { isOpen: true, isPremarket: false, isExtended: false } }))
const live = vi.hoisted(() => ({ prices: {}, asked: [] }))
vi.mock('../../../hooks/useMarketOpen', () => ({ default: () => clock.state }))
vi.mock('../../../hooks/useLivePrices', () => ({
  default: (tickers) => { live.asked.push(tickers); return { prices: live.prices, isLoading: false, error: null } },
}))

import WatchlistPanel, { FLAGGED_URL, LISTS_URL, PERF_URL, memberLists, pickList } from './WatchlistPanel'

const LISTS = [
  { id: 'ab12', name: 'Semis', items: [{ sym: 'NVDA' }, { sym: 'AMD' }, { sym: 'nvda' }] },
  { id: 'cd34', name: 'Software', items: [{ sym: 'CRWD' }] },
]
const FLAGGED = { id: 'fl99', name: 'Flagged', is_flagged_list: 1, items: [{ sym: 'TSLA' }] }

const realFetch = globalThis.fetch
let posts = []
function serve(routes) {
  posts = []
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const u = String(url)
    if ((init.method || 'GET') === 'POST') posts.push([u, JSON.parse(init.body)])
    const hit = routes[u]
    if (hit === undefined) return new Response('{}', { status: 404 })
    if (typeof hit === 'number') return new Response('{"detail":"x"}', { status: hit })
    if (typeof hit === 'function') return hit()
    return new Response(JSON.stringify(hit), { status: 200, headers: { 'Content-Type': 'application/json' } })
  })
}
const ok = (over = {}) => serve({
  [LISTS_URL]: LISTS, [FLAGGED_URL]: FLAGGED,
  [PERF_URL]: { NVDA: { '1w': 4.2, '1m': -2.1 }, AMD: { '1w': -1, '1m': 12 } }, ...over,
})

function renderPanel(props = {}) {
  return render(
    <MemoryRouter>
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <WatchlistPanel {...props} />
      </SWRConfig>
    </MemoryRouter>,
  )
}
const symsInTable = () => within(screen.getByTestId('terminal-watchlist-table'))
  .getAllByRole('row').slice(1).map((r) => r.getAttribute('data-testid')?.replace('terminal-watchlist-row-', ''))

beforeEach(() => {
  clock.state = { isOpen: true, isPremarket: false, isExtended: false }
  live.prices = {
    NVDA: { price: 182.4, change_pct: 3.1, volume: 41_000_000 },
    AMD: { price: 150.25, change_pct: -1.25, volume: 900_000 },
  }
  live.asked = []
})
afterEach(() => { cleanup(); globalThis.fetch = realFetch })

describe('MON — the table', () => {
  it('shows the first list live: last, % change, volume, 1W and 1M, with ONE pooled price ask', async () => {
    ok()
    const onRows = vi.fn()
    renderPanel({ onRows })
    await screen.findByTestId('terminal-watchlist-table')
    expect(symsInTable()).toEqual(['NVDA', 'AMD'])   // list order, deduped
    const nvda = screen.getByTestId('terminal-watchlist-row-NVDA')
    expect(nvda.textContent).toContain('182.40')
    expect(nvda.textContent).toContain('+3.10%')
    expect(nvda.textContent).toContain('41.0M')
    await screen.findByText('+4.2%')
    expect(nvda.textContent).toContain('-2.1%')
    expect(live.asked.at(-1)).toEqual(['NVDA', 'AMD'])
    expect(posts).toEqual([[PERF_URL, { tickers: ['NVDA', 'AMD'] }]])   // one batched read
    expect(onRows).toHaveBeenLastCalledWith(['$NVDA', '$AMD'])
    expect(screen.getByTestId('terminal-watchlist-session').textContent).toBe('Live')
    expect(screen.getByTestId('terminal-watchlist-pick-1').getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTestId('terminal-watchlist-pick-3').textContent).toBe('Flagged (1)')
  })

  it('MON 2, MON W:id (any case) and MON FLAGGED pick the list; a missing one is said out loud', async () => {
    ok()
    renderPanel({ list: '2' })
    await screen.findByTestId('terminal-watchlist-table')
    expect(symsInTable()).toEqual(['CRWD'])
    cleanup()
    ok(); renderPanel({ list: 'W:CD34' })
    await screen.findByTestId('terminal-watchlist-table')
    expect(symsInTable()).toEqual(['CRWD'])
    cleanup()
    ok(); renderPanel({ list: 'FLAGGED' })
    await screen.findByTestId('terminal-watchlist-table')
    expect(symsInTable()).toEqual(['TSLA'])
    cleanup()
    ok(); renderPanel({ list: '7' })
    await screen.findByTestId('terminal-watchlist-table')
    expect(screen.getByText('There is no list number 7; you have 3. Showing Semis.')).toBeTruthy()
    expect(symsInTable()).toEqual(['NVDA', 'AMD'])
  })

  it('a list chip switches the list; a header sorts, and List order puts it back', async () => {
    ok()
    renderPanel()
    await screen.findByTestId('terminal-watchlist-table')
    fireEvent.click(screen.getByTestId('terminal-watchlist-sort-pct'))
    expect(symsInTable()).toEqual(['NVDA', 'AMD'])          // biggest first
    fireEvent.click(screen.getByTestId('terminal-watchlist-sort-pct'))
    expect(symsInTable()).toEqual(['AMD', 'NVDA'])
    fireEvent.click(screen.getByTestId('terminal-watchlist-sort-sym'))
    expect(symsInTable()).toEqual(['AMD', 'NVDA'])          // A→Z
    fireEvent.click(screen.getByTestId('terminal-watchlist-sort-reset'))
    expect(symsInTable()).toEqual(['NVDA', 'AMD'])
    fireEvent.click(screen.getByTestId('terminal-watchlist-pick-2'))
    expect(symsInTable()).toEqual(['CRWD'])
  })

  it('a row click loads the name into the linked panels (the list keeps its function)', async () => {
    ok()
    const onRun = vi.fn()
    renderPanel({ onRun })
    await screen.findByTestId('terminal-watchlist-table')
    fireEvent.click(screen.getByLabelText('Load AMD into the linked panels'))
    expect(onRun).toHaveBeenCalledWith('$AMD', { keepFunction: true })
  })

  it('after hours the badge never says Live', async () => {
    clock.state = { isOpen: false, isPremarket: false, isExtended: false }
    ok()
    renderPanel()
    await screen.findByTestId('terminal-watchlist-table')
    expect(screen.getByTestId('terminal-watchlist-session').textContent).toBe('Last session')
  })
})

describe('MON — empty and failed', () => {
  it('no lists at all says how to add names, with a link to Charts', async () => {
    serve({ [LISTS_URL]: [], [FLAGGED_URL]: { id: 'fl', items: [] } })
    renderPanel()
    const empty = await screen.findByTestId('terminal-watchlist-empty')
    expect(empty.textContent).toContain('You have no watchlists yet.')
    expect(within(empty).getByRole('link', { name: 'Charts' }).getAttribute('href')).toBe('/charts')
    expect(empty.textContent).toContain('right-click')
  })

  it('a list with no names says how to add them', async () => {
    serve({ [LISTS_URL]: [{ id: 'e1', name: 'Ideas', items: [] }], [FLAGGED_URL]: { id: 'fl', items: [] } })
    renderPanel()
    const empty = await screen.findByTestId('terminal-watchlist-list-empty')
    expect(empty.textContent).toContain('Ideas has no names yet.')
  })

  it('a failed read is an error with Retry, never "no watchlists"', async () => {
    let n = 0
    serve({
      [LISTS_URL]: () => (++n === 1 ? new Response('{}', { status: 500 }) : new Response(JSON.stringify(LISTS), { status: 200 })),
      [FLAGGED_URL]: 500,
    })
    renderPanel()
    const err = await screen.findByTestId('terminal-watchlist-error')
    expect(err.textContent).toContain('Your watchlists could not be read just now.')
    expect(screen.queryByTestId('terminal-watchlist-empty')).toBeNull()
    await act(async () => { fireEvent.click(screen.getByText('Retry')) })
    expect(await screen.findByTestId('terminal-watchlist-table')).toBeTruthy()
    expect(screen.getByText(/Your flagged names could not be read just now/)).toBeTruthy()
  })

  it('1W / 1M failing leaves the live prices and says so', async () => {
    ok({ [PERF_URL]: 500 })
    renderPanel()
    await screen.findByText('1W and 1M could not be read just now; prices are still live.')
    expect(screen.getByTestId('terminal-watchlist-row-NVDA').textContent).toContain('182.40')
  })
})

describe('MON — the pure parts', () => {
  it('memberLists puts own lists first, Flagged last and only when it holds a name; pickList resolves', () => {
    const all = memberLists(LISTS, FLAGGED)
    expect(all.map((l) => l.name)).toEqual(['Semis', 'Software', 'Flagged'])
    expect(all[0].syms).toEqual(['NVDA', 'AMD'])
    expect(memberLists([{ id: 'p', name: 'Russell 2000', is_prebuilt: 1, items: [] }], { id: 'f', items: [] })).toEqual([])
    expect(pickList(all, null)).toEqual({ index: 0, missing: null })
    expect(pickList(all, 'W:AB12')).toEqual({ index: 0, missing: null })
    expect(pickList(all, 'FLAGGED')).toEqual({ index: 2, missing: null })
    expect(pickList(all, 'W:zz')).toEqual({ index: 0, missing: 'W:zz' })
    expect(pickList([], '2')).toEqual({ index: -1, missing: '2' })
  })
})
