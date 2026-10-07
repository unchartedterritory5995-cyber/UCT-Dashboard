// TERM-033 -- the chart dock's Ownership tab (reached in the terminal through the Breadth
// drill's chart). A failed ownership read used to resolve to `null` and render "Ownership
// data is not available for X. Funds and non-US listings do not file...": a claim about the
// company made out of a failed request.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { SWRConfig } from 'swr'
import DockOwnership from './DockOwnership'

const fresh = ({ children }) => (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>{children}</SWRConfig>
)

function api({ ownership }) {
  global.fetch = vi.fn((url) => {
    const u = String(url)
    if (u.includes('/api/research/ownership/')) return Promise.resolve(ownership())
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) })
  })
}
const ok = (body) => () => ({ ok: true, status: 200, json: () => Promise.resolve(body) })
const fail = () => ({ ok: false, status: 500, json: () => Promise.resolve({}) })

afterEach(() => { delete global.fetch; vi.restoreAllMocks() })

describe('DockOwnership (TERM-033)', () => {
  it('a failed read is an error with a Retry, not "not available"', async () => {
    api({ ownership: fail })
    render(<DockOwnership sym="MU" />, { wrapper: fresh })
    expect((await screen.findByRole('alert')).textContent).toMatch(/could not be loaded for MU/i)
    expect(screen.queryByText(/not available/i)).toBeNull()

    api({ ownership: ok({}) })
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
  })

  it('control: an answered-but-empty read is the honest "not available"', async () => {
    api({ ownership: ok({}) })
    render(<DockOwnership sym="MU" />, { wrapper: fresh })
    expect(await screen.findByText(/Ownership data is not available for MU/)).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
