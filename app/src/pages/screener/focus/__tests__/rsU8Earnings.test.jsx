// RS screens, unit U8, item D1: the earnings tag on a row. A report inside the week changes what
// a setup means, so the four list screens lead their tags with `earnings`; the client words it
// from `days_to_earnings`. The date is known for under half the names, so a row without one says
// nothing, and never "no earnings soon". Read on the starters the SERVER serves (rsScreensFixture
// reads the server suite's goldens) and on the mounted page.
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
import { earningsWords, tagOf, rowConfigOf, rowColumns, EARNINGS_TAG_MAX_DAYS } from '../rsRows'
import { net, resetNet, installFetch, mount, pin, scanBodies } from './rsHarness'
import { TOP_RATING, NEW_HIGHS, BEFORE_PRICE, LEADERS, EXIT_WARNINGS, RS_STARTERS, RS_ROWS, PLAIN_STARTERS, SERVED } from './rsScreensFixture'

beforeEach(() => {
  __resetCountCache()
  __resetRevisionStateForTests()
  localStorage.clear()
  sessionStorage.clear()
  window.history.replaceState(null, '', '/')
  resetNet()
  installFetch()
})
const landedOn = name => waitFor(() => expect(screen.getByRole('button', { name: new RegExp(`^${name}.*Change screen`) })).toBeInTheDocument())
const tagEl = t => screen.getByTestId(`focus-row-${t}`).querySelector('[data-testid="rs-tag"]')
const LIST_SCREENS = [TOP_RATING, NEW_HIGHS, BEFORE_PRICE, LEADERS]

describe('the words', () => {
  test.each([
    [0, 'Earnings today'],
    [1, 'Earnings tomorrow'],
    [2, 'Earnings in 2 days'],
    [3, 'Earnings in 3 days'],
    [4, 'Earnings in 4 days'],
    [5, 'Earnings in 5 days'],
  ])('days_to_earnings %s reads "%s"', (n, words) => { expect(earningsWords({ days_to_earnings: n })).toBe(words) })

  test('the window ends at five days: the sixth says nothing', () => {
    expect(EARNINGS_TAG_MAX_DAYS).toBe(5)
    expect(earningsWords({ days_to_earnings: EARNINGS_TAG_MAX_DAYS })).toBe('Earnings in 5 days')
    expect(earningsWords({ days_to_earnings: EARNINGS_TAG_MAX_DAYS + 1 })).toBe('')
    expect(earningsWords({ days_to_earnings: 40 })).toBe('')
  })

  test.each([
    ['not known (null)', null],
    ['not on the row', undefined],
    ['a report already past', -1],
    ['text', '2'],
    ['a fraction', 2.5],
    ['not a number', NaN],
    ['a flag', true],
  ])('nothing is said when the date is %s', (_n, v) => {
    expect(earningsWords({ days_to_earnings: v })).toBe('')
  })
  test('nothing for no row, and never a sentence about there being no report', () => {
    expect(earningsWords(null)).toBe('')
    expect(earningsWords({})).toBe('')
    for (let n = -2; n <= 12; n++) expect(earningsWords({ days_to_earnings: n })).not.toMatch(/no earnings/i)
  })
})

