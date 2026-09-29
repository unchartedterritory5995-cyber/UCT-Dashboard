/**
 * TERM-059 · THE NAAIM COLUMN STATES ITS OWN AS-OF, AT THE VALUE.
 *
 * FB-A11-03's "known it worked": a value older than the stated bound renders its
 * age, ASSERTED AS RENDERED TEXT; and a fixture with a 101-day-old feed cannot
 * render an unlabelled number. Both halves are here, plus the control that keeps
 * the rail honest — a reading from the row's own session renders BARE, or the
 * check passes by labelling everything.
 *
 * The age decision is TERM-006's (`components/provenance/freshnessAge.js`); this
 * file proves the Monitor ASKS it with the right inputs and SHOWS the answer.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

import {
  naaimAge, dayInstant, calendarDay, NAAIM_CADENCE_MS, NAAIM_CADENCE_LABEL,
} from './naaimAge'

const DAY_MS = 86400000
/** `YYYY-MM-DD` shifted by whole days — plain UTC arithmetic, no local zone. */
const shift = (ymd, days) => new Date(Date.parse(`${ymd}T00:00:00Z`) + days * DAY_MS)
  .toISOString().slice(0, 10)

// ─── 1. THE HELPER — the inputs it hands the authority ─────────────────────

describe('naaimAge asks the age authority about the row, not about today', () => {
  const ROW_DATE = '2026-08-27'

  it('CONTROL: a reading from the row\'s own session is within the bound — no label', () => {
    const a = naaimAge({ date: ROW_DATE, naaim: 61.2, naaim_date: ROW_DATE })
    expect(a.reason).toBe('within_threshold')
    expect(a.mustShow).toBe(false)
    expect(a.mustLabel).toBe(false)
    expect(a.ageMs).toBe(0)
  })

  it('a 101-day-old survey must show its age, and names its own as-of', () => {
    const asOf = shift(ROW_DATE, -101)
    const a = naaimAge({ date: ROW_DATE, naaim: 44.4, naaim_date: asOf })
    expect(a.reason).toBe('older_than_threshold')
    expect(a.mustLabel).toBe(true)
    expect(a.asOfDate).toBe(asOf)
    expect(a.ageMs).toBe(101 * DAY_MS)
  })

  it('an UNDATED reading is labelled too — an unknown age is not a fresh one', () => {
    const a = naaimAge({ date: ROW_DATE, naaim: 55.5 })
    expect(a.reason).toBe('no_timestamp')
    expect(a.mustShow).toBe(false)
    expect(a.mustLabel).toBe(true)
    expect(a.asOfDate).toBeNull()
  })

  it('no value, nothing to label — an absent value stays an absent value', () => {
    expect(naaimAge({ date: ROW_DATE, naaim: null, naaim_date: ROW_DATE })).toBeNull()
    expect(naaimAge({ date: ROW_DATE })).toBeNull()
  })

  it('the cadence handed over is the weekly survey\'s, and the words match it', () => {
    expect(NAAIM_CADENCE_MS).toBe(7 * DAY_MS)
    expect(NAAIM_CADENCE_LABEL).toBe('weekly')
    const a = naaimAge({ date: ROW_DATE, naaim: 50, naaim_date: shift(ROW_DATE, -3) })
    expect(a.cadenceMs).toBe(NAAIM_CADENCE_MS)
    expect(a.cadence).toBe('weekly')
  })

  it('"now" for a HISTORICAL row is its own session: a year-old row with a same-day survey is not stale', () => {
    const old = '2025-08-27'
    const a = naaimAge({ date: old, naaim: 50, naaim_date: old }, { now: new Date('2026-09-29T15:00:00Z') })
    expect(a.mustLabel).toBe(false)
  })

  it('"now" for the LIVE row is the wall clock', () => {
    const survey = '2026-09-24'
    const now = new Date(`${survey}T12:00:00Z`)
    const fresh = naaimAge({ _live: true, date: '2026-09-29', naaim: 50, naaim_date: survey }, { now })
    expect(fresh.mustLabel).toBe(false)
    const later = naaimAge({ _live: true, date: '2026-09-29', naaim: 50, naaim_date: survey },
      { now: new Date(Date.parse(`${survey}T12:00:00Z`) + 5 * DAY_MS) })
    expect(later.mustLabel).toBe(true)
  })
})

