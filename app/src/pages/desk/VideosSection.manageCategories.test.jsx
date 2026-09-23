// Manage Categories — Packet U CP1 (fingerprint 877d092c0). Wires the four
// previously-uncalled category-management routes (GET /categories, POST
// /categories/rename, PATCH /categories/{name}, POST /reorder) via a new
// admin-only sheet on the Desk Videos landing. See
// docs/terminal-research/12-decisions/gates/packet-u-desk-category-management-wiring-gate.md
// for the signed scope this test file covers.
import { render, screen, fireEvent, within, act } from '@testing-library/react'
import { vi, beforeEach, afterEach, test, expect } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

// Stub the responsive Sheet so modals render plainly in jsdom.
vi.mock('../../components/mobile/Sheet', () => ({
  default: ({ children, title }) => <div data-testid="sheet">{title}{children}</div>,
}))

// Always admin for this file — Manage Categories is admin-only by construction.
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { role: 'admin' } }),
}))

vi.mock('../../components/video/videoStore', () => ({ play: vi.fn() }))

const EMPTY_PROGRESS = {}
vi.mock('./videoProgress', () => ({
  subscribe: () => () => {},
  getSnapshot: () => EMPTY_PROGRESS,
  hydrateFromServer: vi.fn(),
}))

vi.mock('../../components/video/VideoDockSlot', () => ({
  default: () => <div data-testid="dock-slot" />,
}))

// Controllable SWR payloads, keyed by url — mirrors the mocking idiom already
// used by VideosSection.landing.test.jsx / PathView.admin.test.jsx, extended
// with the sheet's own /api/education/categories key. `videosMutate` and
// `catNamesMutate` are STABLE per-test spies (never reassigned mid-render) so
// a stale closure inside a mocked hook call can't drop an assertion.
let mockData = null
let mockPaths = null
let mockCatNames = null
let videosMutate
let catNamesMutate

vi.mock('swr', () => ({
  default: (key) => {
    if (key === '/api/education/videos') {
      return { data: mockData, error: null, isLoading: false, mutate: (...a) => videosMutate(...a) }
    }
    if (String(key).startsWith('/api/education/paths')) {
      return { data: mockPaths, error: null, isLoading: false, mutate: async () => {} }
    }
    if (key === '/api/education/categories') {
      return { data: mockCatNames, error: null, isLoading: false, mutate: (...a) => catNamesMutate(...a) }
    }
    return { data: null, error: null, isLoading: false, mutate: async () => {} }
  },
}))

import VideosSection from './VideosSection'

const fixture = () => ({
  total: 3,
  categories: [
    {
      name: 'Live Trading Sessions',
      kind: 'show',
      sort_order: 0,
      blurb: '',
      videos: [
        { id: 1, youtube_id: 'lts0000000a', title: 'Session — July 21', description: '', category: 'Live Trading Sessions', tags: [] },
      ],
    },
    {
      name: 'Getting Started',
      kind: 'library',
      sort_order: 0,
      blurb: 'Start here.',
      videos: [
        { id: 4, youtube_id: 'lib0000000a', title: 'Welcome to the Desk', description: '', category: 'Getting Started', tags: [], sort_order: 0 },
        { id: 5, youtube_id: 'lib0000000b', title: 'Breadth basics', description: '', category: 'Getting Started', tags: [], sort_order: 1 },
      ],
    },
    {
      name: 'Risk Management',
      kind: 'library',
      sort_order: 1,
      blurb: '',
      videos: [
        { id: 6, youtube_id: 'lib0000000c', title: 'Position sizing rules', description: '', category: 'Risk Management', tags: [] },
      ],
    },
  ],
})

const catNamesFixture = () => ({
  categories: ['Getting Started', 'Live Trading Sessions', 'Risk Management'],
})

const jsonRes = (obj, ok = true) => Promise.resolve({ ok, json: () => Promise.resolve(obj) })

let fetchFn

