// "+ Add to list" in the universal ticker menu. The defect this file exists
// to pin: the menu used to depend on a `lists` prop that NO call site in the
// app passed, so every surface rendered "No lists yet". The menu now fetches
// the user's lists itself when the picker opens — these tests run the REAL
// SWR + fetch wire (mocking swr here would blind the test to the exact cut
// that shipped the bug).
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi, beforeEach, test, expect } from 'vitest'
import { SWRConfig } from 'swr'

vi.mock('../hooks/useFlagged', () => ({
  useFlagged: () => ({ toggle: vi.fn(), isFlagged: () => false }),
}))
vi.mock('../hooks/useTickerTags', () => ({
  default: () => ({ getTag: () => null, setTag: vi.fn(), removeTag: vi.fn() }),
}))
vi.mock('../hooks/useWatchlistAlerts', () => ({
  default: () => ({
    createAlert: vi.fn(), deleteAlert: vi.fn(),
    getAlertsForSym: () => [], hasAlert: () => false,
  }),
}))
vi.mock('../hooks/useTagColors', () => ({
  default: () => ({ tagColors: [] }),
}))
vi.mock('../hooks/useBreakpoint', () => ({ useIsTouch: () => false }))

import TickerActionsMenu from './TickerActions'

const MENU = { sym: 'MU', x: 100, y: 100 }

// A fresh SWR cache per render — the module-level cache would otherwise leak
// one test's lists into the next.
const renderMenu = (props = {}) => render(
  <MemoryRouter>
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <TickerActionsMenu menu={MENU} onClose={vi.fn()} {...props} />
    </SWRConfig>
  </MemoryRouter>,
)

beforeEach(() => {
  global.fetch = vi.fn(async () => ({ ok: true, json: async () => [] }))
})

test('opening the picker fetches the user lists itself — no prop required', async () => {
  global.fetch = vi.fn(async (url) => {
    if (url === '/api/watchlists') {
      return { ok: true, json: async () => [{ id: 'a', name: 'Momentum' }, { id: 'b', name: 'Earnings' }] }
    }
    return { ok: true, json: async () => ({}) }
  })
  renderMenu()
  fireEvent.click(screen.getByRole('button', { name: /add to list/i }))
  // The bug rendered "No lists yet" here for every user in the app.
  await screen.findByRole('button', { name: 'Momentum' })
  await screen.findByRole('button', { name: 'Earnings' })
  expect(screen.queryByText(/no lists yet/i)).toBeNull()
  expect(global.fetch).toHaveBeenCalledWith('/api/watchlists', expect.anything())
})

test('picking a list POSTs the symbol to it and closes the menu', async () => {
  const onClose = vi.fn()
  const posts = []
  global.fetch = vi.fn(async (url, opts) => {
    if (url === '/api/watchlists' && !opts?.method) {
      return { ok: true, json: async () => [{ id: 'a', name: 'Momentum' }] }
    }
    posts.push([url, opts])
    return { ok: true, json: async () => ({}) }
  })
  renderMenu({ onClose })
  fireEvent.click(screen.getByRole('button', { name: /add to list/i }))
  fireEvent.click(await screen.findByRole('button', { name: 'Momentum' }))
  await waitFor(() => expect(onClose).toHaveBeenCalled())
  const [url, opts] = posts[0]
  expect(url).toBe('/api/watchlists/a/items')
  expect(JSON.parse(opts.body)).toEqual({ sym: 'MU', notes: '' })
})

test('a truly empty account says "No lists yet" — and can create one inline', async () => {
  const calls = []
  global.fetch = vi.fn(async (url, opts) => {
    calls.push([url, opts])
    if (url === '/api/watchlists' && !opts?.method) {
      return { ok: true, json: async () => [] }
    }
    if (url === '/api/watchlists' && opts?.method === 'POST') {
      return { ok: true, json: async () => ({ id: 'new-1', name: 'Swing ideas' }) }
    }
    return { ok: true, json: async () => ({}) }
  })
  renderMenu()
  fireEvent.click(screen.getByRole('button', { name: /add to list/i }))
  await screen.findByText(/no lists yet/i)
  // Inline create: type a name, Enter — list created, symbol added.
  fireEvent.change(screen.getByPlaceholderText(/new list/i), { target: { value: 'Swing ideas' } })
  fireEvent.keyDown(screen.getByPlaceholderText(/new list/i), { key: 'Enter' })
  await waitFor(() => {
    const urls = calls.map(([u, o]) => `${o?.method || 'GET'} ${u}`)
    expect(urls).toContain('POST /api/watchlists')
    expect(urls).toContain('POST /api/watchlists/new-1/items')
  })
  const create = calls.find(([u, o]) => u === '/api/watchlists' && o?.method === 'POST')
  expect(JSON.parse(create[1].body).name).toBe('Swing ideas')
})

test('an explicit lists prop wins — no self-fetch fires', async () => {
  renderMenu({ lists: [{ id: 'p', name: 'Provided' }] })
  fireEvent.click(screen.getByRole('button', { name: /add to list/i }))
  await screen.findByRole('button', { name: 'Provided' })
  expect(global.fetch).not.toHaveBeenCalledWith('/api/watchlists', expect.anything())
})

test('prebuilt (UCT-curated) lists are not offered — the seeder owns them, and the owner holds ~30', async () => {
  global.fetch = vi.fn(async (url) => {
    if (url === '/api/watchlists') {
      return { ok: true, json: async () => [
        { id: 'a', name: 'Momentum' },
        { id: 'p', name: 'Sunday Scans — August 16, 2026', is_prebuilt: 1 },
        { id: 'q', name: 'Liquid Major ETFs', is_prebuilt: 1 },
      ] }
    }
    return { ok: true, json: async () => ({}) }
  })
  renderMenu()
  fireEvent.click(screen.getByRole('button', { name: /add to list/i }))
  await screen.findByRole('button', { name: 'Momentum' })   // control: the fetch wire is live
  expect(screen.queryByRole('button', { name: /sunday scans/i })).toBeNull()
  expect(screen.queryByRole('button', { name: /liquid major/i })).toBeNull()
})

test('an account whose only lists are prebuilt still gets the inline "New list" path, not a wall of UCT names', async () => {
  global.fetch = vi.fn(async (url) => {
    if (url === '/api/watchlists') {
      return { ok: true, json: async () => [{ id: 'p', name: 'Sunday Scans — August 16, 2026', is_prebuilt: 1 }] }
    }
    return { ok: true, json: async () => ({}) }
  })
  renderMenu()
  fireEvent.click(screen.getByRole('button', { name: /add to list/i }))
  await screen.findByText(/no lists yet/i)
  expect(screen.getByPlaceholderText(/new list/i)).toBeInTheDocument()
})
