import { renderWithProviders, screen } from '../../test-utils'
import { vi, test, expect, beforeEach } from 'vitest'

// Packet Q CP1 (signed 2026-09-22, fingerprint 362cb5156).

let mockReports = [
  { id: 1, message_id: 42, channel_slug: 'general', reporter_id: 'u2',
    reason: 'spam', preview: 'BUY MY COURSE', status: 'open', created_at: 1780000000 },
]
const mockMutate = vi.fn()

vi.mock('swr', () => ({
  default: () => ({ data: { reports: mockReports }, mutate: mockMutate }),
  useSWRConfig: () => ({ mutate: vi.fn() }),
}))

import ChatModerationPanel from './ChatModerationPanel'

beforeEach(() => {
  mockReports = [
    { id: 1, message_id: 42, channel_slug: 'general', reporter_id: 'u2',
      reason: 'spam', preview: 'BUY MY COURSE', status: 'open', created_at: 1780000000 },
  ]
  mockMutate.mockClear()
  global.fetch = vi.fn(() => Promise.resolve({
    ok: true, json: () => Promise.resolve({ ok: true }),
  }))
})

test('renders open reports with Hide/Dismiss actions', () => {
  renderWithProviders(<ChatModerationPanel />)
  expect(screen.getByText(/BUY MY COURSE/)).toBeTruthy()
  expect(screen.getByText(/#general/)).toBeTruthy()
  expect(screen.getByText('Hide')).toBeTruthy()
  expect(screen.getByText('Dismiss')).toBeTruthy()
})

test('does not render a Mute author action', () => {
  // Deliberately deferred per the packet -- CommunityReportsPanel's mute
  // endpoint is thread/post-scoped; whether it applies to chat authors is
  // not verified here.
  renderWithProviders(<ChatModerationPanel />)
  expect(screen.queryByText('Mute author')).toBeNull()
})

test('Hide calls the PATCH endpoint with the correct body', async () => {
  renderWithProviders(<ChatModerationPanel />)
  screen.getByText('Hide').click()
  await Promise.resolve()
  await Promise.resolve()
  expect(global.fetch).toHaveBeenCalledWith(
    '/api/community/chat/admin/reports/1',
    expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({ action: 'hide' }),
    }),
  )
})

test('Dismiss calls the PATCH endpoint with the correct body', async () => {
  renderWithProviders(<ChatModerationPanel />)
  screen.getByText('Dismiss').click()
  await Promise.resolve()
  await Promise.resolve()
  expect(global.fetch).toHaveBeenCalledWith(
    '/api/community/chat/admin/reports/1',
    expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({ action: 'dismiss' }),
    }),
  )
})

test('an empty queue renders "Queue is clear" rather than a blank panel', () => {
  mockReports = []
  renderWithProviders(<ChatModerationPanel />)
  expect(screen.getByText('Queue is clear.')).toBeTruthy()
})
