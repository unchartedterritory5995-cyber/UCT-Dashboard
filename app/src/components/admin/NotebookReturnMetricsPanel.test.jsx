import { render, screen } from '@testing-library/react'
import { vi, beforeEach, test, expect } from 'vitest'

// Audit 2026-11-05, S20: the Notebook return metrics panel draws the server's six numbers with their n.
let mockData = null
let lastKey = null
vi.mock('swr', () => ({ default: (key) => { lastKey = key; return { data: mockData } } }))

import NotebookReturnMetricsPanel, { RETURN_METRICS_URL, fmtSeconds } from './NotebookReturnMetricsPanel'

beforeEach(() => {
  mockData = {
    days: 30, capped: false, activeMembers: 12, newMembers: 4, firstRunCompleted: 3,
    definitions: { day1: 'D1 words.', trust: 'Trust words.' },
    day1: { returned: 2, of: 4, rate: 0.5 },
    day7: { returned: 1, of: 3, rate: 1 / 3 },
    aha: { reached: 2, of: 4, rate: 0.5, n: 2, medianS: 90, p90S: 7200 },
    morning: { days: 3, of: 10, rate: 0.3 },
    recap: { days: 1, of: 10, rate: 0.1 },
    trust: { publishUndone: 1, widgetRestored: 2, total: 3, per100Active: 25 },
  }
})

test('asks the admin route, 30 days by default', () => {
  render(<NotebookReturnMetricsPanel />)
  expect(lastKey).toBe(`${RETURN_METRICS_URL}?days=30`)
})

test('draws each metric with its n', () => {
  render(<NotebookReturnMetricsPanel />)
  expect(screen.getByText('Day-1 return')).toBeTruthy()
  expect(screen.getByText('50.0%')).toBeTruthy()
  expect(screen.getByText('2 of 4')).toBeTruthy()
  expect(screen.getByText('33.3%')).toBeTruthy()
  expect(screen.getByText('1.5m')).toBeTruthy()
  expect(screen.getByText('30.0%')).toBeTruthy()
  expect(screen.getByText('1 publish undone · 2 widget restored')).toBeTruthy()
  expect(screen.getByText('D1 words.')).toBeTruthy()
})

test('says when the read was capped', () => {
  mockData = { ...mockData, capped: true }
  render(<NotebookReturnMetricsPanel />)
  expect(screen.getByText(/hit its row cap/)).toBeTruthy()
})

test('durations read short', () => {
  expect(fmtSeconds(45)).toBe('45s')
  expect(fmtSeconds(7200)).toBe('2.0h')
  expect(fmtSeconds(null)).toBe('—')
})

test('re-review R4: while the server builds its index it says so, with Try again, and shows no numbers', () => {
  mockData = { days: 30, warming: true, message: 'Metrics are warming up; try again in a few minutes.', definitions: {} }
  render(<NotebookReturnMetricsPanel />)
  expect(screen.getByRole('status')).toHaveTextContent('Metrics are warming up; try again in a few minutes.')
  expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
  expect(screen.queryByText('50.0%')).toBeNull()
})
