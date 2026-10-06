import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'

// The Overview tab's "Latest report" card. Kept in its own file with vi.doMock + dynamic import
// so each test can hand useMobileSWR a different outcome (same pattern as
// useResearchOverview.errorAndHonesty.test.js).

afterEach(() => {
  vi.resetModules()
  vi.doUnmock('../../../hooks/useMobileSWR')
})

// Shape of api/services/earnings_intel.py's `quarters`: reported, newest fiscal period first.
const INTEL = {
  quarters: [
    { label: 'FY26 Q2', eps_actual: 1.25, eps_estimate: 1.1, eps_surprise_pct: 13.636,
      revenue_actual: 46.7e9, revenue_estimate: 46.0e9, rev_surprise_pct: 1.52 },
    { label: 'FY26 Q1', eps_actual: 0.96, eps_estimate: 0.93, eps_surprise_pct: 3.2,
      revenue_actual: 44.1e9, revenue_estimate: 43.3e9, rev_surprise_pct: 1.8 },
  ],
}

async function load(swr) {
  const calls = []
  vi.doMock('../../../hooks/useMobileSWR', () => ({
    default: (key) => { calls.push(key); return { data: swr, mutate: () => {} } },
  }))
  const mod = await import('./useLatestReport')
  return { mod, calls }
}

describe('latestReportRow', () => {
  it('projects the NEWEST reported quarter into the card row, formatted', async () => {
    const { mod } = await load(undefined)
    expect(mod.latestReportRow(INTEL)).toEqual({
      label: 'FY26 Q2',
      eps_estimate: '$1.10',
      reported_eps: '$1.25',
      surprise_pct: '+13.6%',
      rev_estimate: '$46.00B',
      rev_actual: '$46.70B',
      rev_surprise_pct: '+1.5%',
    })
  })

  it('a miss reads with its minus sign; no comparable consensus leaves the surprise blank', async () => {
    const { mod } = await load(undefined)
    const row = mod.latestReportRow({ quarters: [
      { label: 'Q', eps_actual: 0.9, eps_estimate: 1.0, eps_surprise_pct: -10,
        revenue_actual: 5e6, revenue_estimate: null, rev_surprise_pct: null, rev_surprise_abs: null },
    ] })
    expect(row.surprise_pct).toBe('-10.0%')
    expect(row.rev_estimate).toBe(null)
    expect(row.rev_surprise_pct).toBe(null)
  })

  it('a near-zero estimate shows the backend\'s ABSOLUTE surprise, not a fake percentage', async () => {
    const { mod } = await load(undefined)
    const row = mod.latestReportRow({ quarters: [
      { eps_actual: 0.03, eps_estimate: 0.01, eps_surprise_pct: null, eps_surprise_abs: 0.02 },
    ] })
    expect(row.surprise_pct).toBe('+$0.02')
  })

  it('nothing reported is null (estimate-only rows are not a report)', async () => {
    const { mod } = await load(undefined)
    expect(mod.latestReportRow({ quarters: [] })).toBe(null)
    expect(mod.latestReportRow({ quarters: [{ eps_estimate: 1, revenue_estimate: 2 }] })).toBe(null)
    expect(mod.latestReportRow(null)).toBe(null)
  })
})

describe('useLatestReport -- an outage is never "no report"', () => {
  it('reads the existing earnings-intel endpoint under its OWN cache key (not the dock\'s raw-JSON one)', async () => {
    const { mod, calls } = await load(undefined)
    renderHook(() => mod.default('nvda'))
    expect(calls[0]).toEqual(['overview-latest-report', '/api/earnings-intel/NVDA'])
  })

  it('no answer yet -> loading', async () => {
    const { mod } = await load(undefined)
    const { result } = renderHook(() => mod.default('NVDA'))
    expect(result.current.state).toBe('loading')
    expect(result.current.row).toBe(null)
  })

  it('a refused or failed read -> error, NOT empty', async () => {
    for (const data of [{ ok: false, httpStatus: 500, body: null }, { ok: false, httpStatus: 0, body: null }]) {
      const { mod } = await load(data)
      const { result } = renderHook(() => mod.default('NVDA'))
      expect(result.current.state).toBe('error')
      vi.resetModules()
    }
  })

  it('a 200 carrying {error} is an error too', async () => {
    const { mod } = await load({ ok: true, httpStatus: 200, body: { error: 'ticker required' } })
    const { result } = renderHook(() => mod.default('NVDA'))
    expect(result.current.state).toBe('error')
  })

  it('a healthy answer with no reported quarter -> empty; with one -> ready', async () => {
    let { mod } = await load({ ok: true, httpStatus: 200, body: { quarters: [] } })
    let { result } = renderHook(() => mod.default('NVDA'))
    expect(result.current.state).toBe('empty')
    vi.resetModules();
    ({ mod } = await load({ ok: true, httpStatus: 200, body: INTEL }));
    ({ result } = renderHook(() => mod.default('NVDA')))
    expect(result.current.state).toBe('ready')
    expect(result.current.row.reported_eps).toBe('$1.25')
  })

  // tq-panels: a fund answers not_applicable -- its own state, never "empty".
  it('a fund not_applicable answer -> not_applicable with its reason, not empty', async () => {
    const { mod } = await load({ ok: true, httpStatus: 200, body: { ticker: 'SPY', not_applicable: 'fund',
      reason: 'SPY is a fund; funds do not report earnings', quarters: [] } })
    const { result } = renderHook(() => mod.default('SPY'))
    expect(result.current.state).toBe('not_applicable')
    expect(result.current.reason).toBe('SPY is a fund; funds do not report earnings')
  })

  it('no symbol -> no fetch', async () => {
    const { mod, calls } = await load(undefined)
    renderHook(() => mod.default(''))
    expect(calls[0]).toBe(null)
  })
})
