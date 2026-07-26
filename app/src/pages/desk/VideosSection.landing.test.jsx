// Task 6 — Desk Videos landing: hero + show rails + tag-filtered library.
// The theater/player contract is untouched: VideoDockSlot stays the first
// rendered child and every play routes through videoStore.play(list, index).
import { render, screen, fireEvent, within } from '@testing-library/react'
import { vi, beforeEach, test, expect } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

// Stub the responsive Sheet so modals render plainly in jsdom.
vi.mock('../../components/mobile/Sheet', () => ({
  default: ({ children, title }) => <div data-testid="sheet">{title}{children}</div>,
}))

// Controllable auth role per test.
let mockRole = null
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { role: mockRole || 'pro-user' } }),
}))

// Controllable SWR payload per test (desk-threads and other keys stay empty).
let mockData = null
vi.mock('swr', () => ({
  default: (key) => ({
    data: key === '/api/education/videos' ? mockData : null,
    error: null,
    isLoading: false,
    mutate: vi.fn(),
  }),
}))

// The playback contract: everything must route through videoStore.play.
vi.mock('../../components/video/videoStore', () => ({ play: vi.fn() }))

// The theater slot — stubbed so we can assert its position structurally.
vi.mock('../../components/video/VideoDockSlot', () => ({
  default: () => <div data-testid="dock-slot" />,
}))

import VideosSection from './VideosSection'
import { play } from '../../components/video/videoStore'

const fixture = () => ({
  total: 6,
  categories: [
    {
      name: 'Live Trading Sessions',
      kind: 'show',
      sort_order: 0,
      blurb: 'The daily live tape, archived.',
      videos: [
        { id: 1, youtube_id: 'lts0000000a', title: 'Session — July 21', description: '', category: 'Live Trading Sessions', duration: '1:02:11', tags: [] },
        { id: 2, youtube_id: 'lts0000000b', title: 'Session — July 24 breadth day', description: '', category: 'Live Trading Sessions', duration: '58:00', tags: [] },
      ],
    },
    {
      name: 'Evening Update',
      kind: 'show',
      sort_order: 1,
      blurb: '',
      videos: [
        { id: 3, youtube_id: 'evn0000000a', title: 'Evening Update — July 23', description: '', category: 'Evening Update', tags: [] },
      ],
    },
    {
      name: 'Getting Started',
      kind: 'library',
      sort_order: 0,
      blurb: 'Start here.',
      videos: [
        { id: 4, youtube_id: 'lib0000000a', title: 'Welcome to the Desk', description: '', category: 'Getting Started', tags: [] },
        { id: 5, youtube_id: 'lib0000000b', title: 'Breadth basics', description: '', category: 'Getting Started', tags: [] },
      ],
    },
    {
      name: 'Risk Management',
      kind: 'library',
      sort_order: 1,
      blurb: '',
      videos: [
        { id: 6, youtube_id: 'lib0000000c', title: 'Position sizing rules', description: '', category: 'Risk Management', tags: ['risk'] },
      ],
    },
  ],
})

beforeEach(() => {
  mockRole = null
  mockData = fixture()
  play.mockClear()
})

const renderSection = () => render(<MemoryRouter><VideosSection /></MemoryRouter>)

test('hero features the newest episode of the first show', () => {
  renderSection()
  // Newest = highest id within "Live Trading Sessions" (sessions append
  // chronologically) → id 2, rendered as the hero headline.
  expect(
    screen.getByRole('heading', { level: 2, name: 'Session — July 24 breadth day' }),
  ).toBeTruthy()
})

test('each show renders as a rail with role=list named after the show', () => {
  renderSection()
  expect(screen.getByRole('list', { name: 'Live Trading Sessions' })).toBeTruthy()
  expect(screen.getByRole('list', { name: 'Evening Update' })).toBeTruthy()
})

test('clicking a rail card plays with that show list, newest-first', () => {
  renderSection()
  const rail = screen.getByRole('list', { name: 'Live Trading Sessions' })
  fireEvent.click(within(rail).getAllByRole('button')[0])
  expect(play).toHaveBeenCalledTimes(1)
  const [listArg, indexArg] = play.mock.calls[0]
  expect(listArg.map((v) => v.id)).toEqual([2, 1]) // that show's videos, newest-first
  expect(indexArg).toBe(0)
})

test('selecting a tag chip hides untagged library videos', () => {
  renderSection()
  // Both library videos visible before filtering.
  expect(screen.getByText('Welcome to the Desk')).toBeTruthy()
  expect(screen.getByText('Position sizing rules')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'risk 1' }))
  expect(screen.queryByText('Welcome to the Desk')).toBeNull()
  expect(screen.queryByText('Breadth basics')).toBeNull()
  expect(screen.getByText('Position sizing rules')).toBeTruthy()
})

test('VideoDockSlot is still the first rendered child of the section', () => {
  const { container } = renderSection()
  const page = container.firstChild
  expect(page.firstChild).toBe(screen.getByTestId('dock-slot'))
})

test('search still flat-filters across shows and library', () => {
  renderSection()
  fireEvent.change(screen.getByLabelText('Search educational videos'), {
    target: { value: 'breadth' },
  })
  // Landing chrome (hero + rails) is replaced by the flat filtered grid.
  expect(screen.queryByRole('list')).toBeNull()
  expect(screen.getByText('Session — July 24 breadth day')).toBeTruthy() // show match
  expect(screen.getByText('Breadth basics')).toBeTruthy() // library match
  expect(screen.queryByText('Welcome to the Desk')).toBeNull()
  expect(screen.queryByText('Position sizing rules')).toBeNull()
})
