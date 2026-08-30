/**
 * 🔴 `keepPreviousData` (added to stop a window change from unmounting
 * `BreadthViews` — see `breadthWindow.test.jsx`) means `data` keeps answering
 * with the PREVIOUS window's payload for the whole stretch a new one is being
 * fetched. `effectiveDays` (which pill is lit) updates synchronously on click,
 * but the row count in the shared header's meta line comes from that stale
 * `data` — so clicking a day pill relights it immediately while the meta line
 * keeps stating the OLD window's count as if it described the new one.
 *
 * A test on the meta line's TEXT ALONE cannot catch this — "40 trading days"
 * is a perfectly true sentence about the payload that produced it. The defect
 * is the PAIRING: that sentence rendered beside a pill it no longer describes.
 * So this asserts the relationship, not either half alone — pin a mismatched
 * (stale data, freshly-clicked pill) state and check the header never states
 * the stale count plainly beside it.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// Same shell mocks as breadthWindow.test.jsx / breadthUrlRoute.test.jsx — the
// pairing under test lives entirely in the shared PageHeader row, not in any
// of these.
vi.mock('echarts-for-react', () => ({ default: () => <div data-testid="echart" /> }))
vi.mock('../CotData', () => ({ default: () => <div /> }))
vi.mock('../BreadthCharts', () => ({ default: () => <div /> }))
vi.mock('../../components/tiles/MarketBreadth', () => ({ default: () => <div /> }))
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: { role: 'user' } }) }))
vi.mock('../../hooks/useFlagged', () => ({
  useFlagged: () => ({ flagged: [], toggle: () => {}, remove: () => {}, isFlagged: () => false,
                       isShared: false, toggleShare: () => {}, flaggedName: 'Flagged',
                       renameFlagged: () => {} }),
}))
vi.mock('../../hooks/useLiveBreadth', () => ({
  useLiveBreadth: () => ({ row: null, stamp: null, superseded: true }),
  formatLiveClock: () => 'now',
}))

const ROWS = Array.from({ length: 40 }, (_, i) => ({
  date: `2026-08-${String(40 - i).padStart(2, '0')}`,
  breadth_score: 70 - (i % 10), uct_exposure: 60, pct_above_50sma: 55,
  up_4pct_today: 200, down_4pct_today: 100, vix: 16,
}))

/**
 * ⭐ THE MOCK REPRODUCES `keepPreviousData`, NOT JUST A CANNED RESPONSE.
 *
 * The Monitor tab's own default window is 90d (`OTHER_DAY_CHOICES` includes
 * it and `days` starts at 90), so requesting `days=90` is "settled": the
 * server's `days` stamp on the payload (`{"rows": ..., "days": days}` —
 * `api/routers/breadth_monitor.py`) matches what was asked for, and SWR is
 * not validating. Any OTHER requested window (e.g. the `60d` pill) reproduces
 * exactly what `keepPreviousData` does for real — the payload keeps saying
 * `days: 90` while `isValidating` goes true — because this mock, like the
 * real fetch, never actually resolves the new window.
 */
vi.mock('swr', () => ({
  default: (key) => {
    const requested = /days=(\d+)/.exec(String(key))?.[1]
    const settled = requested === '90'
    return {
      data: { rows: ROWS, days: 90 },
      isLoading: false,
      isValidating: !settled,
      error: null,
      mutate: () => {},
    }
  },
}))

import Breadth, { OTHER_DAY_CHOICES } from '../Breadth'

const render90 = () => render(<MemoryRouter><Breadth /></MemoryRouter>)
const metaText = () => document.querySelector('[class*="meta"]')?.textContent ?? ''
const dayPill = (label) => screen.getAllByRole('button').find(b => b.textContent === label)

beforeEach(() => { localStorage.clear() })

describe('the meta line never pairs a stale count with a fresh pill', () => {
  it('sanity: OTHER_DAY_CHOICES still offers a window besides the settled 90d', () => {
    // Control on the fixture itself — if this ever stops holding, the "60d"
    // click below no longer exercises a real window change and every
    // assertion under it would pass vacuously.
    expect(OTHER_DAY_CHOICES).toContain(60)
    expect(OTHER_DAY_CHOICES).not.toContain(90 + 1)
  })

  it('shows the true count for the settled window on first render', () => {
    render90()
    expect(metaText()).toMatch(/^40 trading days/)
  })

  it('does NOT state the old count once a different window is requested', () => {
    render90()
    // Before the click: the settled 90d state, printing the true count.
    expect(metaText()).toMatch(/^40 trading days/)

    fireEvent.click(dayPill('60d'))

    // The pill relit immediately (synchronous state) …
    expect(dayPill('60d').className).toMatch(/daysPillActive/)
    expect(dayPill('90d').className).not.toMatch(/daysPillActive/)

    // … but the fetch for 60d never resolves in this mock (isValidating stays
    // true, data stays the 90d payload) — exactly the window this bug lived
    // in. The header must not caption the lit 60d pill with the 90d count.
    expect(metaText()).not.toMatch(/^40 trading days/)
    expect(metaText()).not.toBe('')
  })
})
