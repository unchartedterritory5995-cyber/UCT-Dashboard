import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

import ProfileSection from './ProfileSection'
import { pctText } from '../../../utils/profileFormat'

// The peer chips open the real TickerPopup; here we only need to know a chip
// was rendered for the right symbol.
vi.mock('../../TickerPopup', () => ({
  default: ({ sym, children, className }) => (
    <button type="button" className={className} data-testid={`peer-${sym}`}>{children}</button>
  ),
}))

const ok = (body) => ({ ok: true, status: 200, json: async () => body })

function mockFetch(routes) {
  globalThis.fetch = vi.fn((url) => {
    for (const [needle, respond] of Object.entries(routes)) {
      if (url.includes(needle)) return Promise.resolve(respond(url))
    }
    return Promise.resolve({ ok: false, status: 404, json: async () => null })
  })
}

describe('ProfileSection', () => {
  it('renders the description, key facts, this-year story and peers — one authority each', async () => {
    mockFetch({
      '/api/stock-brief/NVDA': () => ok({
        symbol: 'NVDA', company: 'NVIDIA', sector: 'Technology', industry: 'Semiconductors',
        status: 'ready',
        stats: { ytd_gain_pct: 42.5, range_pct: 80.1, range_dir: 'up', avg_dollar_vol: 25e9 },
        profile: { company_desc: 'Designs GPUs.', run_story: 'AI capex carried the year.', generated_at: 1755800000 },
      }),
      '/api/fundamentals/NVDA': () => ok({
        market_cap: '$4.10T', float_shares: 23.5e9, short_pct_float: 1.1, inst_own_pct: 66.2,
        next_earnings: '2026-08-27', website: 'https://www.nvidia.com', hq: 'Santa Clara, CA',
        ceo: 'Jensen Huang', employees: 36000,
      }),
      '/api/groups/peers': () => ok({ peers: ['AMD', 'AVGO', 'NVDA'] }),
    })
    render(<ProfileSection sym="NVDA" />)
    expect(await screen.findByText('Designs GPUs.')).toBeTruthy()
    expect(screen.getByText('AI capex carried the year.')).toBeTruthy()
    expect(await screen.findByText('$4.10T')).toBeTruthy()        // fundamentals' own string
    expect(screen.getByText('+43%')).toBeTruthy()                  // fmtPct, whole percent
    expect(screen.getByText('$25.0B')).toBeTruthy()                // fmtVol
    expect(screen.getByText('66.2%')).toBeTruthy()                 // inst. own
    expect(screen.getByText('8/27/26')).toBeTruthy()               // next earnings
    expect(screen.getByText('nvidia.com')).toBeTruthy()            // website, domain only
    expect(screen.getByText('Technology · Semiconductors')).toBeTruthy()
    expect(await screen.findByTestId('peer-AMD')).toBeTruthy()
    expect(screen.queryByTestId('peer-NVDA')).toBeNull()           // never itself
    expect(screen.getByTestId('profile-provenance').textContent).toMatch(/AI · company profile · written/)
  })

  it('shows the writing state while the profile generates and lands on its own (polls)', async () => {
    let n = 0
    mockFetch({
      '/api/stock-brief/XYZ': () => (n++ === 0
        ? ok({ status: 'generating', profile: {}, stats: {} })
        : ok({ status: 'ready', profile: { company_desc: 'Now written.' }, stats: {} })),
      '/api/fundamentals/XYZ': () => ok({}),
      '/api/groups/peers': () => ok({ peers: [] }),
    })
    render(<ProfileSection sym="XYZ" />)
    expect(await screen.findByTestId('profile-generating')).toBeTruthy()
    expect(await screen.findByText('Now written.', {}, { timeout: 6000 })).toBeTruthy()
    expect(screen.queryByTestId('profile-generating')).toBeNull()
  }, 10000)

  it('a 402 reads as a plan state, not a failure', async () => {
    mockFetch({
      '/api/stock-brief/ABC': () => ({ ok: false, status: 402, json: async () => ({ detail: 'paid' }) }),
      '/api/fundamentals/ABC': () => ok({}),
      '/api/groups/peers': () => ok({ peers: [] }),
    })
    render(<ProfileSection sym="ABC" />)
    expect(await screen.findByText(/require a paid plan/i)).toBeTruthy()
    expect(screen.queryByText(/unavailable/i)).toBeNull()
  })

  it('a missing percent is an em dash, never a phantom 0.0%', () => {
    expect(pctText(null)).toBe('—')
    expect(pctText(undefined)).toBe('—')
    expect(pctText(0)).toBe('0.0%')
    expect(pctText('1.25')).toBe('1.3%')
  })
})
