// The pattern side panel's Historical Stats, from the trader archive. Every state the server
// can answer is rendered here, and the three that mean "nothing to show" (404, 402, no
// pattern id) must leave the panel's original placeholder exactly as it was.
// Synthetic data only: the repo is public.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SWRConfig } from 'swr'

import PatternArchiveStats, { PLACEHOLDER, archiveUrl } from './PatternArchiveStats'

const ok = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) })
const fail = (status) => ({ ok: false, status, json: async () => ({ detail: 'x' }), text: async () => '{"detail":"x"}' })

const ST = (n, edge, z) => ({ n, n_scored: n, win20: 0.55, med_r20: 0.01, med_edge20: 0.012, mean_edgeR: edge, edgeR_z: z })
const CALL = (id, ticker, r20, trader = 'TSDR') => ({ call_id: id, record_id: 't1', ticker, author_id: 'tsdr', trader,
  posted: '2025-01-02', direction: 'long', r20 })
const BODY = {
  pattern_id: 'uct_kicker', setup_id: 'kicker', name: 'Kicker candle',
  stats: { all: ST(140, 0.25, 1.4) },
  market: { state: 'downtrend', cut: ST(40, 0.9) },
  best: [CALL('t1#1', 'ZZW0', 0.3), CALL('t1#2', 'ZZW1', 0.2)],
  worst: [CALL('t1#3', 'ZZL', -0.2, 'Bracco')],
  ticker: { ticker: 'ZZTA', n_calls: 3, n_scored: 3, mean_r20: 0.1,
    last_call: { posted: '2025-03-04', setup: 'kicker', trader: 'Manrav', r20: 0.12 } },
}

function serve(answer) {
  globalThis.fetch = vi.fn(() => Promise.resolve(answer))
}

const mount = (props) => render(
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
    <PatternArchiveStats {...props} />
  </SWRConfig>,
)

afterEach(() => { vi.restoreAllMocks() })

describe('PatternArchiveStats', () => {
  it('asks the pattern route once, with the ticker', async () => {
    serve(ok(BODY))
    mount({ patternId: 'uct_kicker', sym: 'ZZTA' })
    await screen.findByTestId('archive-stats')
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
    expect(String(globalThis.fetch.mock.calls[0][0])).toBe('/api/wisdom/archive/pattern/uct_kicker?ticker=ZZTA')
  })

  it('renders the record, today\'s tape cut, best and worst calls and the ticker line', async () => {
    serve(ok(BODY))
    mount({ patternId: 'uct_kicker', sym: 'ZZTA' })
    const box = await screen.findByTestId('archive-stats')
    expect(box.textContent).toContain('Kicker candle')
    expect(box.textContent).toContain('140 scored calls · not proven (z 1.4)')       // z under 3
    expect(screen.getByTestId('archive-market-cut').textContent)
      .toBe('QQQ downtrend today: 40 calls in this tape, win 55%, edge +0.90R.')
    expect(box.textContent).toContain('ZZW0')
    expect(box.textContent).toContain('ZZL')
    expect(screen.getByTestId('archive-ticker-line').textContent)
      .toBe('ZZTA: 3 team calls, last Manrav on 2025-03-04 (kicker, 20d +12.0%).')
    expect(screen.getByRole('link', { name: 'Open the full playbook' }).getAttribute('href'))
      .toBe('/trader-archive?view=playbooks&setup=kicker')
  })

  it('calls a z of 3 on 30+ calls a measured edge, and a thin cut thin', async () => {
    serve(ok({ ...BODY, stats: { all: ST(500, 0.4, 3.2) }, market: { state: 'uptrend', cut: ST(12, 1.5) } }))
    mount({ patternId: 'uct_kicker', sym: 'ZZTA' })
    const box = await screen.findByTestId('archive-stats')
    expect(box.textContent).toContain('500 scored calls · measured edge (z 3.2)')
    expect(screen.getByTestId('archive-market-cut').textContent)
      .toBe('QQQ uptrend today: fewer than 30 scored calls in this tape.')
  })

  it('says so when the team never called the ticker', async () => {
    serve(ok({ ...BODY, ticker: { ticker: 'ZZNO', n_calls: 0, n_scored: 0, mean_r20: null, last_call: null } }))
    mount({ patternId: 'uct_kicker', sym: 'ZZNO' })
    expect((await screen.findByTestId('archive-ticker-line')).textContent).toBe('ZZNO: the team has not called it.')
  })

  it.each([404, 402, 500])('keeps the original placeholder on a %s', async (status) => {
    serve(fail(status))
    const { container } = mount({ patternId: 'uct_kicker', sym: 'ZZTA' })
    expect(await screen.findByText(PLACEHOLDER)).toBeTruthy()
    expect(container.querySelector('[data-testid="archive-stats"]')).toBeNull()
  })

  it('keeps the placeholder and asks nothing without a pattern id', () => {
    serve(ok(BODY))
    mount({ patternId: undefined, sym: 'ZZTA' })
    expect(screen.getByText(PLACEHOLDER)).toBeTruthy()
    expect(globalThis.fetch).not.toHaveBeenCalled()
    expect(archiveUrl(undefined, 'ZZTA')).toBeNull()
  })

  it('shows a loading line until the answer lands', async () => {
    let resolve
    globalThis.fetch = vi.fn(() => new Promise((r) => { resolve = r }))
    mount({ patternId: 'uct_kicker', sym: 'ZZTA' })
    expect(screen.getByTestId('archive-stats-loading')).toBeTruthy()
    resolve(ok(BODY))
    await screen.findByTestId('archive-stats')
  })

  it('the placeholder sentence is the one the panel always showed', () => {
    expect(PLACEHOLDER).toBe('Pattern stats available after Phase 7 launch — outcome tracker pending.')
  })
})
