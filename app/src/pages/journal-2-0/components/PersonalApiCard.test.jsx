import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { SWRConfig } from 'swr'
import { afterEach, describe, expect, it, vi } from 'vitest'
import PersonalApiCard from './PersonalApiCard'

// Wave 7 lane G (G1) — Settings → Personal API.
//
// ⛔ Asserted by RENDERED TEXT, never by state: the one-time token, the
// "not shown again" warning and every refusal are sentences a member reads.

const TOKENS = '/api/j2/personal/tokens'

function renderCard() {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <PersonalApiCard />
    </SWRConfig>,
  )
}

function json(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

const realFetch = global.fetch
afterEach(() => { global.fetch = realFetch })

describe('PersonalApiCard', () => {
  it('renders NOTHING while the feature is dark (every route 404s)', async () => {
    global.fetch = vi.fn(async () => json(404, { detail: 'Not Found' }))
    const { container } = renderCard()
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    await waitFor(() => expect(container).toBeEmptyDOMElement())
  })

  it('lists tokens without ever showing token material, and revokes one', async () => {
    let tokens = [{
      id: 't1', label: 'iPhone Shortcuts', clientType: 'personal_api',
      createdAt: '2026-09-01T00:00:00+00:00', expiresAt: '2027-09-01T00:00:00+00:00',
      lastUsedAt: null, expired: false,
    }]
    global.fetch = vi.fn(async (url, init = {}) => {
      if (init.method === 'DELETE') { tokens = []; return json(200, { revoked: true }) }
      return json(200, { tokens })
    })
    renderCard()
    const row = await screen.findByTestId('personal-api-token')
    expect(within(row).getByText(/iPhone Shortcuts/)).toBeInTheDocument()
    expect(within(row).getByText(/not used yet/)).toBeInTheDocument()
    fireEvent.click(within(row).getByRole('button', { name: 'Revoke iPhone Shortcuts' }))
    await waitFor(() => expect(screen.queryByTestId('personal-api-token')).not.toBeInTheDocument())
    expect(global.fetch).toHaveBeenCalledWith(`${TOKENS}/t1`, expect.objectContaining({ method: 'DELETE' }))
  })

  it('shows a new token ONCE, says it will not be shown again, and forgets it on Done', async () => {
    let tokens = []
    global.fetch = vi.fn(async (url, init = {}) => {
      if (init.method === 'POST') {
        expect(JSON.parse(init.body)).toEqual({ label: 'My iPhone' })
        tokens = [{ id: 't9', label: 'My iPhone', createdAt: '2026-09-25T00:00:00+00:00', expired: false }]
        return json(200, { token: 'uctpat_SECRET123', tokenId: 't9', label: 'My iPhone',
                           expiresAt: '2027-09-25T00:00:00+00:00' })
      }
      return json(200, { tokens })
    })
    renderCard()
    fireEvent.change(await screen.findByRole('textbox', { name: 'Token name' }), { target: { value: 'My iPhone' } })
    fireEvent.click(screen.getByRole('button', { name: 'Make a token' }))
    const box = await screen.findByTestId('personal-api-new-token')
    expect(within(box).getByRole('textbox', { name: 'Your new Personal API token' })).toHaveValue('uctpat_SECRET123')
    expect(within(box).getByText('Copy it now. For your security it will not be shown again.')).toBeInTheDocument()
    fireEvent.click(within(box).getByRole('button', { name: 'Done' }))
    await waitFor(() => expect(screen.queryByTestId('personal-api-new-token')).not.toBeInTheDocument())
    expect(screen.queryByDisplayValue('uctpat_SECRET123')).not.toBeInTheDocument()
    expect(document.body.textContent).not.toContain('uctpat_SECRET123')
  })

  it('says a paid plan is needed when minting is refused with 402', async () => {
    global.fetch = vi.fn(async (url, init = {}) => (
      init.method === 'POST'
        ? json(402, { detail: 'Personal API tokens require a paid plan' })
        : json(200, { tokens: [] })))
    renderCard()
    fireEvent.click(await screen.findByRole('button', { name: 'Make a token' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Making a Personal API token needs a paid plan.')
  })

  it("shows the server's own sentence when minting is refused otherwise", async () => {
    global.fetch = vi.fn(async (url, init = {}) => (
      init.method === 'POST'
        ? json(400, { detail: 'You already have 20 personal tokens. Revoke one you no longer use, then make a new one.' })
        : json(200, { tokens: [] })))
    renderCard()
    fireEvent.click(await screen.findByRole('button', { name: 'Make a token' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('You already have 20 personal tokens.')
  })
})
