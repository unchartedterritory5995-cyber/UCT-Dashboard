// RS screens (unit U5), item 1 on the page: where a member lands once the payload carries the
// RS screens. A new member lands on UCT RS Leaders; a member's stored pins and last-used screen
// are never overridden.
import { screen, waitFor, fireEvent, within } from '@testing-library/react'
import { vi, beforeEach, expect, test } from 'vitest'
vi.mock('../../../../components/StockChart', () => ({ default: p => <div data-testid="stockchart" data-sym={p.sym} /> }))
vi.mock('../ScreenerChartWidget', () => ({ default: p => <div data-testid="stockchart" data-sym={p.sym} /> }))
vi.mock('../../shell/ScannerShell', () => ({ default: () => <div data-testid="table-mode" /> }))
vi.mock('../../../../hooks/useRealtimePrices', () => ({ default: () => ({ prices: {} }) }))
vi.mock('../../../../hooks/useNeighborWarm', () => ({ useNeighborWarm: () => {} }))
vi.mock('../../../../utils/prefetchBars', () => ({ prefetchBars: () => {}, prefetchBarsToIDB: () => {}, warmMemFromIDB: () => {}, prewarmVisibleList: () => {} }))
import { __resetCountCache } from '../useLazyCounts'
import { lastScreenKey } from '../landing'
import { net, resetNet, installFetch, mount, scanBodies, pin } from './rsHarness'
import { STARTERS_ON, PLAIN_STARTERS, HIDDEN_STARTERS } from './rsScreensFixture'

beforeEach(() => {
  __resetCountCache()
  localStorage.clear()
  sessionStorage.clear()
  window.history.replaceState(null, '', '/')
  resetNet()
  installFetch()
})
const landedOn = name => waitFor(() => expect(screen.getByRole('button', { name: new RegExp(`^${name}.*Change screen`) })).toBeInTheDocument())

test('a new member lands on UCT RS Leaders, with the four RS screens pinned first', async () => {
  mount()
  await landedOn('UCT RS Leaders')
  expect(scanBodies().at(-1).rank).toEqual({ criteria: [{ key: 'rs_rating_score', weight: 1 }], top_n: 50 })
  fireEvent.click(screen.getByRole('button', { name: /Change screen/ }))
  const pinned = within(screen.getByRole('dialog', { name: 'Screens' })).getByRole('region', { name: 'Pinned' })
  expect(within(pinned).getAllByRole('button', { name: /^Open / }).map(b => b.querySelector('span').textContent))
    .toEqual(['UCT RS Leaders', 'RS New Highs', 'RS New High Before Price', 'Top RS Rating', 'Power plays', 'Tight bases', '3 weeks tight'])
})

test('without the RS screens in the payload a new member lands where they do today', async () => {
  net.starters = PLAIN_STARTERS
  mount()
  await landedOn('Power plays')
})

test("a member's stored pins are kept: the landing and the Pinned list are theirs", async () => {
  pin(['starter_tight_base', 'starter_momentum_leaders'])
  mount()
  await landedOn('Tight bases')
  fireEvent.click(screen.getByRole('button', { name: /Change screen/ }))
  const pinned = within(screen.getByRole('dialog', { name: 'Screens' })).getByRole('region', { name: 'Pinned' })
  // The second pin is hidden from the groups now, and still theirs under Pinned.
  expect(within(pinned).getAllByRole('button', { name: /^Open / }).map(b => b.querySelector('span').textContent))
    .toEqual(['Tight bases', 'Leaders (RS ≥ 90)'])
})

test("a member's last-used screen wins over the new defaults, even a hidden one", async () => {
  const was = HIDDEN_STARTERS.find(s => s.id === 'starter_momentum_leaders')
  localStorage.setItem(lastScreenKey('member-a'), JSON.stringify({ id: was.id, name: was.name, kind: 'starter', spec: was.spec }))
  mount()
  await landedOn('Leaders \\(RS ≥ 90\\)')
  // The server has answered and the screen still stands.
  await waitFor(() => expect(fetch.mock.calls.some(([u]) => String(u).startsWith('/api/screener/saved-screens'))).toBe(true))
  await new Promise(r => setTimeout(r, 50))
  expect(screen.getByRole('button', { name: /^Leaders \(RS ≥ 90\).*Change screen/ })).toBeInTheDocument()
  expect(STARTERS_ON.some(s => s.id === was.id && s.hidden)).toBe(true)
})
