// Study trail (D4): collapsed tracks with only the current one open, the
// recommended node marked (one, and only one), the node sheet's contents,
// test-out present ONLY inside the sheet, the Jump-to sheet, and the
// skeleton on null. Rendered text, never state.
import { render, screen, fireEvent, within } from '@testing-library/react'
import { vi, beforeEach, test, expect } from 'vitest'

let mockMap = null
vi.mock('swr', () => ({
  default: (key) => ({
    data: key === '/api/study/map' ? mockMap : null,
    error: null,
    isLoading: false,
    mutate: vi.fn(),
  }),
}))

import SkillTrail from './SkillTrail'

const mapFixture = () => ({
  map: {
    curricula: [
      { id: 'foundations', title: 'UCT Foundations', tracks: [{ id: 'F1', title: 'Market basics', units: [] }] },
      {
        id: 'method',
        title: 'The UCT Method',
        tracks: [
          {
            id: 'REG',
            title: 'Regime',
            units: [
              { id: 'REG.01', title: 'The loop', skills: ['regime.loop'] },
              { id: 'REG.02', title: 'Read the dial', skills: ['regime.dial'] },
            ],
          },
          {
            id: 'SCN',
            title: 'Scan',
            units: [
              { id: 'SCN.01', title: 'Percent above the 50-day', skills: ['scan.breadth_pct'] },
              { id: 'SCN.02', title: 'Net new highs', skills: ['scan.new_highs'] },
            ],
          },
          { id: 'SIZ', title: 'Size', units: [] },
        ],
      },
    ],
  },
  skills: [
    { skill_id: 'regime.loop', mastery: 85, reps: 12, band: 'proficient' },
    { skill_id: 'regime.dial', mastery: 30, reps: 2, band: 'learning' },
  ],
})

beforeEach(() => { mockMap = mapFixture() })

const renderTrail = (props = {}) => render(<SkillTrail curriculumId="method" onBack={() => {}} {...props} />)

test('only the current track is open on arrival; a collapsed seam opens on tap', () => {
  renderTrail()
  expect(screen.getByRole('heading', { level: 2, name: 'The UCT Method' })).toBeTruthy()
  const regime = screen.getByRole('button', { name: /^Regime/ })
  const scan = screen.getByRole('button', { name: /^Scan/ })
  expect(regime.getAttribute('aria-expanded')).toBe('true')
  expect(scan.getAttribute('aria-expanded')).toBe('false')
  expect(screen.getByText('Read the dial')).toBeTruthy()
  expect(screen.queryByText('Percent above the 50-day')).toBeNull()
  // the seam pills: 1 of 2 Regime units mastered, 0 of 2 Scan
  expect(within(regime).getByText('1/2')).toBeTruthy()
  expect(within(scan).getByText('0/2')).toBeTruthy()
  fireEvent.click(scan)
  expect(scan.getAttribute('aria-expanded')).toBe('true')
  expect(screen.getByText('Percent above the 50-day')).toBeTruthy()
  // the sticky bar names the track in view
  expect(screen.getByText('Scan', { selector: '[class*="barLabel"]' })).toBeTruthy()
})

test('the recommended node is the started-but-unmastered unit, and it is the only one marked', () => {
  renderTrail()
  const rec = screen.getByRole('button', { name: 'Read the dial, 3 of 9 rungs, recommended' })
  expect(rec.hasAttribute('data-recommended')).toBe(true)
  expect(document.querySelectorAll('[data-recommended]')).toHaveLength(1)
  // the mastered node shows all nine rungs and is not recommended
  const done = screen.getByRole('button', { name: 'The loop, 9 of 9 rungs' })
  expect(done.hasAttribute('data-recommended')).toBe(false)
})

