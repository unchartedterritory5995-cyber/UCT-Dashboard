// Desk Videos — the admin course editor (Task 6). PathView's edit mode
// (name/blurb/kind + per-row remove / move / module_label / note + the
// predictive add-lesson search), the landing's New-course / Delete-path
// affordances, and the save contract: PATCH meta ONLY when changed, PUT the
// WHOLE ordered step list, inline error + draft preservation on failure,
// SWR mutate on success. Members must see ZERO of it.
import { render, screen, fireEvent, within, act } from '@testing-library/react'
import { vi, beforeEach, afterEach, test, expect } from 'vitest'
import { MemoryRouter, useLocation } from 'react-router-dom'

// Stub the responsive Sheet so modals render plainly in jsdom.
vi.mock('../../components/mobile/Sheet', () => ({
  default: ({ children, title }) => <div data-testid="sheet">{title}{children}</div>,
}))

// Controllable auth role per test.
let mockRole = null
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { role: mockRole || 'pro-user' } }),
}))

// Controllable SWR payloads with a STABLE paths mutate. Calling the paths
// mutate applies mockPathsNext when set — simulating the post-create
// revalidate that must land before ?path=<new slug> can resolve.
let mockData = null
let mockPaths = null
let mockPathsNext = null
let pathsMutate
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
    mutate: String(key).startsWith('/api/education/paths') ? (...a) => pathsMutate(...a) : () => {},
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

import VideosSection, { slugifyPathName } from './VideosSection'
import { play } from '../../components/video/videoStore'

const fixture = () => ({
  total: 6,
  categories: [
    {
      name: 'Live Trading Sessions',
      kind: 'show',
      sort_order: 0,
      videos: [
        { id: 1, youtube_id: 'lts0000000a', title: 'Session — July 21', description: '', category: 'Live Trading Sessions', duration: '1:02:11', created_at: 1753100000, tags: [] },
        { id: 2, youtube_id: 'lts0000000b', title: 'Session — July 24 breadth day', description: '', category: 'Live Trading Sessions', duration: '58:00', created_at: 1753359200, tags: [] },
      ],
    },
    {
      name: 'Evening Update',
      kind: 'show',
      sort_order: 1,
      videos: [
        { id: 3, youtube_id: 'evn0000000a', title: 'Evening Update — July 23', description: '', category: 'Evening Update', created_at: 1753272800, tags: [] },
      ],
    },
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
        { id: 6, youtube_id: 'lib0000000c', title: 'Position sizing rules', description: '', category: 'Risk Management', tags: ['risk'] },
      ],
    },
  ],
})

const pathsFixture = () => ({
  paths: [
    {
      id: 1, slug: 'foundations', name: 'Foundations', kind: 'course', sort_order: 0,
      blurb: 'The essentials, in order.',
      steps: [
        { youtube_id: 'lib0000000a', module_label: null, note: null },
        { youtube_id: 'lib0000000b', module_label: null, note: null },
        { youtube_id: 'lts0000000a', module_label: null, note: null },
      ],
    },
    {
      // 'risk' carries an UNRESOLVABLE step (index 1) — members see 2 lessons;
      // the editor must surface AND preserve all 3 authored steps.
      id: 2, slug: 'risk', name: 'Risk & Discipline', kind: 'track', sort_order: 1,
      blurb: 'Protect capital first.',
      steps: [
        { youtube_id: 'lib0000000c', module_label: null, note: null },
        { youtube_id: 'zzUNKNOWNzz', module_label: 'Legacy', note: 'Re-record this one.' },
        { youtube_id: 'evn0000000a', module_label: null, note: null },
      ],
    },
  ],
})

const jsonRes = (obj, ok = true) =>
  Promise.resolve({ ok, json: () => Promise.resolve(obj) })

let fetchFn

