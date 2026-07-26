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
    expect(fetch).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent(/enter an email/i)
  })

  it('counts down to the launch target', () => {
    renderPage()
    // Rendered from a future default target, so a day figure is always present.
    expect(screen.getByText(/^days?$/i)).toBeInTheDocument()
    expect(screen.getByText('hrs')).toBeInTheDocument()
  })
})
