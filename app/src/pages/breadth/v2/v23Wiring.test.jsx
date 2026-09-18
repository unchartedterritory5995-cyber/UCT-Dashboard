/**
 * V2-3 component-level wiring: the extended-days picker and LTTB, as actually threaded
 * through `BreadthChartsV2` — complementing (not duplicating) `lttb.test.js`'s pure
 * algorithm rails and `panels.test.js`'s pure family-split rails.
 *
 * ⛔⛔ WHY THIS MOCKS THE HOOK RATHER THAN DRIVING THE REAL ONE (still true after L-A/L-B,
 * 2026-09-17, D-054). `useBreadthSeries.MAX_SESSIONS` is now large enough that LTTB's
 * 1,500-point threshold IS organically reachable through the real hook (the "5y" and
 * "Max" presets both clear it) — the cap raise this file's history referred to has
 * shipped. The mock is kept anyway, deliberately: it gives each case an EXACT series
 * length without depending on a live `/series` response or a fixture generator, and it
 * keeps this file fast and independent of network/fixture plumbing. The ALGORITHM itself
 * is tested in `lttb.test.js` against real, ungated inputs; `useBreadthSeries.test.jsx`
 * covers the real hook's own span-refusal boundary.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import { AuthContext } from '../../../context/AuthContext'
import BreadthChartsV2 from './BreadthChartsV2'
import { THRESHOLD_POINTS } from './lttb'

vi.mock('echarts-for-react', () => ({
  default: ({ option }) => <div data-testid="echart" data-option={JSON.stringify(option)} />,
}))

const mockUseBreadthSeries = vi.fn()
vi.mock('./useBreadthSeries', () => ({
  default: (...args) => mockUseBreadthSeries(...args),
  // BreadthChartsV2.jsx imports this named export (the request-budget check for the
  // universe_count injection) — a mock missing it throws at render, not at assertion time.
  MAX_KEYS: 8,
}))

function longFixture(n) {
  const dates = Array.from({ length: n }, (_, i) => `d${String(i).padStart(6, '0')}`)
  return {
    dates,
    series: {
      breadth_score: dates.map((_, i) => Math.sin(i / 41) * 60 + 60),
      new_52w_highs: dates.map((_, i) => (i * 17) % 300),
    },
    keys: ['breadth_score', 'new_52w_highs'],
    missing: [], dropped: [], reconstructed: [], tooWide: false, maxSessions: 4700,
    isLoading: false, error: null,
  }
}

function ctx(flags) {
  return { user: { id: 'u' }, plan: 'pro', loading: false, ...flags }
}

async function mountWith(flags, seriesReturn, props = {}) {
  mockUseBreadthSeries.mockReturnValue(seriesReturn)
  render(
    <AuthContext.Provider value={ctx(flags)}>
      <BreadthChartsV2 {...props} />
    </AuthContext.Provider>,
  )
  return waitFor(() => screen.getByTestId('echart'))
}

beforeEach(() => { mockUseBreadthSeries.mockReset() })
afterEach(() => { cleanup() })

describe('⛔⛔ LTTB wiring: BreadthChartsV2 actually calls downsampleForChart', () => {
  it('a series past the threshold is SAMPLED and the honest note appears', async () => {
    await mountWith(
      { breadthDcV22Enabled: true, breadthDcV23Enabled: true },
      longFixture(THRESHOLD_POINTS + 500),
    )
    const note = screen.getByTestId('v2-sampled')
    expect(note.textContent).toContain('combined for readability')
    expect(note.textContent).toContain('real reading')
    const opt = JSON.parse(screen.getByTestId('echart').getAttribute('data-option'))
    expect(opt.series.some(s => s.sampling === 'lttb')).toBe(true)
  })

  it('⭐ CONTROL — a series AT or below the threshold is NOT sampled, no note', async () => {
    await mountWith(
      { breadthDcV22Enabled: true, breadthDcV23Enabled: true },
      longFixture(THRESHOLD_POINTS),
    )
    expect(screen.queryByTestId('v2-sampled')).toBeNull()
    const opt = JSON.parse(screen.getByTestId('echart').getAttribute('data-option'))
    expect(opt.series.every(s => s.sampling === undefined)).toBe(true)
  })

  it('⛔ LTTB is gated on v23 — a long series with V2-2 only is NOT sampled', async () => {
    // The chart still renders (v22 draws it) at the full, real resolution — LTTB is a
    // V2-3 capability and must not silently engage just because the data happens to be
    // long. ⭐ `sampling` on the SERIES, not `xAxis.data.length`: delegating to ECharts
    // native means the shared category axis never shrinks either way (D-053) — the axis
    // being full-length is expected in BOTH cases now, so it cannot distinguish them.
    await mountWith(
      { breadthDcV22Enabled: true, breadthDcV23Enabled: false },
      longFixture(THRESHOLD_POINTS + 500),
    )
    expect(screen.queryByTestId('v2-sampled')).toBeNull()
    const opt = JSON.parse(screen.getByTestId('echart').getAttribute('data-option'))
    expect(opt.series.every(s => s.sampling === undefined)).toBe(true)
  })

  it('⛔⛔ the shared category axis NEVER shrinks — that is the whole point of delegating', async () => {
    const n = THRESHOLD_POINTS + 500
    await mountWith({ breadthDcV22Enabled: true, breadthDcV23Enabled: true }, longFixture(n))
    const opt = JSON.parse(screen.getByTestId('echart').getAttribute('data-option'))
    expect(opt.xAxis[0].data.length).toBe(n)
  })
})

describe('the extended-days picker actually changes the request', () => {
  it('clicking a preset calls the hook with a DIFFERENT window than the default', async () => {
    const { fireEvent } = await import('@testing-library/react')
    await mountWith(
      { breadthDcV22Enabled: true, breadthDcV23Enabled: true }, longFixture(30))
    const callsBefore = mockUseBreadthSeries.mock.calls.length
    const [, fromArgBefore] = mockUseBreadthSeries.mock.calls[callsBefore - 1]

    fireEvent.click(screen.getByTestId('v2-days-1y'))
    await waitFor(() => expect(mockUseBreadthSeries.mock.calls.length).toBeGreaterThan(callsBefore))
    const lastCall = mockUseBreadthSeries.mock.calls[mockUseBreadthSeries.mock.calls.length - 1]
    const [, fromArgAfter] = lastCall
    expect(fromArgAfter).not.toBe(fromArgBefore)
  })

  it('⛔ a preset past the client-side cap correctly shows the HONEST refusal, not a crash', async () => {
    // ⭐ The cap is finite even after the 2026-09-17 raise (D-054) — a request wider than
    // `MAX_SESSIONS × SESSION_TO_CALENDAR_DAY_RATIO` calendar days must still land on the
    // existing `tooWide` honest state, exactly like any other request this app already
    // knows it cannot serve. This case simulates the real hook reacting to such a window
    // rather than depending on one that happens to be wide enough today.
    const { fireEvent } = await import('@testing-library/react')
    await mountWith(
      { breadthDcV22Enabled: true, breadthDcV23Enabled: true },
      { ...longFixture(30), tooWide: false },
    )
    // Simulate the hook reacting to a window past its cap by reporting tooWide, the way
    // the REAL useBreadthSeries would for a span wider than it can serve.
    mockUseBreadthSeries.mockReturnValue({ ...longFixture(30), tooWide: true, maxSessions: 4700 })
    fireEvent.click(screen.getByTestId('v2-days-5y'))
    expect(await screen.findByTestId('v2-range-refused')).toBeInTheDocument()
  })
})

describe('⛔⛔ A-11 era note wiring: universe_count rides the REQUEST only (Q3/DC5, L-A/L-B)', () => {
  function lastRequestedKeys() {
    const [keys] = mockUseBreadthSeries.mock.calls[mockUseBreadthSeries.mock.calls.length - 1]
    return keys
  }

  it('injects universe_count when a count panel is selected under v23', async () => {
    await mountWith(
      { breadthDcV22Enabled: true, breadthDcV23Enabled: true },
      longFixture(30),
      { keys: ['breadth_score', 'new_52w_highs'] },
    )
    expect(lastRequestedKeys()).toContain('universe_count')
  })

  it('⛔ does NOT inject it when nothing selected is a count-family metric', async () => {
    await mountWith(
      { breadthDcV22Enabled: true, breadthDcV23Enabled: true },
      longFixture(30),
      { keys: ['breadth_score', 'pct_above_50sma'] },
    )
    expect(lastRequestedKeys()).not.toContain('universe_count')
  })

  it('⛔ does NOT inject it under V2-2 only — the era note is a v23 capability', async () => {
    await mountWith(
      { breadthDcV22Enabled: true, breadthDcV23Enabled: false },
      longFixture(30),
      { keys: ['breadth_score', 'new_52w_highs'] },
    )
    expect(lastRequestedKeys()).not.toContain('universe_count')
  })

  it('does not double-add it when the member already selected universe_count themselves', async () => {
    await mountWith(
      { breadthDcV22Enabled: true, breadthDcV23Enabled: true },
      longFixture(30),
      { keys: ['universe_count', 'new_52w_highs'] },
    )
    expect(lastRequestedKeys().filter(k => k === 'universe_count')).toHaveLength(1)
  })

  it('⛔ NEVER when there is no room — a full 8-panel selection keeps every member choice, never displaces one for the helper field', async () => {
    const full8 = ['breadth_score', 'pct_above_50sma', 'pct_above_100sma', 'pct_above_200sma',
      'pct_above_5sma', 'pct_above_10sma', 'pct_above_40sma', 'new_52w_highs']
    await mountWith(
      { breadthDcV22Enabled: true, breadthDcV23Enabled: true },
      longFixture(30),
      { keys: full8 },
    )
    const requested = lastRequestedKeys()
    expect(requested).not.toContain('universe_count')
    expect(requested).toEqual(full8)
  })

  it('⭐ NEVER renders as its own chart panel — it is a helper field, not a series', async () => {
    await mountWith(
      { breadthDcV22Enabled: true, breadthDcV23Enabled: true },
      longFixture(30),
      { keys: ['breadth_score', 'new_52w_highs'] },
    )
    const opt = JSON.parse(screen.getByTestId('echart').getAttribute('data-option'))
    expect(opt.series.map(s => s.id)).not.toContain('universe_count')
  })
})
