/**
 * `/smoke-login` reads its token from the URL FRAGMENT, and only from there.
 *
 * ⚰️ WHY THIS FILE EXISTS. The token used to ride in a query string. On 2026-09-12 a mistyped
 * navigation on a BrowserStack mirror ran a Google SEARCH for the whole URL and handed a live
 * login token to a third party. A fragment is never transmitted to any server, so the same slip
 * now leaks the path and nothing else — and these are the rails that stop it quietly reverting.
 */
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import SmokeLogin from './SmokeLogin'

const navigate = vi.fn()
vi.mock('react-router-dom', async () => ({
  ...(await vi.importActual('react-router-dom')),
  useNavigate: () => navigate,
}))
const refetch = vi.fn().mockResolvedValue(undefined)
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ refetch }) }))

function setUrl(url) {
  window.history.replaceState(null, '', url)
}

const renderPage = () => render(<MemoryRouter><SmokeLogin /></MemoryRouter>)

describe('SmokeLogin — the token lives in the fragment', () => {
  beforeEach(() => {
    navigate.mockClear()
    refetch.mockClear()
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) })
  })
  afterEach(() => { setUrl('/'); vi.restoreAllMocks() })

  it('reads the token from location.hash and POSTs it in the request BODY', async () => {
    setUrl('/smoke-login#token=abc123')
    renderPage()
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    const [url, init] = global.fetch.mock.calls[0]
    expect(url).toBe('/api/auth/smoke-login')
    expect(init.method).toBe('POST')
    // ⭐ The secret reaches the server in the body — the one part that is not logged and never
    // appears in a Referer header.
    expect(JSON.parse(init.body)).toEqual({ token: 'abc123' })
    expect(url).not.toContain('abc123')
  })

  it('⛔ REFUSES a token supplied in the QUERY STRING — fragment-only acceptance', async () => {
    // This is the whole hardening in one assertion. If the page still honoured `?token=`, a
    // minted link could silently regress to the leaky shape and every other test would stay green.
    setUrl('/smoke-login?token=fromquery')
    renderPage()
    expect(await screen.findByTestId('smoke-login-status'))
      .toHaveTextContent('This link is no longer valid.')
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('scrubs the token out of the address bar once it has been read', async () => {
    setUrl('/smoke-login#token=abc123')
    renderPage()
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    // It never reached a server, but it was sitting in the URL bar of a SHARED test phone.
    expect(window.location.hash).toBe('')
    expect(window.location.href).not.toContain('abc123')
  })

  it('CONTROL — with no token at all it says so and posts nothing', async () => {
    setUrl('/smoke-login')
    renderPage()
    expect(await screen.findByTestId('smoke-login-status'))
      .toHaveTextContent('This link is no longer valid.')
    expect(global.fetch).not.toHaveBeenCalled()
  })
})
