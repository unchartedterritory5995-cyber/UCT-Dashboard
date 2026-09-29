// TERM-091 — curriculum text lessons on the Courses section.
// Asserts RENDERED TEXT, never state: an attribution that is computed and
// stored but not on screen is the CLM-15 failure this exists to prevent.
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react'
import { vi, beforeEach, afterEach, test, expect } from 'vitest'
import { SWRConfig } from 'swr'
import CurriculumLessons from './CurriculumLessons'

const ATTR =
  "Draws on third-party frameworks: Qullamaggie (Kristjan Kullamägi) — episodic pivot, EP. " +
  'Re-organised public material; the underlying framework belongs to its author, not UCT.'

const payload = () => ({
  lessons: [
    {
      lesson_key: 'uct-method:flagship-episodic-pivot',
      kind: 'lesson',
      course: 'The UCT Method',
      module_label: 'M9 · Setup Family III',
      title: 'FLAGSHIP — Episodic Pivot: Day One of a New Trend',
      note: 'The gap that starts a trend.',
      minutes: 22,
      attribution: ATTR,
      attribution_detail: [{ framework: 'Qullamaggie (Kristjan Kullamägi)', basis: 'named_in_source', terms: ['episodic pivot', 'EP'] }],
      verdicts: { verified: 1, corrected: 2, replaced: 0, no_data_needed: 0 },
    },
    {
      lesson_key: 'uct-method:casino-math',
      kind: 'lesson',
      course: 'The UCT Method',
      module_label: 'M1 · The Game and the Loop',
      title: 'Casino Math: Why a 45% Win Rate at 2R Prints Money',
      note: 'Expectancy.',
      minutes: 12,
      attribution: '',
      attribution_detail: [],
      verdicts: { verified: 0, corrected: 1, replaced: 0, no_data_needed: 0 },
    },
    {
      lesson_key: 'uct-method-toolkit:loop-card',
      kind: 'artifact',
      course: 'The UCT Method',
      module_label: 'Toolkit',
      title: 'THE LOOP CARD',
      note: 'Six stations.',
      minutes: null,
      attribution: '',
      attribution_detail: [],
      verdicts: null,
    },
  ],
  census: { verified: 29, corrected: 138, replaced: 9, no_data_needed: 5, total: 181 },
  counts: { lessons: 2, artifacts: 1 },
})

const detail = {
  lesson_key: 'uct-method:flagship-episodic-pivot',
  kind: 'lesson',
  chapters: [
    { marker: 'The gap and the base', spec_verdict: 'corrected' },
    { marker: 'Why day one', spec_verdict: null },
  ],
}

let fetchFn
let listResponse

beforeEach(() => {
  listResponse = { ok: true, json: () => Promise.resolve(payload()) }
  fetchFn = vi.fn((url) => {
    if (String(url) === '/api/education/lessons') return Promise.resolve(listResponse)
    return Promise.resolve({ ok: true, json: () => Promise.resolve(detail) })
  })
  vi.stubGlobal('fetch', fetchFn)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const renderIt = () =>
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <CurriculumLessons />
    </SWRConfig>,
  )

test('flag off: the route 404s and NOTHING renders', async () => {
  listResponse = { ok: false, status: 404, json: () => Promise.resolve({ detail: 'Not Found' }) }
  const { container } = renderIt()
  await waitFor(() => expect(fetchFn).toHaveBeenCalledWith('/api/education/lessons', { credentials: 'include' }))
  await new Promise((r) => setTimeout(r, 0))
  expect(container.textContent).toBe('')
  expect(screen.queryByText(/Lesson notes/)).toBeNull()
})

test('an attributed lesson renders its attribution text; an unattributed one renders none', async () => {
  renderIt()
  const title = await screen.findByText(/FLAGSHIP — Episodic Pivot/)
  const item = title.closest('li')
  expect(within(item).getByText(ATTR)).toBeTruthy()
  const plain = screen.getByText(/Casino Math/).closest('li')
  expect(within(plain).queryByTestId('lesson-attribution')).toBeNull()
  expect(screen.getAllByTestId('lesson-attribution')).toHaveLength(1)
  // never an originality claim
  expect(document.body.textContent.toLowerCase()).not.toContain('original')
})

test('the spec_verdict census renders as text', async () => {
  renderIt()
  const census = await screen.findByTestId('curriculum-census')
  expect(census.textContent).toBe(
    '181 chart examples checked against real price history: 29 verified · 138 corrected · 9 replaced · 5 needed no data',
  )
  expect(screen.getByText(/Lesson notes — The UCT Method/)).toBeTruthy()
  expect(screen.getByText('Printable toolkit')).toBeTruthy()
})

test('opening a lesson fetches it (a counted view) and renders each chapter verdict', async () => {
  renderIt()
  const summary = await screen.findByText(/FLAGSHIP — Episodic Pivot/)
  const details = summary.closest('details')
  details.open = true
  fireEvent(details, new Event('toggle'))
  expect(await screen.findByText(/example corrected against real bars/)).toBeTruthy()
  expect(fetchFn).toHaveBeenCalledWith(
    '/api/education/lessons/uct-method%3Aflagship-episodic-pivot',
    { credentials: 'include' },
  )
})
