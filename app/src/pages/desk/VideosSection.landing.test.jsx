// Desk Videos landing — custom-YouTube-library layout: featured strip + one
// shelf per category (server order) + one chip bar with a Filters toggle for
// the tag chips. The theater/player contract is untouched: VideoDockSlot stays
// the first rendered child and every play routes through videoStore.play(list,
// index) with THAT category's display-order list.
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

// Controllable watch-progress store (keyed by youtube_id).
let mockProgress = {}
vi.mock('./videoProgress', () => ({
  subscribe: () => () => {},
  getSnapshot: () => mockProgress,
  hydrateFromServer: vi.fn(),
}))

// The theater slot — stubbed so we can assert its position structurally.
vi.mock('../../components/video/VideoDockSlot', () => ({
  default: () => <div data-testid="dock-slot" />,
}))

import VideosSection, { fmtSeekTime, renderSnippet } from './VideosSection'
import Shelf, { showGlyphName } from './Shelf'
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
  mockProgress = {}
  play.mockClear()
})

// Optional initialEntries → deep-link/URL-state tests share one entry point.
const renderSection = (entries) =>
  render(
    <MemoryRouter initialEntries={entries || ['/']}>
      <VideosSection />
    </MemoryRouter>,
  )

// Reads the live URL search string from inside the same router.
function LocationProbe() {
  return <div data-testid="loc">{useLocation().search}</div>
}

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

test('every category renders as a shelf (role=list) in server order, after Recently added', () => {
  renderSection()
  const names = screen.getAllByRole('list').map((l) => l.getAttribute('aria-label'))
  expect(names).toEqual([
    'Recently added',
    'Live Trading Sessions', 'Evening Update', 'Getting Started', 'Risk Management',
  ])
})

test('Recently added holds the newest videos across categories and plays within its own list', () => {
  renderSection()
  const rail = screen.getByRole('list', { name: 'Recently added' })
  // Fixture created_at ordering: id 2 (Jul 24) > id 3 (Jul 23) > id 1 (Jul 21);
  // library videos carry no created_at so they never join the cross-cut.
  const cards = within(rail).getAllByRole('button', { name: /^Play / })
  expect(cards.map((b) => b.getAttribute('aria-label'))).toEqual([
    'Play Session — July 24 breadth day',
    'Play Evening Update — July 23',
    'Play Session — July 21',
  ])
  fireEvent.click(cards[1])
  expect(play).toHaveBeenCalledTimes(1)
  const [listArg, indexArg] = play.mock.calls[0]
  expect(listArg.map((v) => v.id)).toEqual([2, 3, 1]) // the recently-added list itself
  expect(indexArg).toBe(1)
})

test('Recently added shows no count in its header', () => {
  renderSection()
  const heading = screen.getByRole('heading', { level: 2, name: 'Recently added' })
  // The header row holds only the name — no count node, no View all.
  expect(heading.parentElement.textContent).toBe('Recently added')
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
  expect(screen.queryByRole('button', { name: 'risk' })).toBeNull()
  const filters = screen.getByRole('button', { name: 'Filters' })
  expect(filters.getAttribute('aria-expanded')).toBe('false')
  fireEvent.click(filters)
  expect(filters.getAttribute('aria-expanded')).toBe('true')
  expect(screen.getByRole('button', { name: 'risk' })).toBeTruthy()
})

test('selecting a tag hides untagged library videos but not the shows', () => {
  renderSection()
  fireEvent.click(screen.getByRole('button', { name: 'Filters' }))
  fireEvent.click(screen.getByRole('button', { name: 'risk' }))
  expect(screen.queryByText('Welcome to the Desk')).toBeNull()
  expect(screen.queryByText('Breadth basics')).toBeNull()
  expect(screen.getByText('Position sizing rules')).toBeTruthy()
  expect(screen.getByRole('list', { name: 'Live Trading Sessions' })).toBeTruthy()
})

test('chips carry no count numbers — accessible names are the bare category names', () => {
  renderSection()
  const tabNames = screen.getAllByRole('tab').map((t) => t.textContent)
  expect(tabNames).toEqual([
    'All', 'Live Trading Sessions', 'Evening Update', 'Getting Started', 'Risk Management',
  ])
  for (const name of tabNames) expect(name).not.toMatch(/\d/)
})