beforeEach(() => {
  mockRole = 'admin'
  mockData = fixture()
  mockPaths = pathsFixture()
  mockPathsNext = null
  mockProgress = {}
  play.mockClear()
  pathsMutate = vi.fn(async (updater) => {
    // Mirror SWR's bound mutate: a function argument transforms the cached
    // data in place (the optimistic-save path); mockPathsNext still simulates
    // the post-create server revalidation when set.
    if (typeof updater === 'function') mockPaths = updater(mockPaths) ?? mockPaths
    if (mockPathsNext) {
      mockPaths = mockPathsNext
      mockPathsNext = null
    }
  })
  fetchFn = vi.fn(() => jsonRes({ ok: true }))
  vi.stubGlobal('fetch', fetchFn)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const renderSection = (entries) =>
  render(
    <MemoryRouter initialEntries={entries || ['/']}>
      <VideosSection />
      <LocationProbe />
    </MemoryRouter>,
  )

function LocationProbe() {
  return <div data-testid="loc">{useLocation().search}</div>
}

const callsTo = (method, urlPart) =>
  fetchFn.mock.calls.filter(
    ([url, opts]) =>
      (opts?.method || 'GET') === method && String(url).includes(urlPart),
  )
const bodyOf = (call) => JSON.parse(call[1].body)

const enterEdit = () => fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
const clickSave = () =>
  act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  })

/* ── Gating — members see ZERO change ────────────────────────────────────── */

