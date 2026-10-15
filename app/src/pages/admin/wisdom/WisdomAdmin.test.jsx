// app/src/pages/admin/wisdom/WisdomAdmin.test.jsx
//
// ⛔ MOCKS NOTHING ON THE PATH UNDER TEST BUT `global.fetch`. The real SWR cache
// and the real jsonFetcher run, so a non-ok answer takes the error branch here
// exactly as it does in the browser. Every feedback assertion reads RENDERED
// TEXT after the action settles — a state flag that flips while the member sees
// a blank line is the defect this repo has shipped before.
import { render, screen, waitFor, fireEvent, cleanup, within } from '@testing-library/react'
import { SWRConfig } from 'swr'
import { describe, it, expect, vi, afterEach } from 'vitest'

import WisdomAdmin, { OWNER_ONLY_TEXT, tabLabel } from './WisdomAdmin'

const API = '/api/admin/wisdom/publish'
const ITEM = 'a'.repeat(24)

const COUNTS = {
  tabs: {
    golden: { open: 2, accepted: 1, vetoed: 0, resolved: 0, total: 3 },
    vocabulary: { open: 0, accepted: 0, vetoed: 0, resolved: 0, total: 0 },
    extraction_audit: { open: 0, accepted: 0, vetoed: 0, resolved: 0, total: 0 },
  },
  totals: { open: 2, accepted: 1, vetoed: 0, resolved: 0, total: 3 },
}

const LIST = {
  items: [{ item_id: ITEM, tab: 'golden', subject_ref: 'golden:G-900', summary: 'CALL label for G-900',
    recommendation: null, status: 'open', created_at: '2026-09-14T19:00:00-04:00' }],
}

const detail = (overrides = {}) => ({
  item_id: ITEM, tab: 'golden', subject_ref: 'golden:G-900', summary: 'CALL label for G-900',
  recommendation: 'Accept the corrected stance', status: 'open', created_at: '2026-09-14',
  old: { stance: 'watching' }, new: { stance: 'taking' }, evidence: { locator: 'src-1#seg-2' },
  actions: [], golden_candidate: null, can_act: true, ...overrides,
})

const DASHBOARD = {
  week: '2026-W38', d16b: 'deferred', master_switch_on: false,
  metrics: {
    rows: [
      { metric: 'uct_see_rate_any', slice: {}, numerator: 0, denominator: 0, display: '0/0', method_version: 'v0', computed_at: '2026-09-20' },
      { metric: 'false_positive_rate', slice: {}, numerator: 3, denominator: 12, display: '3/12 (25.0%)', method_version: 'v0', computed_at: '2026-09-20' },
    ],
    not_computed: ['grounding_coverage'],
  },
  extractor: { eval_runs: [], rates: [] },
  capture_health: { source: 'wisdom_capture_runs', datasets: [{ dataset: 'wire', session_date: '2026-09-18', row_count: 120, trailing_median: 118, health: 'ok', consecutive_ok_sessions: 3 }] },
  budget: { this_week: { batches: 1, actual_usd: 1.25, pending_estimate_usd: 0 }, to_date: { batches: 1, actual_usd: 1.25, pending_estimate_usd: 0 }, budget_cap_usd: 120, budget_cap_source: 'latest wisdom_batches row' },
  scheduled_gates: { gates: [{ gate: 'First WEEKLY WISDOM REPORT (W1 §9.1)', due: '2026-09-20', status: 'scheduled', evidence: 'not stored yet' }] },
  jobs: [{ job_id: 'wisdom_daily_chain', trigger: { kind: 'cron', day_of_week: 'mon-fri', hour: 18, minute: 47 }, enabled: false, heartbeat: null }],
  flags: [{ env: 'WISDOM_WEEKLY_REPORT_ENABLED', on: false, member_visible: false }],
  chains: { daily: { due_key: '2026-09-14', dry_run: false, summary: { ok: 1, failed: 0, not_available: 1, skipped: 0 }, steps: [{ step: 'capture', status: 'not_available', reason: 'not built yet: api.services.wisdom.capture.run_all' }] }, weekly: null, monthly: null },
  chain_catalogue: { daily: [{ step: 'capture', available: false }] },
  queue_counts: COUNTS,
}

function serve(routes) {
  global.fetch = vi.fn(async (url, init = {}) => {
    const key = `${(init.method || 'GET').toUpperCase()} ${url}`
    const handler = routes[key]
    if (!handler) return { ok: false, status: 404, json: async () => ({ detail: `unmocked ${key}` }) }
    const [status, body] = typeof handler === 'function' ? handler(init) : handler
    return { ok: status >= 200 && status < 300, status, json: async () => body }
  })
  return global.fetch
}

const mount = () => render(
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, revalidateOnFocus: false }}>
    <WisdomAdmin />
  </SWRConfig>,
)

