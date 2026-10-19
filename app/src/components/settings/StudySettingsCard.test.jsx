// Settings → Study (D14 / §1.10): silent default goal of 50, each control
// writes ONE key to PUT /api/study/profile, sound/haptics is a device
// preference (localStorage, never a setPref key), the kill switch hides the
// card, and every outcome is RENDERED TEXT.
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { vi, beforeEach, afterEach, test, expect } from 'vitest'

let mockProfile = undefined
const mutate = vi.fn()
vi.mock('swr', () => ({
  default: (key) => ({
    data: key === '/api/study/profile' ? mockProfile : null,
    error: null,
    isLoading: false,
    mutate,
  }),
}))

let mockStudyEnabled = undefined
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { role: 'pro-user' }, studyEnabled: mockStudyEnabled }),
}))

import StudySettingsCard, { SOUND_KEY } from './StudySettingsCard'

const profileFixture = (over = {}) => ({
  profile: {
    xp: 120, level: 1, streak: 2, daily_goal: 50, reminder_time: null, reminder_on: false,
    leaderboard_optout: false, journal_autopsy_optin: false, display_name: null, ...over,
  },
  badges: [],
})

let fetchFn
beforeEach(() => {
  mockStudyEnabled = undefined
  mockProfile = profileFixture()
  mutate.mockClear()
  localStorage.removeItem(SOUND_KEY)
  fetchFn = vi.fn((url, opts) => Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ profile: { ...mockProfile.profile, ...JSON.parse(opts?.body || '{}') } }),
  }))
  vi.stubGlobal('fetch', fetchFn)
})
afterEach(() => { vi.unstubAllGlobals() })

const puts = () => fetchFn.mock.calls
  .filter(([url, o]) => url === '/api/study/profile' && o?.method === 'PUT')
  .map(([, o]) => JSON.parse(o.body))

test('renders the five controls with the silent default goal of 50 when the profile carries none', () => {
  mockProfile = profileFixture({ daily_goal: undefined })
  render(<StudySettingsCard />)
  expect(screen.getByRole('region', { name: 'Study' })).toBeTruthy()
  expect(screen.getByLabelText('Daily goal').value).toBe('50')
  expect(screen.getByLabelText('Daily reminder').checked).toBe(false)
  expect(screen.getByLabelText('Reminder time').disabled).toBe(true)
  expect(screen.getByLabelText('Sound and haptics')).toBeTruthy()
  expect(screen.getByLabelText('Hide me on the weekly board').checked).toBe(false)
  expect(screen.getByLabelText('Use my journal in Study').checked).toBe(false)
  // D14: the reminder copy, verbatim, and nothing else
  expect(screen.getByText(/Today's Study is ready — 10 questions, about 4 minutes\./)).toBeTruthy()
})

test('changing the goal PUTs only daily_goal and says "Saved."', async () => {
  render(<StudySettingsCard />)
  fireEvent.change(screen.getByLabelText('Daily goal'), { target: { value: '100' } })
  await waitFor(() => expect(screen.getByText('Saved.')).toBeTruthy())
  expect(puts()).toEqual([{ daily_goal: 100 }])
  expect(mutate).toHaveBeenCalled()
})

test('the reminder switch writes reminder_on with the 7:00 AM default time; the time then edits alone', async () => {
  const first = render(<StudySettingsCard />)
  fireEvent.click(screen.getByLabelText('Daily reminder'))
  await waitFor(() => expect(screen.getByText('Saved.')).toBeTruthy())
  expect(puts()).toEqual([{ reminder_on: true, reminder_time: '07:00' }])
  first.unmount() // the controls carry ids; one instance at a time

  mockProfile = profileFixture({ reminder_on: true, reminder_time: '07:00' })
  render(<StudySettingsCard />)
  const time = screen.getByLabelText('Reminder time')
  expect(time.disabled).toBe(false)
  fireEvent.change(time, { target: { value: '18:30' } })
  await waitFor(() => expect(puts().at(-1)).toEqual({ reminder_time: '18:30' }))
})

test('Hide me and the journal opt-in each write their one key', async () => {
  render(<StudySettingsCard />)
  fireEvent.click(screen.getByLabelText('Hide me on the weekly board'))
  await waitFor(() => expect(puts()).toEqual([{ leaderboard_optout: true }]))
  fireEvent.click(screen.getByLabelText('Use my journal in Study'))
  await waitFor(() => expect(puts().at(-1)).toEqual({ journal_autopsy_optin: true }))
})

test('sound/haptics is a device preference: localStorage, no PUT, no preference key', () => {
  render(<StudySettingsCard />)
  const sound = screen.getByLabelText('Sound and haptics')
  expect(sound.checked).toBe(true) // jsdom is not iOS → on by default (D11)
  fireEvent.click(sound)
  expect(localStorage.getItem(SOUND_KEY)).toBe('0')
  expect(puts()).toEqual([])
  expect(fetchFn.mock.calls.some(([u]) => String(u).includes('/api/auth/preferences'))).toBe(false)
  expect(screen.getByText('Saved.')).toBeTruthy()
})

test('a failed save says so in words', async () => {
  fetchFn.mockImplementation(() => Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) }))
  render(<StudySettingsCard />)
  fireEvent.click(screen.getByLabelText('Hide me on the weekly board'))
  await waitFor(() => expect(screen.getByText('Could not save — try again.')).toBeTruthy())
})

test('null profile (route dark) shows the not-available line; the kill switch hides the card entirely', () => {
  mockProfile = null
  const dark = render(<StudySettingsCard />)
  expect(screen.getByText('Study is not available on this account yet.')).toBeTruthy()
  expect(screen.queryByLabelText('Daily goal')).toBeNull()
  dark.unmount()

  mockStudyEnabled = false
  mockProfile = profileFixture()
  const { container } = render(<StudySettingsCard />)
  expect(container.querySelectorAll('h2, h3, select, input')).toHaveLength(0)
})