test('active chip semantics: selection inverts aria-selected and toggles off', () => {
  renderSection()
  const all = screen.getByRole('tab', { name: 'All' })
  const cat = screen.getByRole('tab', { name: 'Getting Started' })
  expect(all.getAttribute('aria-selected')).toBe('true')
  expect(cat.getAttribute('aria-selected')).toBe('false')
  fireEvent.click(cat)
  expect(cat.getAttribute('aria-selected')).toBe('true')
  expect(screen.getByRole('tab', { name: 'All' }).getAttribute('aria-selected')).toBe('false')
  fireEvent.click(cat) // second click deselects back to All
  expect(screen.getByRole('tab', { name: 'All' }).getAttribute('aria-selected')).toBe('true')
})

test('NEW badge marks only videos created within the last 5 days', () => {
  const now = Math.floor(Date.now() / 1000)
  const data = fixture()
  // Fresh library video (2 days old) + stale sibling (10 days old). Library
  // videos with created_at also join Recently added, so the fresh one shows
  // its badge in BOTH rails.
  data.categories[2].videos[0].created_at = now - 2 * 86400 // Welcome to the Desk
  data.categories[2].videos[1].created_at = now - 10 * 86400 // Breadth basics
  mockData = data
  renderSection()
  const lib = screen.getByRole('list', { name: 'Getting Started' })
  const freshCard = within(lib).getByRole('button', { name: 'Play Welcome to the Desk' })
  const staleCard = within(lib).getByRole('button', { name: 'Play Breadth basics' })
  expect(within(freshCard).getByText('NEW')).toBeTruthy()
  expect(within(staleCard).queryByText('NEW')).toBeNull()
})

test('shelf paddles track content-only changes (useScrollEdges contentKey dep)', () => {
  // Simulate layout in jsdom: every box is 600px wide, each row child 300px —
  // so 5 cards overflow (1500 > 600) and 2 cards fit exactly (600 = 600).
  const swSpy = vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get')
    .mockImplementation(function () { return this.children.length * 300 })
  const cwSpy = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get')
    .mockImplementation(() => 600)
  try {
    const mk = (n) =>
      Array.from({ length: n }, (_, i) => ({
        video: { id: i + 1, youtube_id: `vid${i}`, title: `V${i}` },
        list: [], index: i, kind: 'library',
      }))
    const props = { name: 'T', onPlay: () => {}, progress: {} }
    const { rerender } = render(<Shelf {...props} entries={mk(5)} />)
    expect(screen.getByRole('button', { name: 'Scroll T forward' })).toBeTruthy()
    // Content-only shrink (same row node, no resize event — the tag-filter
    // case): the paddle must disappear because the row no longer overflows.
    rerender(<Shelf {...props} entries={mk(2)} />)
    expect(screen.queryByRole('button', { name: 'Scroll T forward' })).toBeNull()
    // And grow back: the paddle returns.
    rerender(<Shelf {...props} entries={mk(6)} />)
    expect(screen.getByRole('button', { name: 'Scroll T forward' })).toBeTruthy()
  } finally {
    swSpy.mockRestore()
    cwSpy.mockRestore()
  }
})

test('watched videos dim the thumbnail and carry a Watched tag', () => {
  mockProgress = { lib0000000a: { done: true, t: 500, d: 600, at: 10 } }
  renderSection()
  const lib = screen.getByRole('list', { name: 'Getting Started' })
  const watchedCard = within(lib).getByRole('button', { name: 'Play Welcome to the Desk' })
  expect(within(watchedCard).getByText('Watched')).toBeTruthy()
  expect(watchedCard.querySelector('img').className).toMatch(/thumbWatched/)
  const otherCard = within(lib).getByRole('button', { name: 'Play Breadth basics' })
  expect(within(otherCard).queryByText('Watched')).toBeNull()
  expect(otherCard.querySelector('img').className).not.toMatch(/thumbWatched/)
})

test('VideoDockSlot is still the first rendered child of the section', () => {
  const { container } = renderSection()
  const page = container.firstChild
  expect(page.firstChild).toBe(screen.getByTestId('dock-slot'))
})

test('zone markers: SHOWS and LIBRARY seams render in order, cross-cuts float above SHOWS', () => {
  mockProgress = { lts0000000a: { t: 600, d: 2400, at: 99, done: false } }
  renderSection()
  const shows = screen.getByText('SHOWS')
  const library = screen.getByText('LIBRARY')
  const after = (a, b) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)
  // Continue Watching + Recently added are cross-cuts — ABOVE the SHOWS seam.
  expect(after(screen.getByRole('list', { name: 'Continue watching' }), shows)).toBe(true)
  expect(after(screen.getByRole('list', { name: 'Recently added' }), shows)).toBe(true)
  // SHOWS opens the show zone; LIBRARY sits between the last show shelf and
  // the first library shelf.
  expect(after(shows, screen.getByRole('list', { name: 'Live Trading Sessions' }))).toBe(true)
  expect(after(screen.getByRole('list', { name: 'Evening Update' }), library)).toBe(true)
  expect(after(library, screen.getByRole('list', { name: 'Getting Started' }))).toBe(true)
})

