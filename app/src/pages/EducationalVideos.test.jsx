import { render, screen } from '@testing-library/react'
import { vi, beforeEach, test, expect } from 'vitest'

// Stub the responsive Sheet so modals render plainly in jsdom.
vi.mock('../components/mobile/Sheet', () => ({
  default: ({ children, title }) => <div data-testid="sheet">{title}{children}</div>,
}))

// Controllable auth role per test.
let mockRole = null
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: mockRole ? { role: mockRole } : { role: 'pro-user' } }),
}))

// Controllable SWR payload per test.
let mockData = null
vi.mock('swr', () => ({
  default: () => ({ data: mockData, error: null, isLoading: false, mutate: vi.fn() }),
}))

import EducationalVideos from './EducationalVideos'
import { MemoryRouter } from 'react-router-dom'

beforeEach(() => {
  mockRole = null
  mockData = {
    total: 2,
    categories: [
      {
        name: 'Getting Started',
        kind: 'library',
        sort_order: 0,
        blurb: '',
        videos: [
          { id: 1, youtube_id: 'abc12345678', title: 'Welcome', description: 'Start here', category: 'Getting Started', duration: '5:00', tags: [] },
          { id: 2, youtube_id: 'def12345678', title: 'The Basics', description: '', category: 'Getting Started', tags: [] },
        ],
      },
    ],
  }
})

test('renders the page heading and videos', () => {
  render(<MemoryRouter><EducationalVideos /></MemoryRouter>)
  expect(screen.getByRole('heading', { name: /educational videos/i })).toBeTruthy()
  expect(screen.getByText('Welcome')).toBeTruthy()
  expect(screen.getByText('The Basics')).toBeTruthy()
  expect(screen.getByText('Getting Started')).toBeTruthy()
})

test('non-admin sees no add/edit controls', () => {
  mockRole = null
  render(<MemoryRouter><EducationalVideos /></MemoryRouter>)
  expect(screen.queryByText(/add video/i)).toBeNull()
  expect(screen.queryByText('Edit')).toBeNull()
  expect(screen.queryByText('Delete')).toBeNull()
})

test('admin sees add and per-video edit/delete controls', () => {
  mockRole = 'admin'
  render(<MemoryRouter><EducationalVideos /></MemoryRouter>)
  expect(screen.getByText(/add video/i)).toBeTruthy()
  expect(screen.getAllByText('Edit').length).toBe(2)
  expect(screen.getAllByText('Delete').length).toBe(2)
})

test('empty state shows admin add prompt for admins', () => {
  mockRole = 'admin'
  mockData = { total: 0, categories: [] }
  render(<MemoryRouter><EducationalVideos /></MemoryRouter>)
  expect(screen.getByText(/add the first video/i)).toBeTruthy()
})

test('empty state shows coming-soon for non-admins', () => {
  mockRole = null
  mockData = { total: 0, categories: [] }
  render(<MemoryRouter><EducationalVideos /></MemoryRouter>)
  expect(screen.getByText(/being loaded in/i)).toBeTruthy()
  expect(screen.queryByText(/add the first video/i)).toBeNull()
})

test('renders categories in server-provided order, not the old pin list', () => {
  // "Live Trading Sessions" (a show) is NOT in the legacy CATEGORY_ORDER pin
  // list and would have sunk to the bottom under the old client re-sort.
  // "Options & Flow" (a library category) WAS in that pin list near the top.
  // The payload lists the show first — server order must win verbatim.
  mockData = {
    total: 2,
    categories: [
      {
        name: 'Live Trading Sessions',
        kind: 'show',
        sort_order: 0,
        blurb: '',
        videos: [
          { id: 10, youtube_id: 'lts1abcdefg', title: 'Session 1', description: '', category: 'Live Trading Sessions', tags: [] },
        ],
      },
      {
        name: 'Options & Flow',
        kind: 'library',
        sort_order: 1,
        blurb: '',
        videos: [
          { id: 11, youtube_id: 'opt1abcdefg', title: 'Options Basics', description: '', category: 'Options & Flow', tags: [] },
        ],
      },
    ],
  }
  render(<MemoryRouter><EducationalVideos /></MemoryRouter>)
  // Shelf headers (the only h2s — the featured strip title is plain text)
  // must remain in server-verbatim order.
  const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)
  expect(headings).toEqual(['Live Trading Sessions', 'Options & Flow'])
})
