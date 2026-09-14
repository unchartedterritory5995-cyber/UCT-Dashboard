// app/src/pages/breadth/v2/useBreadthSeries.test.jsx
//
// The V2 read path. Every case here is a decision the hook makes BEFORE the network —
// which keys it asks for, which spans it declines to ask for, what one window's identity
// is — plus the two things it must never do to an answer: hide a missing key, or turn an
// absent reading into a zero.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import useBreadthSeries, { seriesRequest, spanDays, MAX_KEYS, MAX_SESSIONS } from './useBreadthSeries'

// A probe component: the hook's return rendered as text, so assertions read the same
// artifact a surface would.
function Probe({ keys, from, to, onState }) {
  const s = useBreadthSeries(keys, from, to)
  onState?.(s)
  return <div data-testid="probe">{JSON.stringify({
    keys: s.keys, dropped: s.dropped, tooWide: s.tooWide,
    missing: s.missing, reconstructed: s.reconstructed,
    series: s.series, error: s.error ? (s.error.status || 'error') : null,
  })}</div>
}
const state = () => JSON.parse(screen.getByTestId('probe').textContent)

let fetchMock
beforeEach(() => {
  fetchMock = vi.fn(() => Promise.resolve({
    ok: true,
    json: () => Promise.resolve({
      from: '2026-06-01', to: '2026-08-29', sessions: 3,
      dates: ['2026-06-01', '2026-06-02', '2026-06-03'],
      series: { breadth_score: [41, null, 43] },
      reconstructed: ['2026-06-01'],
      missing: ['not_a_metric'],
    }),
  }))
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

// ── the request, decided before the network ──────────────────────────────────

describe('seriesRequest', () => {
  it('sorts and dedupes the keys so one window has ONE identity', () => {
    const a = seriesRequest(['pct_above_50sma', 'breadth_score'], '2026-01-01', '2026-03-01')
    const b = seriesRequest(['breadth_score', 'pct_above_50sma', 'breadth_score'], '2026-01-01', '2026-03-01')
    expect(a.url).toBe(b.url)
    expect(a.keys).toEqual(['breadth_score', 'pct_above_50sma'])
  })

  it('caps at the server\'s key limit and REPORTS what it dropped', () => {
    const many = Array.from({ length: MAX_KEYS + 3 }, (_, i) => `k${String(i).padStart(2, '0')}`)
    const r = seriesRequest(many, '2026-01-01', '2026-02-01')
    expect(r.keys).toHaveLength(MAX_KEYS)
    expect(r.dropped).toHaveLength(3)
    // ⛔ Dropped SILENTLY would render a metric the member selected as one that has no data.
    expect(r.dropped).toEqual(many.slice(MAX_KEYS))
  })

  it('refuses a span wider than the one exported constant, and asks for nothing', () => {
    const wide = seriesRequest(['breadth_score'], '2020-01-01', '2026-01-01')
    expect(wide.tooWide).toBe(true)
    expect(wide.url).toBeNull()
  })

  it('allows a span exactly AT the cap — the boundary is inclusive', () => {
    const from = new Date(Date.UTC(2026, 0, 1))
    const to = new Date(from.getTime() + (MAX_SESSIONS - 1) * 86400000)
    const r = seriesRequest(['breadth_score'], from.toISOString().slice(0, 10), to.toISOString().slice(0, 10))
    expect(spanDays(r.url ? from.toISOString().slice(0, 10) : '', to.toISOString().slice(0, 10))).toBe(MAX_SESSIONS)
    expect(r.tooWide).toBe(false)
    expect(r.url).not.toBeNull()
  })

  it('asks for nothing when there are no keys, no window, or an inverted one', () => {
    expect(seriesRequest([], '2026-01-01', '2026-02-01').url).toBeNull()
    expect(seriesRequest(['breadth_score'], '', '').url).toBeNull()
    expect(seriesRequest(['breadth_score'], '2026-02-01', '2026-01-01').inverted).toBe(true)
    expect(seriesRequest(['breadth_score'], '2026-02-01', '2026-01-01').url).toBeNull()
  })
})

// ── the hook ─────────────────────────────────────────────────────────────────

describe('useBreadthSeries', () => {
  it('fetches once for one window and passes missing/reconstructed/nulls through', async () => {
    render(<Probe keys={['breadth_score']} from="2026-06-01" to="2026-06-03" />)
    await waitFor(() => expect(state().series).not.toBeNull())
    const s = state()
    expect(s.missing).toEqual(['not_a_metric'])
    expect(s.reconstructed).toEqual(['2026-06-01'])
    // ⛔ THE ONE THAT MATTERS. A null is an absent reading; coerced to 0 it becomes a
    // breadth number a member would act on.
    expect(s.series.breadth_score).toEqual([41, null, 43])
  })

  it('does not call the network AT ALL for a refused span', async () => {
    render(<Probe keys={['breadth_score']} from="2010-01-01" to="2026-01-01" />)
    await waitFor(() => expect(state().tooWide).toBe(true))
    const asked = fetchMock.mock.calls.filter(c => String(c[0]).includes('/series'))
    expect(asked, 'a refused range still reached the server').toHaveLength(0)
  })

  it('sends the keys SORTED on the wire, whatever order the caller passed', async () => {
    render(<Probe keys={['pct_above_50sma', 'breadth_score']} from="2026-06-01" to="2026-06-03" />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const url = String(fetchMock.mock.calls.find(c => String(c[0]).includes('/series'))[0])
    expect(url).toContain('keys=breadth_score%2Cpct_above_50sma')
  })

  it('passes an AbortSignal, so a window change can cancel a read in flight', async () => {
    render(<Probe keys={['breadth_score']} from="2026-06-01" to="2026-06-03" />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const init = fetchMock.mock.calls.find(c => String(c[0]).includes('/series'))[1]
    expect(init?.signal, 'no signal — an abandoned deep read runs to completion').toBeTruthy()
    expect(init.signal.aborted).toBe(false)
  })

  it('aborts the in-flight read when the hook unmounts', async () => {
    const { unmount } = render(<Probe keys={['breadth_score']} from="2026-06-01" to="2026-06-03" />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const init = fetchMock.mock.calls.find(c => String(c[0]).includes('/series'))[1]
    unmount()
    expect(init.signal.aborted).toBe(true)
  })

  it('surfaces a 404 rather than rendering it as an empty range', async () => {
    // The endpoint is DARK today, so this is its real answer — and "no data" and
    // "not released" are different sentences.
    fetchMock.mockImplementation(() => Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) }))
    render(<Probe keys={['breadth_score']} from="2026-06-01" to="2026-06-03" />)
    await waitFor(() => expect(state().error).toBe(404))
    expect(state().series).toBeNull()
  })
})
