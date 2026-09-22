import { render, screen } from '@testing-library/react'
import { vi, beforeEach, test, expect } from 'vitest'

// Packet J CP1 (signed 2026-09-22, fingerprint d3e86c615).

let mockData = null
vi.mock('swr', () => ({ default: () => ({ data: mockData }) }))

import ConfidenceBadge from './ConfidenceBadge'

const renderBadge = (sym = 'NVDA') => render(<ConfidenceBadge sym={sym} />)

beforeEach(() => {
  mockData = {
    symbol: 'NVDA',
    score: {
      grade: 'A', total_score: 92, base_score: 40, regime_fit: 10,
      volume_confirm: 8, rs_confirm: 15, sector_fit: 10, catalyst_score: 9,
      qualifying: ['above 50-day', 'RS line rising'],
      invalidating: [],
    },
  }
})

test('a real score renders the badge with the grade, total and sub-scores', () => {
  renderBadge()
  expect(screen.getByText('Grade A')).toBeTruthy()
  expect(screen.getByText(/92 total/)).toBeTruthy()
  expect(screen.getByText('Base 40')).toBeTruthy()
  expect(screen.getByText('RS 15')).toBeTruthy()
})

test('qualifying factors render when present', () => {
  renderBadge()
  expect(screen.getByText(/Qualifying: above 50-day, RS line rising/)).toBeTruthy()
})

test('invalidating factors render only when present, not as an empty line', () => {
  renderBadge()
  expect(screen.queryByText(/Invalidating:/)).toBeNull()
  mockData = { ...mockData, score: { ...mockData.score, invalidating: ['extended >8% from EMA20'] } }
  const { container } = render(<ConfidenceBadge sym="NVDA" />)
  expect(container.textContent).toMatch(/Invalidating: extended >8% from EMA20/)
})

test('a ticker that has never been scored (score: null) renders NOTHING', () => {
  mockData = { symbol: 'ZZZZ', score: null }
  const { container } = renderBadge('ZZZZ')
  expect(container.firstChild).toBeNull()
})

test('the engine-unavailable case (also score: null) renders NOTHING, not a broken card', () => {
  mockData = { symbol: 'NVDA', score: null }
  const { container } = renderBadge()
  expect(container.firstChild).toBeNull()
})

test('a fetch failure (SWR yields no data) renders NOTHING rather than a broken card', () => {
  mockData = null
  const { container } = renderBadge()
  expect(container.firstChild).toBeNull()
})
