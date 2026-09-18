// app/src/pages/breadth/v2/BreadthChartsV2.test.jsx
//
// The shell's job is to SAY things. Every assertion here reads RENDERED TEXT after the
// action settles, never state — the owner ruling of 2026-09-09, written from two toast
// defects that left every structural assertion green while the member saw nothing.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
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
    .toHaveTextContent('1 reconstructed session(s) in this range.')
})

it('shows the dark endpoint\'s 404 as unavailable, not as an empty range', async () => {
  stubFetch(() => Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) }))
  render(<BreadthChartsV2 keys={['breadth_score']} from="2026-06-01" to="2026-06-03" />)
  const err = await screen.findByTestId('v2-error')
  expect(err).toHaveTextContent('Series unavailable (404).')
  expect(err).toHaveAttribute('role', 'alert')
  // ⛔ NOT an empty series list — "nothing happened" and "we could not ask" are different
  // sentences, and only one of them is true.
  expect(screen.queryByTestId('v2-series')).toBeNull()
})

it('renders with no props at all — the defaults are a real window, not a crash', async () => {
  render(<BreadthChartsV2 />)
  await waitFor(() => expect(screen.getByTestId('breadth-charts-v2')).toBeInTheDocument())
  const url = String(vi.mocked(fetch).mock.calls[0][0])
  expect(url).toContain('/api/breadth-monitor/series?')
  expect(url).toContain('keys=breadth_score%2Cpct_above_50sma')
})
