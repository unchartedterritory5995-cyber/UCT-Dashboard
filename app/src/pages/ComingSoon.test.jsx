import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import ComingSoon from './ComingSoon'

function renderPage() {
  return render(<MemoryRouter><ComingSoon /></MemoryRouter>)
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() =>
    Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, already: false }) })
  ))
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('ComingSoon', () => {
  it('leads with COMING SOON', () => {
    renderPage()
    // The two lines are separate spans for the stagger; aria-label carries the
    // readable name.
    expect(screen.getByRole('heading', { name: /coming soon/i })).toBeInTheDocument()
  })

  it('shows the locked tagline and the product name', () => {
    renderPage()
    expect(screen.getByText('Navigate the market, effectively.')).toBeInTheDocument()
    expect(screen.getByText('UCT Intelligence')).toBeInTheDocument()
  })

  it('keeps a route to log in for existing members', () => {
    renderPage()
    expect(screen.getByRole('link', { name: /log in/i })).toHaveAttribute('href', '/login')
  })

  it('offers no way to create an account', () => {
    const { container } = renderPage()
    const hrefs = [...container.querySelectorAll('a')].map(a => a.getAttribute('href'))
    expect(hrefs).not.toContain('/signup')
    expect(hrefs).not.toContain('/subscribe')
    expect(hrefs).not.toContain('/pricing')
    expect(screen.queryByText(/free trial/i)).not.toBeInTheDocument()
  })

  it('posts the email to the waitlist and confirms', async () => {
    renderPage()
    fireEvent.change(screen.getByLabelText(/email address/i), {
      target: { value: 'trader@example.com' },
    })
    fireEvent.click(screen.getByRole('button', { name: /notify me/i }))

    await waitFor(() => {
      expect(screen.getByText(/you're on the list/i)).toBeInTheDocument()
    })

    expect(fetch).toHaveBeenCalledWith('/api/waitlist', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ email: 'trader@example.com' }),
    }))
  })

  it('reports a distinct message for an address already on the list', async () => {
    vi.stubGlobal('fetch', vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, already: true }) })
    ))
    renderPage()
    fireEvent.change(screen.getByLabelText(/email address/i), {
      target: { value: 'trader@example.com' },
    })
    fireEvent.click(screen.getByRole('button', { name: /notify me/i }))

    await waitFor(() => {
      expect(screen.getByText(/already on the list/i)).toBeInTheDocument()
    })
  })

  it('surfaces a server error instead of a false confirmation', async () => {
    vi.stubGlobal('fetch', vi.fn(() =>
      Promise.resolve({ ok: false, json: () => Promise.resolve({ detail: 'Could not save that.' }) })
    ))
    renderPage()
    fireEvent.change(screen.getByLabelText(/email address/i), {
      target: { value: 'trader@example.com' },
    })
    fireEvent.click(screen.getByRole('button', { name: /notify me/i }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Could not save that.')
    })
    expect(screen.queryByText(/you're on the list/i)).not.toBeInTheDocument()
  })

  it('survives a network failure without claiming success', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))
    renderPage()
    fireEvent.change(screen.getByLabelText(/email address/i), {
      target: { value: 'trader@example.com' },
    })
    fireEvent.click(screen.getByRole('button', { name: /notify me/i }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/no connection/i)
    })
  })

  it('does not submit an empty email', () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: /notify me/i }))
    // Not "fetch was never called" — the analytics tracker also posts through
    // fetch (jsdom has no sendBeacon), so assert on the waitlist call itself.
    const waitlistCalls = fetch.mock.calls.filter(([url]) => url === '/api/waitlist')
    expect(waitlistCalls).toHaveLength(0)
    expect(screen.getByRole('alert')).toHaveTextContent(/enter an email/i)
  })

  it('counts down to the launch target', () => {
    renderPage()
    // Rendered from a future default target, so a day figure is always present.
    expect(screen.getByText(/^days?$/i)).toBeInTheDocument()
    expect(screen.getByText('hrs')).toBeInTheDocument()
  })

  it('links published work as proof, not just a claim', () => {
    renderPage()
    const proof = document.querySelector('a[href^="https://unchartedterritoryy.substack.com"]')
    expect(proof).toBeInTheDocument()
    expect(proof).toHaveAttribute('target', '_blank')
    expect(proof).toHaveAttribute('rel', expect.stringContaining('noopener'))
    // Names what is actually published there — the Morning Wire stages as a
    // draft, so pointing people at it would send them somewhere it isn't.
    expect(proof.textContent).toMatch(/sunday scans/i)
    expect(proof.textContent).not.toMatch(/morning wire/i)
  })

  describe('once the launch moment passes', () => {
    // The flags are a deliberate human action, so the page has to hold this
    // state gracefully for however long it takes someone to flip them.
    const realDateNow = Date.now

    afterEach(() => { Date.now = realDateNow })

    it('says doors open today, not an empty countdown, on launch day', () => {
      // 2026-09-05 12:00 ET — same ET day as the 09:00 ET target, past it.
      Date.now = () => new Date('2026-09-05T16:00:00Z').getTime()
      renderPage()
      expect(screen.getByRole('status')).toHaveTextContent(/doors open today/i)
      expect(screen.queryByText(/^days?$/i)).not.toBeInTheDocument()
    })

    it('does not still claim "today" days later', () => {
      Date.now = () => new Date('2026-09-09T16:00:00Z').getTime()
      renderPage()
      expect(screen.getByRole('status')).toHaveTextContent(/opening imminently/i)
    })

    it('keeps capturing emails after the date passes', () => {
      Date.now = () => new Date('2026-09-09T16:00:00Z').getTime()
      renderPage()
      expect(screen.getByLabelText(/email address/i)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /notify me/i })).toBeInTheDocument()
    })
  })

  it('never says "opening bell" — the launch date is a Saturday', () => {
    const { container } = renderPage()
    expect(container.textContent).not.toMatch(/opening bell/i)
  })

  describe('founder access', () => {
    it('offers every contact route', () => {
      renderPage()
      const hrefs = [...document.querySelectorAll('a')].map(a => a.getAttribute('href'))
      expect(hrefs).toEqual(expect.arrayContaining([
        'https://x.com/TSDR_Trading',
        'https://x.com/Braczyy',
        'mailto:unchartedterritory5995@gmail.com',
        'tel:+16127300632',
      ]))
    })

    it('states the rate lock', () => {
      renderPage()
      expect(screen.getByRole('heading', { name: /founder access/i })).toBeInTheDocument()
      expect(screen.getByText(/locked for as long as you stay/i)).toBeInTheDocument()
    })

    it('opens external profiles safely', () => {
      renderPage()
      const x = document.querySelector('a[href="https://x.com/TSDR_Trading"]')
      expect(x).toHaveAttribute('target', '_blank')
      expect(x).toHaveAttribute('rel', expect.stringContaining('noopener'))
    })

    it('keeps mail and tel links in-place, not new tabs', () => {
      renderPage()
      expect(document.querySelector('a[href^="mailto:"]')).not.toHaveAttribute('target')
      expect(document.querySelector('a[href^="tel:"]')).not.toHaveAttribute('target')
    })
  })
})
