// COURSES — the Desk's dedicated section for kind='course' programs
// (2026-07-27 split): course cards (DRAFT badge, "N to record" counts,
// progress), tracks excluded, member visibility rules, ?path syllabus
// open, and the admin New-course flow (lockKind, draft-on-create).
//
// STUDY (2026-10-17, D2/D3, T13/T14): the Study panel above the cards and
// its skeleton on null; the course cards as curriculum doors (3px mastered
// bar + meta) opening the trail via ?study=map&curriculum=…; the trail's
// recorded-lessons door back to the syllabus; ?study=unit deep links; the
// panel's buttons writing ?study=today|practise; the flat CurriculumLessons
// list retired while Study is on and restored under the kill switch.
import { render, screen, fireEvent, within, act } from '@testing-library/react'
import { vi, beforeEach, afterEach, test, expect } from 'vitest'
import { MemoryRouter, useLocation } from 'react-router-dom'

vi.mock('../../components/mobile/Sheet', () => ({
  default: ({ children, title }) => <div data-testid="sheet">{title}{children}</div>,
}))

let mockRole = null
let mockStudyEnabled = undefined
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { role: mockRole || 'pro-user' }, studyEnabled: mockStudyEnabled }),
}))

let mockData = null
let mockPaths = null
let mockStudy = {}
vi.mock('swr', () => ({
  default: (key) => ({
    data:
      key === '/api/education/videos'
        ? mockData
        : String(key).startsWith('/api/education/paths')
          ? mockPaths
          : String(key).startsWith('/api/study/')
            ? (mockStudy[key] ?? null)
            : null,
    error: null,
    isLoading: false,
    mutate: vi.fn(),
  }),
}))

vi.mock('../../components/video/videoStore', () => ({ play: vi.fn(), minimize: vi.fn() }))

let mockProgress = {}
vi.mock('./videoProgress', () => ({
  subscribe: () => () => {},
  getSnapshot: () => mockProgress,
  hydrateFromServer: vi.fn(),
}))

vi.mock('../../components/video/VideoDockSlot', () => ({
  default: () => <div data-testid="dock-slot" />,
}))

// The flat lesson list renders nothing while its route is dark, so a marker
// stands in for it: the test needs to see it absent under Study and present
// under the kill switch.
vi.mock('./CurriculumLessons', () => ({
  default: () => <div data-testid="curriculum-lessons" />,
}))

// The drill and the practise sheet are mounted off the URL (integration seam);
// they are mocked here because the real drill carries the 20k-line chart.
vi.mock('../study/DrillPlayer', () => ({
  default: ({ sessionId, initial }) => (
    <div data-testid="drill-player">drill:{sessionId || 'today'}:{initial ? 'handed' : 'fresh'}</div>
  ),
}))
vi.mock('../study/PractiseSheet', () => ({
  default: ({ onStart }) => (
    <button type="button" data-testid="practise-sheet" onClick={() => onStart({ session_id: 'sess-p' })}>
      practise-sheet
    </button>
  ),
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

const studyMapFixture = () => ({
  map: {
    curricula: [
      {
        id: 'foundations',
        title: 'UCT Foundations',
        tracks: [
          {
            id: 'F1',
            title: 'Market basics',
            units: [
              { id: 'F1.01', title: 'What a candle says', skills: ['f1.candle'] },
              { id: 'F1.02', title: 'Volume tells', skills: ['f1.volume'] },
            ],
          },
        ],
      },
      { id: 'method', title: 'The UCT Method', tracks: [] },
    ],
  },
  skills: [
    { skill_id: 'f1.candle', mastery: 90, reps: 10, band: 'proficient' },
    { skill_id: 'f1.volume', mastery: 10, reps: 1, band: 'learning' },
  ],
})

const studyTodayFixture = () => ({
  session_id: 'sess-1',
  day_et: '2026-10-17',
  items: Array.from({ length: 10 }, (_, i) => ({ id: `it${i}` })),
  answered_item_ids: [],
  finished_at: null,
  profile: { xp: 0, streak: 0, last_done_day: null, daily_goal: 50 },
})

let fetchFn

beforeEach(() => {
  mockRole = 'admin'
  mockStudyEnabled = undefined
  mockData = fixture()
  mockPaths = pathsFixture()
  mockProgress = {}
  mockStudy = {}
  play.mockClear()
  fetchFn = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ id: 9, slug: 'new-course', kind: 'course' }) }))
  vi.stubGlobal('fetch', fetchFn)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function LocationProbe() {
  const loc = useLocation()
  return <pre data-testid="loc">{loc.search}</pre>
}

