import { renderWithProviders, screen } from '../../test-utils'
import { vi } from 'vitest'
import CommunityPage from './CommunityPage'

vi.mock('swr', () => ({
  default: (key) => {
    if (typeof key === 'string' && key.includes('/status'))
      return { data: { enabled: true, acked: true, is_mentor: false, muted: false } }
    if (typeof key === 'string' && key.includes('/spaces'))
      return { data: [
        { key: 'mentor-desk', label: 'Mentor Desk', mentor_only: true, unread: 2 },
        { key: 'trade-ideas', label: 'Trade Ideas', mentor_only: false, unread: 0 },
        { key: 'questions', label: 'Questions & Reviews', mentor_only: false, unread: 0 },
        { key: 'wins-lessons', label: 'Wins & Lessons', mentor_only: false, unread: 0 },
      ] }
    if (typeof key === 'string' && key.includes('/threads?'))
      return { data: { threads: [{ id: 1, title: 'July 9 Session', pinned: 1,
        answered: 0, ticker_tags: ['NVDA'], reply_count: 3,
        last_activity_at: 1780000000, author: { name: 'UCT Mentor', is_mentor: true },
        author_id: null }] } }
    return { data: null }
  },
  useSWRConfig: () => ({ mutate: vi.fn() }),
}))

test('renders spaces rail and thread list', () => {
  renderWithProviders(<CommunityPage />, { route: '/community' })
  expect(screen.getByText('Mentor Desk')).toBeTruthy()
  expect(screen.getByText('Trade Ideas')).toBeTruthy()
  expect(screen.getByText('July 9 Session')).toBeTruthy()
  expect(screen.getByText('UCT Mentor')).toBeTruthy()
})
