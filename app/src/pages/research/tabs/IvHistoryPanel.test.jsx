// RM-L01 / RM-L02 -- the IV-history panel over our own options log, asserted on rendered text.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { SWRConfig } from 'swr'
import IvHistoryPanel from './IvHistoryPanel'

const BASE = {
  symbol: 'AAPL', status: 'ok', logging_began: '2026-09-30', covers_from: '2026-09-30',
  covers_to: '2026-10-02', n: 2, partial: true, missing_sessions: ['2026-10-01'],
  partial_reasons: ['1 trading session since 2026-09-30 was not logged (2026-10-01).'],
  points: [
    { date: '2026-09-30', atm_iv: 0.2656, atm_dte: 30, rule: 'closest-30' },
    { date: '2026-10-02', atm_iv: 0.2711, atm_dte: 28, rule: 'closest-30' },
  ],
  rank: null, rank_note: '2 sessions logged, rank needs 20.',
  method: 'ATM IV is the mean of the call and put IV.', source: 'UCT options log',
}
const IVR_NONE = {
  prints: [], paired: 0, calibration: null, method: 'Implied move = front straddle / price.',
  calibration_note: 'Logging began 2026-09-30; first comparison after the next print.',
}

function serve(routes) {
  global.fetch = vi.fn((url) => {
    const hit = Object.entries(routes).find(([k]) => String(url).endsWith(k))
    if (!hit) return Promise.resolve({ ok: false, status: 404, json: async () => ({ detail: 'Not Found' }) })
    const [, body] = hit
    if (body === 404) return Promise.resolve({ ok: false, status: 404, json: async () => ({ detail: 'Not Found' }) })
    return Promise.resolve({ ok: true, status: 200, json: async () => body })
  })
}

const mount = (sym = 'AAPL') => render(
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
    <IvHistoryPanel sym={sym} />
  </SWRConfig>,
)

afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('IvHistoryPanel', () => {
  it('renders NOTHING while the flag is dark (404)', async () => {
    serve({ '/iv-history/AAPL': 404 })
    const { container } = mount()
    await new Promise((r) => setTimeout(r, 30))
    expect(container.innerHTML).toBe('')
  })

  it('prints every point with its date and DTE, the rank sentence, and the gap in words', async () => {
    serve({ '/iv-history/AAPL': BASE, '/implied-vs-realized': IVR_NONE })
    mount()
    expect(await screen.findByTestId('iv-history')).toBeTruthy()
    expect(screen.getByTestId('iv-latest').textContent).toBe('ATM IV 27.1% on 2026-10-02 (28 days to expiry)')
    const items = [...screen.getByTestId('iv-points').querySelectorAll('li')].map((li) => li.textContent)
    expect(items).toEqual(['2026-10-02: 27.1% at 28 DTE', '2026-09-30: 26.6% at 30 DTE'])
    expect(screen.getByTestId('iv-rank').textContent).toBe('IV rank: 2 sessions logged, rank needs 20.')
    expect(screen.getByTestId('iv-coverage').textContent).toContain('was not logged (2026-10-01)')
  })

  it('shows NO calibration below the minimum, only the sentence', async () => {
    serve({ '/iv-history/AAPL': BASE, '/implied-vs-realized': IVR_NONE })
    mount()
    expect((await screen.findByTestId('ivr-note')).textContent)
      .toBe('Logging began 2026-09-30; first comparison after the next print.')
    expect(screen.queryByTestId('ivr-calibration')).toBeNull()
  })

  it('serves the rank as numbers once the server sends one', async () => {
    serve({
      '/iv-history/AAPL': { ...BASE, rank: { iv_rank: 80, iv_percentile: 94.7, window_sessions: 20 }, rank_note: null },
      '/implied-vs-realized': IVR_NONE,
    })
    mount()
    expect((await screen.findByTestId('iv-rank')).textContent)
      .toBe('IV rank 80 · IV percentile 95 over 20 sessions')
  })

  it('draws the reliability line only when the server sends a calibration', async () => {
    serve({
      '/iv-history/AAPL': BASE,
      '/implied-vs-realized': {
        ...IVR_NONE, calibration_note: null, paired: 4,
        calibration: { prints: 4, mean_ratio: 1.1, inside_share: 50 },
        prints: [{ report_date: '2026-07-30', pre_print_session: '2026-07-29', implied_move_pct: 5,
                   realized_move_pct: -6, ratio: 1.2, note: null }],
      },
    })
    mount()
    expect((await screen.findByTestId('ivr-calibration')).textContent).toContain('averaged 1.10× the')
    expect(screen.getByTestId('ivr-prints').textContent).toContain('2026-07-30: implied ±5.00%')
  })

  it('ignores a body that is not an IV-history answer', async () => {
    serve({ '/iv-history/AAPL': { calls: [], puts: [] } })
    const { container } = mount()
    await new Promise((r) => setTimeout(r, 30))
    expect(container.innerHTML).toBe('')
  })
})