test('zone markers render in landing mode only', () => {
  renderSection()
  fireEvent.click(screen.getByRole('tab', { name: 'Getting Started' }))
  expect(screen.queryByText('SHOWS')).toBeNull()
  expect(screen.queryByText('LIBRARY')).toBeNull()
  fireEvent.click(screen.getByRole('tab', { name: 'Getting Started' })) // back to All
  expect(screen.getByText('SHOWS')).toBeTruthy()
  expect(screen.getByText('LIBRARY')).toBeTruthy()
  fireEvent.change(screen.getByLabelText('Search educational videos'), {
    target: { value: 'breadth' },
  })
  expect(screen.queryByText('SHOWS')).toBeNull()
  expect(screen.queryByText('LIBRARY')).toBeNull()
})

test('View-all sort: shows default to Newest; Oldest reorders the grid AND the play list; collapse resets', () => {
  renderSection()
  const section = screen
    .getByRole('heading', { level: 2, name: 'Live Trading Sessions' })
    .closest('section')
  fireEvent.click(within(section).getByRole('button', { name: 'View all' }))
  const oldest = within(section).getByRole('button', { name: 'Oldest' })
  expect(
    within(section).getByRole('button', { name: 'Newest' }).getAttribute('aria-pressed'),
  ).toBe('true') // show shelves default = Newest (matches the rail)
  let cards = within(section).getAllByRole('button', { name: /^Play / })
  expect(cards.map((b) => b.getAttribute('aria-label'))).toEqual([
    'Play Session — July 24 breadth day',
    'Play Session — July 21',
  ])
  fireEvent.click(oldest)
  expect(oldest.getAttribute('aria-pressed')).toBe('true')
  cards = within(section).getAllByRole('button', { name: /^Play / })
  expect(cards.map((b) => b.getAttribute('aria-label'))).toEqual([
    'Play Session — July 21',
    'Play Session — July 24 breadth day',
  ])
  // Plays route through the SORTED display list (Up Next coherence).
  fireEvent.click(cards[0])
  expect(play).toHaveBeenCalledTimes(1)
  const [listArg, indexArg] = play.mock.calls[0]
  expect(listArg.map((v) => v.id)).toEqual([1, 2])
  expect(indexArg).toBe(0)
  // Sort is per-expansion state: collapse + re-expand returns to the default.
  fireEvent.click(within(section).getByRole('button', { name: 'Collapse' }))
  fireEvent.click(within(section).getByRole('button', { name: 'View all' }))
  expect(
    within(section).getByRole('button', { name: 'Newest' }).getAttribute('aria-pressed'),
  ).toBe('true')
})

test('library View-all keeps server order by default (neither sort pressed); toggle still works', () => {
  renderSection()
  const section = screen
    .getByRole('heading', { level: 2, name: 'Getting Started' })
    .closest('section')
  fireEvent.click(within(section).getByRole('button', { name: 'View all' }))
  expect(
    within(section).getByRole('button', { name: 'Newest' }).getAttribute('aria-pressed'),
  ).toBe('false')
  expect(
    within(section).getByRole('button', { name: 'Oldest' }).getAttribute('aria-pressed'),
  ).toBe('false')
  let cards = within(section).getAllByRole('button', { name: /^Play / })
  expect(cards.map((b) => b.getAttribute('aria-label'))).toEqual([
    'Play Welcome to the Desk',
    'Play Breadth basics',
  ])
  fireEvent.click(within(section).getByRole('button', { name: 'Newest' }))
  cards = within(section).getAllByRole('button', { name: /^Play / })
  // Library fixture carries no created_at → newest falls back to id desc.
  expect(cards.map((b) => b.getAttribute('aria-label'))).toEqual([
    'Play Breadth basics',
    'Play Welcome to the Desk',
  ])
})

