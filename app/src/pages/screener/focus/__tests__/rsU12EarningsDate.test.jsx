// RS screens, unit U12, item W3.2: the earnings tag counts from today's date in New York.
// `days_to_earnings` is counted from the BUILD's date, so over a weekend (and on Monday before the
// 03:00 ET build) it ran a day or two long: a report on Monday read "Earnings in 3 days" from
// Friday night to Monday morning. The tag now counts from today in New York to the row's own
// `next_earnings_date`, falls back to the stored count only for a row that carries no date, and
// says nothing about a date already past.
import { screen, waitFor } from '@testing-library/react'
import { vi, beforeEach, describe, expect, test } from 'vitest'
vi.mock('../../../../components/StockChart', () => ({ default: p => <div data-testid="stockchart" data-sym={p.sym} /> }))
vi.mock('../ScreenerChartWidget', () => ({ default: p => <div data-testid="stockchart" data-sym={p.sym} /> }))
vi.mock('../../shell/ScannerShell', () => ({ default: () => <div data-testid="table-mode" /> }))
vi.mock('../../../../hooks/useRealtimePrices', () => ({ default: () => ({ prices: {} }) }))
vi.mock('../../../../hooks/useNeighborWarm', () => ({ useNeighborWarm: () => {} }))
vi.mock('../../../../utils/prefetchBars', () => ({ prefetchBars: () => {}, prefetchBarsToIDB: () => {}, warmMemFromIDB: () => {}, prewarmVisibleList: () => {} }))
import { __resetCountCache } from '../useLazyCounts'
import { __resetRevisionStateForTests } from '../../../../hooks/usePreferences'
import { etYmd } from '../../../../lib/marketClock/etTime'
import { earningsDays, earningsWords, tagOf, rowConfigOf, rowColumns, EARNINGS_TAG_MAX_DAYS } from '../rsRows'
import { RS_NOTE_PREF } from '../rsScreens'
import { net, resetNet, installFetch, mount, pin, scanBodies } from './rsHarness'
import { TOP_RATING, NEW_HIGHS, BEFORE_PRICE, LEADERS, EXIT_WARNINGS, RS_ROWS } from './rsScreensFixture'