const baseQueueRoutes = (detailBody = detail()) => ({
  [`GET ${API}/queue/counts`]: [200, COUNTS],
  [`GET ${API}/queue?tab=golden&status=open`]: [200, LIST],
  [`GET ${API}/queue/${ITEM}`]: [200, detailBody],
})

afterEach(() => { cleanup(); delete global.fetch; vi.restoreAllMocks() })

describe('WisdomAdmin', () => {
  it('labels queue tabs from the server keys, not a second list', () => {
    expect(tabLabel('extraction_audit')).toBe('Extraction audit')
  })

  it('shows every queue tab the server reports with its open count, and the open items', async () => {
    serve(baseQueueRoutes())
    mount()
    const tablist = await screen.findByRole('tablist', { name: 'Queue tabs' })
    expect(within(tablist).getByRole('tab', { name: /Golden\s*2/ })).toHaveAttribute('aria-selected', 'true')
    expect(within(tablist).getByRole('tab', { name: /Extraction audit\s*0/ })).toBeInTheDocument()
    expect(await screen.findByText('CALL label for G-900')).toBeInTheDocument()
    expect(screen.getByText('Open across all tabs: 2')).toBeInTheDocument()
  })

  it('opens an item with old, new and evidence, and accepting says so and refreshes the queue', async () => {
    const fetcher = serve({
      ...baseQueueRoutes(),
      [`POST ${API}/queue/${ITEM}/action`]: (init) => {
        expect(JSON.parse(init.body)).toEqual({ action: 'accept', note: 'matches the text' })
        return [200, { item_id: ITEM, status: 'accepted', action_id: 1, golden_candidate_id: 'c1' }]
      },
    })
    mount()
    fireEvent.click(await screen.findByText('CALL label for G-900'))
    expect(await screen.findByText(/"watching"/)).toBeInTheDocument()
    expect(screen.getByText(/"taking"/)).toBeInTheDocument()
    expect(screen.getByText(/src-1#seg-2/)).toBeInTheDocument()
    expect(screen.getByText('Accept the corrected stance')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Note'), { target: { value: 'matches the text' } })
    const countsCallsBefore = fetcher.mock.calls.filter(([u]) => u === `${API}/queue/counts`).length
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }))
    expect(await screen.findByText('Accepted.')).toBeInTheDocument()
    await waitFor(() => expect(
      fetcher.mock.calls.filter(([u]) => u === `${API}/queue/counts`).length).toBeGreaterThan(countsCallsBefore))
  })

  it('tells a second admin in words that only the owner can rule, and disables the buttons', async () => {
    serve(baseQueueRoutes(detail({ can_act: false })))
    mount()
    fireEvent.click(await screen.findByText('CALL label for G-900'))
    expect(await screen.findByText(OWNER_ONLY_TEXT)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Veto' })).toBeDisabled()
  })

  it('renders the owner-only sentence when the server refuses the ruling with 403', async () => {
    serve({ ...baseQueueRoutes(), [`POST ${API}/queue/${ITEM}/action`]: [403, { detail: 'Owner access required' }] })
    mount()
    fireEvent.click(await screen.findByText('CALL label for G-900'))
    fireEvent.click(await screen.findByRole('button', { name: 'Veto' }))
    expect(await screen.findByRole('status')).toHaveTextContent(OWNER_ONLY_TEXT)
  })

  it('prints every rate with its n and 0/0 as 0/0', async () => {
    serve({ ...baseQueueRoutes(), [`GET ${API}/dashboard`]: [200, DASHBOARD] })
    mount()
    fireEvent.click(await screen.findByRole('tab', { name: /Metrics/ }))
    expect(await screen.findByText('3/12 (25.0%)')).toBeInTheDocument()
    expect(screen.getByText('0/0')).toBeInTheDocument()
    expect(screen.getByText('Not computed yet: grounding_coverage')).toBeInTheDocument()
    expect(screen.queryByText(/NaN|0\.0%/)).not.toBeInTheDocument()
  })

  it('shows capture health, job slots with chain steps, and budget with flags from one dashboard read', async () => {
    serve({ ...baseQueueRoutes(), [`GET ${API}/dashboard`]: [200, DASHBOARD] })
    mount()
    fireEvent.click(await screen.findByRole('tab', { name: /Capture health/ }))
    expect(await screen.findByText('wire')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: /Jobs/ }))
    expect(await screen.findByText('mon-fri 18:47 ET')).toBeInTheDocument()
    expect(screen.getByText(/capture: not_available — not built yet/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: /Budget & flags/ }))
    expect(await screen.findByText('WISDOM_WEEKLY_REPORT_ENABLED')).toBeInTheDocument()
    expect(screen.getByText('Budget cap: 120 (latest wisdom_batches row).')).toBeInTheDocument()
    expect(screen.getByText('D16b: deferred.')).toBeInTheDocument()
  })

  it('lists reports, shows one, and starting a preview says so', async () => {
    serve({
      ...baseQueueRoutes(),
      [`GET ${API}/reports`]: [200, { reports: [{ report_id: 'r1', kind: 'weekly', period_key: '2026-W38', variant: 'preview', generated_at: '2026-09-13', delivery_status: 'not_sent' }], preview: { running: false } }],
      [`GET ${API}/reports/r1`]: [200, { report_id: 'r1', markdown: '# WEEKLY WISDOM REPORT — 2026-W38' }],
      [`POST ${API}/reports/preview`]: [200, { started: true }],
    })
    mount()
    fireEvent.click(await screen.findByRole('tab', { name: /Reports/ }))
    fireEvent.click(await screen.findByText('Weekly report 2026-W38 (preview)'))
    expect(await screen.findByText('# WEEKLY WISDOM REPORT — 2026-W38')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Generate preview/ }))
    expect(await screen.findByText('Preview started. Refresh in a minute to see it.')).toBeInTheDocument()
  })

  it('says the queue could not load, with the status, instead of rendering an empty queue', async () => {
    serve({ [`GET ${API}/queue/counts`]: [503, { detail: 'wisdom.db unavailable' }] })
    mount()
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load the review queue (503).')
    expect(screen.queryByRole('tablist', { name: 'Queue tabs' })).not.toBeInTheDocument()
  })

  // ── Archive (synthetic data only — the repo is public) ──
  const ARCH = '/api/admin/wisdom/archive'
  const ARCH_STATS = {
    records: 2, calls: 3,
    records_by_author: { tsdr: 1, bracco: 1 }, records_by_type: { CALL: 1, LESSON: 1 },
    calls_by_author: { tsdr: 2, bracco: 1 }, calls_by_setup: { synthetic_setup: 3 },
  }
  const CALL = (id, r20) => ({ call_id: id, record_id: 't1', author_id: 'tsdr', ticker: 'ZZTA', direction: 'long',
    setup: 'synthetic_setup', action: 'entry', posted: '2025-01-02', entry: 10, stop: 9, outcome: { r20 } })

  it('Archive: shows stats, looks up a ticker, browses a setup and searches', async () => {
    serve({
      ...baseQueueRoutes(),
      [`GET ${ARCH}/stats`]: [200, ARCH_STATS],
      [`GET ${ARCH}/ticker/ZZTA`]: [200, { ticker: 'ZZTA',
        records: [{ record_id: 't1', stated_date: '2025-01-02', record_type: 'CALL', author_id: 'tsdr', note: 'synthetic pivot note', image_count: 0, tickers: ['ZZTA'] }],
        calls: [CALL('t1#0', 0.1)] }],
      [`GET ${ARCH}/setup/synthetic_setup`]: [200, { setup: 'synthetic_setup', n_calls: 3, n_scored: 2, mean_r20: 0.05,
        best: [{ ...CALL('t1#0', 0.3), record_note: 'best synthetic note' }], worst: [{ ...CALL('t1#1', -0.2), record_note: 'worst synthetic note' }] }],
      [`GET ${ARCH}/search?q=patience`]: [200, { q: 'patience', hits: [{ record_id: 't2', stated_date: '2025-02-01', record_type: 'LESSON', author_id: 'bracco', tickers: [], note: 'synthetic lesson about patience' }] }],
    })
    mount()
    fireEvent.click(await screen.findByRole('tab', { name: /Archive/ }))
    expect(await screen.findByText(/2 records · 3 calls/)).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Ticker'), { target: { value: 'zzta' } })
    fireEvent.click(screen.getByRole('button', { name: /Look up/ }))
    expect(await screen.findByText('synthetic pivot note')).toBeInTheDocument()
    expect(screen.getByText('ZZTA: 1 records · 1 calls')).toBeInTheDocument()
    expect(screen.getByText('+10.0%')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Setup'), { target: { value: 'synthetic_setup' } })
    expect(await screen.findByText('best synthetic note')).toBeInTheDocument()
    expect(screen.getByText('worst synthetic note')).toBeInTheDocument()
    expect(screen.getByText('-20.0%')).toBeInTheDocument()
    expect(screen.getByText(/mean r20 \+5\.0%/)).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'patience' } })
    fireEvent.click(screen.getByRole('button', { name: /^\s*Search$/ }))
    expect(await screen.findByText('synthetic lesson about patience')).toBeInTheDocument()
  })

  it('Archive: a 404 says the archive is off, not that nothing was found', async () => {
    serve({ ...baseQueueRoutes(), [`GET ${ARCH}/stats`]: [404, { detail: 'Not Found' }] })
    mount()
    fireEvent.click(await screen.findByRole('tab', { name: /Archive/ }))
    expect(await screen.findByText('The archive is off (WISDOM_ARCHIVE_ADMIN_ENABLED).')).toBeInTheDocument()
  })
})