test('a member sees no Edit on PathView and no New/Delete on the landing', () => {
  mockRole = null // pro-user
  const first = renderSection(['/desk?path=foundations'])
  expect(screen.getByRole('heading', { level: 2, name: 'Foundations' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull()
  // The member header DOM is byte-identical to pre-Task-6: the admin-only
  // kindRow wrapper (host of the Edit pill) must not exist at all.
  expect(document.querySelector('[class*="kindRow"]')).toBeNull()
  first.unmount()
  renderSection(['/desk'])
  expect(screen.getByRole('heading', { level: 2, name: 'Courses' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: /New course/ })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Delete path' })).toBeNull()
})

test('a member cannot open a sub-2-lesson path; an admin can (editor reachability)', () => {
  const data = pathsFixture()
  data.paths[1].steps = [{ youtube_id: 'lib0000000c', module_label: null, note: null }]
  mockPaths = data
  mockRole = null
  const first = renderSection(['/desk?path=risk'])
  expect(screen.getByRole('list', { name: 'Recently added' })).toBeTruthy() // landing
  first.unmount()
  mockRole = 'admin'
  renderSection(['/desk?path=risk'])
  expect(screen.getByRole('heading', { level: 2, name: 'Risk & Discipline' })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Edit' })).toBeTruthy()
})

/* ── The editor — enter, anatomy, cancel ─────────────────────────────────── */

test('Edit unlocks the syllabus: meta inputs + per-row controls; Cancel discards the draft', () => {
  renderSection(['/desk?path=foundations'])
  // The admin view-mode header hosts the Edit pill inside the kindRow wrapper.
  expect(document.querySelector('[class*="kindRow"]')).toBeTruthy()
  enterEdit()
  expect(screen.getByLabelText('Name').value).toBe('Foundations')
  expect(screen.getByLabelText('Blurb').value).toBe('The essentials, in order.')
  expect(screen.getByLabelText('Path kind').value).toBe('course')
  expect(screen.getAllByRole('button', { name: /^Remove / })).toHaveLength(3)
  expect(screen.getByRole('button', { name: 'Move Welcome to the Desk up' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Move Session — July 21 down' })).toBeDisabled()
  expect(screen.getByLabelText('Add a lesson')).toBeTruthy()
  // Lesson rows are NOT playable in edit mode — the ledger is a draft.
  expect(screen.queryByRole('button', { name: /^Play / })).toBeNull()
  // Rename, then Cancel: nothing fetched, the view returns untouched, and
  // re-entering rebuilds a FRESH draft (not the abandoned one).
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Scrapped' } })
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(screen.getByRole('heading', { level: 2, name: 'Foundations' })).toBeTruthy()
  expect(fetchFn).not.toHaveBeenCalled()
  enterEdit()
  expect(screen.getByLabelText('Name').value).toBe('Foundations')
})

/* ── Save contract — PUT order, PATCH only-when-changed ──────────────────── */

test('move down reorders the draft and the PUT carries the new whole-list order; no PATCH when meta untouched', async () => {
  renderSection(['/desk?path=foundations'])
  enterEdit()
  fireEvent.click(screen.getByRole('button', { name: 'Move Welcome to the Desk down' }))
  await clickSave()
  const puts = callsTo('PUT', '/api/education/paths/1/steps')
  expect(puts).toHaveLength(1)
  expect(bodyOf(puts[0]).steps).toEqual([
    { youtube_id: 'lib0000000b', module_label: null, note: null, start_seconds: null, end_seconds: null, planned_title: null },
    { youtube_id: 'lib0000000a', module_label: null, note: null, start_seconds: null, end_seconds: null, planned_title: null },
    { youtube_id: 'lts0000000a', module_label: null, note: null, start_seconds: null, end_seconds: null, planned_title: null },
  ])
  expect(callsTo('PATCH', '/api/education/paths/1')).toHaveLength(0) // meta untouched
  expect(pathsMutate).toHaveBeenCalledTimes(1)
  expect(screen.queryByLabelText('Name')).toBeNull() // editor closed
})

test('add via the predictive library search + remove a lesson — the PUT reflects both, with inline module/note carried', async () => {
  renderSection(['/desk?path=foundations'])
  enterEdit()
  fireEvent.click(screen.getByRole('button', { name: 'Remove Breadth basics' }))
  // Predictive search over the loaded library (shows included).
  const add = screen.getByLabelText('Add a lesson')
  fireEvent.change(add, { target: { value: 'position siz' } })
  fireEvent.click(screen.getByRole('button', { name: /^Position sizing rules/ }))
  expect(add.value).toBe('') // cleared for the next add
  expect(screen.getByRole('button', { name: 'Remove Position sizing rules' })).toBeTruthy()
  // Inline per-row module_label + note on the appended lesson (row 3).
  fireEvent.change(screen.getByLabelText('Module for lesson 3'), {
    target: { value: 'Risk' },
  })
  fireEvent.change(screen.getByLabelText('Note for lesson 3'), {
    target: { value: 'Size before entries.' },
  })
  await clickSave()
  const puts = callsTo('PUT', '/api/education/paths/1/steps')
  expect(puts).toHaveLength(1)
  expect(bodyOf(puts[0]).steps).toEqual([
    { youtube_id: 'lib0000000a', module_label: null, note: null, start_seconds: null, end_seconds: null, planned_title: null },
    { youtube_id: 'lts0000000a', module_label: null, note: null, start_seconds: null, end_seconds: null, planned_title: null },
    { youtube_id: 'lib0000000c', module_label: 'Risk', note: 'Size before entries.', start_seconds: null, end_seconds: null, planned_title: null },
  ])
})

test('meta PATCH fires only when changed and carries ONLY the changed fields', async () => {
  renderSection(['/desk?path=foundations'])
  enterEdit()
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Foundations II' } })
  fireEvent.change(screen.getByLabelText('Path kind'), { target: { value: 'track' } })
  await clickSave()
  const patches = callsTo('PATCH', '/api/education/paths/1')
  expect(patches).toHaveLength(1)
  expect(bodyOf(patches[0])).toEqual({ name: 'Foundations II', kind: 'track' }) // blurb omitted
  expect(callsTo('PUT', '/api/education/paths/1/steps')).toHaveLength(1)
})

test('save mutates the /paths cache OPTIMISTICALLY — the syllabus shows the saved values with no revalidation round-trip', async () => {
  const view = renderSection(['/desk?path=foundations'])
  enterEdit()
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Foundations II' } })
  fireEvent.click(screen.getByRole('button', { name: 'Move Welcome to the Desk down' }))
  await clickSave()
  // The mutate carried a cache UPDATER + explicit background revalidation —
  // not a bare refetch that would leave the pre-save data on screen for one
  // round-trip.
  expect(typeof pathsMutate.mock.calls[0][0]).toBe('function')
  expect(pathsMutate.mock.calls[0][1]).toEqual({ revalidate: true })
  // The harness mock applied the updater to mockPaths; the cache now holds
  // the saved values with NO server payload staged (mockPathsNext unset) —
  // a pure row merge that left the sibling path and the slug untouched.
  expect(mockPaths.paths).toHaveLength(2)
  expect(mockPaths.paths[0]).toMatchObject({ id: 1, slug: 'foundations', name: 'Foundations II' })
  expect(mockPaths.paths[0].steps.map((s) => s.youtube_id)).toEqual([
    'lib0000000b', 'lib0000000a', 'lts0000000a',
  ])
  expect(mockPaths.paths[1].name).toBe('Risk & Discipline')
  // SWR's cache write is what repaints subscribers; the harness stands that
  // in with an explicit re-render — the syllabus shows the saved values.
  view.rerender(
    <MemoryRouter initialEntries={['/desk?path=foundations']}>
      <VideosSection />
      <LocationProbe />
    </MemoryRouter>,
  )
  expect(screen.getByRole('heading', { level: 2, name: 'Foundations II' })).toBeTruthy()
  expect(
    screen.getAllByRole('button', { name: /^Play / }).map((b) => b.getAttribute('aria-label')),
  ).toEqual(['Play Breadth basics', 'Play Welcome to the Desk', 'Play Session — July 21'])
})

test('a stored blurb with incidental whitespace fires NO spurious PATCH on an untouched Save', async () => {
  const data = pathsFixture()
  data.paths[0].blurb = '  The essentials, in order.  ' // whitespace in store
  mockPaths = data
  renderSection(['/desk?path=foundations'])
  enterEdit()
  await clickSave()
  expect(callsTo('PATCH', '/api/education/paths/1')).toHaveLength(0) // both sides trimmed
  expect(callsTo('PUT', '/api/education/paths/1/steps')).toHaveLength(1)
})

test('a save failure shows inline and PRESERVES the draft; the retry succeeds', async () => {
  renderSection(['/desk?path=foundations'])
  enterEdit()
  fireEvent.click(screen.getByRole('button', { name: 'Move Welcome to the Desk down' }))
  fetchFn.mockImplementation((url, opts) =>
    opts?.method === 'PUT' ? jsonRes({ detail: 'steps exploded' }, false) : jsonRes({ ok: true }),
  )
  await clickSave()
  expect((await screen.findByRole('alert')).textContent).toBe('steps exploded')
  // Still editing, reorder intact — no data loss.
  expect(
    screen.getAllByRole('button', { name: /^Remove / }).map((b) => b.getAttribute('aria-label')),
  ).toEqual(['Remove Breadth basics', 'Remove Welcome to the Desk', 'Remove Session — July 21'])
  expect(pathsMutate).not.toHaveBeenCalled()
  // Backend heals → the same draft saves clean.
  fetchFn.mockImplementation(() => jsonRes({ ok: true }))
  await clickSave()
  const puts = callsTo('PUT', '/api/education/paths/1/steps')
  expect(bodyOf(puts[puts.length - 1]).steps.map((s) => s.youtube_id)).toEqual([
    'lib0000000b', 'lib0000000a', 'lts0000000a',
  ])
  expect(pathsMutate).toHaveBeenCalledTimes(1)
  expect(screen.queryByLabelText('Name')).toBeNull()
})

test('an unresolvable step id is flagged in the editor and SURVIVES the round-trip', async () => {
  renderSection(['/desk?path=risk'])
  enterEdit()
  expect(screen.getByText('not in library')).toBeTruthy()
  expect(screen.getByLabelText('Module for lesson 2').value).toBe('Legacy')
  expect(screen.getByLabelText('Note for lesson 2').value).toBe('Re-record this one.')
  await clickSave()
  const puts = callsTo('PUT', '/api/education/paths/2/steps')
  expect(bodyOf(puts[0]).steps).toEqual([
    { youtube_id: 'lib0000000c', module_label: null, note: null, start_seconds: null, end_seconds: null, planned_title: null },
    { youtube_id: 'zzUNKNOWNzz', module_label: 'Legacy', note: 'Re-record this one.', start_seconds: null, end_seconds: null, planned_title: null },
    { youtube_id: 'evn0000000a', module_label: null, note: null, start_seconds: null, end_seconds: null, planned_title: null },
  ])
})

/* ── New course/track — POST payload, kebab slug, open-in-edit ───────────── */

test('New course: slug auto-kebabs until touched, POST carries the payload, and the new path opens in edit mode', async () => {
  renderSection(['/desk?section=videos'])
  fireEvent.click(screen.getByRole('button', { name: /New course/ }))
  const name = screen.getByLabelText('Name')
  const slug = screen.getByLabelText(/^Slug/)
  fireEvent.change(name, { target: { value: 'Tape Reading 101' } })
  expect(slug.value).toBe('tape-reading-101')
  // Editable before create; once touched, the name stops driving it.
  fireEvent.change(slug, { target: { value: 'tape-101' } })
  fireEvent.change(name, { target: { value: 'Tape Reading 202' } })
  expect(slug.value).toBe('tape-101')
  fireEvent.change(screen.getByLabelText('Blurb (optional)'), {
    target: { value: 'Reading the prints.' },
  })
  const created = {
    id: 9, slug: 'tape-101', name: 'Tape Reading 202', kind: 'course',
    sort_order: 2, blurb: 'Reading the prints.', steps: [],
  }
  fetchFn.mockImplementation((url, opts) =>
    opts?.method === 'POST' ? jsonRes(created) : jsonRes({ ok: true }),
  )
  mockPathsNext = { paths: [...pathsFixture().paths, created] }
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
  })
  const posts = callsTo('POST', '/api/education/paths')
  expect(posts).toHaveLength(1)
  expect(bodyOf(posts[0])).toEqual({
    slug: 'tape-101',
    name: 'Tape Reading 202',
    blurb: 'Reading the prints.',
    kind: 'course',
    sort_order: 2, // after the fixture's max sort_order (1)
  })
  expect(pathsMutate).toHaveBeenCalled()
  // ?path=<slug> is open (params MERGED) — straight into the editor.
  expect(new URLSearchParams(screen.getByTestId('loc').textContent).get('path')).toBe('tape-101')
  expect(new URLSearchParams(screen.getByTestId('loc').textContent).get('section')).toBe('videos')
  expect(screen.getByLabelText('Name').value).toBe('Tape Reading 202')
  expect(screen.getByLabelText('Add a lesson')).toBeTruthy()
  expect(play).not.toHaveBeenCalled() // creating never autoplays anything
})

test('slugifyPathName: kebab-case, punctuation collapsed, accents folded, edges trimmed', () => {
  expect(slugifyPathName('Tape Reading 101')).toBe('tape-reading-101')
  expect(slugifyPathName('Risk & Discipline!')).toBe('risk-discipline')
  expect(slugifyPathName('  Café — Trading  ')).toBe('cafe-trading')
  expect(slugifyPathName('---')).toBe('')
  expect(slugifyPathName('')).toBe('')
})

test('an admin with zero publishable courses still gets the section + New (Delete hidden with nothing to delete)', () => {
  mockPaths = { paths: [] }
  renderSection(['/desk'])
  expect(screen.getByRole('heading', { level: 2, name: 'Courses' })).toBeTruthy()
  expect(screen.getByRole('button', { name: /New course/ })).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Delete path' })).toBeNull()
})

/* ── Delete path — confirm-gated, lists drafts members never see ─────────── */

test('Delete path: confirm gates the DELETE; success revalidates /paths', async () => {
  renderSection(['/desk'])
  fireEvent.click(screen.getByRole('button', { name: 'Delete path' }))
  const sheet = screen.getByTestId('sheet')
  expect(within(sheet).getByText('Foundations')).toBeTruthy()
  expect(within(sheet).getByText('Course · 3 lessons')).toBeTruthy()
  expect(within(sheet).getByText('Track · 3 lessons')).toBeTruthy() // authored steps, not resolved
  const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
  try {
    fireEvent.click(within(sheet).getByRole('button', { name: 'Delete Foundations' }))
    expect(callsTo('DELETE', '/api/education/paths/1')).toHaveLength(0) // declined
    confirmSpy.mockReturnValue(true)
    await act(async () => {
      fireEvent.click(within(sheet).getByRole('button', { name: 'Delete Foundations' }))
    })
    expect(callsTo('DELETE', '/api/education/paths/1')).toHaveLength(1)
    expect(pathsMutate).toHaveBeenCalledTimes(1)
  } finally {
    confirmSpy.mockRestore()
  }
})
