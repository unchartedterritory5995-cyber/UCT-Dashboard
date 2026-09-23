import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import DataPipelineHealthPanel from './DataPipelineHealthPanel'

// Packet Y CP2 (signed 2026-09-23, fingerprint 4007862bd). Real useSWR
// (test-setup.js purges the SWR cache before every test), mock global.fetch
// and route by URL — mirrors AiSearchInsightsPanel.test.jsx's convention.

// A "clean" fixture per monitor — every flag condition false.
const CLEAN = {
  '/api/admin/fundamentals-health': {
    last_cycle_at: '2026-09-23T10:00:00+00:00', checked_total: 300, healed_total: 4, flagged_current: [],
  },
  '/api/admin/reconciliation-status': {
    last_cycle_at: '2026-09-23T10:05:00+00:00', audits_run: 60, rows_healed_total: 2, last_detect_drift: [],
  },
  '/api/admin/bars-stream-status': {
    enabled: true,
    broadcaster: { last_emit_age_s: 1.2, bars_emitted_total: 9000, bars_dropped_total: 0 },
    websocket: { connected: true },
  },
  '/api/admin/warm-universe-status': {
    running: false, started_at: 100, total: 3742, done: 3742, errors: 0,
    started_iso: '2026-09-23T09:00:00Z', completed_iso: '2026-09-23T09:30:00Z',
  },
  '/api/admin/provider-coverage': {
    last_cycle_at: '2026-09-23T10:10:00+00:00',
    fields: { price_target: {}, consensus: {}, beat_history: {} },
    defects_current: [],
  },
  '/api/admin/calendar-date-integrity': { tracked: 500, with_moves: 120 },
  '/api/admin/calendar-coverage-status': {
    as_of: '2026-09-23T09:40:00-04:00', supplemented: 12,
    days: { '2026-09-23': { served: 40, schedule_only: 28 } },
  },
  '/api/admin/calendar-enrichment-status': {
    dates: { '2026-09-23': { total: 40, with_em: 38, computed_at: '2026-09-23T09:41:00-04:00', em_collapsed: false } },
    window_days: 7,
  },
  '/api/admin/implied-sweep-status': {
    runs: [{ run_id: 'a1', started_at: '2026-09-23T02:00:00-04:00', finished_at: '2026-09-23T02:30:00-04:00', symbols_done: 100, symbols_total: 100 }],
    unfinished: [],
  },
  '/api/admin/call-recap-status': { generated_today: 8, spend_today_usd: 1.5, daily_cap_usd: 10.0 },
  '/api/admin/transcript-index-status': { transcripts: 900, symbols: 300, newest: '2026-09-22' },
  '/api/admin/yfinance-guard': { last_trip_epoch: null, calls_total: 5000, suppressed_total: 0, breaker_open: false },
}

function mockFetch(overrides = {}) {
  const payloads = { ...CLEAN, ...overrides }
  global.fetch = vi.fn((url) => {
    const u = String(url)
    const match = Object.keys(payloads).find((k) => u.includes(k))
    if (!match) return Promise.resolve({ ok: true, json: async () => ({}) })
    const val = payloads[match]
    if (val === null) return Promise.resolve({ ok: false, json: async () => null })
    return Promise.resolve({ ok: true, json: async () => val })
  })
}

describe('DataPipelineHealthPanel — happy path', () => {
  afterEach(() => { delete global.fetch })

  it('renders all 12 monitor rows with a clean badge when every signal is healthy', async () => {
    mockFetch()
    render(<DataPipelineHealthPanel />)

    await waitFor(() => expect(screen.getByText('300 checked / 4 healed')).toBeTruthy())
    expect(screen.getByText('60 audits / 2 healed')).toBeTruthy()
    expect(screen.getByText('9000 emitted')).toBeTruthy()
    expect(screen.getByText('3742/3742')).toBeTruthy()
    expect(screen.getByText('3 fields tracked')).toBeTruthy()
    expect(screen.getByText('500 tracked / 120 moved')).toBeTruthy()
    expect(screen.getByText('12 supplemented')).toBeTruthy()
    expect(screen.getByText('38/40 with EM')).toBeTruthy()
    expect(screen.getByText('100/100 symbols')).toBeTruthy()
    expect(screen.getByText('8 generated / $1.50 spend')).toBeTruthy()
    expect(screen.getByText('900 transcripts / 300 symbols')).toBeTruthy()
    expect(screen.getByText('5000 calls / 0 suppressed')).toBeTruthy()

    // No "flagged"-toned badge text present anywhere.
    expect(screen.queryByText(/unhealed drift/)).toBeNull()
    expect(screen.queryByText('breaker OPEN')).toBeNull()
    expect(screen.queryByText('at daily cap')).toBeNull()
  })

  it('states plainly that two routes publish no timestamp, rather than inventing one', async () => {
    mockFetch()
    render(<DataPipelineHealthPanel />)
    await waitFor(() => expect(screen.getAllByText('(no timestamp published)').length).toBe(2))
  })

  it('never flags Calendar Date Integrity or Transcript Index — no defect signal in either payload', async () => {
    mockFetch()
    render(<DataPipelineHealthPanel />)
    await waitFor(() => expect(screen.getByText('500 tracked / 120 moved')).toBeTruthy())
    // Both rows render the neutral "info" badge, never "flagged"/"clean".
    const infoBadges = screen.getAllByText('info')
    expect(infoBadges.length).toBe(2)
  })
})

