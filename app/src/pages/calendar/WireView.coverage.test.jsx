// app/src/pages/calendar/WireView.coverage.test.jsx
//
// The trust line: the owner reads the feed as "complete and total" only
// because this line SAYS so from measurement — so its three states are
// behaviour, not styling:
//   • complete   → says complete, with the measured count
//   • incomplete → NAMES the missing tickers (a count alone hides the story)
//   • unmeasured → says unknown; it must never render as clean
//   • and it never renders at all for a non-current session (history would
//     scream "missing" about rows nobody ever recorded)
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('./useWire', () => ({ useWire: () => globalThis.__wire }))
vi.mock('./useWireCoverage', () => ({
  useWireCoverage: () => (globalThis.__wireCov ?? { data: null }),
}))

import WireView from './WireView'

const row = (sym, seen) => ({
  sym, first_seen_at: seen, timing: 'amc', move_pct: 2.1,
  eps_act: 1.2, eps_est: 1.1, rev_act: 100, rev_est: 99,
})

const cov = (extra = {}) => ({
  market_date: '2026-08-11', is_current_session: true, measured: true,
  reported: 99, on_feed_with_numbers: 99,
  missing_from_feed: [], numbers_pending_on_feed: [], ok: true, ...extra,
})

describe('WireView coverage trust line', () => {
  it('says complete, with the measured count', () => {
    globalThis.__wire = { data: { rows: [row('SE', 1000)], expected: 1 } }
    globalThis.__wireCov = { data: cov() }
    render(<WireView />)
    const line = screen.getByTestId('wire-coverage')
    expect(line.textContent).toMatch(/Complete/)
    expect(line.textContent).toMatch(/99 reported/)
  })

  it('NAMES the missing tickers instead of only counting them', () => {
    globalThis.__wire = { data: { rows: [row('SE', 1000)], expected: 2 } }
    globalThis.__wireCov = {
      data: cov({ missing_from_feed: ['SLAB', 'BGS'], ok: false }),
    }
    render(<WireView />)
    const line = screen.getByTestId('wire-coverage')
    expect(line.textContent).toMatch(/SLAB/)
    expect(line.textContent).toMatch(/BGS/)
    expect(line.textContent).not.toMatch(/Complete —/)
  })

  it('caps a long list visibly rather than silently truncating it', () => {
    const many = Array.from({ length: 12 }, (_, i) => `S${String(i).padStart(2, '0')}`)
    globalThis.__wire = { data: { rows: [row('SE', 1000)], expected: 2 } }
    globalThis.__wireCov = { data: cov({ missing_from_feed: many, ok: false }) }
    render(<WireView />)
    const line = screen.getByTestId('wire-coverage')
    expect(line.textContent).toMatch(/S07/)
    expect(line.textContent).not.toMatch(/S08/)
    expect(line.textContent).toMatch(/\+4 more/)
  })

  it('renders unmeasured as UNKNOWN, never as clean', () => {
    globalThis.__wire = { data: { rows: [row('SE', 1000)], expected: 1 } }
    globalThis.__wireCov = { data: cov({ measured: false }) }
    render(<WireView />)
    const line = screen.getByTestId('wire-coverage')
    expect(line.textContent).toMatch(/unverified/i)
    expect(line.textContent).not.toMatch(/✓ Complete/)
  })

  it('does not render at all for a non-current session', () => {
    globalThis.__wire = { data: { rows: [row('SE', 1000)], expected: 1 } }
    globalThis.__wireCov = { data: cov({ is_current_session: false, missing_from_feed: ['GHOST'] }) }
    render(<WireView />)
    expect(screen.queryByTestId('wire-coverage')).toBeNull()
  })

  it('still shows the trust line on the empty pre-print view', () => {
    globalThis.__wire = { data: { rows: [], expected: 37 } }
    globalThis.__wireCov = { data: cov({ reported: 0 }) }
    render(<WireView />)
    expect(screen.getByTestId('wire-coverage')).toBeInTheDocument()
    expect(screen.getByText(/37 reporters/)).toBeInTheDocument()
  })
})
