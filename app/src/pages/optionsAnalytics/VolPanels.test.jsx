import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SWRConfig } from 'swr'
import { IvRankBadge, OptionMonitorStrip, VolStatsPanel } from './VolPanels'

// Bodies are the shapes api/services/options_analytics/vol.py returns (tests/test_options_vol.py).
const RANK_THIN = { label: 'computed', method: 'm.', n: 3, rank_min_sessions: 20, logging_began: '2026-09-30',
  iv_rank: null, iv_percentile: null, rank_word: null, meaningful_from: '2026-10-27',
  sentence: 'IV rank: 3 sessions logged, needs 20 (first possible 2026-10-27).' }
const RANK_FULL = { ...RANK_THIN, n: 25, iv_rank: 49.2, iv_percentile: 51, rank_word: 'Moderate', window_sessions: 25,
  sentence: 'IV rank 49 Moderate' }
const MONITOR = { hv: { hv20: 0.2512, hv30: 0.2401 }, hv_label: 'computed', hv_method: 'HV method.', hv_note: null,
  events: { next_earnings: '2026-10-28', days_to_earnings: 26, note: null },
  volume: { expiration: '2026-10-09', call_volume: 400, put_volume: 200, put_call_ratio: 0.5, label: 'vendor', note: 'n' } }

function stub(map) {
  vi.stubGlobal('fetch', vi.fn((u) => {
    const hit = Object.entries(map).find(([k]) => u.includes(k))
    const [status, body] = hit ? hit[1] : [404, { detail: 'Not Found' }]
    return Promise.resolve({ status, ok: status === 200, json: () => Promise.resolve(body) })
  }))
}

const wrap = (el) => render(<MemoryRouter><SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{el}</SWRConfig></MemoryRouter>)

describe('IvRankBadge (FT-006)', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('keeps the caller fallback while the switch is off', async () => {
    stub({})
    wrap(<IvRankBadge sym="TST" fallback={<span>IV rank: needs IV history</span>} />)
    await waitFor(() => expect(fetch).toHaveBeenCalled())
    expect(screen.getByText('IV rank: needs IV history')).toBeTruthy()
  })

  it('below 20 sessions shows the count and the first date, never a number', async () => {
    stub({ '/iv-rank': [200, RANK_THIN] })
    wrap(<IvRankBadge sym="TST" />)
    const b = await screen.findByTestId('iv-rank-badge')
    expect(b.textContent).toBe('IV rank: 3 sessions logged, needs 20 (first possible 2026-10-27).')
    expect(b.textContent).not.toMatch(/\d+%/)
  })

  it('with a rank shows the number and the plain word', async () => {
    stub({ '/iv-rank': [200, RANK_FULL] })
    wrap(<IvRankBadge sym="TST" />)
    expect((await screen.findByTestId('iv-rank-badge')).textContent).toContain('IV rank 49% Moderate')
  })
})

describe('OptionMonitorStrip (FT-019)', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('renders HV, the events button and vendor volume', async () => {
    stub({ '/monitor': [200, MONITOR] })
    wrap(<OptionMonitorStrip sym="TST" />)
    const m = await screen.findByTestId('option-monitor')
    expect(m.textContent).toContain('HV20 25.1%')
    expect(m.textContent).toContain('HV30 24.0%')
    expect(m.textContent).toContain('P/C 0.5')
    const link = screen.getByRole('link', { name: /Earnings 2026-10-28 \(26d\)/ })
    expect(link.getAttribute('href')).toBe('/research/TST?section=catalysts')
  })

  it('is absent while dark', async () => {
    stub({})
    const { container } = wrap(<OptionMonitorStrip sym="TST" />)
    await waitFor(() => expect(fetch).toHaveBeenCalled())
    expect(container.querySelector('[data-testid="option-monitor"]')).toBeNull()
  })
})

describe('VolStatsPanel (FT-020)', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('reads realized, constant-maturity IV and VRP from their routes', async () => {
    stub({
      '/realized': [200, { label: 'computed', method: 'HV.', available: true, hv: { hv10: 0.2, hv20: 0.25, hv30: 0.24 } }],
      '/interpolated-iv': [200, { label: 'computed', method: 'CM.', iv: 0.3697, reason: null }],
      '/vrp': [200, { label: 'computed', vrp_points: 0.1297, note: null }],
    })
    wrap(<VolStatsPanel sym="TST" />)
    expect((await screen.findByTestId('vol-realized')).textContent).toContain('HV30 24.0%')
    await waitFor(() => expect(screen.getByTestId('vol-iv30').textContent).toContain('37.0%'))
    await waitFor(() => expect(screen.getByTestId('vol-vrp').textContent).toContain('+13.0 vol pts'))
  })

  it('a body that is not a vol answer renders nothing', async () => {
    stub({ '/realized': [200, { calls: [] }], '/interpolated-iv': [200, { calls: [] }], '/vrp': [200, { calls: [] }] })
    const { container } = wrap(<VolStatsPanel sym="TST" />)
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3))
    await new Promise((r) => setTimeout(r, 20))
    expect(container.querySelector('[data-testid="vol-stats"]')).toBeNull()
  })
})
