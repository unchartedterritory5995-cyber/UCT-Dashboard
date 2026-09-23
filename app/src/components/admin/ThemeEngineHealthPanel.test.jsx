import { render, screen } from '@testing-library/react'
import { vi, beforeEach, afterEach, test, expect } from 'vitest'

// Packet Y CP3 (signed 2026-09-23, fingerprint 4007862bd).

let mockData = null
vi.mock('swr', () => ({ default: () => ({ data: mockData }) }))

import ThemeEngineHealthPanel from './ThemeEngineHealthPanel'

const NOW = new Date('2026-09-23T18:00:00Z')

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  mockData = {
    day_cost_usd: 1.23,
    pending_suppressions: 4,
    overlay_adds: 512,
    runs: [
      {
        run_id: 'r1', kind: 'orphans',
        started_at: '2026-09-23 17:00:00', finished_at: '2026-09-23 17:04:00',
        examined: 40, added: 3, retiered: 1, dropped: 0, skipped: 36,
        cost_usd: 0.87, error: null,
      },
    ],
  }
})

afterEach(() => { vi.useRealTimers() })

test('renders the three top stat cards from real data', () => {
  render(<ThemeEngineHealthPanel />)
  expect(screen.getByText('$1.23 / $5.00')).toBeTruthy()
  expect(screen.getByText('Day spend')).toBeTruthy()
  expect(screen.getByText('4')).toBeTruthy()
  expect(screen.getByText('Pending suppressions')).toBeTruthy()
  expect(screen.getByText('512')).toBeTruthy()
  expect(screen.getByText('Overlay adds')).toBeTruthy()
})

test('renders a run ledger row with a "done" badge for a finished run', () => {
  render(<ThemeEngineHealthPanel />)
  expect(screen.getByText('orphans')).toBeTruthy()
  expect(screen.getByText('2026-09-23 17:00:00')).toBeTruthy()
  expect(screen.getByText('2026-09-23 17:04:00')).toBeTruthy()
  expect(screen.getByText('done')).toBeTruthy()
})

test('flags a run with a non-null error, badge text "error"', () => {
  mockData = {
    ...mockData,
    runs: [{ ...mockData.runs[0], finished_at: '2026-09-23 17:04:00', error: 'boom' }],
  }
  render(<ThemeEngineHealthPanel />)
  expect(screen.getByText('error')).toBeTruthy()
})

test('flags an unfinished run older than the stale threshold as "unfinished — check logs"', () => {
  // started 3 hours before NOW, never finished — past the 2h stale bound.
  mockData = {
    ...mockData,
    runs: [{
      run_id: 'r2', kind: 'improve',
      started_at: '2026-09-23 15:00:00', finished_at: null,
      examined: 10, added: 0, retiered: 0, dropped: 0, skipped: 10,
      cost_usd: 0.1, error: null,
    }],
  }
  render(<ThemeEngineHealthPanel />)
  expect(screen.getByText('unfinished — check logs')).toBeTruthy()
})

test('shows "running", not flagged, for an unfinished run within the stale threshold', () => {
  // started 30 minutes before NOW, never finished — within the 2h bound.
  mockData = {
    ...mockData,
    runs: [{
      run_id: 'r3', kind: 'orphans',
      started_at: '2026-09-23 17:30:00', finished_at: null,
      examined: 5, added: 0, retiered: 0, dropped: 0, skipped: 5,
      cost_usd: 0.02, error: null,
    }],
  }
  render(<ThemeEngineHealthPanel />)
  expect(screen.getByText('running')).toBeTruthy()
  expect(screen.queryByText('unfinished — check logs')).toBeNull()
})

test('degrades to placeholders, never a crash, when SWR has no data yet', () => {
  mockData = null
  const { container } = render(<ThemeEngineHealthPanel />)
  expect(container.textContent).toMatch(/—/)
  expect(screen.getByText('No data yet')).toBeTruthy()
})
