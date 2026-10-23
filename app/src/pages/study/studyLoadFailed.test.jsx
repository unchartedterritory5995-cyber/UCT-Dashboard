// Study surfaces must SAY when a read failed. The fetcher used to resolve any
// non-OK answer to null, so a 429 from the rate limit (or a 5xx) left the
// panel on its loading skeleton forever and the Settings card claiming
// "Study is not available on this account yet." Only a 404 (STUDY_ENABLED
// off) means "nothing here". Asserted by rendered text.
import { render, screen, fireEvent } from '@testing-library/react'
import { vi, beforeEach, afterEach, test, expect, describe } from 'vitest'

let mockError = null
let mockData
const mutate = vi.fn()
vi.mock('swr', () => ({
  default: () => ({ data: mockData, error: mockError, isLoading: false, mutate }),
}))
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { role: 'pro-user' }, studyEnabled: true }),
}))

import { fetcher, shouldRetryStudy } from './useStudy'
import StudyPanel from './StudyPanel'
import SkillTrail from './SkillTrail'
import StudySettingsCard from '../../components/settings/StudySettingsCard'

const httpError = (status) => Object.assign(new Error(`HTTP ${status}`), { status })

beforeEach(() => {
  mockError = null
  mockData = undefined
  mutate.mockClear()
})

describe('the Study fetcher', () => {
  const realFetch = globalThis.fetch
  afterEach(() => { globalThis.fetch = realFetch })
  const answer = (status, body = {}) => {
    globalThis.fetch = vi.fn(() => Promise.resolve({ ok: status < 400, status, json: async () => body }))
  }

  test('a 404 (Study off) resolves to null', async () => {
    answer(404)
    await expect(fetcher('/api/study/today')).resolves.toBeNull()
  })

  test('a 402 (no paid plan) resolves to null, like Study off', async () => {
    answer(402)
    await expect(fetcher('/api/study/profile')).resolves.toBeNull()
  })

  test('a 429 throws, carrying the status', async () => {
    answer(429)
    await expect(fetcher('/api/study/today')).rejects.toMatchObject({ status: 429 })
  })

  test('a 500 throws too', async () => {
    answer(500)
    await expect(fetcher('/api/study/today')).rejects.toMatchObject({ status: 500 })
  })

  test('a 200 is the body', async () => {
    answer(200, { session_id: 's1' })
    await expect(fetcher('/api/study/today')).resolves.toEqual({ session_id: 's1' })
  })
})

describe('the Study retry rule', () => {
  // The app-wide rule (no retry on a 4xx except 408) plus ONE addition: no retry on a 429.
  test.each([400, 401, 402, 403, 404, 429])('a %s is not retried', (status) => {
    expect(shouldRetryStudy(httpError(status))).toBe(false)
  })
  test.each([408, 500, 502, 503])('a %s is retried', (status) => {
    expect(shouldRetryStudy(httpError(status))).toBe(true)
  })
  test('a failure with no status (the network) is retried', () => {
    expect(shouldRetryStudy(new TypeError('Failed to fetch'))).toBe(true)
  })
})

describe('StudyPanel', () => {
  test('a failed read says so, offers Try again, and is not the skeleton', () => {
    mockError = httpError(429)
    render(<StudyPanel />)
    expect(screen.getByText("Couldn't load today's Study.")).toBeInTheDocument()
    expect(document.querySelector('[aria-busy="true"]')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(mutate).toHaveBeenCalled()
  })

  test('THE CONTROL: still loading is the skeleton, with no failure sentence', () => {
    render(<StudyPanel />)
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull()
    expect(screen.queryByText(/Couldn't load/)).toBeNull()
  })
})

describe('SkillTrail', () => {
  test('a failed read says so, with Try again and the way back', () => {
    mockError = httpError(503)
    const onBack = vi.fn()
    render(<SkillTrail curriculumId="method" onBack={onBack} />)
    expect(screen.getByText("Couldn't load the Study trail.")).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(mutate).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /Back to courses/ }))
    expect(onBack).toHaveBeenCalled()
  })
})

describe('StudySettingsCard', () => {
  test('a failed read says so instead of "Loading" or "not available"', () => {
    mockError = httpError(429)
    render(<StudySettingsCard />)
    expect(screen.getByText("Couldn't load your Study settings.")).toBeInTheDocument()
    expect(screen.queryByText(/Loading your Study settings/)).toBeNull()
    expect(screen.queryByText(/not available on this account/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(mutate).toHaveBeenCalled()
  })

  test('THE CONTROL: Study off (null) still reads "not available"', () => {
    mockData = null
    render(<StudySettingsCard />)
    expect(screen.getByText(/not available on this account/)).toBeInTheDocument()
    expect(screen.queryByText(/Couldn't load/)).toBeNull()
  })
})
