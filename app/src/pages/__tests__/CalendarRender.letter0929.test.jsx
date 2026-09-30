// Owner rulings 2026-09-29 for "EARNINGS · THE SESSIONS AHEAD" (/r/calendar):
//   - a company appears ONCE (MKC printed on Thu Oct 1 AND Mon Oct 5): the
//     merged this-week + next-week view keeps one date per symbol;
//   - a small `days` works (days=1 on a Friday), and ?until=week caps the window
//     at the end of the current ET week;
//   - the header uses "·", not an em dash.
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import CalendarRender, { dedupeDays, untilDate } from '../CalendarRender'

const e = (sym, extra = {}) => ({ sym, name: `${sym} Corp`, mc_b: 10, ew: 0, ...extra })

describe('dedupeDays — one date per symbol', () => {
  const dates = ['2026-10-01', '2026-10-05']

  it('the MKC case: a confirmed date this week beats a projected one next week, no tag', () => {
    const days = {
      '2026-10-01': { bmo: [e('MKC')], amc: [] },                       // schedule placement
      '2026-10-05': { bmo: [e('MKC', { date_est: true })], amc: [] },   // provider projection
    }
    const out = dedupeDays(days, dates)
    expect(out['2026-10-01'].bmo.map((x) => x.sym)).toEqual(['MKC'])
    expect(out['2026-10-05'].bmo).toEqual([])
    expect(out['2026-10-01'].bmo[0]._unconfirmed).toBeUndefined()
  })

  it('an EarningsWhispers placement (ew > 0) wins even when it is the LATER date', () => {
    const days = {
      '2026-10-01': { bmo: [], amc: [e('ORCL')] },
      '2026-10-05': { bmo: [], amc: [e('ORCL', { ew: 120 })] },
    }
    const out = dedupeDays(days, dates)
    expect(out['2026-10-01'].amc).toEqual([])
    expect(out['2026-10-05'].amc.map((x) => x.sym)).toEqual(['ORCL'])
    expect(out['2026-10-05'].amc[0]._unconfirmed).toBeUndefined()
  })

  it('sources that disagree with nothing to break the tie: earliest date, tagged UNCONFIRMED', () => {
    const tie = {
      '2026-10-01': { bmo: [e('XYZ')], amc: [] },
      '2026-10-05': { bmo: [], amc: [e('XYZ')] },
    }
    const out = dedupeDays(tie, dates)
    expect(out['2026-10-01'].bmo[0]._unconfirmed).toBe(true)
    expect(out['2026-10-05'].amc).toEqual([])

    const bothProjected = {
      '2026-10-01': { bmo: [e('ABC', { date_est: true })], amc: [] },
      '2026-10-05': { bmo: [e('ABC', { date_est: true })], amc: [] },
    }
    const out2 = dedupeDays(bothProjected, dates)
    expect(out2['2026-10-01'].bmo[0]._unconfirmed).toBe(true)
    expect(out2['2026-10-05'].bmo).toEqual([])
  })

  it('CONTROL: a payload with no duplicates comes back unchanged (same objects, no tags)', () => {
    const a = e('AAA'); const b = e('BBB', { date_est: true })
    const days = { '2026-10-01': { bmo: [a], amc: [] }, '2026-10-05': { bmo: [], amc: [b] } }
    const out = dedupeDays(days, dates)
    expect(out['2026-10-01'].bmo[0]).toBe(a)
    expect(out['2026-10-05'].amc[0]).toBe(b)
  })
})

describe('untilDate', () => {
  it("'week' is the Sunday closing the current ET week", () => {
    expect(untilDate('week', '2026-10-02')).toBe('2026-10-04')   // Friday
    expect(untilDate('week', '2026-09-28')).toBe('2026-10-04')   // Monday
    expect(untilDate('week', '2026-10-04')).toBe('2026-10-04')   // Sunday
  })
  it('a date passes through; anything else is no cap', () => {
    expect(untilDate('2026-10-02', '2026-09-29')).toBe('2026-10-02')
    expect(untilDate('', '2026-09-29')).toBeNull()
    expect(untilDate('soon', '2026-09-29')).toBeNull()
  })
})

// ── The page, on Friday 2026-10-02 (noon ET) ─────────────────────────────────
const CUR = {
  days: {
    '2026-09-28': { label: 'Mon Sep 28', bmo: [e('OLD')], amc: [] },
    '2026-10-01': { label: 'Thu Oct 1', bmo: [e('MKC')], amc: [e('NKE', { mc_b: 90 })] },
    '2026-10-02': { label: 'Fri Oct 2', bmo: [e('STZ', { mc_b: 40 })], amc: [] },
  },
}
const NEXT = {
  days: {
    '2026-10-05': { label: 'Mon Oct 5', bmo: [e('MKC', { date_est: true }), e('PEP', { mc_b: 200 })], amc: [] },
    '2026-10-06': { label: 'Tue Oct 6', bmo: [], amc: [e('LEVI')] },
  },
}

function mockCalendar(cur = CUR, next = NEXT) {
  vi.stubGlobal('fetch', vi.fn((url) => Promise.resolve({
    ok: true, json: () => Promise.resolve(String(url).includes('week=') ? next : cur),
  })))
}
const renderAt = (qs) => render(
  <MemoryRouter initialEntries={[`/r/calendar?w=728&from=today${qs}`]}><CalendarRender /></MemoryRouter>)

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-02T16:00:00Z'))   // Fri Oct 2, 12:00 ET
  mockCalendar()
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('CalendarRender page', () => {
  it('days=1 on a Friday renders just Friday', async () => {
    renderAt('&days=1')
    await screen.findByText('STZ')
    expect(screen.getByText('Fri Oct 2')).toBeInTheDocument()
    expect(screen.queryByText('Mon Oct 5')).not.toBeInTheDocument()
    expect(screen.queryByText('PEP')).not.toBeInTheDocument()
  })

  it('until=week with an empty rest-of-week does NOT spill into next Monday', async () => {
    mockCalendar({ days: { '2026-10-02': { label: 'Fri Oct 2', bmo: [], amc: [] } } }, NEXT)
    renderAt('&days=5&until=week')
    await screen.findByText('No earnings scheduled.')
    expect(screen.queryByText('Mon Oct 5')).not.toBeInTheDocument()
  })

  it('CONTROL: without until, the old from=today window still extends into next week', async () => {
    renderAt('&days=5')
    await screen.findByText('PEP')
    expect(screen.getByText('Fri Oct 2')).toBeInTheDocument()
    expect(screen.getByText('Mon Oct 5')).toBeInTheDocument()
    expect(screen.getByText('Tue Oct 6')).toBeInTheDocument()
    expect(screen.queryByText('OLD')).not.toBeInTheDocument()   // past day still dropped
  })

  it('header reads "EARNINGS · THE SESSIONS AHEAD" with no em dash', async () => {
    renderAt('&days=5')
    await screen.findByText('STZ')
    const head = screen.getByText(/EARNINGS/)
    expect(head.textContent).toBe('EARNINGS · THE SESSIONS AHEAD')
    expect(head.textContent).not.toMatch(/—/)
  })

  it('a company placed in both weeks renders ONCE', async () => {
    // Thursday Oct 1 is past on this clock, so use a Thursday clock for MKC.
    vi.setSystemTime(new Date('2026-10-01T16:00:00Z'))
    renderAt('&days=5')
    await screen.findByText('PEP')
    expect(screen.getAllByText('MKC')).toHaveLength(1)
    expect(screen.getByText('Thu Oct 1')).toBeInTheDocument()
  })
})
