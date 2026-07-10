import { renderWithProviders, screen } from '../../test-utils'
import { vi } from 'vitest'

const THREAD = {
  id: 1, title: 'July 9 Session', space: 'mentor-desk', author_id: null,
  author: { name: 'UCT Mentor', is_mentor: true }, locked: 0, answered: 0, pinned: 1,
  ticker_tags: [], created_at: 1780000000, last_activity_at: 1780000000,
  body: JSON.stringify({ type: 'doc', content: [{ type: 'paragraph',
    content: [{ type: 'text', text: 'Recap body text' }] }] }),
  posts: [
    { id: 11, author_id: 'u1', author: { name: 'Alice', is_mentor: false },
      parent_post_id: null, mentor_highlight: 0, deleted: 0, created_at: 1780000100,
      reactions: { fire: 2 },
      body: JSON.stringify({ type: 'doc', content: [{ type: 'paragraph',
        content: [{ type: 'text', text: 'Great session' }] }] }) },
    { id: 12, author_id: 'u2', author: { name: 'Coach', is_mentor: true },
      parent_post_id: 11, mentor_highlight: 1, deleted: 0, created_at: 1780000200,
      reactions: {},
      body: JSON.stringify({ type: 'doc', content: [{ type: 'paragraph',
        content: [{ type: 'text', text: 'Watch the 10am reclaim' }] }] }) },
  ],
}

vi.mock('swr', () => ({
  default: (key) => {
    if (typeof key === 'string' && key.includes('/threads/1')) return { data: THREAD, mutate: vi.fn() }
    if (typeof key === 'string' && key.includes('/status'))
      return { data: { enabled: true, acked: true, is_mentor: false, muted: false } }
    return { data: null, mutate: vi.fn() }
  },
  useSWRConfig: () => ({ mutate: vi.fn() }),
}))

global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }))

import ThreadView from './ThreadView'

test('renders OP, replies, highlight and reactions', () => {
  renderWithProviders(<ThreadView threadId="1" />, { route: '/community/1' })
  expect(screen.getByText('July 9 Session')).toBeTruthy()
  expect(screen.getByText('Recap body text')).toBeTruthy()
  expect(screen.getByText('Great session')).toBeTruthy()
  expect(screen.getByText('Watch the 10am reclaim')).toBeTruthy()
  expect(screen.getAllByText('UCT Mentor').length).toBeGreaterThan(0)
})