describe('a calendar date is never read as UTC midnight', () => {
  it('dayInstant lands on the SAME New York calendar day', () => {
    const d = dayInstant('2026-06-17')
    const et = d.toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
    expect(et).toBe('2026-06-17')
  })

  it('accepts a timestamped value by its date part, and refuses a non-date', () => {
    expect(calendarDay('2026-06-17T20:00:00')).toBe('2026-06-17')
    expect(calendarDay('June 17')).toBeNull()
    expect(calendarDay(20260617)).toBeNull()
    expect(dayInstant(null)).toBeNull()
  })
})

// ─── 2. THE MONITOR — what a member actually reads ─────────────────────────

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

const TOP = '2026-08-28'
const ROWS = Array.from({ length: 6 }, (_, i) => ({
  date: shift(TOP, -i),
  breadth_score: 70, uct_exposure: 60, pct_above_50sma: 55, up_4pct_today: 200,
  down_4pct_today: 90, vix: 16, sp500_close: 5000,
}))
// Three NAAIM readings, each a distinct number so its cell can be found by text.
const FRESH = { value: '61.23', date: ROWS[0].date }            // same session as its row
const STALE = { value: '44.44', date: shift(ROWS[1].date, -101) } // the ledger's 101 days
const UNDATED = { value: '55.55' }                                // no survey date at all
Object.assign(ROWS[0], { naaim: 61.23, naaim_date: FRESH.date })
Object.assign(ROWS[1], { naaim: 44.44, naaim_date: STALE.date })
Object.assign(ROWS[2], { naaim: 55.55 })

vi.mock('swr', () => ({
  default: (key) => (String(key).includes('/dates')
    ? { data: { dates: ROWS.map(r => r.date) }, isLoading: false, error: null, mutate: () => {} }
    : { data: { rows: ROWS, days: 90 }, isLoading: false, error: null, mutate: () => {} }),
  useSWRConfig: () => ({ mutate: () => {} }),
}))
// jsdom does no layout, so the real virtualizer renders ZERO rows and every
// assertion below would be made against an empty table. The CONTROL catches it.
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
/** The one body cell whose number is `value` — its text STARTS with the number. */
const cellFor = (container, value) => {
  const hits = Array.from(container.querySelectorAll('tbody td'))
    .filter(td => (td.textContent || '').startsWith(value))
  expect(hits, `exactly one cell renders ${value}`).toHaveLength(1)
  return hits[0]
}

describe('CONTROL — the monitor really rendered the NAAIM cells', () => {
  it('all three readings are on screen', () => {
    const { container } = mount()
    for (const v of [FRESH.value, STALE.value, UNDATED.value]) cellFor(container, v)
  })
})

describe('the as-of renders AT THE VALUE, as text a member reads', () => {
  it('the 101-day-old reading says so beside the number', () => {
    const { container } = mount()
    const td = cellFor(container, STALE.value)
    expect(td.textContent).toBe(`${STALE.value}weekly · as of ${STALE.date}`)
    expect(td.querySelector('[data-testid="freshness-age"]').textContent)
      .toBe(`weekly · as of ${STALE.date}`)
    expect(td.getAttribute('title')).toBe(`NAAIM: weekly survey dated ${STALE.date}`)
  })

  it('an undated reading says it is undated, never renders bare', () => {
    const { container } = mount()
    const td = cellFor(container, UNDATED.value)
    expect(td.textContent).toBe(`${UNDATED.value}weekly · undated`)
  })

  it('CONTROL: a reading from the row\'s own session renders BARE — the label is not on everything', () => {
    const { container } = mount()
    const td = cellFor(container, FRESH.value)
    expect(td.textContent).toBe(FRESH.value)
    expect(td.querySelector('[data-testid="freshness-age"]')).toBeNull()
  })

  it('no NAAIM label on any other column, and none that says UNKNOWN', () => {
    const { container } = mount()
    const labelled = Array.from(container.querySelectorAll('[data-value-age]'))
    expect(labelled.length).toBe(2)
    for (const el of labelled) expect(el.getAttribute('data-value-age')).toBe('naaim')
    expect(container.textContent).not.toMatch(/UNKNOWN/)
  })
})
