import { renderWithProviders, screen, fireEvent, waitFor } from '../../test-utils'
import { vi } from 'vitest'

// Shared mutable state the mocks read from. vi.hoisted so it exists before the
// vi.mock factories run (same idiom as JournalSnapshotTile.test.jsx).
const h = vi.hoisted(() => ({ data: undefined, mutate: () => {} }))

// useSWR is keyed by URL — only answer for the insights endpoint so provider
// internals (if any ever adopt SWR) stay unaffected.
vi.mock('swr', () => ({
  default: (key) => {
    const k = String(key)
    if (k.includes('/api/voice/insights')) return { data: h.data, mutate: h.mutate }
    return { data: undefined, isLoading: false, mutate: () => {} }
  },
  useSWRConfig: () => ({ mutate: () => {} }),
}))

vi.mock('../../hooks/useRealtimeSession', () => ({
  default: () => ({ connect: vi.fn(), disconnect: vi.fn() }),
}))

import CompassTodayTile from './CompassTodayTile'

beforeEach(() => {
  h.data = undefined
  h.mutate = vi.fn()
  global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) })
})

test('renders nothing while loading', () => {
  h.data = undefined
  const { container } = renderWithProviders(<CompassTodayTile />)
  expect(container.firstChild).toBeNull()
})

test('renders nothing when there is no focus and no undismissed insights', () => {
  h.data = { insights: [] }
  const { container } = renderWithProviders(<CompassTodayTile />)
  expect(container.firstChild).toBeNull()
})

test("renders today's focus block", () => {
  h.data = {
    insights: [{ id: 1, kind: 'daily_focus', headline: 'Focus', body: 'Stay disciplined.', dismissed_at: null }],
  }
  renderWithProviders(<CompassTodayTile />)
  expect(screen.getByText("Today's focus")).toBeInTheDocument()
  expect(screen.getByText('Stay disciplined.')).toBeInTheDocument()
})

test('groups noticed insights by kind and shows dismiss buttons', () => {
  h.data = {
    insights: [
      { id: 2, kind: 'stop_hit', symbol: 'NVDA', headline: 'NVDA is AT or THROUGH its stop', body: 'Long NVDA...', dismissed_at: null },
      { id: 3, kind: 'earnings_proximity', symbol: 'AAPL', headline: 'AAPL reports earnings today', body: 'You own AAPL...', dismissed_at: null },
    ],
  }
  renderWithProviders(<CompassTodayTile />)
  expect(screen.getByText('At Stop')).toBeInTheDocument()
  expect(screen.getByText('Earnings')).toBeInTheDocument()
  expect(screen.getAllByLabelText(/Dismiss:/)).toHaveLength(2)
})

test('excludes dismissed insights from the feed', () => {
  h.data = {
    insights: [
      { id: 4, kind: 'stop_proximity', symbol: 'TSLA', headline: 'TSLA nearing stop', body: null, dismissed_at: '2026-07-01T00:00:00Z' },
    ],
  }
  const { container } = renderWithProviders(<CompassTodayTile />)
  expect(container.firstChild).toBeNull()
})

test('clicking dismiss posts to the dismiss endpoint', async () => {
  h.data = {
    insights: [
      { id: 5, kind: 'stop_hit', symbol: 'MSFT', headline: 'MSFT is AT or THROUGH its stop', body: null, dismissed_at: null },
    ],
  }
  renderWithProviders(<CompassTodayTile />)
  fireEvent.click(screen.getByLabelText(/Dismiss:/))
  await waitFor(() => {
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/voice/insights/5/dismiss',
      expect.objectContaining({ method: 'POST' }),
    )
  })
})
