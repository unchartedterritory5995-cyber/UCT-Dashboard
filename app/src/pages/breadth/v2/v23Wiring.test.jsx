/**
 * V2-3 component-level wiring: the extended-days picker and LTTB, as actually threaded
 * through `BreadthChartsV2` — complementing (not duplicating) `lttb.test.js`'s pure
 * algorithm rails and `panels.test.js`'s pure family-split rails.
 *
 * ⛔⛔ WHY LTTB CANNOT BE REACHED THROUGH THE REAL HOOK TODAY, AND WHY THAT IS CORRECT.
 * `useBreadthSeries.MAX_SESSIONS = 365` (calendar days) mirrors the server's CURRENT cap
 * — raising it is coupled to L-A's server-side raise, not to this landing, exactly the
 * "three variables in order" dependency already on record for the production flip. So
 * ANY window long enough to clear LTTB's 1500-point threshold (≈6+ years) trips the
 * CLIENT'S OWN `tooWide` guard before a fetch is even issued — there is no way to
 * organically reach a long-enough series through the real component until L-A ships,
 * which is the same structural gate every other long-history V2-3 feature sits behind.
 * So the WIRING is tested here by mocking the hook directly (bypassing the guard on
 * purpose, the way a future L-A landing legitimately would), and the ALGORITHM is
 * tested in `lttb.test.js` against real, ungated inputs.
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
vi.mock('./useBreadthSeries', () => ({ default: (...args) => mockUseBreadthSeries(...args) }))

function longFixture(n) {
  const dates = Array.from({ length: n }, (_, i) => `d${String(i).padStart(6, '0')}`)
  return {
    dates,
    series: {
      breadth_score: dates.map((_, i) => Math.sin(i / 41) * 60 + 60),
      new_52w_highs: dates.map((_, i) => (i * 17) % 300),
    },
    keys: ['breadth_score', 'new_52w_highs'],
    missing: [], dropped: [], reconstructed: [], tooWide: false, maxSessions: 365,
    isLoading: false, error: null,
  }
}

function ctx(flags) {
  return { user: { id: 'u' }, plan: 'pro', loading: false, ...flags }
}

async function mountWith(flags, seriesReturn) {
  mockUseBreadthSeries.mockReturnValue(seriesReturn)
  render(
    <AuthContext.Provider value={ctx(flags)}>
      <BreadthChartsV2 />
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

  it('⛔ a preset past today\'s client-side cap correctly shows the HONEST refusal, not a crash', async () => {
    // ⭐ THIS IS THE CORRECT BEHAVIOUR, NOT A BUG. `MAX_SESSIONS=365` mirrors the
    // server's CURRENT cap; raising it is L-A's job. Until then, "5y" and "Max" must
    // land on the existing `tooWide` honest state, exactly like any other request this
    // app already knows it cannot serve.
    const { fireEvent } = await import('@testing-library/react')
    await mountWith(
      { breadthDcV22Enabled: true, breadthDcV23Enabled: true },
      { ...longFixture(30), tooWide: false },
    )
    // Simulate the hook reacting to the wider window by reporting tooWide, the way the
    // REAL useBreadthSeries would once `daysChoice` produces a >365-day span.
    mockUseBreadthSeries.mockReturnValue({ ...longFixture(30), tooWide: true, maxSessions: 365 })
    fireEvent.click(screen.getByTestId('v2-days-5y'))
    expect(await screen.findByTestId('v2-range-refused')).toBeInTheDocument()
  })
})