test('Continue Watching meta is time-left: rounded minutes, 1-min floor, nothing when duration unknown', () => {
  mockProgress = {
    lts0000000a: { t: 600, d: 2400, at: 30, done: false }, // (2400-600)/60 = 30
    lib0000000a: { t: 2380, d: 2400, at: 20, done: false }, // rounds to 0 → floors at 1
    evn0000000a: { t: 100, at: 10, done: false }, // no d → no meta at all
  }
  renderSection()
  const rail = screen.getByRole('list', { name: 'Continue watching' })
  const cardOf = (label) =>
    within(rail).getByRole('button', { name: label }).closest('article')
  expect(within(cardOf('Play Session — July 21')).getByText('30 min left')).toBeTruthy()
  expect(within(cardOf('Play Welcome to the Desk')).getByText('1 min left')).toBeTruthy()
  const unknown = cardOf('Play Evening Update — July 23')
  expect(within(unknown).queryByText(/min left/)).toBeNull()
  expect(within(unknown).queryByText('Jul 23, 2025')).toBeNull() // no date fallback either
  // The show's own shelf keeps its date meta — time-left is Continue-only.
  const evnRail = screen.getByRole('list', { name: 'Evening Update' })
  expect(within(evnRail).queryByText(/min left/)).toBeNull()
  expect(within(evnRail).getByText('Jul 23, 2025')).toBeTruthy()
})

test('show shelf headers carry "· updated MMM D" from the newest episode; library headers unchanged', () => {
  renderSection()
  const headOf = (name) =>
    screen.getByRole('heading', { level: 2, name }).parentElement.textContent
  expect(headOf('Live Trading Sessions')).toContain('· updated Jul 24')
  expect(headOf('Evening Update')).toContain('· updated Jul 23')
  expect(headOf('Getting Started')).not.toContain('updated')
  expect(headOf('Risk Management')).not.toContain('updated')
})

