import { render, screen } from '@testing-library/react'
import { vi, beforeEach, test, expect } from 'vitest'

// Packet M CP1 (signed 2026-09-22, fingerprint 3f28cd944).

let mockData = null
vi.mock('swr', () => ({ default: () => ({ data: mockData }) }))

import CompassHealthPanel from './CompassHealthPanel'

beforeEach(() => {
  mockData = {
    chat_turns: 42, active_users: 9, tool_calls: 120, tool_failures: 6,
    tool_failure_rate: 0.05, avg_latency_ms: 340,
    top_failing_tools: [{ tool: 'get_regime', failures: 4 }, { tool: 'get_quote', failures: 2 }],
    cost_today: { spend_usd: 3.47, circuit_open: false },
  }
})

test('renders real data across all stat cards', () => {
  render(<CompassHealthPanel />)
  expect(screen.getByText(42)).toBeTruthy()
  expect(screen.getByText(9)).toBeTruthy()
  expect(screen.getByText(120)).toBeTruthy()
  expect(screen.getByText('5.0%')).toBeTruthy()
  expect(screen.getByText('340ms')).toBeTruthy()
})

test('renders the top failing tools bar list', () => {
  render(<CompassHealthPanel />)
  expect(screen.getByText('get_regime')).toBeTruthy()
  expect(screen.getByText('get_quote')).toBeTruthy()
})

test("renders today's spend", () => {
  render(<CompassHealthPanel />)
  expect(screen.getByText('$3.47')).toBeTruthy()
})

test('shows a circuit-breaker warning when open', () => {
  mockData = { ...mockData, cost_today: { spend_usd: 12.0, circuit_open: true } }
  render(<CompassHealthPanel />)
  expect(screen.getByText(/circuit breaker OPEN/)).toBeTruthy()
})

test('degrades to placeholders, never a crash, when SWR has no data yet', () => {
  mockData = null
  const { container } = render(<CompassHealthPanel />)
  expect(container.textContent).toMatch(/—/)
})
