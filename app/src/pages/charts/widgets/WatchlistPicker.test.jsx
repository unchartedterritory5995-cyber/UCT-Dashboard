import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi, beforeEach, afterEach, test, expect } from 'vitest'
import WatchlistPicker from './WatchlistPicker'

// A Watchlist widget scopes to ONE list, so this "Add a Watchlist" screen is the
// only place a new list can be created from the widget. These cover that path.

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
  expect(await screen.findByRole('button', { name: /new list/i })).toBeInTheDocument()
})

test('creating a list posts it and immediately picks it, so the widget lands in the new list', async () => {
  const user = userEvent.setup()
  const onPick = vi.fn()
  render(<WatchlistPicker onPick={onPick} />)

  await user.click(await screen.findByRole('button', { name: /new list/i }))
  await user.type(screen.getByLabelText(/new watchlist name/i), 'Breakouts')
  await user.click(screen.getByRole('button', { name: /^create$/i }))

  await waitFor(() => expect(onPick).toHaveBeenCalledWith({ key: 'user:new-1', name: 'Breakouts' }))
  expect(created).toHaveLength(1)
})

test('Enter submits the new-list name', async () => {
  const user = userEvent.setup()
  const onPick = vi.fn()
  render(<WatchlistPicker onPick={onPick} />)

  await user.click(await screen.findByRole('button', { name: /new list/i }))
  await user.type(screen.getByLabelText(/new watchlist name/i), 'Swings{Enter}')

  await waitFor(() => expect(onPick).toHaveBeenCalledWith({ key: 'user:new-1', name: 'Swings' }))
})

test('a blank name cannot be submitted', async () => {
  const user = userEvent.setup()
  const onPick = vi.fn()
  render(<WatchlistPicker onPick={onPick} />)

  await user.click(await screen.findByRole('button', { name: /new list/i }))
  expect(screen.getByRole('button', { name: /^create$/i })).toBeDisabled()
  await user.type(screen.getByLabelText(/new watchlist name/i), '   {Enter}')
  expect(onPick).not.toHaveBeenCalled()
})

test('a failed create surfaces an error and does not pick a phantom list', async () => {
  const user = userEvent.setup()
  const onPick = vi.fn()
  render(<WatchlistPicker onPick={onPick} />)

  await user.click(await screen.findByRole('button', { name: /new list/i }))
  await user.type(screen.getByLabelText(/new watchlist name/i), 'BOOM{Enter}')

  expect(await screen.findByText(/could not create that list/i)).toBeInTheDocument()
  expect(onPick).not.toHaveBeenCalled()
})

test('Escape abandons the new-list input', async () => {
  const user = userEvent.setup()
  render(<WatchlistPicker onPick={() => {}} />)

  await user.click(await screen.findByRole('button', { name: /new list/i }))
  await user.type(screen.getByLabelText(/new watchlist name/i), 'Temp{Escape}')

  await waitFor(() => expect(screen.queryByLabelText(/new watchlist name/i)).not.toBeInTheDocument())
  expect(screen.getByRole('button', { name: /new list/i })).toBeInTheDocument()
})
