// Desk Courses — planned lessons ("to be recorded" slots, 2026-07-27).
// A course step may carry planned_title instead of a real video: the syllabus
// renders it as an inert placeholder row (never playable, outside all
// progress math), the landing card counts it separately ("N to record") and
// badges unpublished (enabled=0) courses DRAFT for admins, and the editor can
// add planned rows / attach a library video to convert one. Admins fetch
// /paths?all=1 so draft courses are reachable at all.
import { render, screen, fireEvent, act } from '@testing-library/react'
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
let requestedPathsKeys = []
vi.mock('swr', () => ({
  default: (key) => {
    if (String(key).startsWith('/api/education/paths')) requestedPathsKeys.push(key)
    return {
      data:
        key === '/api/education/videos'
          ? mockData
          : String(key).startsWith('/api/education/paths')
            ? mockPaths
            : null,
      error: null,
      isLoading: false,
      mutate: vi.fn(),
    }
  },
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
  total: 3,
  categories: [
    {
      name: 'Getting Started',
      kind: 'library',
      sort_order: 0,
      videos: [
        { id: 1, youtube_id: 'lib0000000a', title: 'Welcome to the Desk', description: '', category: 'Getting Started', duration: '10:00', tags: [] },
        { id: 2, youtube_id: 'lib0000000b', title: 'Breadth basics', description: '', category: 'Getting Started', duration: '12:00', tags: [] },
        { id: 3, youtube_id: 'lib0000000c', title: 'Position sizing rules', description: '', category: 'Getting Started', duration: '9:00', tags: [] },
      ],
    },
  ],
})

// A draft flagship: 2 real lessons + 1 planned slot, module-grouped.
const draftCourse = () => ({
  paths: [
    {
      id: 7, slug: 'uct-foundations', name: 'UCT Foundations', kind: 'course',
      sort_order: 10, enabled: 0, blurb: 'The flagship.',
      steps: [
        { youtube_id: 'lib0000000a', module_label: 'M1 · Foundations', note: null, planned_title: null },
        { youtube_id: 'gap:1', module_label: 'M1 · Foundations', note: 'Record first — the on-ramp.', planned_title: 'Welcome to UCT Foundations' },
        { youtube_id: 'lib0000000b', module_label: 'M2 · Market Regime', note: null, planned_title: null },
      ],
    },
  ],
})

let fetchFn

beforeEach(() => {
  mockRole = 'admin'
  mockData = fixture()
  mockPaths = draftCourse()
  mockProgress = {}
  requestedPathsKeys = []
  play.mockClear()
  fetchFn = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) }))
  vi.stubGlobal('fetch', fetchFn)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const renderSection = (entries) =>
  render(
    <MemoryRouter initialEntries={entries || ['/']}>
      <VideosSection />
    </MemoryRouter>,
  )

/* ── Fetch key: admins ask for drafts, members never do ─────────────────── */

test('admin fetches /paths?all=1; member fetches the plain member key', () => {
  renderSection(['/desk'])
  expect(requestedPathsKeys).toContain('/api/education/paths?all=1')
  requestedPathsKeys = []
  mockRole = null
  renderSection(['/desk'])
  expect(requestedPathsKeys).toContain('/api/education/paths')
  expect(requestedPathsKeys).not.toContain('/api/education/paths?all=1')
})

/* ── Landing card ────────────────────────────────────────────────────────── */

test('admin card shows DRAFT badge + "N to record" count for an unpublished course', () => {
  renderSection(['/desk'])
  expect(screen.getByText('DRAFT')).toBeTruthy()
  expect(screen.getByText(/2 lessons · 1 to record/)).toBeTruthy()
})

test('a draft course never claims the starter strip', () => {
  renderSection(['/desk'])
  expect(screen.queryByText(/New here\?/)).toBeNull()
})

