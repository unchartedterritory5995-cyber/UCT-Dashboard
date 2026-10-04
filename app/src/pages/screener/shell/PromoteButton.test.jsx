import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import PromoteButton from './PromoteButton'

const res = (status, json) => ({ ok: status < 300, status, json: async () => json })

afterEach(() => vi.restoreAllMocks())

describe('PromoteButton', () => {
  it('renders nothing while the door is dark', async () => {
    const fetcher = vi.fn(async () => res(404, { detail: 'Not Found' }))
    const { container } = render(<PromoteButton spec={{}} fetcher={fetcher} />)
    await waitFor(() => expect(fetcher).toHaveBeenCalled())
    expect(container.textContent).toBe('')
  })

  it('posts the screen spec and says when the result was truncated', async () => {
    vi.spyOn(window, 'prompt').mockReturnValue('Breakouts')
    const fetcher = vi.fn(async (url, init = {}) => (init.method === 'POST'
      ? res(200, { watchlist_id: 'w1', created: true, added: 500, taken: 500, matched: 812, truncated: true })
      : res(200, { available: true, max_symbols: 500 })))
    const spec = { filters: [{ key: 'price', op: 'gte', min: 10 }] }
    render(<PromoteButton spec={spec} fetcher={fetcher} />)
    fireEvent.click(await screen.findByText('To watchlist'))
    expect((await screen.findByRole('status')).textContent).toBe('Added the first 500 of 812 matches.')
    const post = fetcher.mock.calls.find(([, i]) => i?.method === 'POST')
    expect(JSON.parse(post[1].body)).toEqual({ spec, name: 'Breakouts' })
  })

  it('cancelling the name prompt sends nothing', async () => {
    vi.spyOn(window, 'prompt').mockReturnValue(null)
    const fetcher = vi.fn(async () => res(200, { available: true }))
    render(<PromoteButton spec={{}} fetcher={fetcher} />)
    fireEvent.click(await screen.findByText('To watchlist'))
    expect(fetcher.mock.calls.filter(([, i]) => i?.method === 'POST')).toHaveLength(0)
  })
})