beforeEach(() => {
  __resetCountCache()
  __resetRevisionStateForTests()
  localStorage.clear()
  sessionStorage.clear()
  window.history.replaceState(null, '', '/')
  resetNet()
  net.prefs = { [RS_NOTE_PREF]: '1' }
  installFetch()
})
const landedOn = name => waitFor(() => expect(screen.getByRole('button', { name: new RegExp(`^${name}.*Change screen`) })).toBeInTheDocument())
const tagEl = t => screen.getByTestId(`focus-row-${t}`).querySelector('[data-testid="rs-tag"]')
const LIST_SCREENS = [TOP_RATING, NEW_HIGHS, BEFORE_PRICE, LEADERS]
// An instant, as epoch ms, from a UTC stamp. Mid-November 2026 New York is UTC-5.
const at = iso => Date.parse(iso)
// A calendar date `n` days from a "YYYY-MM-DD" one.
const plusDays = (ymd, n) => {
  const d = new Date(`${ymd}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

describe('counted from today in New York', () => {
  // The report is on Monday 2026-11-16. The Saturday 03:00 build stored 2 days; nothing rebuilds
  // the count as the weekend passes.
  const row = { next_earnings_date: '2026-11-16', days_to_earnings: 2 }

  test.each([
    ['Saturday noon', '2026-11-14T17:00:00Z', 'Earnings in 2 days'],
    ['Sunday noon', '2026-11-15T17:00:00Z', 'Earnings tomorrow'],
    ['Sunday 11pm in New York (already Monday in UTC)', '2026-11-16T04:00:00Z', 'Earnings tomorrow'],
    ['Monday 1am in New York', '2026-11-16T06:00:00Z', 'Earnings today'],
    ['Monday afternoon', '2026-11-16T20:00:00Z', 'Earnings today'],
  ])('%s: %s -> "%s"', (_when, iso, words) => {
    expect(earningsWords(row, at(iso))).toBe(words)
  })

  test('the stored count alone would have been wrong on Sunday and on Monday', () => {
    const stored = { days_to_earnings: 2 }
    expect(earningsWords(stored, at('2026-11-15T17:00:00Z'))).toBe('Earnings in 2 days')
    expect(earningsWords(row, at('2026-11-15T17:00:00Z'))).toBe('Earnings tomorrow')
    expect(earningsWords(row, at('2026-11-16T20:00:00Z'))).toBe('Earnings today')
  })

  test('a date already past says nothing, and is never replaced by the stored count', () => {
    expect(earningsWords(row, at('2026-11-17T15:00:00Z'))).toBe('')
    expect(earningsWords({ next_earnings_date: '2026-11-10', days_to_earnings: 0 }, at('2026-11-14T17:00:00Z'))).toBe('')
    expect(earningsWords({ next_earnings_date: '2026-11-10', days_to_earnings: 3 }, at('2026-11-14T17:00:00Z'))).toBe('')
    expect(earningsDays(row, at('2026-11-17T15:00:00Z'))).toBe(-1)
  })

  test('the window is the same five days, counted from today', () => {
    const now = at('2026-11-14T17:00:00Z')
    expect(EARNINGS_TAG_MAX_DAYS).toBe(5)
    expect(earningsWords({ next_earnings_date: '2026-11-19' }, now)).toBe('Earnings in 5 days')
    expect(earningsWords({ next_earnings_date: '2026-11-20' }, now)).toBe('')
    // a date the stored count put outside the window comes inside it as the days pass
    expect(earningsWords({ next_earnings_date: '2026-11-20', days_to_earnings: 6 }, at('2026-11-15T17:00:00Z'))).toBe('Earnings in 5 days')
  })

  test('the date is read as the calendar date it names, in either of its stored shapes', () => {
    const now = at('2026-11-14T17:00:00Z')
    expect(earningsDays({ next_earnings_date: '2026-11-16' }, now)).toBe(2)
    expect(earningsDays({ next_earnings_date: '2026-11-16T00:00:00' }, now)).toBe(2)
    expect(earningsDays({ next_earnings_date: '20261116' }, now)).toBe(2)
    expect(earningsDays({ next_earnings_date: '2026-11-16' }, new Date(now))).toBe(2)
  })
})

describe('the fallback', () => {
  const now = at('2026-11-14T17:00:00Z')
  test.each([
    ['no date on the row', {}],
    ['a blank date', { next_earnings_date: null }],
    ['an empty date', { next_earnings_date: '' }],
    ['a date that is not one', { next_earnings_date: 'soon' }],
    ['a date with an impossible month', { next_earnings_date: '2026-13-40' }],
  ])('%s: the stored count speaks', (_n, extra) => {
    expect(earningsWords({ ...extra, days_to_earnings: 1 }, now)).toBe('Earnings tomorrow')
    expect(earningsWords({ ...extra, days_to_earnings: 0 }, now)).toBe('Earnings today')
    expect(earningsWords({ ...extra, days_to_earnings: 6 }, now)).toBe('')
    expect(earningsWords({ ...extra, days_to_earnings: -1 }, now)).toBe('')
    expect(earningsWords({ ...extra, days_to_earnings: null }, now)).toBe('')
    expect(earningsWords({ ...extra, days_to_earnings: 2.5 }, now)).toBe('')
  })
  test('neither known: nothing, and never a sentence about there being no report', () => {
    expect(earningsWords({}, now)).toBe('')
    expect(earningsWords(null, now)).toBe('')
    expect(earningsDays({}, now)).toBeNull()
  })
})

describe('the list asks for the date', () => {
  test('a screen that carries the tag asks for both columns; RS exit warnings for neither', () => {
    for (const st of LIST_SCREENS) {
      expect(rowColumns(rowConfigOf(st)), st.id).toContain('next_earnings_date')
      expect(rowColumns(rowConfigOf(st)), st.id).toContain('days_to_earnings')
    }
    expect(rowColumns(rowConfigOf(EXIT_WARNINGS))).not.toContain('next_earnings_date')
    expect(rowColumns(rowConfigOf(EXIT_WARNINGS))).not.toContain('days_to_earnings')
  })

  test('the tag still leads the row, now from the date', () => {
    const today = etYmd(Date.now())
    const busy = { rs_nh_weekly: 1, rs_nhbp_age: 0, px_below_high_pct: -5, rs_flag: 'new_issue' }
    for (const st of LIST_SCREENS) {
      expect(tagOf({ ...busy, next_earnings_date: plusDays(today, 1), days_to_earnings: 4 }, rowConfigOf(st), true), st.id).toBe('Earnings tomorrow')
      // a past date: the screen's next tag speaks, exactly as with no report at all
      const none = tagOf(busy, rowConfigOf(st), true)
      expect(tagOf({ ...busy, next_earnings_date: plusDays(today, -1), days_to_earnings: 0 }, rowConfigOf(st), true), st.id).toBe(none)
    }
  })
})

describe('on the page', () => {
  test('each row reads its report from today, not from the build', async () => {
    const today = etYmd(Date.now())
    const [nvda, mu, lly, xom, amd] = RS_ROWS
    net.rows = [
      { ...nvda, next_earnings_date: today, days_to_earnings: 2 },                  // the build counted 2; it is today
      { ...mu, next_earnings_date: plusDays(today, 1), days_to_earnings: 3 },       // tomorrow
      { ...lly, next_earnings_date: plusDays(today, -1), days_to_earnings: 1 },     // reported yesterday: its own flag
      { ...xom, next_earnings_date: null, days_to_earnings: 4 },                    // no date: the stored count
      { ...amd, next_earnings_date: plusDays(today, 9), days_to_earnings: 0 },      // nine days out: its own flag
    ]
    pin(['starter_rs_leaders'])
    mount()
    await landedOn('UCT RS Leaders')
    await waitFor(() => expect(tagEl('NVDA')).toHaveTextContent('Earnings today'))
    expect(tagEl('MU')).toHaveTextContent('Earnings tomorrow')
    expect(tagEl('LLY')).toHaveTextContent('New issue')
    expect(tagEl('XOM')).toHaveTextContent('Earnings in 4 days')
    expect(tagEl('AMD')).toHaveTextContent('One-day move')
    expect(scanBodies()[0].columns).toEqual(expect.arrayContaining(['days_to_earnings', 'next_earnings_date']))
  })

  test('RS exit warnings asks for neither column', async () => {
    pin(['starter_rs_exit_warning_5'])
    mount()
    await landedOn('RS exit warnings')
    await waitFor(() => screen.getByTestId('focus-row-NVDA'))
    expect(scanBodies().at(-1).columns).not.toContain('days_to_earnings')
  })
})
