/**
 * TERM-059 follow-ups 2-4 · AAII, CBOE P/C and CNN F/G state their as-of AT THE VALUE.
 *
 * Same contract as naaimAge.test.jsx: the age decision is TERM-006's; these rails prove
 * the Monitor asks it with each series' own as-of and RENDERS the answer as text, with
 * the controls that keep the rail honest (a same-session value, and a daily print the
 * row collected itself, render BARE).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

import { aaiiAge, dailyCarryAge, makeSeriesAge, AAII_KEYS, DAILY_CARRY_KEYS, asofKey } from './sentimentAge'

const DAY_MS = 86400000
const shift = (ymd, days) => new Date(Date.parse(`${ymd}T00:00:00Z`) + days * DAY_MS)
  .toISOString().slice(0, 10)

describe('the helpers ask the authority about the row, not about today', () => {
  const D = '2026-08-27'

  it('AAII: a survey 9 days older than its row must label, and names its as-of', () => {
    const a = aaiiAge.aaii_bulls({ date: D, aaii_bulls: 38.1, aaii_survey_date: shift(D, -9) })
    expect(a.mustLabel).toBe(true)
    expect(a.asOfDate).toBe(shift(D, -9))
    expect(a.cadence).toBe('weekly')
  })

  it('CONTROL: an AAII survey dated the row\'s own session does not label', () => {
    expect(aaiiAge.aaii_bears({ date: D, aaii_bears: 30, aaii_survey_date: D }).mustLabel).toBe(false)
  })

  it('AAII undated is labelled undated — an unknown age is not a fresh one', () => {
    const a = aaiiAge.aaii_spread({ date: D, aaii_spread: 5 })
    expect(a.mustLabel).toBe(true)
    expect(a.asOfDate).toBeNull()
  })

  it('a CARRIED daily print labels with the session it came from', () => {
    const a = dailyCarryAge.cboe_putcall({ date: D, cboe_putcall: 0.9, [asofKey('cboe_putcall')]: shift(D, -2) })
    expect(a.mustLabel).toBe(true)
    expect(a.cadence).toBe('daily')
  })

  it('CONTROL: an undated daily print is the row\'s own and renders bare', () => {
    expect(dailyCarryAge.cnn_fear_greed({ date: D, cnn_fear_greed: 44 })).toBeNull()
  })

  it('no value, nothing to label', () => {
    for (const k of AAII_KEYS) expect(aaiiAge[k]({ date: D, aaii_survey_date: D })).toBeNull()
    for (const k of DAILY_CARRY_KEYS) expect(dailyCarryAge[k]({ date: D })).toBeNull()
  })

  it('a misspelled data class throws where it is written', () => {
    expect(() => makeSeriesAge({ valueKey: 'x', dateKey: 'y', dataClass: 'weeky', labelUndated: true })).toThrow()
  })
})

// ─── rendered by the real Monitor ───────────────────────────────────────────

const TOP = '2026-08-27'
const ROWS = Array.from({ length: 4 }, (_, i) => ({
  date: shift(TOP, -i),
  breadth_score: 70, uct_exposure: 60, pct_above_50sma: 55, up_4pct_today: 200,
  down_4pct_today: 90, vix: 16, sp500_close: 5000,
}))
Object.assign(ROWS[0], { aaii_bulls: 41.17, aaii_survey_date: ROWS[0].date,  // same session: bare
  cboe_putcall: 0.83, cnn_fear_greed: 47 })                                   // own prints: bare
Object.assign(ROWS[1], { aaii_bulls: 33.33, aaii_survey_date: shift(ROWS[1].date, -9),
  cboe_putcall: 1.17, cboe_putcall_asof: shift(ROWS[1].date, -3) })            // carried

vi.mock('echarts-for-react', () => ({ default: () => <div data-testid="echart" /> }))
vi.mock('../CotData', () => ({ default: () => <div /> }))
vi.mock('../BreadthCharts', () => ({ default: () => <div /> }))
vi.mock('../../components/tiles/MarketBreadth', () => ({ default: () => <div /> }))
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: { role: 'user' } }) }))
vi.mock('../../hooks/useFlagged', () => ({
  useFlagged: () => ({ flagged: [], toggle: () => {}, remove: () => {}, isFlagged: () => false,
                       isShared: false, toggleShare: () => {}, flaggedName: 'Flagged',
                       renameFlagged: () => {} }),
}))
vi.mock('../../hooks/useLiveBreadth', () => ({
  useLiveBreadth: () => ({ row: null, stamp: null, superseded: true }),
  formatLiveClock: () => 'now',
}))
vi.mock('./drill/BreadthDrillModal', () => ({ default: () => <div /> }))
vi.mock('swr', () => ({
  default: (key) => (String(key).includes('/dates')
    ? { data: { dates: ROWS.map(r => r.date) }, isLoading: false, error: null, mutate: () => {} }
    : { data: { rows: ROWS, days: 90 }, isLoading: false, error: null, mutate: () => {} }),
  useSWRConfig: () => ({ mutate: () => {} }),
}))
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }) => ({
    getVirtualItems: () => Array.from({ length: count }, (_, index) => ({
      index, key: index, start: index * 28, size: 28, end: (index + 1) * 28,
    })),
    getTotalSize: () => count * 28,
    scrollToIndex: () => {}, measureElement: () => {}, scrollToOffset: () => {},
  }),
  observeElementRect: () => () => {},
  observeElementOffset: () => () => {},
  elementScroll: () => {},
}))

import Breadth from '../Breadth'

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem('uct.breadth.dates.v1', JSON.stringify({ dates: ROWS.map(r => r.date) }))
  localStorage.setItem('uct.breadth.recent.v1', JSON.stringify(ROWS))
})

const mount = () => render(<MemoryRouter initialEntries={['/breadth']}><Breadth /></MemoryRouter>)
const cellFor = (container, value) => {
  const hits = Array.from(container.querySelectorAll('tbody td'))
    .filter(td => (td.textContent || '').startsWith(value))
  expect(hits, `exactly one cell renders ${value}`).toHaveLength(1)
  return hits[0]
}

describe('the as-of renders at the value', () => {
  it('a 9-day-old AAII survey says so beside the number', () => {
    const td = cellFor(mount().container, '33.3')
    expect(td.textContent).toBe(`33.3weekly · as of ${shift(ROWS[1].date, -9)}`)
  })

  it('a carried CBOE print says which session it came from', () => {
    const td = cellFor(mount().container, '1.17')
    expect(td.textContent).toBe(`1.17daily · as of ${shift(ROWS[1].date, -3)}`)
    expect(td.getAttribute('title')).toBe(`CBOE P/C: daily print dated ${shift(ROWS[1].date, -3)}`)
  })

  it('CONTROL: same-session AAII and the row\'s own daily prints render BARE', () => {
    const { container } = mount()
    expect(cellFor(container, '41.2').textContent).toBe('41.2')
    expect(cellFor(container, '0.83').textContent).toBe('0.83')
    expect(cellFor(container, '47').textContent).toBe('47')
  })

  it('exactly the two stale values are labelled', () => {
    const { container } = mount()
    const tags = Array.from(container.querySelectorAll('[data-value-age]')).map(e => e.getAttribute('data-value-age'))
    expect(tags.sort()).toEqual(['aaii_bulls', 'cboe_putcall'])
  })
})
