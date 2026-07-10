import { renderWithProviders, screen } from '../../test-utils'
import { vi } from 'vitest'

vi.mock('swr', () => ({
  default: () => ({ data: { reports: [
    { id: 1, thread_id: 5, post_id: null, reporter_id: 'u2', reason: 'spam',
      preview: 'BUY MY COURSE', target_author_id: 'u9', created_at: 1780000000 },
  ] }, mutate: vi.fn() }),
  useSWRConfig: () => ({ mutate: vi.fn() }),
}))

import CommunityReportsPanel from './CommunityReportsPanel'

test('renders open reports with actions', () => {
  renderWithProviders(<CommunityReportsPanel />)
  expect(screen.getByText(/BUY MY COURSE/)).toBeTruthy()
  expect(screen.getByText('Hide')).toBeTruthy()
  expect(screen.getByText('Dismiss')).toBeTruthy()
  expect(screen.getByText('Mute author')).toBeTruthy()
})
