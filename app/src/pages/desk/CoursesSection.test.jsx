// COURSES — the Desk's dedicated section for kind='course' programs
// (2026-07-27 split): course cards (DRAFT badge, "N to record" counts,
// progress), tracks excluded, member visibility rules, ?path syllabus
// open, and the admin New-course flow (lockKind, draft-on-create).
import { render, screen, fireEvent, within, act } from '@testing-library/react'
import { vi, beforeEach, afterEach, test, expect } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../../components/mobile/Sheet', () => ({
  default: ({ children, title }) => <div data-testid="sheet">{title}{children}</div>,
}))

let mockRole = null
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { role: mockRole || 'pro-user' } }),
}))

let mockData = null
let mockPaths = null
vi.mock('swr', () => ({
  default: (key) => ({
    data:
      key === '/api/education/videos'
        ? mockData
        : String(key).startsWith('/api/education/paths')
          ? mockPaths
          : null,
    error: null,
    isLoading: false,
    mutate: vi.fn(),
  }),
}))

vi.mock('../../components/video/videoStore', () => ({ play: vi.fn() }))

let mockProgress = {}
vi.mock('./videoProgress', () => ({
  subscribe: () => () => {},
  getSnapshot: () => mockProgress,
  hydrateFromServer: vi.fn(),
}))

vi.mock('../../components/video/VideoDockSlot', () => ({
  default: () => <div data-testid="dock-slot" />,
}))

import CoursesSection from './CoursesSection'
import { play } from '../../components/video/videoStore'

const fixture = () => ({
  total: 2,
  categories: [
    {
      name: 'Getting Started',
      kind: 'library',
      sort_order: 0,
      videos: [
        { id: 1, youtube_id: 'lib0000000a', title: 'Welcome to the Desk', description: '', category: 'Getting Started', duration: '10:00', tags: [] },
        { id: 2, youtube_id: 'lib0000000b', title: 'Breadth basics', description: '', category: 'Getting Started', duration: '12:00', tags: [] },
      ],
    },
  ],
})

const pathsFixture = () => ({
  paths: [
    {
      id: 1, slug: 'uct-foundations', name: 'UCT Foundations', kind: 'course',
      sort_order: 20, enabled: 0, blurb: 'The flagship.',
      steps: [
        { youtube_id: 'lib0000000a', module_label: 'M1', note: null, planned_title: null },
        { youtube_id: 'gap:1', module_label: 'M1', note: null, planned_title: 'The Operating Loop' },
      ],
    },
    {
      id: 2, slug: 'a-track', name: 'A Track', kind: 'track', sort_order: 0, enabled: 1,
      steps: [
        { youtube_id: 'lib0000000a', module_label: null, note: null, planned_title: null },
        { youtube_id: 'lib0000000b', module_label: null, note: null, planned_title: null },
      ],
    },
  ],
})

let fetchFn

beforeEach(() => {
  mockRole = 'admin'
  mockData = fixture()
  mockPaths = pathsFixture()
  mockProgress = {}
  play.mockClear()
  fetchFn = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ id: 9, slug: 'new-course', kind: 'course' }) }))
  vi.stubGlobal('fetch', fetchFn)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const renderSection = (entries) =>
  render(
    <MemoryRouter initialEntries={entries || ['/desk?section=courses']}>
      <CoursesSection />
    </MemoryRouter>,
  )

test('renders course cards only — tracks never appear here', () => {
  renderSection()
  expect(screen.getByRole('heading', { name: 'Courses' })).toBeTruthy()
  const card = screen.getByRole('button', { name: /UCT Foundations/ })
  expect(within(card).getByText('COURSE')).toBeTruthy()
  expect(within(card).getByText('DRAFT')).toBeTruthy()
  expect(within(card).getByText(/1 lesson · 1 to record/)).toBeTruthy()
  expect(screen.queryByRole('button', { name: /A Track/ })).toBeNull()
})

test('members never see draft courses (and the dock slot renders first)', () => {
  mockRole = null // member — server would filter drafts; mirror that here
  mockPaths = { paths: pathsFixture().paths.filter((p) => p.enabled) }
  renderSection()
  expect(screen.getByTestId('dock-slot')).toBeTruthy()
  expect(screen.queryByRole('button', { name: /UCT Foundations/ })).toBeNull()
  expect(screen.getByText(/Courses are being produced/)).toBeTruthy()
})

test('card click opens the PathView syllabus via ?path=<slug>, planned row inert', () => {
  renderSection()
  fireEvent.click(screen.getByRole('button', { name: /UCT Foundations/ }))
  expect(screen.getByRole('heading', { level: 2, name: 'UCT Foundations' })).toBeTruthy()
  expect(screen.getByText('The Operating Loop')).toBeTruthy()
  expect(screen.getByText('To record')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Play Welcome to the Desk' })).toBeTruthy()
})

test('deep-link ?path renders the syllabus directly', () => {
  renderSection(['/desk?section=courses&path=uct-foundations'])
  expect(screen.getByRole('heading', { level: 2, name: 'UCT Foundations' })).toBeTruthy()
})

test('admin New-course outline: kind is locked (no select) and the POST creates a DRAFT', async () => {
  renderSection()
  fireEvent.click(screen.getByRole('button', { name: /New course outline/ }))
  const sheet = screen.getByTestId('sheet')
  expect(within(sheet).queryByLabelText('Kind')).toBeNull() // lockKind hides the select
  fireEvent.change(within(sheet).getByPlaceholderText('e.g. Tape Reading 101'), {
    target: { value: 'Tape Reading' },
  })
  await act(async () => {
    fireEvent.click(within(sheet).getByRole('button', { name: 'Create' }))
  })
  const post = fetchFn.mock.calls.find(([, o]) => o?.method === 'POST')
  const body = JSON.parse(post[1].body)
  expect(body.kind).toBe('course')
  expect(body.enabled).toBe(false) // outlines start as drafts
})

test('member with no visible courses sees the coming-soon note, admin sees the create note', () => {
  mockPaths = { paths: [] }
  renderSection()
  expect(screen.getByText(/No courses yet/)).toBeTruthy()
  mockRole = null
  renderSection()
  expect(screen.getByText(/Courses are being produced/)).toBeTruthy()
})
