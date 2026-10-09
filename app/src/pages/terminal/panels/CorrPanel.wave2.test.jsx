// Audit wave 2 (lane A, CORR P2 #8/#10): an unknown ticker says "No price history for X", and the
// error carries a Retry that re-reads (re-running the same command keeps the panel and reads nothing).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import CorrPanel from './CorrPanel'
import { clearClosesCache } from './useCloses'
import { fakeBarsFetch, series, weekdays, wiggle } from './__fixtures__/compareFixtures'

const realFetch = globalThis.fetch
beforeEach(() => { clearClosesCache() })
afterEach(() => { globalThis.fetch = realFetch })
const dates = weekdays(120)

describe('CORR wave 2', () => {
  it('an unknown ticker reads "No price history for XYZQ", never "just now"', async () => {
    globalThis.fetch = vi.fn(fakeBarsFetch({ NVDA: series(dates, (i) => wiggle(i, 1)) }))
    render(<CorrPanel sym="NVDA" with0="XYZQ" />)
    const err = await screen.findByTestId('terminal-corr-error')
    expect(err.textContent).toContain('No price history for XYZQ: check the ticker.')
    expect(err.textContent).not.toContain('just now')
  })

  it('a transient failure has a Retry button that re-reads', async () => {
    const ok = fakeBarsFetch({ NVDA: series(dates, (i) => wiggle(i, 1)), AMD: series(dates, (i) => wiggle(i, 1), 20) })
    let down = true
    globalThis.fetch = vi.fn((url) => (down && /\/api\/bars\/AMD/.test(String(url))
      ? Promise.resolve({ ok: false, status: 503, json: async () => ({ detail: 'busy' }) })
      : ok(url)))
    render(<CorrPanel sym="NVDA" with0="AMD" />)
    expect((await screen.findByTestId('terminal-corr-error')).textContent).toContain('Could not read AMD just now.')
    down = false
    fireEvent.click(screen.getByTestId('terminal-corr-retry'))
    expect(await screen.findByTestId('terminal-corr-matrix')).toBeTruthy()
  })

  it('a partial failure names the unknown ticker and offers Retry beside the matrix', async () => {
    globalThis.fetch = vi.fn(fakeBarsFetch({ NVDA: series(dates, (i) => wiggle(i, 1)), AMD: series(dates, (i) => wiggle(i, 1), 20) }))
    render(<CorrPanel sym="NVDA" with0="AMD" with1="XYZQ" />)
    const note = await screen.findByTestId('terminal-corr-failed')
    expect(note.textContent).toContain('No price history for XYZQ')
    expect(screen.getByTestId('terminal-corr-failed-retry')).toBeTruthy()
  })
})
