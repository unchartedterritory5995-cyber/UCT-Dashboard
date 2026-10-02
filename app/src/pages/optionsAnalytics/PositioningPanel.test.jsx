import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { SWRConfig } from 'swr'
import PositioningPanel from './PositioningPanel'

// Bodies are the shapes api/services/options_analytics/positioning.py returns for
// tests/fixtures/options_analytics/chain_tst_schwab_shape.json (tests/test_options_positioning.py).
const BODIES = {
  levels: {
    label: 'computed', method: 'Levels method.', vocabulary_version: 1, notes: [],
    atm_iv: { value: 0.252, strike: 100, expiration: '2026-10-09', label: 'vendor' },
    levels: [
      { id: 'call_wall', label: 'Call Wall', value: 100, unit: 'strike', role: 'Pin' },
      { id: 'implied_move_1d', label: 'Implied 1-Day Move', value: 1.59, unit: '$ move', role: null },
    ],
  },
  heatmap: {
    label: 'computed', method: 'Heatmap method.', unit: '$ of gamma per 1% move', note: 'A blank cell is a strike with no computable contract.',
    expirations: ['2026-10-09', '2026-10-16'], strikes: [90, 95, 100, 105],
    cells: [[null, -140000, 150000, 80000], [-60000, null, 80000, null]], max_abs: 150000,
  },
  'max-pain': {
    label: 'computed', method: 'Max pain method.', band_note: 'Computed over strikes within 15% of spot.',
    expirations: [{ expiration: '2026-10-09', max_pain: 100, distance_pct: 0, call_oi: 900, put_oi: 650 }],
  },
  nope: { label: 'computed', method: 'NOPE method.', nope: 5.94, net_option_delta_shares: 5940, share_volume: 100000 },
  impact: { label: 'computed', method: 'Impact method, uncalibrated.', impact_ratio: 0.0077, band: 'low' },
  'dealer-short': {
    label: 'computed', method: 'Dealer method.', summary: 'Dealers are estimated net short 2 of the 3 largest open-interest contracts on TST in the 2026-10-02 snapshot.',
    explanation: 'Negative open interest, read plainly.',
    dealer_short: [{ contract_key: 'TST|C|100.0|10/9/2026', expiration: '2026-10-09', strike: 100, cp: 'C', est_dealer_net: -220, flow_confidence: 0.7 }],
  },
}

function stub(armed) {
  vi.stubGlobal('fetch', vi.fn((u) => {
    const kind = Object.keys(BODIES).find((k) => u.includes(`/${k}`))
    const on = armed.includes(kind)
    return Promise.resolve({ status: on ? 200 : 404, ok: on, json: () => Promise.resolve(on ? BODIES[kind] : { detail: 'Not Found' }) })
  }))
}

const mount = () => render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}><PositioningPanel sym="tst" /></SWRConfig>)

describe('PositioningPanel (FT-047/049/050/052/055)', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('every block is dark on its own: all switches off renders no block', async () => {
    stub([])
    mount()
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(6))
    await new Promise((r) => setTimeout(r, 20))
    expect(screen.getByTestId('positioning').children.length).toBe(0)
  })

  it('arming ONE surface shows that block and no other', async () => {
    stub(['max-pain'])
    mount()
    expect((await screen.findByTestId('posn-maxpain')).textContent).toContain('2026-10-09: 100.00')
    expect(screen.queryByTestId('posn-heatmap')).toBeNull()
    expect(screen.queryByTestId('posn-levels')).toBeNull()
  })

  it('renders each armed block with its computed label and its words', async () => {
    stub(Object.keys(BODIES))
    mount()
    expect((await screen.findByTestId('posn-level-call_wall')).textContent).toBe('Call Wall: 100.00 (Pin)')
    expect(screen.getByTestId('posn-level-implied_move_1d').textContent).toContain('±$1.59')
    const heat = await screen.findByTestId('posn-heatmap')
    expect(heat.textContent).toContain('-$140K')
    expect(heat.querySelectorAll('tbody td')[0].textContent).toBe('')     // blank, never $0
    expect((await screen.findByTestId('posn-nope')).textContent).toContain('NOPE +5.94%')
    expect((await screen.findByTestId('posn-impact-read')).textContent).toContain('Ignore the positioning read')
    expect((await screen.findByTestId('posn-dealer-short')).textContent).toContain('dealers -220 contracts')
    expect(screen.getAllByText('computed').length).toBe(6)
  })

  it('a failed read says so in words', async () => {
    vi.stubGlobal('fetch', vi.fn((u) => Promise.resolve(u.includes('/nope')
      ? { status: 503, ok: false, json: () => Promise.resolve({ detail: 'x' }) }
      : { status: 404, ok: false, json: () => Promise.resolve({}) })))
    mount()
    expect((await screen.findByTestId('posn-nope')).textContent).toContain('failed read, not an empty one')
  })
})