describe('DataPipelineHealthPanel — flagged states', () => {
  afterEach(() => { delete global.fetch })

  it('flags Fundamentals Accuracy when flagged_current is non-empty', async () => {
    mockFetch({ '/api/admin/fundamentals-health': { ...CLEAN['/api/admin/fundamentals-health'], flagged_current: [{ sym: 'HUBG', issues: [{ kind: 'forward_gap' }] }] } })
    render(<DataPipelineHealthPanel />)
    await waitFor(() => expect(screen.getByText('flagged (1)')).toBeTruthy())
  })

  it('flags Bars Reconciliation when last_detect_drift is non-empty (unhealed drift)', async () => {
    mockFetch({ '/api/admin/reconciliation-status': { ...CLEAN['/api/admin/reconciliation-status'], last_detect_drift: [{ ticker: 'AAPL', tf: 'D' }] } })
    render(<DataPipelineHealthPanel />)
    await waitFor(() => expect(screen.getByText('unhealed drift (1)')).toBeTruthy())
  })

  it('flags Bars Push Feed when enabled and the websocket is disconnected', async () => {
    mockFetch({
      '/api/admin/bars-stream-status': {
        enabled: true,
        broadcaster: { last_emit_age_s: 400, bars_emitted_total: 100, bars_dropped_total: 0 },
        websocket: { connected: false },
      },
    })
    render(<DataPipelineHealthPanel />)
    await waitFor(() => expect(screen.getByText('flagged')).toBeTruthy())
  })

  it('flags Bars Push Feed when enabled and bars are being dropped, even with the websocket connected', async () => {
    mockFetch({
      '/api/admin/bars-stream-status': {
        enabled: true,
        broadcaster: { last_emit_age_s: 1, bars_emitted_total: 100, bars_dropped_total: 3 },
        websocket: { connected: true },
      },
    })
    render(<DataPipelineHealthPanel />)
    await waitFor(() => expect(screen.getByText('flagged')).toBeTruthy())
  })

  it('never flags Bars Push Feed when the rail is disabled, however the nested fields would read', async () => {
    mockFetch({ '/api/admin/bars-stream-status': { enabled: false } })
    render(<DataPipelineHealthPanel />)
    await waitFor(() => expect(screen.getByText('off')).toBeTruthy())
    expect(screen.queryByText('flagged')).toBeNull()
  })

  it('flags Warm Universe when errors > 0', async () => {
    mockFetch({ '/api/admin/warm-universe-status': { ...CLEAN['/api/admin/warm-universe-status'], errors: 2 } })
    render(<DataPipelineHealthPanel />)
    await waitFor(() => expect(screen.getByText('2 errors')).toBeTruthy())
  })

  it('flags Provider Coverage when defects_current is non-empty', async () => {
    mockFetch({ '/api/admin/provider-coverage': { ...CLEAN['/api/admin/provider-coverage'], defects_current: [{ field: 'price_target' }] } })
    render(<DataPipelineHealthPanel />)
    await waitFor(() => expect(screen.getByText('defects (1)')).toBeTruthy())
  })

  it('flags Calendar Coverage on the error-key branch', async () => {
    mockFetch({ '/api/admin/calendar-coverage-status': { as_of: '2026-09-23T09:40:00-04:00', today: '2026-09-23', window: [], error: 'ValueError: boom' } })
    render(<DataPipelineHealthPanel />)
    await waitFor(() => expect(within(screen.getByTestId('monitor-row-calendar-coverage')).getByText('flagged')).toBeTruthy())
  })

  it('flags Calendar Coverage when supplemented is 0 and every day served equals schedule_only (the 2026-08-16 shape)', async () => {
    mockFetch({
      '/api/admin/calendar-coverage-status': {
        as_of: '2026-09-23T09:40:00-04:00', supplemented: 0,
        days: { '2026-09-23': { served: 28, schedule_only: 28 }, '2026-09-24': { served: 5, schedule_only: 5 } },
      },
    })
    render(<DataPipelineHealthPanel />)
    await waitFor(() => expect(within(screen.getByTestId('monitor-row-calendar-coverage')).getByText('flagged')).toBeTruthy())
  })

  it('does NOT flag Calendar Coverage when supplemented is 0 but some day added real supplement (served != schedule_only)', async () => {
    mockFetch({
      '/api/admin/calendar-coverage-status': {
        as_of: '2026-09-23T09:40:00-04:00', supplemented: 0,
        days: { '2026-09-23': { served: 40, schedule_only: 28 } },
      },
    })
    render(<DataPipelineHealthPanel />)
    await waitFor(() => expect(screen.getByText('0 supplemented')).toBeTruthy())
    const row = screen.getByTestId('monitor-row-calendar-coverage')
    expect(within(row).getByText('clean')).toBeTruthy()
    expect(within(row).queryByText('flagged')).toBeNull()
  })

  it('does NOT flag Calendar Coverage on an empty response (no build yet since restart)', async () => {
    mockFetch({ '/api/admin/calendar-coverage-status': {} })
    render(<DataPipelineHealthPanel />)
    await waitFor(() => expect(screen.getByText('— supplemented')).toBeTruthy())
  })

  it('does NOT flag Calendar Coverage when supplemented is 0 but `days` is empty (no build yet, not a defect — the vacuous-every guard)', async () => {
    mockFetch({ '/api/admin/calendar-coverage-status': { as_of: '2026-09-23T09:40:00-04:00', supplemented: 0, days: {} } })
    render(<DataPipelineHealthPanel />)
    await waitFor(() => expect(screen.getByText('0 supplemented')).toBeTruthy())
    const row = screen.getByTestId('monitor-row-calendar-coverage')
    expect(within(row).getByText('clean')).toBeTruthy()
    expect(within(row).queryByText('flagged')).toBeNull()
  })

  it('flags Calendar Enrichment when the newest date has em_collapsed true', async () => {
    mockFetch({
      '/api/admin/calendar-enrichment-status': {
        dates: { '2026-09-23': { total: 40, with_em: 0, computed_at: '2026-09-23T09:41:00-04:00', em_collapsed: true } },
      },
    })
    render(<DataPipelineHealthPanel />)
    await waitFor(() => expect(screen.getByText('em_collapsed')).toBeTruthy())
  })

  it('flags Implied Sweep when the unfinished array is non-empty', async () => {
    mockFetch({
      '/api/admin/implied-sweep-status': {
        runs: [{ run_id: 'a2', started_at: '2026-09-23T02:00:00-04:00', finished_at: null, symbols_done: 40, symbols_total: 100 }],
        unfinished: ['a2'],
      },
    })
    render(<DataPipelineHealthPanel />)
    await waitFor(() => expect(screen.getByText('unfinished (1)')).toBeTruthy())
  })

  it('flags Call Recap when spend_today_usd has reached daily_cap_usd', async () => {
    mockFetch({ '/api/admin/call-recap-status': { generated_today: 40, spend_today_usd: 10.0, daily_cap_usd: 10.0 } })
    render(<DataPipelineHealthPanel />)
    await waitFor(() => expect(screen.getByText('at daily cap')).toBeTruthy())
  })

  it('flags yfinance Guard when breaker_open is true', async () => {
    mockFetch({ '/api/admin/yfinance-guard': { last_trip_epoch: 1758000000, calls_total: 100, suppressed_total: 50, breaker_open: true } })
    render(<DataPipelineHealthPanel />)
    await waitFor(() => expect(screen.getByText('breaker OPEN')).toBeTruthy())
  })

  it('degrades every row to a no-data placeholder, never a crash, when all 12 fetches fail', async () => {
    mockFetch(Object.fromEntries(Object.keys(CLEAN).map((k) => [k, null])))
    render(<DataPipelineHealthPanel />)
    await waitFor(() => expect(screen.getAllByText('no data').length).toBe(12))
  })
})
