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
afterEach(() => { global.fetch = realFetch; localStorage.clear() })

describe('PersonalApiCard', () => {
  // P0.8: a member looks for "apps & shortcuts", not for an API. The old name stays in brackets so
  // support, the docs and anyone searching Settings for it still land here.
  it('is titled "Connect apps & shortcuts (Personal API)"', async () => {
    global.fetch = vi.fn(async () => json(200, { tokens: [] }))
    renderCard()
    expect(await screen.findByRole('region', { name: 'Connect apps & shortcuts (Personal API)' })).toBeInTheDocument()
  })

  it('renders NOTHING while the feature is dark (every route 404s)', async () => {
    global.fetch = vi.fn(async () => json(404, { detail: 'Not Found' }))
    const { container } = renderCard()
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    await waitFor(() => expect(container).toBeEmptyDOMElement())
  })

  // ⛔ Wave 7 whole-branch fix (frontend review M-2): DARK MEANS ABSENT holds before the answer
  // too. The card used to render its title, a paragraph describing the unreleased feature and
  // "Loading…" until the 404 came back -- and on any other error (a 502 in a deploy swap, a dropped
  // connection) it stayed up saying "Could not load your tokens." while the gate was dark.
  it('renders NOTHING while the gate answer is not known yet (the first request in flight)', async () => {
    global.fetch = vi.fn(() => new Promise(() => {}))
    const { container } = renderCard()
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    await new Promise((r) => setTimeout(r, 20))
    expect(container).toBeEmptyDOMElement()
  })

  it('renders NOTHING when the first answer is an error other than 404 (the gate is still unknown)', async () => {
    global.fetch = vi.fn(async () => json(502, {}))
    const { container } = renderCard()
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    await new Promise((r) => setTimeout(r, 20))
    expect(container).toBeEmptyDOMElement()
  })

  it('an error AFTER the gate is known ON shows the card’s own sentence', async () => {
    const cache = new Map()
    const mount = () => render(
      <SWRConfig value={{ provider: () => cache, dedupingInterval: 0 }}>
        <PersonalApiCard />
      </SWRConfig>,
    )
    global.fetch = vi.fn(async () => json(200, { tokens: [] }))
    const first = mount()
    await screen.findByRole('button', { name: 'Make a token' })
    first.unmount()
    global.fetch = vi.fn(async () => json(502, {}))
    mount()
    expect(await screen.findByText("Couldn't load your tokens.")).toBeInTheDocument()
  })

  // ⛔ Wave 10 F7 (Part A, 5d): WHY THE PROOF WALK SAW NOTHING. A FIRST read that failed left the
  // gate unknown, so the card vanished (M-2, above). For a member whose browser has seen this
  // card before, it stays and says the read failed; a browser that never saw it still gets
  // nothing -- the two M-2 rails above hold with localStorage clear.
  it('a member whose browser has SEEN the card before is told a failed first read', async () => {
    global.fetch = vi.fn(async () => json(200, { tokens: [] }))
    const first = renderCard()
    await screen.findByRole('button', { name: 'Make a token' })
    first.unmount()
    expect(localStorage.getItem('uct.nb.personalApi.gateSeen')).toBe('1')
    // a fresh page (a new cache): the FIRST read fails
    global.fetch = vi.fn(async () => json(500, {}))
    renderCard()
    expect(await screen.findByText("Couldn't load your tokens.")).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })

  it('a 404 forgets the remembered gate (dark again means absent again)', async () => {
    localStorage.setItem('uct.nb.personalApi.gateSeen', '1')
    global.fetch = vi.fn(async () => json(404, { detail: 'Not Found' }))
    const { container } = renderCard()
    await waitFor(() => expect(localStorage.getItem('uct.nb.personalApi.gateSeen')).toBeNull())
    expect(container).toBeEmptyDOMElement()
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
    // S1: the first press asks; the confirm's Revoke is what revokes.
    fireEvent.click(within(screen.getByRole('group', { name: 'Confirm revoke' })).getByRole('button', { name: 'Revoke' }))
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
    fireEvent.change(await screen.findByRole('textbox', { name: 'Token name' }), { target: { value: 'Mac' } })
    fireEvent.click(await screen.findByRole('button', { name: 'Make a token' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Making a Personal API token needs a paid plan.')
  })

  it("shows the server's own sentence when minting is refused otherwise", async () => {
    global.fetch = vi.fn(async (url, init = {}) => (
      init.method === 'POST'
        ? json(400, { detail: 'You already have 20 personal tokens. Revoke one you no longer use, then make a new one.' })
        : json(200, { tokens: [] })))
    renderCard()
    fireEvent.change(await screen.findByRole('textbox', { name: 'Token name' }), { target: { value: 'Mac' } })
    fireEvent.click(await screen.findByRole('button', { name: 'Make a token' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('You already have 20 personal tokens.')
  })

  // ⛔ Audit 2026-11-05, spec S1 (B19): a token was made on the first press with no name, and
  // Revoke took a working Shortcut's key away on one press.
  it('Make a token stays disabled until the token has a name (spaces are not a name)', async () => {
    global.fetch = vi.fn(async () => json(200, { tokens: [] }))
    renderCard()
    const make = await screen.findByRole('button', { name: 'Make a token' })
    expect(make).toBeDisabled()
    const field = screen.getByRole('textbox', { name: 'Token name' })
    fireEvent.change(field, { target: { value: '   ' } })
    expect(make).toBeDisabled()
    fireEvent.click(make)
    fireEvent.submit(field.closest('form'))
    expect(global.fetch.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false)
    fireEvent.change(field, { target: { value: 'iPhone' } })
    expect(make).toBeEnabled()
  })

  it('Revoke asks first, by name; Cancel keeps the token and sends nothing', async () => {
    const tokens = [{ id: 't1', label: 'iPhone Shortcuts', createdAt: '2026-09-01T00:00:00+00:00', expired: false }]
    global.fetch = vi.fn(async (url, init = {}) => (
      init.method === 'DELETE' ? json(200, { revoked: true }) : json(200, { tokens })))
    renderCard()
    const row = await screen.findByTestId('personal-api-token')
    fireEvent.click(within(row).getByRole('button', { name: 'Revoke iPhone Shortcuts' }))
    const ask = screen.getByRole('group', { name: 'Confirm revoke' })
    expect(ask).toHaveTextContent('Revoke "iPhone Shortcuts"? Shortcuts using this key stop working at once.')
    expect(global.fetch.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false)
    await waitFor(() => expect(document.activeElement).toBe(within(ask).getByRole('button', { name: 'Cancel' })))
    fireEvent.click(within(ask).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('group', { name: 'Confirm revoke' })).toBeNull()
    expect(global.fetch.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false)
    expect(screen.getByTestId('personal-api-token')).toBeInTheDocument()
  })

  // Fix round 1 (review minor 9): Cancel returned focus to <body> (the Revoke button it brings back
  // is a new element), Esc did nothing, and the buttons were not tied to the sentence.
  it('Esc cancels the confirm, and focus goes back to that row’s Revoke', async () => {
    const tokens = [{ id: 't1', label: 'iPhone Shortcuts', createdAt: '2026-09-01T00:00:00+00:00', expired: false }]
    global.fetch = vi.fn(async (url, init = {}) => (init.method === 'DELETE' ? json(200, {}) : json(200, { tokens })))
    renderCard()
    const row = await screen.findByTestId('personal-api-token')
    fireEvent.click(within(row).getByRole('button', { name: 'Revoke iPhone Shortcuts' }))
    const ask = screen.getByRole('group', { name: 'Confirm revoke' })
    const sentence = within(ask).getByText(/Shortcuts using this key stop working at once/)
    expect(within(ask).getByRole('button', { name: 'Revoke' }).getAttribute('aria-describedby')).toBe(sentence.id)
    fireEvent.keyDown(within(ask).getByRole('button', { name: 'Cancel' }), { key: 'Escape' })
    expect(screen.queryByRole('group', { name: 'Confirm revoke' })).toBeNull()
    await waitFor(() => expect(document.activeElement).toBe(within(row).getByRole('button', { name: 'Revoke iPhone Shortcuts' })))
    expect(global.fetch.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false)
  })

  it('Cancel also puts focus back on that row’s Revoke', async () => {
    const tokens = [{ id: 't1', label: 'iPhone Shortcuts', createdAt: '2026-09-01T00:00:00+00:00', expired: false }]
    global.fetch = vi.fn(async () => json(200, { tokens }))
    renderCard()
    const row = await screen.findByTestId('personal-api-token')
    fireEvent.click(within(row).getByRole('button', { name: 'Revoke iPhone Shortcuts' }))
    fireEvent.click(within(screen.getByRole('group', { name: 'Confirm revoke' })).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(document.activeElement).toBe(within(row).getByRole('button', { name: 'Revoke iPhone Shortcuts' })))
  })

  // Fix round 3 (re-review m-9): after a confirmed revoke the row (and the focused button) is gone;
  // focus goes to the "Make a token" name field, never <body>.
  it('a confirmed revoke puts focus on the token name field', async () => {
    let tokens = [{ id: 't1', label: 'iPhone Shortcuts', createdAt: '2026-09-01T00:00:00+00:00', expired: false }]
    global.fetch = vi.fn(async (url, init = {}) => {
      if (init.method === 'DELETE') { tokens = []; return json(200, { revoked: true }) }
      return json(200, { tokens })
    })
    renderCard()
    const row = await screen.findByTestId('personal-api-token')
    fireEvent.click(within(row).getByRole('button', { name: 'Revoke iPhone Shortcuts' }))
    fireEvent.click(within(screen.getByRole('group', { name: 'Confirm revoke' })).getByRole('button', { name: 'Revoke' }))
    await waitFor(() => expect(screen.queryByTestId('personal-api-token')).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Token name' })))
  })
})
