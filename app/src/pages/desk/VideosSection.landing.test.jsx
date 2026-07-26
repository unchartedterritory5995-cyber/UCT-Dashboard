// Desk Videos landing — custom-YouTube-library layout: featured strip + one
// shelf per category (server order) + one chip bar with a Filters toggle for
// the tag chips. The theater/player contract is untouched: VideoDockSlot stays
// the first rendered child and every play routes through videoStore.play(list,
// index) with THAT category's display-order list.
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
        { id: 1, youtube_id: 'lts0000000a', title: 'Session — July 21', description: '', category: 'Live Trading Sessions', duration: '1:02:11', created_at: 1753100000, tags: [] },
        { id: 2, youtube_id: 'lts0000000b', title: 'Session — July 24 breadth day', description: '', category: 'Live Trading Sessions', duration: '58:00', created_at: 1753359200, tags: [] },
      ],
    },
    {
      name: 'Evening Update',
      kind: 'show',
      sort_order: 1,
      blurb: '',
      videos: [
        { id: 3, youtube_id: 'evn0000000a', title: 'Evening Update — July 23', description: '', category: 'Evening Update', created_at: 1753272800, tags: [] },
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

test('featured strip carries the newest first-show episode and plays it', () => {
  renderSection()
  // Newest = highest id within "Live Trading Sessions" → id 2. The strip title
  // is NOT a heading (shelf names own the h2 register).
  const strip = screen.getByRole('region', { name: 'Latest: Session — July 24 breadth day' })
  expect(strip).toBeTruthy()
  fireEvent.click(within(strip).getByRole('button', { name: /^Play$/ }))
  expect(play).toHaveBeenCalledTimes(1)
  const [listArg, indexArg] = play.mock.calls[0]
  expect(listArg.map((v) => v.id)).toEqual([2, 1]) // newest-first show list
  expect(indexArg).toBe(0)
})

test('every category renders as a shelf (role=list) in server order', () => {
  renderSection()
  const names = screen.getAllByRole('list').map((l) => l.getAttribute('aria-label'))
  expect(names).toEqual([
    'Live Trading Sessions', 'Evening Update', 'Getting Started', 'Risk Management',
  ])
})

test('clicking a show shelf card plays with that show list, newest-first', () => {
  renderSection()
  const rail = screen.getByRole('list', { name: 'Live Trading Sessions' })
  fireEvent.click(within(rail).getAllByRole('button', { name: /^Play / })[0])
  expect(play).toHaveBeenCalledTimes(1)
  const [listArg, indexArg] = play.mock.calls[0]
  expect(listArg.map((v) => v.id)).toEqual([2, 1]) // that show's videos, newest-first
  expect(indexArg).toBe(0)
})

test('clicking a library shelf card plays with that category list in server order', () => {
  renderSection()
  const rail = screen.getByRole('list', { name: 'Getting Started' })
  fireEvent.click(within(rail).getByRole('button', { name: 'Play Breadth basics' }))
  expect(play).toHaveBeenCalledTimes(1)
  const [listArg, indexArg] = play.mock.calls[0]
  expect(listArg.map((v) => v.id)).toEqual([4, 5]) // server order, not re-sorted
  expect(indexArg).toBe(1)
})

test('landing thumbnails are plain YouTube thumbs — no poster endpoint', () => {
  const { container } = renderSection()
  const imgs = [...container.querySelectorAll('img')]
  expect(imgs.length).toBeGreaterThan(0)
  for (const img of imgs) {
    expect(img.getAttribute('src')).toMatch(/^https:\/\/i\.ytimg\.com\/vi\/.+\/hqdefault\.jpg$/)
  }
})

test('category chip filters to the flat grid; shelves disappear', () => {
  renderSection()
  fireEvent.click(screen.getByRole('tab', { name: /Getting Started/ }))
  expect(screen.queryByRole('list')).toBeNull() // shelves replaced by the grid
  expect(screen.getByRole('heading', { level: 2, name: 'Getting Started' })).toBeTruthy()
  expect(screen.queryByRole('heading', { level: 2, name: 'Risk Management' })).toBeNull()
  expect(screen.getByText('Welcome to the Desk')).toBeTruthy()
})

test('tag chips are hidden until the Filters toggle reveals them', () => {
  renderSection()
  expect(screen.queryByRole('button', { name: 'risk 1' })).toBeNull()
  const filters = screen.getByRole('button', { name: 'Filters' })
  expect(filters.getAttribute('aria-expanded')).toBe('false')
  fireEvent.click(filters)
  expect(filters.getAttribute('aria-expanded')).toBe('true')
  expect(screen.getByRole('button', { name: 'risk 1' })).toBeTruthy()
})

test('selecting a tag hides untagged library videos but not the shows', () => {
  renderSection()
  fireEvent.click(screen.getByRole('button', { name: 'Filters' }))
  fireEvent.click(screen.getByRole('button', { name: 'risk 1' }))
  expect(screen.queryByText('Welcome to the Desk')).toBeNull()
  expect(screen.queryByText('Breadth basics')).toBeNull()
  expect(screen.getByText('Position sizing rules')).toBeTruthy()
  expect(screen.getByRole('list', { name: 'Live Trading Sessions' })).toBeTruthy()
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
  // Landing chrome (featured strip + shelves) is replaced by the flat grid.
  expect(screen.queryByRole('list')).toBeNull()
  expect(screen.getByText('Session — July 24 breadth day')).toBeTruthy() // show match
  expect(screen.getByText('Breadth basics')).toBeTruthy() // library match
  expect(screen.queryByText('Welcome to the Desk')).toBeNull()
  expect(screen.queryByText('Position sizing rules')).toBeNull()
})