test('an ENABLED zero-lesson path (admin view) does not crash the landing or claim the starter', () => {
  mockPaths = {
    paths: [
      {
        id: 9, slug: 'empty-live', name: 'Empty Live', kind: 'track',
        sort_order: 0, enabled: 1,
        steps: [{ youtube_id: 'zzUNRESOLVEDz', module_label: null, note: null, planned_title: null }],
      },
    ],
  }
  renderSection(['/desk'])
  expect(screen.queryByText(/New here\?/)).toBeNull()
})

/* ── Syllabus (view mode) ────────────────────────────────────────────────── */

test('planned row renders inert with its title, note, and To-record chip — and is not playable', () => {
  renderSection(['/desk?path=uct-foundations'])
  expect(screen.getByText('Welcome to UCT Foundations')).toBeTruthy()
  expect(screen.getByText('Record first — the on-ramp.')).toBeTruthy()
  expect(screen.getByText('To record')).toBeTruthy()
  // No Play button exists for the planned title; real lessons keep theirs.
  expect(screen.queryByRole('button', { name: /Play Welcome to UCT Foundations/ })).toBeNull()
  expect(screen.getByRole('button', { name: 'Play Welcome to the Desk' })).toBeTruthy()
})

test('progress meta counts playable lessons only and reports the planned count', () => {
  renderSection(['/desk?path=uct-foundations'])
  expect(screen.getByText(/0 of 2 · 1 to record/)).toBeTruthy()
})

test('clicking the lesson AFTER a planned slot plays the correct playable index', () => {
  renderSection(['/desk?path=uct-foundations'])
  fireEvent.click(screen.getByRole('button', { name: 'Play Breadth basics' }))
  const [list, index] = play.mock.calls[0]
  expect(index).toBe(1) // second PLAYABLE lesson — the planned row consumed no slot
  expect(list[1].youtube_id).toBe('lib0000000b')
})

/* ── Editor ──────────────────────────────────────────────────────────────── */

test('editor: planned row has a title input; attach-video converts it and the PUT carries the real id', async () => {
  renderSection(['/desk?path=uct-foundations'])
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
  const titleInput = screen.getByLabelText('Title for planned lesson 2')
  expect(titleInput.value).toBe('Welcome to UCT Foundations')
  // Attach the just-recorded video via the per-row search.
  const attach = screen.getByLabelText('Attach a video to planned lesson 2')
  fireEvent.change(attach, { target: { value: 'sizing' } })
  fireEvent.click(screen.getByRole('option', { name: /Position sizing rules/ }))
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  })
  const put = fetchFn.mock.calls.find(([, opts]) => opts?.method === 'PUT')
  const steps = JSON.parse(put[1].body).steps
  expect(steps[1]).toEqual({
    youtube_id: 'lib0000000c', module_label: 'M1 · Foundations',
    note: 'Record first — the on-ramp.', start_seconds: null, end_seconds: null,
    planned_title: null,
  })
})

test('editor: Add planned lesson appends a row; empty title blocks the save inline', async () => {
  renderSection(['/desk?path=uct-foundations'])
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
  fireEvent.click(screen.getByRole('button', { name: /Add planned lesson/ }))
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  })
  expect(screen.getByRole('alert').textContent).toMatch(/planned lesson needs a title/)
  expect(fetchFn.mock.calls.filter(([, o]) => o?.method === 'PUT')).toHaveLength(0)
  // Title it → the save goes through with the planned step in position.
  fireEvent.change(screen.getByLabelText('Title for planned lesson 4'), {
    target: { value: 'Advanced regime nuances' },
  })
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  })
  const put = fetchFn.mock.calls.find(([, opts]) => opts?.method === 'PUT')
  const steps = JSON.parse(put[1].body).steps
  expect(steps[3]).toEqual({
    youtube_id: '', module_label: null, note: null,
    start_seconds: null, end_seconds: null,
    planned_title: 'Advanced regime nuances',
  })
})
