// Accuracy follow-up 3 (audit 2026-10-06, design note 4): `CORR … 2Y` and `CORR … YTD` were
// parsed and then silently ignored — the panel stayed on 3M. They are now drawn, and the
// numbers are checked against an independent Pearson written here (not the product's).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import CorrPanel, { CORR_WINDOWS } from './CorrPanel'
import { clearClosesCache } from './useCloses'
import { correlationMatrix, corrWindow } from './relativeMath'
import { fakeBarsFetch, series, weekdays } from './__fixtures__/compareFixtures'

const realFetch = globalThis.fetch
beforeEach(() => { clearClosesCache() })
afterEach(() => { globalThis.fetch = realFetch })

// Two series whose daily returns differ by regime, so each window has its OWN r.
const dates = weekdays(560, '2024-07-01')              // ~2024-07 .. 2026-08: > 2Y of sessions
const lcg = (seed) => () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 - 0.5 }
const ra = lcg(7)
const rb = lcg(11)
const aRet = dates.map(() => 0.02 * ra())
const A = series(dates, (i) => aRet[i])
// unrelated to A before 2026, strongly related to it from Jan 1 2026
const B = series(dates, (i) => (dates[i] >= '2026-01-01' ? 0.6 * aRet[i] + 0.01 * rb() : 0.02 * rb()))

/** Independent reference: textbook Pearson over the simple returns dated in `keepDate`,
 *  last `n` of them. Written without relativeMath. */
function refR(a, b, { last = Infinity, from = '' } = {}) {
  const ret = (s) => {
    const m = {}
    for (let i = 1; i < s.length; i++) m[s[i].d] = s[i].c / s[i - 1].c - 1
    return m
  }
  const x = ret(a)
  const y = ret(b)
  let ds = Object.keys(x).filter((d) => d in y && d >= from).sort()
  if (Number.isFinite(last)) ds = ds.slice(-last)
  const xs = ds.map((d) => x[d])
  const ys = ds.map((d) => y[d])
  const mx = xs.reduce((t, v) => t + v, 0) / xs.length
  const my = ys.reduce((t, v) => t + v, 0) / ys.length
  let sxy = 0; let sxx = 0; let syy = 0
  for (let i = 0; i < xs.length; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2
  }
  return { r: sxy / Math.sqrt(sxx * syy), n: xs.length }
}

describe('CORR windows', () => {
  it('every window the lookback arg accepts is a window the panel draws', () => {
    expect(CORR_WINDOWS).toEqual(['1M', '3M', '6M', '1Y', '2Y', 'YTD'])
  })

  it('2Y is the last 504 shared returns, equal to the independent reference', () => {
    const { sessions, since } = corrWindow('2Y', { A, B }, ['A', 'B'])
    expect(sessions).toBe(504)
    const got = correlationMatrix({ A, B }, ['A', 'B'], sessions, { since }).matrix[0][1]
    const ref = refR(A, B, { last: 504 })
    expect(got.n).toBe(504)
    expect(ref.n).toBe(504)
    expect(Math.abs(got.r - ref.r)).toBeLessThan(1e-12)
  })

  it('YTD is every return dated in the newest year, equal to the independent reference', () => {
    const w = corrWindow('YTD', { A, B }, ['A', 'B'])
    expect(w.since).toBe('2026-01-01')
    const got = correlationMatrix({ A, B }, ['A', 'B'], w.sessions, { since: w.since }).matrix[0][1]
    const ref = refR(A, B, { from: '2026-01-01' })
    expect(got.n).toBe(ref.n)
    expect(ref.n).toBeGreaterThan(100)
    expect(Math.abs(got.r - ref.r)).toBeLessThan(1e-12)
    // ...and it is NOT the 3M answer the panel used to show for YTD
    const threeM = refR(A, B, { last: 63 })
    expect(Math.abs(got.r - threeM.r)).toBeGreaterThan(1e-3)
  })

  it('the panel opens on 2Y / YTD when typed, and its matrix shows those numbers', async () => {
    globalThis.fetch = vi.fn(fakeBarsFetch({ AAA: A, BBB: B }))
    const { unmount } = render(<CorrPanel sym="AAA" with0="BBB" lookback="2Y" />)
    await screen.findByTestId('terminal-corr-matrix')
    expect(screen.getByRole('button', { name: '2Y' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTestId('corr-AAA-BBB').textContent).toBe(refR(A, B, { last: 504 }).r.toFixed(2))
    expect(screen.getByTestId('corr-AAA-BBB').getAttribute('title')).toBe('504 common sessions')
    expect(screen.queryByTestId('terminal-corr-unapplied')).toBeNull()
    unmount()

    render(<CorrPanel sym="AAA" with0="BBB" lookback="YTD" />)
    await screen.findByTestId('terminal-corr-matrix')
    expect(screen.getByRole('button', { name: 'YTD' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTestId('corr-AAA-BBB').textContent).toBe(refR(A, B, { from: '2026-01-01' }).r.toFixed(2))
    expect(screen.getByTestId('terminal-corr-matrix').closest('[data-testid="terminal-corr"]').textContent)
      .toContain('since January 1 (year to date)')
  })

  it('a window it cannot draw is said out loud, never silently replaced', async () => {
    globalThis.fetch = vi.fn(fakeBarsFetch({ AAA: A, BBB: B }))
    render(<CorrPanel sym="AAA" with0="BBB" lookback="5Y" />)
    expect((await screen.findByTestId('terminal-corr-unapplied')).textContent)
      .toBe('Window 5Y is not available here; showing 3M.')
  })
})
