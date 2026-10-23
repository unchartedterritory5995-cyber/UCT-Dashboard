// shouldRetryStudy must CALL the app-wide retry rule, not restate it: a change
// to lib/swrRetry.js has to reach Study. The app-wide function is replaced
// here with one that answers differently from the real rule (408 NOT retried,
// 404 retried); Study must follow it for everything except its own 429.
import { vi, test, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const appWide = vi.fn((err) => !(err && (err.status === 408 || err.status === 429)))
vi.mock('../../lib/swrRetry', () => ({ shouldRetryOnErrorAppWide: (err) => appWide(err) }))

import { shouldRetryStudy } from './useStudy'

const httpError = (status) => Object.assign(new Error(`HTTP ${status}`), { status })

test('the 408 and 404 answers come from the shared app-wide function', () => {
  expect(shouldRetryStudy(httpError(408))).toBe(false)
  expect(shouldRetryStudy(httpError(404))).toBe(true)
  expect(appWide).toHaveBeenCalled()
})

test('Study keeps its one addition whatever the shared rule says: no retry on a 429', () => {
  appWide.mockReturnValueOnce(true)
  expect(shouldRetryStudy(httpError(429))).toBe(false)
})

test('App.jsx uses the same shared function as its SWR_CONFIG rule', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '../../App.jsx'), 'utf8')
  expect(src).toMatch(/import \{ shouldRetryOnErrorAppWide \} from '\.\/lib\/swrRetry'/)
  expect(src).toMatch(/shouldRetryOnError: shouldRetryOnErrorAppWide,/)
})
