import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi, beforeEach, afterEach, test, expect } from 'vitest'
import WatchlistPicker from './WatchlistPicker'
import { SWRConfig } from 'swr'

// A Watchlist widget scopes to ONE list, so this "Add a Watchlist" screen is the
// only place a new list can be created from the widget. These cover that path.
//
// The tabbed-landing redesign (e53d9910) renamed the affordance "New list…" →
// "New watchlist" — deliberate copy, pinned here. What that same commit dropped
// by accident is NOT deliberate and is pinned too: the input's accessible name
// and the create-failed message (it had become `if (!res.ok) return`, a dead
// Create button with no feedback).

vi.mock('../../../hooks/useFlagged', () => ({
  useFlagged: () => ({ flagged: ['NVDA'], flaggedName: 'Flagged' }),
}))
vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({ user: { display_name: 'Test' } }),
}))

let created = []

beforeEach(() => {
  created = []
  vi.stubGlobal('fetch', vi.fn((url, opts) => {
    if (String(url) === '/api/watchlists' && opts?.method === 'POST') {
      const body = JSON.parse(opts.body)
      if (body.name === 'BOOM') return Promise.resolve({ ok: false, status: 500 })
      // A 2xx that carries no id — the shape that would build `user:undefined`.
      if (body.name === 'GHOST') return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
      const row = { id: 'new-1', name: body.name, items: [] }
      created.push(row)
      return Promise.resolve({ ok: true, json: () => Promise.resolve(row) })
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve([]) })
  }))
})
afterEach(() => { vi.unstubAllGlobals() })

test('offers a way to create a new list', async () => {
  render(<WatchlistPicker onPick={() => {}} />)
  expect(await screen.findByRole('button', { name: /new watchlist/i })).toBeInTheDocument()
})

test('creating a list posts it and immediately picks it, so the widget lands in the new list', async () => {
  const user = userEvent.setup()
  const onPick = vi.fn()
  render(<WatchlistPicker onPick={onPick} />)

  await user.click(await screen.findByRole('button', { name: /new watchlist/i }))
  await user.type(screen.getByLabelText(/new watchlist name/i), 'Breakouts')
  await user.click(screen.getByRole('button', { name: /^create$/i }))

  // objectContaining, not an exact match: handlePick also stamps which tab the
  // pick came from, and a chosen template contributes settings/cols. What this
  // test exists to prove is that the list just created is the one picked — so
  // it pins key and name, and stays green when the payload gains a field.
  await waitFor(() => expect(onPick).toHaveBeenCalledWith(
    expect.objectContaining({ key: 'user:new-1', name: 'Breakouts' })))
  expect(created).toHaveLength(1)
})

test('Enter submits the new-list name', async () => {
  const user = userEvent.setup()
  const onPick = vi.fn()
  render(<WatchlistPicker onPick={onPick} />)

  await user.click(await screen.findByRole('button', { name: /new watchlist/i }))
  await user.type(screen.getByLabelText(/new watchlist name/i), 'Swings{Enter}')

  await waitFor(() => expect(onPick).toHaveBeenCalledWith(
    expect.objectContaining({ key: 'user:new-1', name: 'Swings' })))
})

test('a blank name cannot be submitted', async () => {
  const user = userEvent.setup()
  const onPick = vi.fn()
  render(<WatchlistPicker onPick={onPick} />)

  await user.click(await screen.findByRole('button', { name: /new watchlist/i }))
  expect(screen.getByRole('button', { name: /^create$/i })).toBeDisabled()
  await user.type(screen.getByLabelText(/new watchlist name/i), '   {Enter}')
  expect(onPick).not.toHaveBeenCalled()
})

test('a failed create surfaces an error and does not pick a phantom list', async () => {
  const user = userEvent.setup()
  const onPick = vi.fn()
  render(<WatchlistPicker onPick={onPick} />)

  await user.click(await screen.findByRole('button', { name: /new watchlist/i }))
  await user.type(screen.getByLabelText(/new watchlist name/i), 'BOOM{Enter}')

  expect(await screen.findByText(/could not create that list/i)).toBeInTheDocument()
  expect(onPick).not.toHaveBeenCalled()
})

test('a 2xx create with no id is treated as a failure, not a user:undefined list', async () => {
  const user = userEvent.setup()
  const onPick = vi.fn()
  render(<WatchlistPicker onPick={onPick} />)

  await user.click(await screen.findByRole('button', { name: /new watchlist/i }))
  await user.type(screen.getByLabelText(/new watchlist name/i), 'GHOST{Enter}')

  expect(await screen.findByText(/could not create that list/i)).toBeInTheDocument()
  expect(onPick).not.toHaveBeenCalled()
})

test('Escape abandons the new-list input', async () => {
  const user = userEvent.setup()
  render(<WatchlistPicker onPick={() => {}} />)

  await user.click(await screen.findByRole('button', { name: /new watchlist/i }))
  await user.type(screen.getByLabelText(/new watchlist name/i), 'Temp{Escape}')

  await waitFor(() => expect(screen.queryByLabelText(/new watchlist name/i)).not.toBeInTheDocument())
  expect(screen.getByRole('button', { name: /new watchlist/i })).toBeInTheDocument()
})

// ── Dated prebuilt lists (the Sunday Scans archive) ───────────────────────────
// The server tags each issue list with `issue_date`. Inside a section those
// render NEWEST FIRST in a single column (the full dated name must be readable —
// a 2-column cell ellipsizes exactly the date off the end), while undated
// sections keep their A→Z two-column grid.
// Server order: sections come grouped (ETF → … → Community); the picker keeps that
// first-seen section order and only re-sorts WITHIN a section. The dated rows are
// deliberately shuffled here so the test proves the picker's own ordering.
const PREBUILT = [
  { id: 'liq', name: 'Liquid Major ETFs', category: 'UCT ETF Lists', items: [] },
  { id: 'bb', name: 'Bull & Bear ETFs', category: 'UCT ETF Lists', items: [] },
  { id: 'a2', name: 'Sunday Scans — August 2, 2026', category: 'UCT Community', issue_date: '2026-08-02', items: [] },
  { id: 'a16', name: 'Sunday Scans — August 16, 2026', category: 'UCT Community', issue_date: '2026-08-16', items: [] },
  { id: 'a9', name: 'Sunday Scans — August 9, 2026', category: 'UCT Community', issue_date: '2026-08-09', items: [] },
]

test('dated prebuilt lists render newest-first in a single column; undated sections stay A→Z', async () => {
  const user = userEvent.setup()
  vi.stubGlobal('fetch', vi.fn((url) => {
    if (String(url) === '/api/watchlists/prebuilt') {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(PREBUILT) })
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve([]) })
  }))
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <WatchlistPicker onPick={() => {}} />
    </SWRConfig>,
  )
  await user.click(screen.getByRole('tab', { name: /prebuilt/i }))

  const names = (await screen.findAllByRole('button', { name: /sunday scans|etfs/i })).map(b => b.getAttribute('title'))
  expect(names).toEqual([
    'Bull & Bear ETFs', 'Liquid Major ETFs',                      // undated: A→Z
    'Sunday Scans — August 16, 2026', 'Sunday Scans — August 9, 2026', 'Sunday Scans — August 2, 2026',
  ])
  const cellOf = (title) => screen.getByTitle(title).parentElement
  expect(cellOf('Sunday Scans — August 16, 2026').className).toMatch(/pList/)
  expect(cellOf('Liquid Major ETFs').className).toMatch(/pGrid/)
})
