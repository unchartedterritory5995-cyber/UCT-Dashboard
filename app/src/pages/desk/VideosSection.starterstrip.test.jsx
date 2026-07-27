// Desk Videos — the day-one start affordance. With ZERO course progress the
// continue-strip's slot instead offers "New here? Start with <first course>"
// (server order = course-kind first, then sort_order) + its lesson-1 title +
// a Start button that NAVIGATES to ?path=<slug> (never autoplays). Any course
// progress restores the existing Resume behavior untouched.
import { render, screen, fireEvent, within } from '@testing-library/react'
import { vi, beforeEach, test, expect } from 'vitest'
import { MemoryRouter, useLocation } from 'react-router-dom'

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
    mutate: () => {},
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

import VideosSection from './VideosSection'
import { play } from '../../components/video/videoStore'

const fixture = () => ({
  total: 4,
  categories: [
    {
      name: 'Getting Started',
      kind: 'library',
      sort_order: 0,
      videos: [
        { id: 4, youtube_id: 'lib0000000a', title: 'Welcome to the Desk', description: '', category: 'Getting Started', tags: [] },
        { id: 5, youtube_id: 'lib0000000b', title: 'Breadth basics', description: '', category: 'Getting Started', tags: [] },
      ],
    },
    {
      name: 'Risk Management',
      kind: 'library',
      sort_order: 1,
      videos: [
        { id: 6, youtube_id: 'lib0000000c', title: 'Position sizing rules', description: '', category: 'Risk Management', tags: [] },
        { id: 7, youtube_id: 'lib0000000d', title: 'Stops that hold', description: '', category: 'Risk Management', tags: [] },
      ],
    },
  ],
})

// Server order: course kind first, then sort_order (list order IS the rule).
const pathsFixture = () => ({
  paths: [
    {
      id: 1, slug: 'foundations', name: 'Foundations', kind: 'track', sort_order: 0,
      blurb: 'The essentials, in order.',
      steps: [
        { youtube_id: 'lib0000000a', module_label: null, note: null },
        { youtube_id: 'lib0000000b', module_label: null, note: null },
      ],
    },
    {
      id: 2, slug: 'risk', name: 'Risk & Discipline', kind: 'track', sort_order: 1,
      blurb: 'Protect capital first.',
      steps: [
        { youtube_id: 'lib0000000c', module_label: null, note: null },
        { youtube_id: 'lib0000000d', module_label: null, note: null },
      ],
    },
  ],
})

beforeEach(() => {
  mockRole = null
  mockData = fixture()
  mockPaths = pathsFixture()
  mockProgress = {}
  play.mockClear()
})

function LocationProbe() {
  return <div data-testid="loc">{useLocation().search}</div>
}

const renderSection = (entries) =>
  render(
    <MemoryRouter initialEntries={entries || ['/desk?section=videos']}>
      <VideosSection />
      <LocationProbe />
    </MemoryRouter>,
  )

const starter = () => screen.queryByRole('region', { name: 'Start your first course' })
const resume = () => screen.queryByRole('region', { name: 'Continue your course' })

/* ── Zero progress → the starter variant ──────────────────────────────────── */

test('zero course progress renders the starter strip: first course by server order + its lesson 1', () => {
  renderSection()
  const region = starter()
  expect(region).toBeTruthy()
  expect(within(region).getByText('New here?')).toBeTruthy()
  expect(within(region).getByText(/Start with/)).toBeTruthy()
  expect(within(region).getByText('Foundations')).toBeTruthy() // kind='course' leads server order
  expect(within(region).getByText('Lesson 1: Welcome to the Desk')).toBeTruthy()
  expect(resume()).toBeNull() // never both strips
})

test('Start NAVIGATES to ?path=<slug> — it does not autoplay', () => {
  renderSection()
  fireEvent.click(within(starter()).getByRole('button', { name: /Start/ }))
  const params = new URLSearchParams(screen.getByTestId('loc').textContent)
  expect(params.get('path')).toBe('foundations')
  expect(params.get('section')).toBe('videos') // params merged, not clobbered
  expect(play).not.toHaveBeenCalled()
  // The course page is open now — the landing (and its strips) are gone.
  expect(screen.getByRole('heading', { level: 2, name: 'Foundations' })).toBeTruthy()
  expect(starter()).toBeNull()
})

test('with only tracks (no course kind), the first track leads', () => {
  const data = pathsFixture()
  data.paths = [data.paths[1]] // risk track alone
  mockPaths = data
  renderSection()
  expect(within(starter()).getByText('Risk & Discipline')).toBeTruthy()
  expect(within(starter()).getByText('Lesson 1: Position sizing rules')).toBeTruthy()
})

/* ── Any progress → existing behavior, unchanged ──────────────────────────── */

test('mid-course progress renders the Resume strip, not the starter', () => {
  mockProgress = { lib0000000a: { done: true, t: 600, d: 610, at: 5 } }
  renderSection()
  expect(starter()).toBeNull()
  const region = resume()
  expect(region).toBeTruthy()
  fireEvent.click(within(region).getByRole('button', { name: /Resume/ }))
  expect(play).toHaveBeenCalledTimes(1) // resume still plays directly
})

test('a fully completed course suppresses BOTH strips (the member is not new)', () => {
  mockProgress = {
    lib0000000a: { done: true, t: 1, d: 2, at: 1 },
    lib0000000b: { done: true, t: 1, d: 2, at: 2 },
  }
  renderSection()
  expect(starter()).toBeNull()
  expect(resume()).toBeNull()
})

test('in-progress (not yet done) lessons also count as progress', () => {
  mockProgress = { lib0000000c: { done: false, t: 120, d: 900, at: 3 } }
  renderSection()
  expect(starter()).toBeNull()
  expect(resume()).toBeTruthy()
})

/* ── Edge — nothing to offer ──────────────────────────────────────────────── */

test('no member-visible courses (sub-2-lesson paths) → no starter strip', () => {
  const data = pathsFixture()
  data.paths.forEach((p) => { p.steps = p.steps.slice(0, 1) })
  mockPaths = data
  renderSection()
  expect(starter()).toBeNull()
})
