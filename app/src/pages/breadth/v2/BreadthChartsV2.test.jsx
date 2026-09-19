// app/src/pages/breadth/v2/BreadthChartsV2.test.jsx
//
// The shell's job is to SAY things. Every assertion here reads RENDERED TEXT after the
// action settles, never state — the owner ruling of 2026-09-09, written from two toast
// defects that left every structural assertion green while the member saw nothing.
import { it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import BreadthChartsV2 from './BreadthChartsV2'
import { MAX_SESSIONS } from './useBreadthSeries'

const PAYLOAD = {
  from: '2026-06-01', to: '2026-06-03', sessions: 3,
  dates: ['2026-06-01', '2026-06-02', '2026-06-03'],
  series: { breadth_score: [41, null, 43] },
  reconstructed: ['2026-06-01'],
  missing: ['not_a_metric'],
}

function stubFetch(impl) {
  vi.stubGlobal('fetch', vi.fn(impl))
}

beforeEach(() => {
  stubFetch(() => Promise.resolve({ ok: true, json: () => Promise.resolve(PAYLOAD) }))
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

it('says the range is not available yet — and says it as a status, not an error', async () => {
  render(<BreadthChartsV2 keys={['breadth_score']} from="1990-01-01" to="2026-01-01" />)
  const msg = await screen.findByTestId('v2-range-refused')
  expect(msg).toHaveTextContent(`Range not yet available — up to ${MAX_SESSIONS} sessions for now.`)
  // ⛔ role=status, not alert: the member did nothing wrong and nothing is broken.
  expect(msg).toHaveAttribute('role', 'status')
  expect(screen.queryByTestId('v2-error')).toBeNull()
})

it('names the keys the row schema does not hold, rather than drawing them as flat', async () => {
  render(<BreadthChartsV2 keys={['breadth_score', 'not_a_metric']} from="2026-06-01" to="2026-06-03" />)
  expect(await screen.findByTestId('v2-missing')).toHaveTextContent('Not held: not_a_metric')
})

it('counts absent readings instead of rendering them as zero', async () => {
  render(<BreadthChartsV2 keys={['breadth_score']} from="2026-06-01" to="2026-06-03" />)
  expect(await screen.findByTestId('v2-series-breadth_score'))
    .toHaveTextContent('breadth_score: 3 points, 1 absent')
})

it('reports reconstructed sessions, because their provenance is a caveat a reader needs', async () => {
  render(<BreadthChartsV2 keys={['breadth_score']} from="2026-06-01" to="2026-06-03" />)
  expect(await screen.findByTestId('v2-reconstructed'))
    .toHaveTextContent('1 session in this range is reconstructed from price history.')
})

it('shows the dark endpoint\'s 404 as unavailable, not as an empty range', async () => {
  stubFetch(() => Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) }))
  render(<BreadthChartsV2 keys={['breadth_score']} from="2026-06-01" to="2026-06-03" />)
  const err = await screen.findByTestId('v2-error')
  // The same sentences V1 uses for a failed load (chartLoadError), with the status kept.
  expect(err).toHaveTextContent("Breadth history didn't load.")
  expect(err).toHaveTextContent('The server returned an error. (404)')
  expect(err).toHaveAttribute('role', 'alert')
  // ⛔ NOT an empty series list — "nothing happened" and "we could not ask" are different
  // sentences, and only one of them is true.
  expect(screen.queryByTestId('v2-series')).toBeNull()
})

it('renders with no props at all — the defaults are a real window, not a crash', async () => {
  render(<BreadthChartsV2 />)
  await waitFor(() => expect(screen.getByTestId('breadth-charts-v2')).toBeInTheDocument())
  // The uncontrolled mount also reads the member's saved view and the live row, so the
  // series request is found among the calls rather than assumed to be the first.
  await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([u]) =>
    String(u).includes('/api/breadth-monitor/series?'))).toBe(true))
  const url = String(vi.mocked(fetch).mock.calls.find(([u]) =>
    String(u).includes('/api/breadth-monitor/series?'))[0])
  expect(url).toContain('keys=breadth_score%2Cpct_above_50sma')
})

it('never tells a member which build they are on', async () => {
  render(<BreadthChartsV2 keys={['breadth_score']} from="2026-06-01" to="2026-06-03" />)
  await screen.findByTestId('v2-reconstructed')
  // ⚰️ It rendered `<h2>Data Charts V2</h2>` to every member (2026-09-18/19).
  expect(screen.queryByText(/V2/)).toBeNull()
  expect(screen.getByTestId('breadth-charts-v2')).toHaveAttribute('aria-label', 'Data Charts')
})
