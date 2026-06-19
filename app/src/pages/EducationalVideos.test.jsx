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

beforeEach(() => {
  mockRole = null
  mockData = {
    total: 2,
    categories: [
      {
        name: 'Getting Started',
        videos: [
          { id: 1, youtube_id: 'abc12345678', title: 'Welcome', description: 'Start here', category: 'Getting Started', duration: '5:00' },
          { id: 2, youtube_id: 'def12345678', title: 'The Basics', description: '', category: 'Getting Started' },
        ],
      },
    ],
  }
})

test('renders the page heading and videos', () => {
  render(<EducationalVideos />)
  expect(screen.getByRole('heading', { name: /educational videos/i })).toBeTruthy()
  expect(screen.getByText('Welcome')).toBeTruthy()
  expect(screen.getByText('The Basics')).toBeTruthy()
  expect(screen.getByText('Getting Started')).toBeTruthy()
})

test('non-admin sees no add/edit controls', () => {
  mockRole = null
  render(<EducationalVideos />)
  expect(screen.queryByText(/add video/i)).toBeNull()
  expect(screen.queryByText('Edit')).toBeNull()
  expect(screen.queryByText('Delete')).toBeNull()
})

test('admin sees add and per-video edit/delete controls', () => {
  mockRole = 'admin'
  render(<EducationalVideos />)
  expect(screen.getByText(/add video/i)).toBeTruthy()
  expect(screen.getAllByText('Edit').length).toBe(2)
  expect(screen.getAllByText('Delete').length).toBe(2)
})

test('empty state shows admin add prompt for admins', () => {
  mockRole = 'admin'
  mockData = { total: 0, categories: [] }
  render(<EducationalVideos />)
  expect(screen.getByText(/add the first video/i)).toBeTruthy()
})

test('empty state shows coming-soon for non-admins', () => {
  mockRole = null
  mockData = { total: 0, categories: [] }
  render(<EducationalVideos />)
  expect(screen.getByText(/being loaded in/i)).toBeTruthy()
  expect(screen.queryByText(/add the first video/i)).toBeNull()
})
