// @vitest-environment jsdom
// P0.8: "Capture from anywhere" -- the three ways in that live in Settings, pointed at from
// inside the Notebook. A door shows exactly when its Settings card would render, because it asks
// the same endpoint through the same fetcher (one authority); an unknown gate hides the door.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SWRConfig } from 'swr'
import CaptureDoors from './CaptureDoors'
import InboundEmailCard, { INBOUND_EMAIL_URL } from '../InboundEmailCard'
import PersonalApiCard, { PERSONAL_API_URL } from '../PersonalApiCard'
import { CAPTURE_INSTALL_URL } from '../BrowserCaptureCard'

const MAIL = '/api/j2/inbound-email/address'
const API = '/api/j2/personal/tokens'

/** routes: { '<url>': status | [status, body] } -- anything else answers 404. */
function stubFetch(routes) {
  const calls = []
  global.fetch = vi.fn(async (url) => {
    calls.push(String(url))
    const hit = routes[String(url)]
    const [status, body] = Array.isArray(hit) ? hit : [hit ?? 404, {}]
    return { ok: status >= 200 && status < 300, status, json: async () => body }
  })
  return calls
}
const fetchCalls = () => global.fetch.mock.calls.length

function renderDoors(ui = <CaptureDoors />) {
  return render(
    <SWRConfig value={{ provider: () => new Map() }}>
      <MemoryRouter>{ui}</MemoryRouter>
    </SWRConfig>,
  )
}

beforeEach(() => { try { localStorage.clear() } catch { /* ignore */ } })
afterEach(() => { vi.restoreAllMocks() })

describe('CaptureDoors', () => {
  it('lists only the capture doors whose card would render', async () => {
    stubFetch({ [MAIL]: [200, { address: 'x@in.example' }], [API]: [404, {}] })
    renderDoors()
    expect(await screen.findByRole('link', { name: /Email to Notebook/ })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Capture from anywhere' })).toBeTruthy()
    expect(screen.getByRole('link', { name: /Browser extension/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /iPhone Shortcut/ })).toBeNull()
  })

  it("an unknown gate (502) hides that door -- the cards' own M-2 rule", async () => {
    stubFetch({ [MAIL]: [404, {}], [API]: [502, {}] })
    renderDoors()
    await waitFor(() => expect(fetchCalls()).toBeGreaterThan(1))
    expect(screen.queryByRole('button', { name: /iPhone Shortcut/ })).toBeNull()
    expect(screen.queryByRole('link', { name: /Email to Notebook/ })).toBeNull()
  })

  it('the Shortcut door opens a how-to a member can follow', async () => {
    stubFetch({ [MAIL]: [404, {}], [API]: [200, { tokens: [] }] })
    renderDoors()
    await screen.findByRole('button', { name: /iPhone Shortcut/ })
    fireEvent.click(screen.getByRole('button', { name: /iPhone Shortcut/ }))
    expect(screen.getByRole('dialog', { name: 'Send notes from your iPhone' })).toBeTruthy()
    expect(screen.getAllByRole('listitem').length).toBeGreaterThanOrEqual(4)
  })

  it('a plan the feature needs (402) hides the door, as the Email card hides its address', async () => {
    stubFetch({ [MAIL]: 402, [API]: [200, { tokens: [] }] })
    renderDoors()
    await screen.findByRole('button', { name: /iPhone Shortcut/ })
    expect(screen.queryByRole('link', { name: /Email to Notebook/ })).toBeNull()
  })

  it('asks the SAME endpoints the cards ask (one authority, exported constants)', async () => {
    const calls = stubFetch({ [MAIL]: [404, {}], [API]: [404, {}] })
    renderDoors()
    await waitFor(() => expect(calls).toContain(INBOUND_EMAIL_URL))
    await waitFor(() => expect(calls).toContain(PERSONAL_API_URL))
    expect(INBOUND_EMAIL_URL).toBe(MAIL)
    expect(PERSONAL_API_URL).toBe(API)
  })

  it('mounted beside the Settings cards it adds no request of its own (SWR dedupes the key)', async () => {
    const calls = stubFetch({ [MAIL]: [200, { address: 'x@in.example' }], [API]: [200, { tokens: [] }] })
    renderDoors(<><CaptureDoors /><InboundEmailCard /><PersonalApiCard /></>)
    await screen.findByRole('button', { name: /iPhone Shortcut/ })
    await new Promise((r) => setTimeout(r, 50))
    expect(calls.filter((u) => u === MAIL)).toHaveLength(1)
    expect(calls.filter((u) => u === API)).toHaveLength(1)
  })

  it('the email door points at Settings > Connections; the extension door at the store listing', async () => {
    stubFetch({ [MAIL]: [200, { address: 'x@in.example' }], [API]: [404, {}] })
    renderDoors()
    const email = await screen.findByRole('link', { name: /Email to Notebook/ })
    expect(email.getAttribute('href')).toBe('/settings?section=connections')
    const ext = screen.getByRole('link', { name: /Browser extension/ })
    expect(ext.getAttribute('href')).toBe(CAPTURE_INSTALL_URL)
    expect(ext.getAttribute('rel')).toMatch(/noopener/)
  })

  it('the extension door needs no gate: it shows while both gates are dark', async () => {
    stubFetch({ [MAIL]: [404, {}], [API]: [404, {}] })
    renderDoors()
    expect(await screen.findByRole('link', { name: /Browser extension/ })).toBeTruthy()
    await waitFor(() => expect(fetchCalls()).toBeGreaterThan(1))
    expect(screen.queryByRole('link', { name: /Email to Notebook/ })).toBeNull()
  })

  it('two copies on one screen do not share a heading id (the Import sheet over Research Home)', async () => {
    stubFetch({ [MAIL]: [404, {}], [API]: [404, {}] })
    renderDoors(<><CaptureDoors /><CaptureDoors compact /></>)
    const regions = await screen.findAllByRole('region', { name: 'Capture from anywhere' })
    expect(regions).toHaveLength(2)
    const ids = screen.getAllByRole('heading', { name: 'Capture from anywhere' }).map((h) => h.id)
    expect(new Set(ids).size).toBe(2)
  })

  it('uses no emoji', async () => {
    stubFetch({ [MAIL]: [200, { address: 'x@in.example' }], [API]: [200, { tokens: [] }] })
    const { container } = renderDoors()
    await screen.findByRole('button', { name: /iPhone Shortcut/ })
    expect(container.textContent).not.toMatch(/\p{Extended_Pictographic}/u)
  })
})
