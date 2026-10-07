// REL / RRG / CORR windows: every window the command line accepts is one the panel draws, and a
// window a panel cannot draw is SAID with the same visible line CORR uses ("Window X is not
// available here; showing Y."), never silently replaced. Only the network is faked.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import RrgPanel, { RRG_CADENCES, rrgCadence } from './RrgPanel'
import RelPanel, { REL_WINDOWS } from './RelPanel'
import CorrPanel, { CORR_WINDOWS } from './CorrPanel'
import { ARG_KINDS, CADENCES, LOOKBACK_WINDOWS } from '../args'
import { BY_CODE } from '../functions'
import { clearClosesCache } from './useCloses'
import { fakeBarsFetch, fridays, series, weekdays } from './__fixtures__/compareFixtures'

const realFetch = globalThis.fetch
beforeEach(() => { clearClosesCache() })
afterEach(() => { globalThis.fetch = realFetch })

describe('the windows the command line accepts are the windows each panel draws', () => {
  it('REL and CORR draw every lookback window, and the lookback arg takes exactly those', () => {
    expect([...REL_WINDOWS].sort()).toEqual([...LOOKBACK_WINDOWS].sort())
    expect([...CORR_WINDOWS].sort()).toEqual([...LOOKBACK_WINDOWS].sort())
    for (const w of LOOKBACK_WINDOWS) expect(ARG_KINDS.lookback.parse(w)).toBe(w)
    expect(ARG_KINDS.lookback.parse('5Y')).toBe(null)
    for (const code of ['REL', 'CORR']) {
      for (const v of [BY_CODE[code].ticker, BY_CODE[code].market]) {
        expect(v.args.find((a) => a.kind === 'lookback')?.prop, code).toBe('lookback')
      }
    }
  })

  it('RRG draws every cadence the cadence arg can produce', () => {
    const produced = ['D', 'W', 'DAILY', 'WEEKLY'].map((t) => ARG_KINDS.cadence.parse(t))
    expect(new Set(produced)).toEqual(new Set(CADENCES))
    for (const c of CADENCES) {
      expect(RRG_CADENCES).toContain(c)
      expect(rrgCadence(c)).toBe(c)
    }
  })
})

describe('a window a panel cannot draw is said out loud (the CORR pattern)', () => {
  it('CORR (the reference line)', async () => {
    const dates = weekdays(140, '2026-01-02')
    globalThis.fetch = vi.fn(fakeBarsFetch({ AAA: series(dates, (i) => 0.001 * Math.sin(i)), BBB: series(dates, (i) => 0.001 * Math.cos(i)) }))
    render(<CorrPanel sym="AAA" with0="BBB" lookback="5Y" />)
    expect((await screen.findByTestId('terminal-corr-unapplied')).textContent).toBe('Window 5Y is not available here; showing 3M.')
  })

  it('REL says the same thing, and shows its default window instead', async () => {
    const dates = weekdays(300, '2025-06-02')
    globalThis.fetch = vi.fn(fakeBarsFetch({ AAA: series(dates, () => 0.001), BBB: series(dates, () => 0.0005) }))
    render(<RelPanel sym="AAA" with0="BBB" lookback="5Y" />)
    const note = await screen.findByTestId('terminal-rel-unapplied')
    expect(note.textContent).toBe('Window 5Y is not available here; showing 6M.')
    expect(note.getAttribute('role')).toBe('status')
    expect(screen.getByRole('button', { name: '6M' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('REL on a window it draws says nothing', async () => {
    const dates = weekdays(300, '2025-06-02')
    globalThis.fetch = vi.fn(fakeBarsFetch({ AAA: series(dates, () => 0.001), BBB: series(dates, () => 0.0005) }))
    render(<RelPanel sym="AAA" with0="BBB" lookback="1Y" />)
    await screen.findByTestId('terminal-rel-lede')
    expect(screen.queryByTestId('terminal-rel-unapplied')).toBeNull()
  })

  it('RRG says the same thing, and shows weekly closes instead', async () => {
    const dates = fridays(60)
    const bench = series(dates, () => 0.001)
    globalThis.fetch = vi.fn(fakeBarsFetch({ SPY: bench, XLK: series(dates, (i) => 0.001 + 0.0004 * i / 60), XLU: series(dates, () => 0.0008) }))
    render(<RrgPanel with0="XLK" with1="XLU" tf="M" />)
    const note = await screen.findByTestId('terminal-rrg-unapplied')
    expect(note.textContent).toBe('Window M is not available here; showing W.')
    expect(screen.getByTestId('terminal-rrg-lede').textContent).toContain('weekly')
  })

  it('RRG on a cadence it draws says nothing', async () => {
    const dates = fridays(60)
    globalThis.fetch = vi.fn(fakeBarsFetch({ SPY: series(dates, () => 0.001), XLK: series(dates, () => 0.0012), XLU: series(dates, () => 0.0008) }))
    render(<RrgPanel with0="XLK" with1="XLU" tf="W" />)
    await screen.findByTestId('terminal-rrg')
    expect(screen.queryByTestId('terminal-rrg-unapplied')).toBeNull()
  })
})
