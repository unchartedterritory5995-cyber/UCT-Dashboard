import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

import CatalystsSection from './CatalystsSection'

const ok = (body) => ({ ok: true, status: 200, json: async () => body })

function mockFetch(respond) {
  globalThis.fetch = vi.fn((url) => Promise.resolve(respond(url)))
}

const EVENTS = [
  { type: 'catalyst', title: 'Raised FY guide on AI demand', description: 'Data-centre orders doubled.',
    date: '2026-05-21', direction: 'up', move_pct: 12.4, source: 'Reuters', url: 'https://r.example/1' },
  { type: 'earnings', title: 'Q1 print — beat', date: '2026-02-26', direction: 'down', move_pct: -3.46, source: 'Earnings' },
  { type: 'breaking', title: 'Partnership with Megacorp announced', date: '2026-08-20', direction: 'up', move_pct: 4, source: 'FinancialJuice' },
]

describe('CatalystsSection', () => {
  it('renders the merged feed with kind, date, move and source, newest order preserved', async () => {
    mockFetch(() => ok({ symbol: 'NVDA', status: 'ready', events: EVENTS }))
    render(<CatalystsSection sym="NVDA" />)
    expect(await screen.findByText('Raised FY guide on AI demand')).toBeTruthy()
    expect(screen.getByText('Data-centre orders doubled.')).toBeTruthy()
    expect(screen.getByText('May 21, 2026')).toBeTruthy()
    expect(screen.getByText('+12.4%')).toBeTruthy()
    expect(screen.getByText('-3.5%')).toBeTruthy()
    const link = screen.getByRole('link', { name: 'Reuters' })
    expect(link.getAttribute('href')).toBe('https://r.example/1')
    expect(link.getAttribute('rel')).toContain('noopener')
    expect(screen.getByText('Wire')).toBeTruthy()                // the kind label for a breaking item
    expect(screen.getByText('FinancialJuice')).toBeTruthy()      // its source, no link
    expect(screen.getByTestId('catalysts-provenance')).toBeTruthy()
  })

  it('the direction pills filter the list without refetching', async () => {
    mockFetch(() => ok({ symbol: 'AMD', status: 'ready', events: EVENTS }))
    render(<CatalystsSection sym="AMD" />)
    await screen.findByText('Raised FY guide on AI demand')
    const calls = globalThis.fetch.mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: /down/i }))
    expect(screen.queryByText('Raised FY guide on AI demand')).toBeNull()
    expect(screen.getByText('Q1 print — beat')).toBeTruthy()
    expect(screen.getByRole('button', { name: /down/i }).getAttribute('aria-pressed')).toBe('true')
    expect(globalThis.fetch.mock.calls.length).toBe(calls)
  })

  it('shows the finding state while catalysts generate and lands on its own (polls)', async () => {
    let n = 0
    mockFetch(() => (n++ === 0
      ? ok({ symbol: 'XYZ', status: 'generating', events: [] })
      : ok({ symbol: 'XYZ', status: 'ready', events: [EVENTS[2]] })))
    render(<CatalystsSection sym="XYZ" />)
    expect(await screen.findByTestId('catalysts-generating')).toBeTruthy()
    expect(await screen.findByText('Partnership with Megacorp announced', {}, { timeout: 6000 })).toBeTruthy()
    expect(screen.queryByTestId('catalysts-generating')).toBeNull()
  }, 10000)

  it('an empty, settled feed says so rather than showing a skeleton forever', async () => {
    mockFetch(() => ok({ symbol: 'EMP', status: 'ready', events: [] }))
    render(<CatalystsSection sym="EMP" />)
    expect(await screen.findByText(/No catalysts yet for EMP/)).toBeTruthy()
  })

  it('a 402 reads as a plan state, not a failure', async () => {
    mockFetch(() => ({ ok: false, status: 402, json: async () => ({ detail: 'paid' }) }))
    render(<CatalystsSection sym="ABC" />)
    expect(await screen.findByText(/require a paid plan/i)).toBeTruthy()
  })
})
