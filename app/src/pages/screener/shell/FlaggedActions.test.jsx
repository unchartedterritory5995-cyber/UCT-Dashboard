import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import FlaggedActions from './FlaggedActions'

// Drive the flag set through the real hook's storage + event, so the component
// reacts exactly as it does in the app.
const setFlags = (arr) => {
  localStorage.setItem('uct_flagged', JSON.stringify(arr))
  window.dispatchEvent(new Event('uct:flagged-changed'))
}

beforeEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})
afterEach(() => { localStorage.clear() })

describe('FlaggedActions', () => {
  it('renders nothing when nothing is flagged', () => {
    const { container } = render(<FlaggedActions />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the flagged count once something is flagged', () => {
    setFlags(['NVDA', 'AAPL'])
    render(<FlaggedActions />)
    const btn = screen.getByRole('button', { name: /Flagged/ })
    expect(btn).toHaveTextContent('2')
  })

  it('moves the flagged set into a chosen watchlist, then clears the flags', async () => {
    setFlags(['NVDA', 'AAPL'])
    const calls = []
    vi.stubGlobal('fetch', vi.fn(async (url, init) => {
      calls.push({ url: String(url), init })
      if (String(url).startsWith('/api/watchlists?')) {
        return { ok: true, json: async () => [{ id: 'wl1', name: 'Swing longs' }] }
      }
      if (String(url) === '/api/watchlists/wl1/items/bulk') {
        return { ok: true, json: async () => ({ added: 2 }) }
      }
      return { ok: true, json: async () => ({}) }
    }))

    render(<FlaggedActions />)
    fireEvent.click(screen.getByRole('button', { name: /Flagged/ }))
    const target = await screen.findByRole('button', { name: 'Swing longs' })
    await act(async () => { fireEvent.click(target) })

    const bulk = calls.find(c => c.url === '/api/watchlists/wl1/items/bulk')
    expect(bulk).toBeTruthy()
    expect(JSON.parse(bulk.init.body)).toEqual({ symbols: ['NVDA', 'AAPL'] })
    // flags cleared after the move → the control disappears
    await waitFor(() => expect(screen.queryByRole('button', { name: /Flagged/ })).toBeNull())
    expect(JSON.parse(localStorage.getItem('uct_flagged'))).toEqual([])
  })

  it('the Flagged shadow list is not offered as a move target', async () => {
    setFlags(['NVDA'])
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (String(url).startsWith('/api/watchlists?')) {
        return { ok: true, json: async () => [
          { id: 'flag', name: 'Flagged', is_flagged_list: true },
          { id: 'wl2', name: 'Breakouts' },
        ] }
      }
      return { ok: true, json: async () => ({}) }
    }))
    render(<FlaggedActions />)
    fireEvent.click(screen.getByRole('button', { name: /Flagged/ }))
    expect(await screen.findByRole('button', { name: 'Breakouts' })).toBeInTheDocument()
    // The trigger's accessible name is "Flagged 1" (carries the count), so an
    // EXACT "Flagged" match can only be the shadow-list target — which must be
    // filtered out. None ⇒ the shadow list was excluded.
    expect(screen.queryByRole('button', { name: 'Flagged' })).toBeNull()
  })

  it('clear flags without moving empties the set and posts nothing to a list', async () => {
    setFlags(['NVDA', 'AAPL'])
    const fetchSpy = vi.fn(async (url) => {
      if (String(url).startsWith('/api/watchlists?')) return { ok: true, json: async () => [] }
      return { ok: true, json: async () => ({}) }
    })
    vi.stubGlobal('fetch', fetchSpy)
    render(<FlaggedActions />)
    fireEvent.click(screen.getByRole('button', { name: /Flagged/ }))
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: /Clear flags without moving/ })) })
    await waitFor(() => expect(screen.queryByRole('button', { name: /Flagged/ })).toBeNull())
    expect(fetchSpy.mock.calls.some(c => /items\/bulk/.test(String(c[0])))).toBe(false)
  })
})