beforeEach(() => {
  mockData = fixture()
  mockPaths = { paths: [] }
  mockCatNames = catNamesFixture()
  videosMutate = vi.fn(async () => {})
  catNamesMutate = vi.fn(async (updater) => {
    if (typeof updater === 'function') mockCatNames = updater(mockCatNames) ?? mockCatNames
  })
  fetchFn = vi.fn(() => jsonRes({ ok: true }))
  vi.stubGlobal('fetch', fetchFn)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const renderSection = () =>
  render(
    <MemoryRouter initialEntries={['/desk?section=videos']}>
      <VideosSection />
    </MemoryRouter>,
  )

const openSheet = () => {
  const view = renderSection()
  fireEvent.click(screen.getByRole('button', { name: 'Manage Categories' }))
  return { ...view, sheet: screen.getByTestId('sheet') }
}

// Fully mocked 'swr' has no real cache subscription — a mutate() call updates
// the module-level fixture variable but does NOT itself re-render React.
// An explicit rerender (same idiom as PathView.admin.test.jsx's optimistic-
// save test) forces VideosSection to re-invoke the mocked useSWR calls and
// pick up the now-updated fixtures.
const rerenderSection = (rerender) =>
  rerender(
    <MemoryRouter initialEntries={['/desk?section=videos']}>
      <VideosSection />
    </MemoryRouter>,
  )

const rowOf = (name) =>
  screen.getByLabelText(`Rename ${name}`).closest('[class*="manageCatRow"]')

// EXACT url match (not a substring) — a broken endpoint whose new literal
// merely CONTAINS the old path (e.g. an appended suffix) must still fail this
// check, not pass it by accident.
const callsTo = (method, url) =>
  fetchFn.mock.calls.filter(
    ([u, opts]) => (opts?.method || 'GET') === method && String(u) === url,
  )
const bodyOf = (call) => JSON.parse(call[1].body)

/* ── Trigger + list load ──────────────────────────────────────────────── */

test('Manage Categories is admin-only and opens a sheet listing every category from GET /categories', () => {
  const { sheet } = openSheet()
  expect(within(sheet).getByText('Manage Categories')).toBeTruthy()
  expect(screen.getByLabelText('Rename Getting Started')).toBeTruthy()
  expect(screen.getByLabelText('Rename Live Trading Sessions')).toBeTruthy()
  expect(screen.getByLabelText('Rename Risk Management')).toBeTruthy()
})

test('per-category meta fields are pre-filled from the parent categories prop, not a second fetch', () => {
  openSheet()
  // kind/sort_order/blurb are read straight off VideosSection's already-loaded
  // `categories` prop (the /videos payload) — there is no per-category GET to
  // have fired, and the sheet's own GET /categories call supplies the NAME
  // list only (asserted separately above).
  expect(screen.getByLabelText('Kind for Getting Started').value).toBe('library')
  expect(screen.getByLabelText('Sort order for Getting Started').value).toBe('0')
  expect(screen.getByLabelText('Blurb for Getting Started').value).toBe('Start here.')
  expect(screen.getByLabelText('Kind for Live Trading Sessions').value).toBe('show')
})

/* ── Rename + explicit merge-warning copy ─────────────────────────────── */

test('renaming to a brand-new name shows no merge warning and POSTs from_name/to_name', async () => {
  openSheet()
  const row = rowOf('Risk Management')
  fireEvent.change(within(row).getByLabelText('Rename Risk Management'), {
    target: { value: 'Risk & Discipline' },
  })
  expect(within(row).queryByRole('alert')).toBeNull()
  await act(async () => {
    fireEvent.click(within(row).getByRole('button', { name: 'Save' }))
  })
  const posts = callsTo('POST', '/api/education/categories/rename')
  expect(posts).toHaveLength(1)
  expect(bodyOf(posts[0])).toEqual({ from_name: 'Risk Management', to_name: 'Risk & Discipline' })
  expect(videosMutate).toHaveBeenCalled()
})

test('renaming onto an EXISTING category shows an explicit merge warning before saving, and the merge is what gets POSTed', async () => {
  const { rerender } = openSheet()
  const row = rowOf('Risk Management')
  fireEvent.change(within(row).getByLabelText('Rename Risk Management'), {
    target: { value: 'Getting Started' },
  })
  const warning = within(row).getByRole('alert')
  expect(warning.textContent).toMatch(/merge/i)
  expect(warning.textContent).toContain('Risk Management')
  expect(warning.textContent).toContain('Getting Started')
  await act(async () => {
    fireEvent.click(within(row).getByRole('button', { name: 'Save' }))
  })
  const posts = callsTo('POST', '/api/education/categories/rename')
  expect(posts).toHaveLength(1)
  expect(bodyOf(posts[0])).toEqual({ from_name: 'Risk Management', to_name: 'Getting Started' })
  expect(videosMutate).toHaveBeenCalled() // parent /videos payload refreshed too
  // Optimistic apply already removed "Risk Management" from the sheet's own
  // (mocked) name-list fixture — force a repaint to see it (see
  // rerenderSection's note); the sheet itself stays open (same VideosSection
  // fiber, same local state) across the rerender.
  rerenderSection(rerender)
  const sheetAfter = screen.getByTestId('sheet')
  expect(within(sheetAfter).queryByLabelText('Rename Risk Management')).toBeNull()
  expect(within(sheetAfter).getByLabelText('Rename Getting Started')).toBeTruthy()
  expect(within(sheetAfter).queryByRole('alert')).toBeNull()
})

test('a failed rename shows the inline error and rolls the name list back', async () => {
  fetchFn.mockImplementation((url, opts) =>
    opts?.method === 'POST' && String(url) === '/api/education/categories/rename'
      ? jsonRes({ detail: 'distinct old and new category names required' }, false)
      : jsonRes({ ok: true }),
  )
  openSheet()
  const row = rowOf('Risk Management')
  fireEvent.change(within(row).getByLabelText('Rename Risk Management'), {
    target: { value: 'Risk & Discipline' },
  })
  await act(async () => {
    fireEvent.click(within(row).getByRole('button', { name: 'Save' }))
  })
  expect(within(row).getByText('distinct old and new category names required')).toBeTruthy()
  // Rolled back — the original name is still a row (rename never "succeeded" visually).
  expect(screen.getByLabelText('Rename Risk Management')).toBeTruthy()
  expect(screen.queryByLabelText('Rename Risk & Discipline')).toBeNull()
})

/* ── Category meta (kind / sort_order / blurb) — PATCH only-when-changed ── */

test('Save meta PATCHes only the fields actually changed, and calls the parent mutate()', async () => {
  openSheet()
  const row = rowOf('Getting Started')
  fireEvent.change(within(row).getByLabelText('Sort order for Getting Started'), {
    target: { value: '3' },
  })
  await act(async () => {
    fireEvent.click(within(row).getByRole('button', { name: 'Save meta' }))
  })
  const patches = callsTo('PATCH', '/api/education/categories/Getting%20Started')
  expect(patches).toHaveLength(1)
  expect(bodyOf(patches[0])).toEqual({ sort_order: 3 }) // kind/blurb untouched → omitted
  expect(videosMutate).toHaveBeenCalled()
})

test('an untouched Save meta click fires no PATCH at all', async () => {
  openSheet()
  const row = rowOf('Getting Started')
  await act(async () => {
    fireEvent.click(within(row).getByRole('button', { name: 'Save meta' }))
  })
  expect(callsTo('PATCH', '/api/education/categories/Getting%20Started')).toHaveLength(0)
})

test('kind + blurb changes together PATCH both, blurb trimmed', async () => {
  openSheet()
  const row = rowOf('Live Trading Sessions')
  fireEvent.change(within(row).getByLabelText('Kind for Live Trading Sessions'), {
    target: { value: 'library' },
  })
  fireEvent.change(within(row).getByLabelText('Blurb for Live Trading Sessions'), {
    target: { value: '  The daily tape.  ' },
  })
  await act(async () => {
    fireEvent.click(within(row).getByRole('button', { name: 'Save meta' }))
  })
  const patches = callsTo('PATCH', '/api/education/categories/Live%20Trading%20Sessions')
  expect(patches).toHaveLength(1)
  expect(bodyOf(patches[0])).toEqual({ kind: 'library', blurb: 'The daily tape.' })
})

/* ── Per-category video reorder — the Watchlists four-handler idiom ─────── */

test('Reorder videos expands the unfiltered server-order list and a drag POSTs the new ordered_ids', async () => {
  openSheet()
  const row = rowOf('Getting Started')
  fireEvent.click(within(row).getByRole('button', { name: 'Reorder videos' }))
  const list = within(row).getByRole('list', { name: 'Reorder videos in Getting Started' })
  let items = within(list).getAllByRole('listitem')
  expect(items.map((el) => el.textContent)).toEqual(['Welcome to the Desk', 'Breadth basics'])

  const dt = {}
  await act(async () => {
    fireEvent.dragStart(items[0], { dataTransfer: dt })
    fireEvent.dragOver(items[1], { dataTransfer: dt })
    fireEvent.drop(items[1], { dataTransfer: dt })
    fireEvent.dragEnd(items[0])
  })

  const posts = callsTo('POST', '/api/education/reorder')
  expect(posts).toHaveLength(1)
  expect(bodyOf(posts[0])).toEqual({ category: 'Getting Started', ordered_ids: [5, 4] })
  expect(videosMutate).toHaveBeenCalled()

  items = within(list).getAllByRole('listitem')
  expect(items.map((el) => el.textContent)).toEqual(['Breadth basics', 'Welcome to the Desk'])
})

test('a failed reorder shows an inline error and reverts the list to the last known-good order', async () => {
  fetchFn.mockImplementation((url, opts) =>
    opts?.method === 'POST' && String(url) === '/api/education/reorder'
      ? jsonRes({ detail: 'boom' }, false)
      : jsonRes({ ok: true }),
  )
  openSheet()
  const row = rowOf('Getting Started')
  fireEvent.click(within(row).getByRole('button', { name: 'Reorder videos' }))
  const list = within(row).getByRole('list', { name: 'Reorder videos in Getting Started' })
  const items = within(list).getAllByRole('listitem')
  const dt = {}
  await act(async () => {
    fireEvent.dragStart(items[0], { dataTransfer: dt })
    fireEvent.dragOver(items[1], { dataTransfer: dt })
    fireEvent.drop(items[1], { dataTransfer: dt })
  })
  expect(within(row).getByText('boom')).toBeTruthy()
  const after = within(list).getAllByRole('listitem')
  expect(after.map((el) => el.textContent)).toEqual(['Welcome to the Desk', 'Breadth basics'])
})
