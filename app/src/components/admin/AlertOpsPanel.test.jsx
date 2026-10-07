import { render, screen } from '@testing-library/react'
import { vi, beforeEach, test, expect } from 'vitest'

// Alerts PRD AC-7 / AC-8 (lane S).
let mockData = null
vi.mock('swr', () => ({ default: () => ({ data: mockData }) }))

import AlertOpsPanel from './AlertOpsPanel'

beforeEach(() => {
  mockData = {
    window_s: 86400,
    trigger_types: {
      'document-arrival': { runs: 3, evaluated: 30, fired: 2, could_not_evaluate: 0, status: 'clean' },
      'rating-change': { runs: 2, evaluated: 4, fired: 0, could_not_evaluate: 6, status: 'degraded' },
      'price-level': { runs: 0, evaluated: 0, fired: 0, could_not_evaluate: 0, status: 'no-runs' },
    },
    channels: [
      { kind: 'in_app', label: 'In-app bell', owner: 'x', ok: 4, failed: 0, skipped: 0, status: 'ok' },
      { kind: 'email', label: 'Email', owner: 'y', ok: 0, failed: 4, skipped: 0, status: 'degraded' },
    ],
    withheld: { suspended: 1, capped: 2 },
  }
})

test('dark (404 -> null data) renders nothing', () => {
  mockData = null
  const { container } = render(<AlertOpsPanel />)
  expect(container.innerHTML).toBe('')
})

test('names the failing trigger type with its could-not-evaluate count', () => {
  const { container } = render(<AlertOpsPanel />)
  const row = container.querySelector('[data-type="rating-change"]')
  expect(row.textContent).toContain('6')
  expect(row.querySelector('[data-status]').getAttribute('data-status')).toBe('degraded')
  const idle = container.querySelector('[data-type="price-level"] [data-status]')
  expect(idle.getAttribute('data-status')).toBe('no-runs')
})

test('flags the degraded channel while the bell reads ok', () => {
  const { container } = render(<AlertOpsPanel />)
  expect(container.querySelector('[data-channel="email"] [data-status]').getAttribute('data-status')).toBe('degraded')
  expect(container.querySelector('[data-channel="in_app"] [data-status]').getAttribute('data-status')).toBe('ok')
  expect(screen.getByText(/1 suspended by the member/)).toBeTruthy()
})
