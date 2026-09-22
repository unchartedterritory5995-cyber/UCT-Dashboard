import { render, screen } from '@testing-library/react'
import { vi, beforeEach, test, expect } from 'vitest'

// Packet I CP1 (signed 2026-09-22, fingerprint 830cec48e).

let mockData = null
vi.mock('swr', () => ({ default: () => ({ data: mockData }) }))

import LeadershipBadge from './LeadershipBadge'

const renderBadge = (sym = 'NVDA') => render(<LeadershipBadge sym={sym} />)

beforeEach(() => {
  mockData = {
    symbol: 'NVDA', consecutive_days: 40, total_appearances: 62, first_seen: '2026-06-01', last_seen: '2026-09-18',
  }
})

test('a current, multi-session streak renders the badge with the real numbers', () => {
  renderBadge()
  expect(screen.getByText('On Leadership 20 for 40 sessions')).toBeTruthy()
  expect(screen.getByText(/62 total appearances/)).toBeTruthy()
  expect(screen.getByText('First seen 2026-06-01')).toBeTruthy()
})

test('a single-session streak is not pluralised', () => {
  mockData = { ...mockData, consecutive_days: 1 }
  renderBadge()
  expect(screen.getByText('On Leadership 20 for 1 session')).toBeTruthy()
})

test('a ticker that has never been a pick (consecutive_days: 0, 3-key shape) renders NOTHING', () => {
  // The endpoint's "no rows for this ticker" shape omits first_seen/last_seen
  // entirely (see tests/test_leader_persistence.py) -- the badge must not
  // crash or render an empty card on the missing keys.
  mockData = { symbol: 'ZZZZ', consecutive_days: 0, total_appearances: 0 }
  const { container } = renderBadge('ZZZZ')
  expect(container.firstChild).toBeNull()
})

test('the engine-unavailable shape (2 keys only) also renders NOTHING, not a broken card', () => {
  mockData = { symbol: 'NVDA', consecutive_days: 0 }
  const { container } = renderBadge()
  expect(container.firstChild).toBeNull()
})

test('a fetch failure (SWR yields no data) renders NOTHING rather than a broken card', () => {
  mockData = null
  const { container } = renderBadge()
  expect(container.firstChild).toBeNull()
})

test('total_appearances is optional -- its absence does not break the streak line', () => {
  mockData = { symbol: 'NVDA', consecutive_days: 5 }
  renderBadge()
  expect(screen.getByText('On Leadership 20 for 5 sessions')).toBeTruthy()
  expect(screen.queryByText(/total appearance/)).toBeNull()
})