describe('where the server puts the tag', () => {
  test('first on the four list screens, absent from RS exit warnings', () => {
    for (const st of LIST_SCREENS) expect(st.row.tags[0], st.id).toBe('earnings')
    expect(EXIT_WARNINGS.row.tags).toEqual(['new'])
    expect(RS_STARTERS.filter(s => s.row.tags.includes('earnings')).map(s => s.id)).toEqual(LIST_SCREENS.map(s => s.id))
  })

  test('a screen that carries the tag asks for its column; one that does not, does not', () => {
    for (const st of LIST_SCREENS) expect(rowColumns(rowConfigOf(st)), st.id).toContain('days_to_earnings')
    expect(rowColumns(rowConfigOf(EXIT_WARNINGS))).not.toContain('days_to_earnings')
    for (const st of PLAIN_STARTERS) expect(rowColumns(rowConfigOf(st))).toEqual([])
  })

  test('it wins the one tag place over every other tag, and only inside the window', () => {
    const busy = { rs_nhbp_age: 0, px_below_high_pct: -5, rs_nh_red_bars_ago: 0, rs_nh_bars_ago: 0, rs_flag: 'new_issue' }
    for (const st of LIST_SCREENS) {
      expect(tagOf({ ...busy, days_to_earnings: 2 }, rowConfigOf(st), true), st.id).toBe('Earnings in 2 days')
      // outside the window, or not known: the screen's next tag, exactly as before this unit
      const before = tagOf(busy, { tags: st.row.tags.filter(t => t !== 'earnings') }, true)
      expect(before).not.toBe('')
      expect(tagOf({ ...busy, days_to_earnings: 6 }, rowConfigOf(st), true), st.id).toBe(before)
      expect(tagOf({ ...busy, days_to_earnings: null }, rowConfigOf(st), true), st.id).toBe(before)
      expect(tagOf(busy, rowConfigOf(st), true), st.id).toBe(before)
    }
    // RS exit warnings never says it, whatever the row carries
    expect(tagOf({ days_to_earnings: 0 }, rowConfigOf(EXIT_WARNINGS), true)).toBe('New')
    expect(tagOf({ days_to_earnings: 0 }, rowConfigOf(EXIT_WARNINGS), false)).toBe('')
  })

  test('the method page says the date is shown only when known', () => {
    expect(SERVED.method.earnings).toMatch(/only when that date is known/)
    expect(SERVED.method.earnings).toContain(`${EARNINGS_TAG_MAX_DAYS} days away or less`)
  })
})

describe('on the page', () => {
  test('UCT RS Leaders asks for the column and each row reads its own report, or nothing', async () => {
    const [nvda, mu, lly, xom, amd] = RS_ROWS
    net.rows = [
      { ...nvda, days_to_earnings: 0 },
      { ...mu, days_to_earnings: 1 },
      { ...lly, days_to_earnings: 4 },      // carries a flag too: the report comes first
      { ...xom, days_to_earnings: null },   // not known: its own flag, as before
      { ...amd, days_to_earnings: 9 },      // past the window: its own flag, as before
    ]
    pin(['starter_rs_leaders'])
    mount()
    await landedOn('UCT RS Leaders')
    await waitFor(() => expect(tagEl('NVDA')).toHaveTextContent('Earnings today'))
    expect(tagEl('MU')).toHaveTextContent('Earnings tomorrow')
    expect(tagEl('LLY')).toHaveTextContent('Earnings in 4 days')
    expect(tagEl('XOM')).toHaveTextContent('Buyout pending')
    expect(tagEl('AMD')).toHaveTextContent('One-day move')
    expect(scanBodies()[0].columns).toContain('days_to_earnings')
    // words in a plain outline like every other tag: never the green New pill
    expect(tagEl('NVDA').className).not.toMatch(/newPill|newTag/)
  })

  test('a row with no known date and no other tag shows no tag at all', async () => {
    net.rows = [{ ...RS_ROWS[0], days_to_earnings: null }, { ...RS_ROWS[1], days_to_earnings: 3 }]
    pin(['starter_rs_top_rating'])
    mount()
    await landedOn('Top RS Rating')
    await waitFor(() => expect(tagEl('MU')).toHaveTextContent('Earnings in 3 days'))
    expect(tagEl('NVDA')).toBeNull()
    expect(screen.queryByText(/no earnings/i)).toBeNull()
  })

  test('RS exit warnings asks for nothing more', async () => {
    pin(['starter_rs_exit_warning_5'])
    mount()
    await landedOn('RS exit warnings')
    await waitFor(() => screen.getByTestId('focus-row-NVDA'))
    expect(scanBodies().at(-1).columns).not.toContain('days_to_earnings')
  })
  test('a plain screen asks for nothing more', async () => {
    pin([PLAIN_STARTERS[0].id])
    mount()
    await landedOn(PLAIN_STARTERS[0].name)
    await waitFor(() => screen.getByTestId('focus-row-NVDA'))
    for (const b of scanBodies()) expect(b.columns).not.toContain('days_to_earnings')
  })
})