test('test-out lives in the node sheet and nowhere on the trail; the sheet carries the 3x3 grid and ONE gold start', () => {
  const onStartUnit = vi.fn()
  const onTestOut = vi.fn()
  const onReplayIntro = vi.fn()
  renderTrail({ onStartUnit, onTestOut, onReplayIntro })
  expect(screen.queryByRole('button', { name: /Test out/ })).toBeNull()
  expect(screen.queryByRole('button', { name: /Start rung/ })).toBeNull()

  fireEvent.click(screen.getByRole('button', { name: 'Read the dial, 3 of 9 rungs, recommended' }))
  const sheet = screen.getByRole('dialog', { name: 'Read the dial' })
  expect(within(sheet).getByText('Regime')).toBeTruthy() // the station eyebrow
  const grid = within(sheet).getByRole('list', { name: '3 of 9 rungs' })
  expect(within(grid).getAllByRole('listitem')).toHaveLength(9)
  expect(within(grid).getByLabelText('Rung 3, done')).toBeTruthy()
  expect(within(grid).getByLabelText('Rung 4, next').getAttribute('aria-current')).toBe('step')
  expect(within(grid).getByLabelText('Rung 9')).toBeTruthy()

  fireEvent.click(within(sheet).getByRole('button', { name: 'Start rung 4' }))
  expect(onStartUnit).toHaveBeenCalledWith('REG.02', 4)
  fireEvent.click(within(sheet).getByRole('button', { name: /Replay intro/ }))
  expect(onReplayIntro).toHaveBeenCalledWith('REG.02')
  fireEvent.click(within(sheet).getByRole('button', { name: /Test out/ }))
  expect(onTestOut).toHaveBeenCalledWith('REG.02')
  // one gold start, the rest ghosts
  expect(within(sheet).getAllByRole('button', { name: /^(Start rung \d|Practise again)$/ })).toHaveLength(1)
})

test('a mastered unit\'s sheet offers "Practise again" and no test-out', () => {
  renderTrail()
  fireEvent.click(screen.getByRole('button', { name: 'The loop, 9 of 9 rungs' }))
  const sheet = screen.getByRole('dialog', { name: 'The loop' })
  expect(within(sheet).getByRole('button', { name: 'Practise again' })).toBeTruthy()
  expect(within(sheet).queryByRole('button', { name: /Test out/ })).toBeNull()
  expect(within(sheet).getByRole('list', { name: '9 of 9 rungs' })).toBeTruthy()
})

test('deep link ?unit= opens that unit\'s sheet on arrival with its track open', () => {
  renderTrail({ initialUnitId: 'SCN.02' })
  expect(screen.getByRole('dialog', { name: 'Net new highs' })).toBeTruthy()
  expect(screen.getByRole('button', { name: /^Scan/ }).getAttribute('aria-expanded')).toBe('true')
})

test('Jump to: a bottom sheet of tracks with a progress pill each; a row opens that track', () => {
  renderTrail()
  fireEvent.click(screen.getByRole('button', { name: /Jump to/ }))
  const sheet = screen.getByRole('dialog', { name: 'Jump to' })
  const rows = within(sheet).getAllByRole('button').filter((b) => !/Close/.test(b.getAttribute('aria-label') || ''))
  expect(rows.map((r) => r.textContent)).toEqual(['Regime1/2', 'Scan0/2', 'Size0/0'])
  fireEvent.click(within(sheet).getByRole('button', { name: /^Scan/ }))
  expect(screen.queryByRole('dialog', { name: 'Jump to' })).toBeNull()
  expect(screen.getByRole('button', { name: /^Scan/ }).getAttribute('aria-expanded')).toBe('true')
  expect(screen.getByText('Net new highs')).toBeTruthy()
})

test('an empty track says so instead of promising anything; the recorded-lessons door shows when offered', () => {
  const onOpenLessons = vi.fn()
  renderTrail({ recordedLessons: 4, onOpenLessons })
  fireEvent.click(screen.getByRole('button', { name: /^Size/ }))
  expect(screen.getByText('No units on this track yet.')).toBeTruthy()
  expect(screen.queryByText(/coming soon/i)).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '4 recorded lessons' }))
  expect(onOpenLessons).toHaveBeenCalledTimes(1)
})

test('skeleton on null map; Back is wired', () => {
  mockMap = null
  const onBack = vi.fn()
  const { unmount } = renderTrail({ onBack })
  expect(screen.getByLabelText('Study trail').getAttribute('aria-busy')).toBe('true')
  expect(screen.queryByText('The UCT Method')).toBeNull()
  unmount()
  mockMap = mapFixture()
  renderTrail({ onBack })
  fireEvent.click(screen.getByRole('button', { name: /Back to courses/ }))
  expect(onBack).toHaveBeenCalledTimes(1)
})
