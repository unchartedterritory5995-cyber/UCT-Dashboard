import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import AiSearchInsightsPanel from './AiSearchInsightsPanel'

// Real useSWR (test-setup.js purges the SWR cache before every test), mock
// global.fetch and route by URL — mirrors AiSearchWidget.test.jsx's convention.
const LIVE_PAYLOAD = { requests: 5, active_users: 2, cache_hit_rate: 0.4, billed_units: 10, global_limit: 100 }

const LOG_PAYLOAD = {
  enabled: true, total: 120, window_days: 7, window_count: 40, answered: 38, distinct_buckets: 12,
  top_questions: [], top_tickers: [], by_mode: {}, by_question_type: {},
  by_freshness: { evergreen: 10, time_sensitive: 30 },
  cache_rate: 0.25, grounded_rate: 0.5, error_rate: 0.02, first_person_rate: 0.1,
  grounding_coverage: { 'web-only': 22, 'desk-grounded': 18 },
  personal: { invocations: 9, degraded: 1, rate: 0.183 },
  recent: [],
}

function mockFetch({ log, live } = {}) {
  global.fetch = vi.fn((url) => {
    const u = String(url)
    if (u.includes('/admin/log')) {
      return Promise.resolve(log === undefined
        ? { ok: true, json: async () => LOG_PAYLOAD }
        : { ok: log !== null, json: async () => log })
    }
    return Promise.resolve(live === undefined
      ? { ok: true, json: async () => LIVE_PAYLOAD }
      : { ok: live !== null, json: async () => live })
  })
}

// Stat renders <span statNumber>{n}</span><span statLabel>{label}</span> as
// siblings — read the number from the label's previous sibling.
function statValue(label) {
  return screen.getByText(label).previousSibling.textContent
}

describe('AiSearchInsightsPanel — grounding coverage lane', () => {
  afterEach(() => { delete global.fetch })

  it('renders the differentiation tiers and the personal lane with its denominator', async () => {
    mockFetch()
    render(<AiSearchInsightsPanel />)

    await waitFor(() => expect(statValue('Desk-grounded')).toBe('18'))
    expect(statValue('Web-only')).toBe('22')
    // 18 / (18 + 22) = 45%
    expect(statValue('Desk-grounded rate')).toBe('45%')
    expect(statValue('Personal invocations')).toBe('9')
    expect(statValue('Personal degraded')).toBe('1')
    // Explicit denominator label ("personal / total requests" idiom) + the rate itself.
    expect(statValue('Personal / total requests')).toBe('18%')
  })

  it('never labels ambient regime/recency as a proprietary or desk-grounded hit', async () => {
    mockFetch()
    render(<AiSearchInsightsPanel />)
    await waitFor(() => expect(statValue('Desk-grounded')).toBe('18'))

    // The lane's own copy explains regime/recency are ambient and excluded
    // from the tier decision — but "regime" must never appear as its OWN
    // standalone label/badge (i.e. never rendered as if it were itself a
    // countable desk-grounded/proprietary hit).
    expect(screen.getByText(/ambient regime\/recency/i)).toBeTruthy()
    expect(screen.queryByText(/^regime$/i)).toBeNull()
  })

  it('degrades to em-dashes when the /admin/log fetch fails, never throws', async () => {
    mockFetch({ log: null })
    render(<AiSearchInsightsPanel />)

    await waitFor(() => expect(statValue('Desk-grounded')).toBe('—'))
    expect(statValue('Web-only')).toBe('—')
    expect(statValue('Desk-grounded rate')).toBe('—')
    expect(statValue('Personal invocations')).toBe('—')
    expect(statValue('Personal degraded')).toBe('—')
    expect(statValue('Personal / total requests')).toBe('—')
    // No-data copy for the tier bars, not a crash / blank render (the
    // freshness-split lane above it shows the same copy for the same reason).
    expect(screen.getAllByText('No data yet').length).toBeGreaterThan(0)
  })
})
