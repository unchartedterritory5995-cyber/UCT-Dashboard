import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { SWRConfig } from 'swr'
import { afterEach, describe, expect, it, vi } from 'vitest'
import InboundEmailCard from './InboundEmailCard'

const HERE = path.dirname(fileURLToPath(import.meta.url))

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

  // ⛔ Wave 7 whole-branch fix (frontend M-1 / backend M-10): the address is minted on INTENT,
  // never on view. GET answers {"address": null} until the member creates one; POST
  // creates-or-rotates. Opening Settings -> Connections to manage a broker must not leave a live
  // notes+<token>@ key the member never asked for.
  it('no address yet: offers "Create my address", sends NOTHING until pressed, then shows it', async () => {
    let created = false
    global.fetch = vi.fn(async (url, init = {}) => {
      if (init.method === 'POST') { created = true; return json(200, { address: ADDR, createdAt: 'x', rotatedAt: null }) }
      return json(200, { address: created ? ADDR : null })
    })
    renderCard()
    const create = await screen.findByRole('button', { name: 'Create my address' })
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Make a new address…' })).not.toBeInTheDocument()
    expect(global.fetch).not.toHaveBeenCalledWith(URL, expect.objectContaining({ method: 'POST' }))
    fireEvent.click(create)
    expect(await screen.findByRole('textbox', { name: 'Your Notebook email address' })).toHaveValue(ADDR)
    expect(screen.queryByRole('button', { name: 'Create my address' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Make a new address…' })).toBeInTheDocument()
    expect(global.fetch.mock.calls.filter(([, i]) => i?.method === 'POST')).toHaveLength(1)
  })

  // ⛔ Wave 7 residual, backend re-review lens (e): POST creates-OR-ROTATES, so a double-clicked
  // first Create sent two requests -- the server created, then rotated, and the address shown
  // first stopped working at once. The button is disabled while its request is on the wire (the
  // rendered state), and a second click in the same instant sends nothing.
  it('a double-clicked Create sends ONE request, and the button reads as busy while it is on the wire', async () => {
    let release
    const gate = new Promise((r) => { release = r })
    let created = false
    global.fetch = vi.fn(async (url, init = {}) => {
      if (init.method === 'POST') {
        await gate
        created = true
        return json(200, { address: ADDR, createdAt: 'x', rotatedAt: null })
      }
      return json(200, { address: created ? ADDR : null })
    })
    renderCard()
    const create = await screen.findByRole('button', { name: 'Create my address' })
    fireEvent.click(create)
    fireEvent.click(create)
    const pending = screen.getByRole('button', { name: 'Making…' })
    expect(pending).toBeDisabled()
    fireEvent.click(pending)
    expect(global.fetch.mock.calls.filter(([, i]) => i?.method === 'POST')).toHaveLength(1)
    release()
    expect(await screen.findByRole('textbox', { name: 'Your Notebook email address' })).toHaveValue(ADDR)
    expect(global.fetch.mock.calls.filter(([, i]) => i?.method === 'POST')).toHaveLength(1)
  })

  it('a refused create gives the button back, enabled', async () => {
    global.fetch = vi.fn(async (url, init = {}) => (
      init.method === 'POST' ? json(500, { detail: 'boom' }) : json(200, { address: null })))
    renderCard()
    fireEvent.click(await screen.findByRole('button', { name: 'Create my address' }))
    await screen.findByText('Could not make your address. Try again.')
    expect(screen.getByRole('button', { name: 'Create my address' })).toBeEnabled()
  })

  it('a create the server refuses is SAID, and the button stays', async () => {
    global.fetch = vi.fn(async (url, init = {}) => (
      init.method === 'POST' ? json(500, { detail: 'boom' }) : json(200, { address: null })))
    renderCard()
    fireEvent.click(await screen.findByRole('button', { name: 'Create my address' }))
    expect(await screen.findByText('Could not make your address. Try again.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create my address' })).toBeInTheDocument()
  })

  // ⛔ M-2: DARK MEANS ABSENT holds before the answer too, not only after a clean 404.
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
        <InboundEmailCard />
      </SWRConfig>,
    )
    global.fetch = vi.fn(async () => json(200, { address: ADDR }))
    const first = mount()
    await screen.findByRole('textbox', { name: 'Your Notebook email address' })
    first.unmount()
    global.fetch = vi.fn(async () => json(502, {}))
    mount()
    expect(await screen.findByText('Could not load your address.')).toBeInTheDocument()
  })

  it('says a paid plan is needed on 402', async () => {
    global.fetch = vi.fn(async () => json(402, { detail: 'Email to Notebook requires a paid plan' }))
    renderCard()
    expect(await screen.findByText('Email to Notebook needs a paid plan.')).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('styles itself from its OWN stylesheet, which defines every class it uses', () => {
    // Fix round 1, M-13: it borrowed PersonalApiCard.module.css, so a style
    // change to one card moved the other.
    const src = fs.readFileSync(path.join(HERE, 'InboundEmailCard.jsx'), 'utf8')
    expect(src).toMatch(/from '\.\/InboundEmailCard\.module\.css'/)
    expect(src).not.toMatch(/PersonalApiCard\.module\.css/)
    const css = fs.readFileSync(path.join(HERE, 'InboundEmailCard.module.css'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
    const used = [...new Set([...src.matchAll(/styles\.([A-Za-z0-9_]+)/g)].map(m => m[1]))]
    expect(used.length).toBeGreaterThan(3)          // control: the scan found the classes
    const missing = used.filter(c => !new RegExp(`\\.${c}\\b`).test(css))
    expect(missing).toEqual([])
  })
})
