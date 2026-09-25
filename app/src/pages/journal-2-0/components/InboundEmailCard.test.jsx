import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { SWRConfig } from 'swr'
import { afterEach, describe, expect, it, vi } from 'vitest'
import InboundEmailCard from './InboundEmailCard'

// Wave 7 lane G (G3) — Settings → Email to Notebook. Asserted by rendered text.

const URL = '/api/j2/inbound-email/address'
const ADDR = 'notes+abcdef0123456789abcdef01@uctintelligence.com'
const NEW = 'notes+11112222333344445555aaaa@uctintelligence.com'

function renderCard() {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <InboundEmailCard />
    </SWRConfig>,
  )
}

function json(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

const realFetch = global.fetch
afterEach(() => { global.fetch = realFetch })

describe('InboundEmailCard', () => {
  it('renders NOTHING while email-in is dark (every route 404s)', async () => {
    global.fetch = vi.fn(async () => json(404, { detail: 'Not Found' }))
    const { container } = renderCard()
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    await waitFor(() => expect(container).toBeEmptyDOMElement())
  })

  it("shows the member's address and warns before retiring it", async () => {
    global.fetch = vi.fn(async (url, init = {}) => (
      init.method === 'POST'
        ? json(200, { address: NEW, createdAt: 'x', rotatedAt: 'y' })
        : json(200, { address: ADDR, createdAt: 'x', rotatedAt: null })))
    renderCard()
    expect(await screen.findByRole('textbox', { name: 'Your Notebook email address' })).toHaveValue(ADDR)
    fireEvent.click(screen.getByRole('button', { name: 'Make a new address…' }))
    expect(screen.getByText(/Your current address will stop working immediately/)).toBeInTheDocument()
    // backing out changes nothing
    fireEvent.click(screen.getByRole('button', { name: 'Keep this one' }))
    expect(global.fetch).not.toHaveBeenCalledWith(URL, expect.objectContaining({ method: 'POST' }))
    fireEvent.click(screen.getByRole('button', { name: 'Make a new address…' }))
    fireEvent.click(screen.getByRole('button', { name: 'Make a new address' }))
    expect(await screen.findByText('New address made. The old one no longer works.')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Your Notebook email address' })).toHaveValue(NEW)
  })

  it('says a paid plan is needed on 402', async () => {
    global.fetch = vi.fn(async () => json(402, { detail: 'Email to Notebook requires a paid plan' }))
    renderCard()
    expect(await screen.findByText('Email to Notebook needs a paid plan.')).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })
})
