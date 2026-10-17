// Study panel (D3/D16/D18) — asserted by RENDERED TEXT, never state: the
// zero-state copy, the resume copy, the done copy, ONE primary button, the
// Up-next row off the map, the rank line, and the skeleton on null (T13).
import { render, screen, fireEvent, within } from '@testing-library/react'
import { vi, beforeEach, test, expect } from 'vitest'

let mockToday = null
let mockMap = null
let mockBoard = null
vi.mock('swr', () => ({
  default: (key) => ({
    data: key === '/api/study/today' ? mockToday
      : key === '/api/study/map' ? mockMap
        : key === '/api/study/leaderboard' ? mockBoard
          : null,
    error: null,
    isLoading: false,
    mutate: vi.fn(),
  }),
}))

import StudyPanel from './StudyPanel'

const items = (n) => Array.from({ length: n }, (_, i) => ({ id: `it${i}`, type: 'recall', has_chart: false }))

const todayFixture = (over = {}, profile = {}) => ({
  session_id: 'sess-1',
  kind: 'daily',
  day_et: '2026-10-17', // a Saturday
  items: items(10),
  answered_item_ids: [],
  finished_at: null,
  profile: { xp: 0, level: 1, streak: 0, streak_best: 0, last_done_day: null, daily_goal: 50, ...profile },
  ...over,
})

const mapFixture = () => ({
  map: {
    curricula: [
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
        ],
      },
    ],
  },
  skills: [
    { skill_id: 'regime.loop', mastery: 85, reps: 12, band: 'proficient' },
    { skill_id: 'regime.dial', mastery: 30, reps: 2, band: 'learning' },
  ],
})

beforeEach(() => {
  mockToday = todayFixture()
  mockMap = null
  mockBoard = null
})

const primaryLabels = /^(Start today's Study|Start|Continue|Practise)$/

test('zero state (D16): the first-run copy, "Start today\'s Study", no streak, and the board invite', () => {
  render(<StudyPanel />)
  expect(screen.getByText('STUDY')).toBeTruthy()
  expect(screen.getByRole('heading', { name: "Today's Study" })).toBeTruthy()
  expect(screen.getByText('10 questions · about 4 min')).toBeTruthy()
  expect(screen.getByText('Ten quick questions, no setup. Your trail starts here.')).toBeTruthy()
  expect(screen.getByRole('button', { name: "Start today's Study" })).toBeTruthy()
  expect(screen.getByRole('img', { name: 'No streak yet' })).toBeTruthy()
  expect(screen.getByText("Finish a set to join this week's board")).toBeTruthy()
  expect(screen.getByText('0 XP')).toBeTruthy()
})

test('partly done (D18): "6 left · about 2 min", Continue fires onStart with the session id', () => {
  mockToday = todayFixture(
    { answered_item_ids: ['it0', 'it1', 'it2', 'it3'] },
    { streak: 3, last_done_day: '2026-10-16', xp: 120 },
  )
  const onStart = vi.fn()
  render(<StudyPanel onStart={onStart} />)
  expect(screen.getByText('6 left · about 2 min')).toBeTruthy()
  expect(screen.queryByText(/Your trail starts here/)).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
  expect(onStart).toHaveBeenCalledWith('sess-1')
  // streak chip: flame + count + the seven week-dots, named for a screen reader
  expect(screen.getByRole('img', { name: '3-day streak. This week: Wednesday, Thursday, Friday' })).toBeTruthy()
  expect(screen.getByText('3')).toBeTruthy()
  expect(screen.getByText('120 XP')).toBeTruthy()
})

test('done: the done line, Practise fires onPractise, and the rank line reads the board', () => {
  mockToday = todayFixture(
    { answered_item_ids: items(10).map((i) => i.id), finished_at: '2026-10-17T13:00:00Z' },
    { streak: 4, last_done_day: '2026-10-17', xp: 300 },
  )
  mockBoard = { week_et: '2026-10-12', rows: [], you: { rank: 12, xp: 180 } }
  const onPractise = vi.fn()
  render(<StudyPanel onPractise={onPractise} />)
  expect(screen.getByRole('heading', { name: "Today's Study is done" })).toBeTruthy()
  expect(screen.getByText('10 of 10 · streak kept')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Practise' }))
  expect(onPractise).toHaveBeenCalledTimes(1)
  expect(screen.getByText('12th this week')).toBeTruthy()
})

test('exactly ONE primary button in every state (simplicity rule §4.1)', () => {
  const states = [
    todayFixture(),
    todayFixture({ answered_item_ids: ['it0'] }, { streak: 1, last_done_day: '2026-10-17' }),
    todayFixture({ finished_at: '2026-10-17T13:00:00Z', answered_item_ids: items(10).map((i) => i.id) }, { xp: 50 }),
    todayFixture({}, { streak: 2, last_done_day: '2026-10-16', xp: 90 }),
  ]
  for (const today of states) {
    mockToday = today
    const { unmount } = render(<StudyPanel />)
    const primaries = screen.getAllByRole('button').filter((b) => primaryLabels.test(b.textContent.trim()))
    expect(primaries, `state: ${JSON.stringify(today.answered_item_ids.length)}/${today.finished_at}`).toHaveLength(1)
    unmount()
  }
})

test('the Up-next row names the recommended unit with a 24px ring and opens it', () => {
  mockMap = mapFixture()
  const onOpenUnit = vi.fn()
  render(<StudyPanel onOpenUnit={onOpenUnit} />)
  const row = screen.getByRole('button', { name: /Up next on the trail/ })
  expect(within(row).getByText('Read the dial')).toBeTruthy()
  expect(within(row).getByText('Regime · The UCT Method')).toBeTruthy()
  // mastery 30 of the 80 that masters a unit → 3 of 9 rungs lit
  expect(within(row).getByRole('img', { name: '3 of 9 rungs' })).toBeTruthy()
  fireEvent.click(row)
  expect(onOpenUnit).toHaveBeenCalledWith('REG.02', 'method')
})

test('XP bar: when the set reports XP today it fills against the daily goal', () => {
  mockToday = todayFixture({ xp_today: 20 }, { daily_goal: 50, xp: 400 })
  render(<StudyPanel />)
  const bar = screen.getByRole('progressbar', { name: 'XP today' })
  expect(bar.getAttribute('aria-valuenow')).toBe('20')
  expect(bar.getAttribute('aria-valuemax')).toBe('50')
  expect(screen.getByText('20 of 50 XP today')).toBeTruthy()
})

test('skeleton on null (T13): STUDY eyebrow, busy, and no button at all', () => {
  mockToday = null
  render(<StudyPanel />)
  const panel = screen.getByLabelText('Study')
  expect(panel.getAttribute('aria-busy')).toBe('true')
  expect(within(panel).getByText('STUDY')).toBeTruthy()
  expect(within(panel).queryByRole('button')).toBeNull()
  expect(within(panel).queryByText(/Today's Study/)).toBeNull()
})

test('no emoji anywhere in the rendered panel', () => {
  mockMap = mapFixture()
  mockToday = todayFixture({ answered_item_ids: ['it0'] }, { streak: 5, last_done_day: '2026-10-17', xp: 200 })
  const { container } = render(<StudyPanel />)
  expect(container.textContent).not.toMatch(/\p{Extended_Pictographic}/u)
})
