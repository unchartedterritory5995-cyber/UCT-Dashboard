// Terminal quality pass 2026-10-05 -- OBT's start POST.
//   * it had no timeout: a hung pod left the panel with nothing said and nothing to do;
//   * a busy 429 said "Try again in a minute" and nothing asked again.
// Asserted on rendered text.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { SWRConfig } from 'swr'
import FX from './backtestFixtures.json'

// The deadline itself is utils/withDeadline.js's own subject; here the POST's deadline is made to
// fire at once, so the test proves the POST goes THROUGH it and what the member then reads.
let hangPost = false
vi.mock('../../../utils/withDeadline', async (importOriginal) => {
  const real = await importOriginal()
  return {
    ...real,
    withDeadline: (p, url, ms) => (hangPost && String(url).endsWith('/backtest')
      ? Promise.reject(Object.assign(new Error('Timed out after 30s'), { timedOut: true }))
      : real.withDeadline(p, url, ms)),
  }
})

import BacktestPanel from './BacktestPanel'

let posts
let busyAnswers
beforeEach(() => {
  hangPost = false
  posts = 0
  busyAnswers = 0
  global.fetch = vi.fn((url, init) => {
    const u = String(url)
    const json = (status, body, headers = {}) => Promise.resolve({
      ok: status < 400, status, headers: { get: (k) => headers[k] ?? null }, json: () => Promise.resolve(body),
    })
    if (u.endsWith('/backtest') && init?.method === 'POST') {
      posts += 1
      if (posts <= busyAnswers) {
        return json(429, { detail: 'The backtester is busy. Try again in a minute.' }, { 'Retry-After': '60' })
      }
      return json(202, { job: 'j1', state: 'queued', budget_text: '' })
    }
    if (u.includes('/backtest/j1')) return json(200, { job: 'j1', state: 'done', result: FX.full })
    return json(404, {})
  })
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

const wrap = (ui) => render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{ui}</SWRConfig>)

describe('BacktestPanel start', () => {
  it('a start that never answers ends in a sentence, and Simulate is usable again', async () => {
    hangPost = true
    wrap(<BacktestPanel sym="SPY" />)
    fireEvent.click(screen.getByTestId('backtest-simulate'))
    expect((await screen.findByTestId('backtest-error')).textContent)
      .toBe('The backtest could not start: the server did not answer within 30 seconds.')
    expect(screen.getByTestId('backtest-simulate')).not.toBeDisabled()
  })

  it('a busy 429 says it will ask again, and does -- the run starts with no click', async () => {
    busyAnswers = 1
    wrap(<BacktestPanel sym="SPY" />)
    fireEvent.click(screen.getByTestId('backtest-simulate'))
    expect((await screen.findByTestId('backtest-busy')).textContent)
      .toBe('The backtester is busy right now. This asks again by itself every 10 seconds.')
    expect(screen.queryByText(/Try again in a minute/)).toBeNull()
    expect(await screen.findByTestId('backtest-result', {}, { timeout: 15000 })).toBeTruthy()
    expect(posts).toBe(2)
    expect(screen.queryByTestId('backtest-busy')).toBeNull()
  }, 30000)
})