test('show header updated fragment is omitted when no episode carries created_at', () => {
  const data = fixture()
  data.categories[1].videos = data.categories[1].videos.map(
    ({ created_at, ...v }) => v,
  )
  mockData = data
  renderSection()
  const head = screen.getByRole('heading', { level: 2, name: 'Evening Update' }).parentElement
  expect(head.textContent).not.toContain('updated')
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

/* ── `/` shortcut — focus search, with the input/modal guards ───────────── */

test('pressing / focuses the search input and suppresses browser quick-find', () => {
  renderSection()
  const search = screen.getByLabelText('Search educational videos')
  expect(document.activeElement).not.toBe(search)
  // fireEvent returns false when preventDefault was called — the quick-find kill.
  const notPrevented = fireEvent.keyDown(window, { key: '/' })
  expect(notPrevented).toBe(false)
  expect(document.activeElement).toBe(search)
})

test('/ does NOT fire while focus is already in an input (the search box itself)', () => {
  renderSection()
  const search = screen.getByLabelText('Search educational videos')
  search.focus()
  const notPrevented = fireEvent.keyDown(search, { key: '/' })
  expect(notPrevented).toBe(true) // default kept — "/" lands as a typed character
  expect(document.activeElement).toBe(search)
})

test('/ does NOT fire while the admin VideoForm sheet is open', () => {
  mockRole = 'admin'
  renderSection()
  fireEvent.click(screen.getByRole('button', { name: 'Add video' }))
  expect(screen.getByTestId('sheet')).toBeTruthy()
  const search = screen.getByLabelText('Search educational videos')
  const notPrevented = fireEvent.keyDown(window, { key: '/' })
  expect(notPrevented).toBe(true)
  expect(document.activeElement).not.toBe(search)
})

test('/ with a modifier held is left to the browser', () => {
  renderSection()
  const search = screen.getByLabelText('Search educational videos')
  expect(fireEvent.keyDown(window, { key: '/', ctrlKey: true })).toBe(true)
  expect(document.activeElement).not.toBe(search)
})

test('the / window listener is removed on unmount (no per-route stacking)', () => {
  const addSpy = vi.spyOn(window, 'addEventListener')
  const removeSpy = vi.spyOn(window, 'removeEventListener')
  try {
    const { unmount } = renderSection()
    const added = addSpy.mock.calls.filter(([t]) => t === 'keydown').map(([, fn]) => fn)
    expect(added.length).toBeGreaterThanOrEqual(1)
    unmount()
    const removed = removeSpy.mock.calls.filter(([t]) => t === 'keydown').map(([, fn]) => fn)
    for (const fn of added) expect(removed).toContain(fn)
  } finally {
    addSpy.mockRestore()
    removeSpy.mockRestore()
  }
})

/* ── Escape in the search input — two-stage: clear, then blur ───────────── */

test('Escape clears a non-empty query first, then blurs on the second press', () => {
  renderSection()
  const search = screen.getByLabelText('Search educational videos')
  search.focus()
  fireEvent.change(search, { target: { value: 'breadth' } })
  expect(screen.queryByRole('list')).toBeNull() // flat grid active
  fireEvent.keyDown(search, { key: 'Escape' })
  expect(search.value).toBe('')
  expect(document.activeElement).toBe(search) // stage 1 keeps focus
  expect(screen.getByRole('list', { name: 'Recently added' })).toBeTruthy() // landing back
  fireEvent.keyDown(search, { key: 'Escape' })
  expect(document.activeElement).not.toBe(search) // stage 2 blurs
})

/* ── Flat-grid result count — dim "N videos" line, query-only ───────────── */

test('an active query shows a result count with plural/singular handled', () => {
  renderSection()
  const search = screen.getByLabelText('Search educational videos')
  fireEvent.change(search, { target: { value: 'breadth' } })
  expect(screen.getByText('2 videos')).toBeTruthy()
  fireEvent.change(search, { target: { value: 'Position sizing' } })
  expect(screen.getByText('1 video')).toBeTruthy()
  fireEvent.change(search, { target: { value: 'zzz-no-match' } })
  expect(screen.queryByText(/^\d+ videos?$/)).toBeNull() // no count under the no-match note
  // Chip-only filtering (no query) shows no count line either.
  fireEvent.change(search, { target: { value: '' } })
  fireEvent.click(screen.getByRole('tab', { name: 'Getting Started' }))
  expect(screen.queryByText(/^\d+ videos?$/)).toBeNull()
})

/* ── Per-show glyphs — show headers only, curated names + default ───────── */

test('showGlyphName maps the curated shows and defaults unknown names to play', () => {
  expect(showGlyphName('Live Trading Sessions')).toBe('chart')
  expect(showGlyphName('The Mental Game')).toBe('compass')
  expect(showGlyphName('Post-Market Recaps')).toBe('markets')
  expect(showGlyphName('Post Market Recap')).toBe('markets') // punctuation variant
  expect(showGlyphName('Thoughts on the Market')).toBe('chat')
  expect(showGlyphName('Evening Update')).toBe('moon')
  expect(showGlyphName('Some Future Show')).toBe('play')
  expect(showGlyphName('')).toBe('play')
})

test('show shelf headers carry a glyph inside the name; library and cross-cut headers stay bare', () => {
  mockProgress = { lts0000000a: { t: 600, d: 2400, at: 99, done: false } }
  renderSection()
  const glyphOf = (name) =>
    screen.getByRole('heading', { level: 2, name }).querySelector('svg[data-glyph]')
  expect(glyphOf('Live Trading Sessions')?.getAttribute('data-glyph')).toBe('chart')
  expect(glyphOf('Evening Update')?.getAttribute('data-glyph')).toBe('moon')
  expect(glyphOf('Getting Started')).toBeNull()
  expect(glyphOf('Risk Management')).toBeNull()
  expect(glyphOf('Continue watching')).toBeNull() // cross-cuts never carry glyphs
  expect(glyphOf('Recently added')).toBeNull()
})

test('an unknown show still gets the default glyph (future shows are covered)', () => {
  const data = fixture()
  data.categories[1].name = 'Brand New Show'
  data.categories[1].videos = data.categories[1].videos.map((v) => ({
    ...v, category: 'Brand New Show',
  }))
  mockData = data
  renderSection()
  const heading = screen.getByRole('heading', { level: 2, name: 'Brand New Show' })
  expect(heading.querySelector('svg[data-glyph]')?.getAttribute('data-glyph')).toBe('play')
})

test('the flat grid keeps the glyph on show sections only', () => {
  renderSection()
  fireEvent.click(screen.getByRole('tab', { name: 'Live Trading Sessions' }))
  let heading = screen.getByRole('heading', { level: 2, name: 'Live Trading Sessions' })
  expect(heading.querySelector('svg[data-glyph]')?.getAttribute('data-glyph')).toBe('chart')
  fireEvent.click(screen.getByRole('tab', { name: 'Live Trading Sessions' })) // back to All
  fireEvent.click(screen.getByRole('tab', { name: 'Getting Started' }))
  heading = screen.getByRole('heading', { level: 2, name: 'Getting Started' })
  expect(heading.querySelector('svg[data-glyph]')).toBeNull()
})

/* ── ?cat= URL state — preselect, unknown-graceful, param merge ─────────── */

test('loading with ?cat= pre-selects the chip and renders the filtered view', () => {
  renderSection(['/desk?section=videos&cat=Getting%20Started'])
  expect(
    screen.getByRole('tab', { name: 'Getting Started' }).getAttribute('aria-selected'),
  ).toBe('true')
  expect(screen.queryByRole('list')).toBeNull() // flat grid, not shelves
  expect(screen.getByRole('heading', { level: 2, name: 'Getting Started' })).toBeTruthy()
  expect(screen.queryByRole('heading', { level: 2, name: 'Risk Management' })).toBeNull()
})

test('an unknown ?cat= is ignored gracefully — landing renders as All', () => {
  renderSection(['/desk?cat=Not%20A%20Category'])
  expect(screen.getByRole('tab', { name: 'All' }).getAttribute('aria-selected')).toBe('true')
  expect(screen.getByText('SHOWS')).toBeTruthy() // full landing, no crash
  expect(screen.getByRole('list', { name: 'Recently added' })).toBeTruthy()
})

test('chip clicks write ?cat= by MERGING params (section=videos preserved); All removes it', () => {
  render(
    <MemoryRouter initialEntries={['/desk?section=videos']}>
      <VideosSection />
      <LocationProbe />
    </MemoryRouter>,
  )
  const params = () => new URLSearchParams(screen.getByTestId('loc').textContent)
  fireEvent.click(screen.getByRole('tab', { name: 'Getting Started' }))
  expect(params().get('cat')).toBe('Getting Started')
  expect(params().get('section')).toBe('videos') // merged, not clobbered
  fireEvent.click(screen.getByRole('tab', { name: 'All' }))
  expect(params().get('cat')).toBeNull()
  expect(params().get('section')).toBe('videos')
})

/* ── ?v= deep link — byte-unchanged behavior, alone and beside ?cat= ────── */

test('?v= still auto-plays once against its own category list', () => {
  renderSection(['/desk?section=videos&v=lib0000000a'])
  expect(play).toHaveBeenCalledTimes(1)
  const [listArg, indexArg] = play.mock.calls[0]
  expect(listArg.map((v) => v.id)).toEqual([4, 5]) // server-order category list
  expect(indexArg).toBe(0)
})

test('?v= and ?cat= coexist: autoplay fires AND the chip filter applies', () => {
  renderSection(['/desk?v=lib0000000b&cat=Live%20Trading%20Sessions'])
  expect(play).toHaveBeenCalledTimes(1)
  const [listArg, indexArg] = play.mock.calls[0]
  expect(listArg.map((v) => v.id)).toEqual([4, 5])
  expect(indexArg).toBe(1)
  expect(
    screen.getByRole('tab', { name: 'Live Trading Sessions' }).getAttribute('aria-selected'),
  ).toBe('true')
  expect(screen.getByRole('heading', { level: 2, name: 'Live Trading Sessions' })).toBeTruthy()
})

/* ── r6: "Found inside videos" — deep search below the title-match grid ─── */

// Deep tests fake ONLY setTimeout/clearTimeout (the debounce) — Date stays
// real so date meta / NEW-badge logic is untouched — and stub global fetch.
const deepResults = () => [
  // id 2 is a visible title match for "breadth" → must be DEDUPED out.
  { id: 2, youtube_id: 'lts0000000b', title: 'Session — July 24 breadth day', category: 'Live Trading Sessions', match_field: 'title', snippet: 'Session — July 24 <b>breadth</b> day', t: null },
  { id: 6, youtube_id: 'lib0000000c', title: 'Position sizing rules', category: 'Risk Management', match_field: 'transcript', snippet: '…hold the <b>breadth</b> line into the close…', t: 872 },
  { id: 3, youtube_id: 'evn0000000a', title: 'Evening Update — July 23', category: 'Evening Update', match_field: 'chapter', snippet: 'Market <b>breadth</b> check', t: 3725 },
  { id: 4, youtube_id: 'lib0000000a', title: 'Welcome to the Desk', category: 'Getting Started', match_field: 'headline', snippet: 'the <b>breadth</b> engine', t: null },
]

const stubSearch = (impl) => {
  const fn = vi.fn(impl)
  vi.stubGlobal('fetch', fn)
  return fn
}
const okSearch = (results) =>
  stubSearch(() =>
    Promise.resolve({ ok: true, json: () => Promise.resolve({ results, total: results.length, mode: 'fts' }) }),
  )

const typeSearch = (value) =>
  fireEvent.change(screen.getByLabelText('Search educational videos'), { target: { value } })

const settleDeep = () => act(async () => { await vi.advanceTimersByTimeAsync(450) })

const deepSetup = () => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

test('deep section renders from /search, dedupes visible grid matches, formats seek chips', async () => {
  deepSetup()
  const fetchFn = okSearch(deepResults())
  renderSection()
  typeSearch('breadth')
  await settleDeep()
  // One debounced request, query threaded through.
  expect(fetchFn).toHaveBeenCalledTimes(1)
  expect(fetchFn.mock.calls[0][0]).toBe('/api/education/search?q=breadth&limit=30')
  const section = screen.getByRole('heading', { level: 2, name: 'Found inside videos' }).closest('section')
  // id 2 is already in the title-match grid → excluded; the other 3 render.
  expect(within(section).getByText('3')).toBeTruthy()
  expect(within(section).queryByRole('button', { name: 'Play Session — July 24 breadth day' })).toBeNull()
  const row = within(section).getByRole('button', { name: 'Play Position sizing rules' })
  // Snippet <b> emphasis is parsed into a real element (no innerHTML), and the
  // transcript timestamp renders mm:ss.
  expect(within(row).getByText('breadth').tagName).toBe('B')
  expect(within(row).getByText('14:32')).toBeTruthy()
  // Chapter match ≥1h renders h:mm:ss; a t-less match renders no chip.
  const chapterRow = within(section).getByRole('button', { name: 'Play Evening Update — July 23' })
  expect(within(chapterRow).getByText('1:02:05')).toBeTruthy()
  const headlineRow = within(section).getByRole('button', { name: 'Play Welcome to the Desk' })
  expect(within(headlineRow).queryByText(/^\d+:\d\d/)).toBeNull()
  // The deep section sits BELOW the title-match grid.
  const grid = screen.getByRole('heading', { level: 2, name: 'Getting Started' }).closest('section')
  expect(grid.compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
})

test('clicking a deep row plays a minimal one-video list via playVideo(list, 0)', async () => {
  deepSetup()
  okSearch(deepResults())
  renderSection()
  typeSearch('breadth')
  await settleDeep()
  fireEvent.click(screen.getByRole('button', { name: 'Play Position sizing rules' }))
  expect(play).toHaveBeenCalledTimes(1)
  const [listArg, indexArg] = play.mock.calls[0]
  expect(indexArg).toBe(0)
  expect(listArg).toHaveLength(1)
  expect(listArg[0]).toEqual({
    id: 6, youtube_id: 'lib0000000c', title: 'Position sizing rules', category: 'Risk Management',
  })
})

test('debounce: rapid typing fires ONE fetch for the final query only', async () => {
  deepSetup()
  const fetchFn = okSearch(deepResults())
  renderSection()
  typeSearch('bre')
  typeSearch('brea')
  typeSearch('breadth')
  await settleDeep()
  expect(fetchFn).toHaveBeenCalledTimes(1)
  expect(fetchFn.mock.calls[0][0]).toContain('q=breadth')
})

test('queries under 3 chars never fetch and render no deep section', async () => {
  deepSetup()
  const fetchFn = stubSearch(() => Promise.reject(new Error('must not be called')))
  renderSection()
  await settleDeep() // landing (empty query)
  typeSearch('br') // flat grid, but below the deep threshold
  await settleDeep()
  expect(fetchFn).not.toHaveBeenCalled()
  expect(screen.queryByText('Found inside videos')).toBeNull()
})

test('fail-silent: a network error or non-OK response renders nothing; titles still work', async () => {
  deepSetup()
  stubSearch(() => Promise.reject(new Error('boom')))
  renderSection()
  typeSearch('breadth')
  await settleDeep()
  expect(screen.queryByText('Found inside videos')).toBeNull()
  expect(screen.getByText('Breadth basics')).toBeTruthy() // title grid unharmed
  // Non-OK (e.g. 500) is equally silent.
  stubSearch(() => Promise.resolve({ ok: false, json: () => Promise.resolve({}) }))
  typeSearch('breadth day')
  await settleDeep()
  expect(screen.queryByText('Found inside videos')).toBeNull()
})

test('a LATER genuine failure clears earlier results — no stale rows under new text', async () => {
  deepSetup()
  okSearch(deepResults())
  renderSection()
  typeSearch('breadth')
  await settleDeep()
  expect(screen.getByText('Found inside videos')).toBeTruthy() // query A rendered
  // Query B's fetch genuinely fails (network) → A's rows must NOT survive.
  stubSearch(() => Promise.reject(new Error('network down')))
  typeSearch('breadth day')
  await settleDeep()
  expect(screen.queryByText('Found inside videos')).toBeNull()
  // Same for a later non-OK response (500).
  okSearch(deepResults())
  typeSearch('breadth')
  await settleDeep()
  expect(screen.getByText('Found inside videos')).toBeTruthy()
  stubSearch(() => Promise.resolve({ ok: false, json: () => Promise.resolve({}) }))
  typeSearch('breadth day')
  await settleDeep()
  expect(screen.queryByText('Found inside videos')).toBeNull()
})

test('an ABORT (superseded keystroke) keeps the current rows — no clear-then-repaint flicker', async () => {
  deepSetup()
  okSearch(deepResults())
  renderSection()
  typeSearch('breadth')
  await settleDeep() // query A rendered
  // Query B hangs until aborted — rejecting with AbortError, exactly like a
  // real fetch when the next keystroke's cleanup calls ctrl.abort().
  stubSearch((url, opts) =>
    new Promise((_, reject) => {
      opts.signal.addEventListener('abort', () =>
        reject(new DOMException('The operation was aborted.', 'AbortError')))
    }),
  )
  typeSearch('breadth da')
  await settleDeep() // B's fetch fires and hangs
  typeSearch('breadth day') // supersede → cleanup aborts B mid-flight
  await act(async () => {}) // flush the AbortError rejection
  expect(screen.getByText('Found inside videos')).toBeTruthy() // A's rows held
})

test('renderSnippet escapes everything outside <b> markers (no HTML injection)', () => {
  const { container } = render(
    <div>{renderSnippet('x <img src=y> before <b>hit</b> after')}</div>,
  )
  expect(container.querySelector('img')).toBeNull() // raw HTML stays text
  expect(container.querySelector('b').textContent).toBe('hit')
  expect(container.textContent).toBe('x <img src=y> before hit after')
})

test('renderSnippet: unbalanced/nested markers render as text — never crash, no HTML', () => {
  // Nested opener inside a match: lazy split captures 'a<b>b'; the inner
  // marker is CONTENT of the one <b> element (escaped text), not an element.
  const nested = render(<div>{renderSnippet('x <b>a<b>b</b>c')}</div>).container
  expect(nested.querySelectorAll('b')).toHaveLength(1)
  expect(nested.querySelector('b').textContent).toBe('a<b>b')
  expect(nested.textContent).toBe('x a<b>bc')
  // Unclosed marker: no pair → one plain text node, marker included verbatim.
  const open = render(<div>{renderSnippet('<b>open')}</div>).container
  expect(open.querySelector('b')).toBeNull()
  expect(open.textContent).toBe('<b>open')
  // Stray closer only: same — plain text.
  const close = render(<div>{renderSnippet('shut</b> it')}</div>).container
  expect(close.querySelector('b')).toBeNull()
  expect(close.textContent).toBe('shut</b> it')
})

test('fmtSeekTime formats mm:ss under an hour and h:mm:ss over', () => {
  expect(fmtSeekTime(0)).toBe('0:00')
  expect(fmtSeekTime(59)).toBe('0:59')
  expect(fmtSeekTime(872)).toBe('14:32')
  expect(fmtSeekTime(3600)).toBe('1:00:00')
  expect(fmtSeekTime(3725)).toBe('1:02:05')
})

/* ── r6: episode labels on card meta ────────────────────────────────────── */

test('episode_label prepends the card meta line with a · separator', () => {
  const data = fixture()
  data.categories[0].videos[0].episode_label = 'S12 · E9' // show + date meta
  data.categories[2].videos[0].episode_label = 'E42.4' // library, no date meta
  mockData = data
  renderSection()
  const showRail = screen.getByRole('list', { name: 'Live Trading Sessions' })
  expect(within(showRail).getByText('S12 · E9 · Jul 21, 2025')).toBeTruthy()
  const libRail = screen.getByRole('list', { name: 'Getting Started' })
  expect(within(libRail).getByText('E42.4')).toBeTruthy() // label alone — no stray separator
})

test('cards without episode_label keep their meta byte-unchanged', () => {
  renderSection()
  const showRail = screen.getByRole('list', { name: 'Live Trading Sessions' })
  expect(within(showRail).getByText('Jul 24, 2025')).toBeTruthy()
  expect(within(showRail).queryByText(/·/)).toBeNull() // no separator sneaks in
})