// The course card, not the panel's Up-next row (which also names the curriculum).
const courseCard = (re) =>
  screen.getAllByRole('button', { name: re }).find((b) => within(b).queryByText('COURSE'))

const renderSection = (entries) =>
  render(
    <MemoryRouter initialEntries={entries || ['/desk?section=courses']}>
      <CoursesSection />
      <LocationProbe />
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

test('TERM-091 dark: with the lessons route answering nothing, the section shows nothing new', () => {
  // the swr mock returns null for /api/education/lessons — what the 404 of a
  // disarmed EDU_CURRICULUM_ENABLED looks like to the fetcher
  renderSection()
  expect(screen.getByRole('heading', { name: 'Courses' })).toBeTruthy()
  expect(screen.queryByText(/Lesson notes/)).toBeNull()
  expect(screen.queryByTestId('curriculum-census')).toBeNull()
})

/* ── Study (D2/D3, T13/T14) ───────────────────────────────────────────────── */

test('T13: the Study panel mounts above the cards and renders its skeleton while /api/study/* answers null', () => {
  renderSection()
  const panel = screen.getByLabelText('Study')
  expect(panel.getAttribute('aria-busy')).toBe('true')
  expect(within(panel).getByText('STUDY')).toBeTruthy()
  const card = courseCard(/UCT Foundations/)
  // the panel precedes the first course card in document order
  expect(panel.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  // with no map, the card is still the plain course card (no door meta)
  expect(within(card).getByText(/1 lesson · 1 to record/)).toBeTruthy()
})

test('D2: with the map in, the Foundations card is a curriculum door and opens the trail via ?study=map', () => {
  mockStudy = { '/api/study/map': studyMapFixture(), '/api/study/today': studyTodayFixture() }
  renderSection()
  const card = courseCard(/UCT Foundations/)
  expect(within(card).getByText('1 track · 2 units · 1 recorded lesson')).toBeTruthy()
  expect(within(card).getByText('1 of 2 mastered')).toBeTruthy()
  expect(within(card).queryByText(/to record/)).toBeNull()

  fireEvent.click(card)
  expect(screen.getByTestId('loc').textContent).toContain('study=map')
  expect(screen.getByTestId('loc').textContent).toContain('curriculum=foundations')
  // the trail, not the syllabus
  expect(screen.getByRole('heading', { level: 2, name: 'UCT Foundations' })).toBeTruthy()
  expect(screen.getByRole('button', { name: /Back to courses/ })).toBeTruthy()
  expect(screen.getByText('Volume tells')).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Play Welcome to the Desk' })).toBeNull()
  expect(screen.queryByLabelText('Study')).toBeNull() // the panel leaves with the grid

  // the recorded lessons stay one tap away: the trail's door opens the syllabus
  fireEvent.click(screen.getByRole('button', { name: '1 recorded lesson' }))
  expect(screen.getByTestId('loc').textContent).toContain('path=uct-foundations')
  expect(screen.getByRole('button', { name: 'Play Welcome to the Desk' })).toBeTruthy()

  // and Back from the trail returns to the grid with the panel
  renderSection(['/desk?section=courses&study=map&curriculum=foundations'])
  fireEvent.click(screen.getAllByRole('button', { name: /Back to courses/ })[0])
  expect(screen.getAllByLabelText('Study').length).toBeGreaterThan(0)
})

test('D4: ?study=unit&unit=<id> opens that unit\'s sheet on the trail', () => {
  mockStudy = { '/api/study/map': studyMapFixture() }
  renderSection(['/desk?section=courses&study=unit&unit=F1.02'])
  expect(screen.getByRole('heading', { level: 2, name: 'UCT Foundations' })).toBeTruthy()
  // the Sheet mock renders inline: the unit sheet carries the rung grid and ONE start
  expect(screen.getByRole('list', { name: '1 of 9 rungs' })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Start rung 2' })).toBeTruthy()
})

test('the panel\'s buttons write ?study=today&session=<id> and ?study=practise; Up next writes ?study=unit', () => {
  mockStudy = { '/api/study/map': studyMapFixture(), '/api/study/today': studyTodayFixture() }
  renderSection()
  fireEvent.click(screen.getByRole('button', { name: "Start today's Study" }))
  expect(screen.getByTestId('loc').textContent).toContain('study=today')
  expect(screen.getByTestId('loc').textContent).toContain('session=sess-1')

  renderSection()
  fireEvent.click(screen.getAllByRole('button', { name: /Up next on the trail/ })[0])
  const locs = screen.getAllByTestId('loc').map((el) => el.textContent)
  expect(locs.some((l) => l.includes('study=unit') && l.includes('unit=F1.02'))).toBe(true)

  mockStudy['/api/study/today'] = {
    ...studyTodayFixture(),
    answered_item_ids: Array.from({ length: 10 }, (_, i) => `it${i}`),
    finished_at: '2026-10-17T13:00:00Z',
    profile: { xp: 80, streak: 1, last_done_day: '2026-10-17', daily_goal: 50 },
  }
  renderSection()
  fireEvent.click(screen.getByRole('button', { name: 'Practise' }))
  expect(screen.getAllByTestId('loc').some((el) => el.textContent.includes('study=practise'))).toBe(true)
})

test('integration: ?study=today mounts the drill on that session and ?study=practise mounts the sheet, whose set opens the drill', () => {
  mockStudy = { '/api/study/map': studyMapFixture(), '/api/study/today': studyTodayFixture() }
  renderSection(['/desk?section=courses&study=today&session=sess-1'])
  expect(screen.getByTestId('drill-player').textContent).toBe('drill:sess-1:fresh')
  expect(screen.queryByTestId('practise-sheet')).toBeNull()

  renderSection(['/desk?section=courses&study=practise'])
  expect(screen.getByTestId('practise-sheet')).toBeTruthy()
  fireEvent.click(screen.getByTestId('practise-sheet'))
  // the handed-over set opens the drill on its own session id, without a fetch
  expect(screen.getAllByTestId('drill-player').some((el) => el.textContent === 'drill:sess-p:handed')).toBe(true)
  expect(screen.getAllByTestId('loc').some((el) => el.textContent.includes('session=sess-p'))).toBe(true)
})

test('D2/T14: the flat CurriculumLessons list is retired from the page while Study is on', () => {
  renderSection()
  expect(screen.getByLabelText('Study')).toBeTruthy()
  expect(screen.queryByTestId('curriculum-lessons')).toBeNull()
})

test('kill switch: study_enabled=false hides the panel, cards open the syllabus, and the flat list is back', () => {
  mockStudyEnabled = false
  mockStudy = { '/api/study/map': studyMapFixture(), '/api/study/today': studyTodayFixture() }
  renderSection()
  expect(screen.queryByLabelText('Study')).toBeNull()
  expect(screen.getByTestId('curriculum-lessons')).toBeTruthy()
  const card = courseCard(/UCT Foundations/)
  expect(within(card).getByText(/1 lesson · 1 to record/)).toBeTruthy()
  fireEvent.click(card)
  expect(screen.getByRole('button', { name: 'Play Welcome to the Desk' })).toBeTruthy()
  // a stale ?study=map link is ignored under the kill switch
  renderSection(['/desk?section=courses&study=map&curriculum=foundations'])
  expect(screen.queryByRole('button', { name: /Back to courses/ })).toBeNull()
})

test('owner 2026-10-21: an admin gets "Feedback on this screen" on the landing and the trail; a member never does', () => {
  mockStudy = { '/api/study/map': studyMapFixture(), '/api/study/today': studyTodayFixture() }
  renderSection()
  expect(screen.getByTestId('screen-feedback').dataset.screen).toBe('landing')
  fireEvent.click(courseCard(/UCT Foundations/))
  const door = screen.getByTestId('screen-feedback')
  expect(door.dataset.screen).toBe('trail')
  fireEvent.click(within(door).getByTestId('screen-feedback-open'))
  expect(screen.getByTestId('screen-feedback-form')).toHaveTextContent('Skill trail')

  mockRole = null
  renderSection(['/desk?section=courses&study=map&curriculum=foundations'])
  renderSection()
  expect(screen.getAllByTestId('screen-feedback')).toHaveLength(1)        // only the admin render above
})
