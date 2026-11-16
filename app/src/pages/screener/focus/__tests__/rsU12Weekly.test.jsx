// RS screens, unit U12, item W1: the weekly RS new high. The house lesson is the WEEKLY RS line
// making a new high, so RS New Highs and RS New High Before Price tag a row whose weekly line
// did ("Weekly RS high", right after the earnings tag) and offer "Weekly" as a fourth choice of
// When, which swaps the daily age clause for the weekly flag. Read on the starters the SERVER
// serves (rsScreensFixture reads the server suite's goldens) and on the mounted page.
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
import { weeklyWords, tagOf, rowConfigOf, rowColumns } from '../rsRows'
import { controlsOf, defaultOption, activeOption, specWithOption, RS_CONTROLS_PREF, RS_NOTE_PREF, RS_SCREENS_COLUMNS } from '../rsScreens'
import { net, resetNet, installFetch, mount, pin, scanBodies } from './rsHarness'
import { TOP_RATING, NEW_HIGHS, BEFORE_PRICE, LEADERS, EXIT_WARNINGS, RS_ROWS, SERVED } from './rsScreensFixture'

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
const WEEKLY_SCREENS = [[NEW_HIGHS, 'rs_nh_bars_ago', 'rs_nh_weekly'], [BEFORE_PRICE, 'rs_nhbp_age', 'rs_nhbp_weekly']]
const keyed = spec => Object.fromEntries(spec.filters.map(({ key, ...rest }) => [key, rest]))
const whenOf = st => controlsOf(st).find(c => c.id === 'when')

describe('the words', () => {
  test('only a stored 1 says it', () => {
    expect(weeklyWords({ rs_nh_weekly: 1 })).toBe('Weekly RS high')
    for (const v of [0, null, undefined, true, '1', 2, NaN]) expect(weeklyWords({ rs_nh_weekly: v }), String(v)).toBe('')
    expect(weeklyWords(null)).toBe('')
    expect(weeklyWords({})).toBe('')
  })
})

describe('where the server puts the tag', () => {
  test('right after earnings on the two RS high screens, on no other', () => {
    for (const [st] of WEEKLY_SCREENS) expect(st.row.tags.slice(0, 2), st.id).toEqual(['earnings', 'weekly'])
    for (const st of [TOP_RATING, LEADERS, EXIT_WARNINGS]) expect(st.row.tags, st.id).not.toContain('weekly')
  })

  test('a screen that carries the tag asks for the weekly high column; the others do not', () => {
    for (const [st] of WEEKLY_SCREENS) expect(rowColumns(rowConfigOf(st)), st.id).toContain('rs_nh_weekly')
    for (const st of [TOP_RATING, LEADERS, EXIT_WARNINGS]) expect(rowColumns(rowConfigOf(st)), st.id).not.toContain('rs_nh_weekly')
    expect(RS_SCREENS_COLUMNS).toEqual(expect.arrayContaining(['rs_nh_weekly', 'rs_nhbp_weekly']))
  })

  test('it follows a report inside the week and leads every daily reading', () => {
    const busy = { rs_nh_weekly: 1, rs_nhbp_age: 0, px_below_high_pct: -5, rs_nh_red_bars_ago: 0, rs_nh_bars_ago: 0, rs_flag: 'new_issue' }
    for (const [st] of WEEKLY_SCREENS) {
      expect(tagOf(busy, rowConfigOf(st), true), st.id).toBe('Weekly RS high')
      expect(tagOf({ ...busy, days_to_earnings: 2 }, rowConfigOf(st), true), st.id).toBe('Earnings in 2 days')
      // without the weekly high the screen's next tag speaks, exactly as before this unit
      const before = tagOf(busy, { tags: st.row.tags.filter(t => t !== 'weekly') }, true)
      expect(before).not.toBe('')
      expect(before).not.toBe('Weekly RS high')
      expect(tagOf({ ...busy, rs_nh_weekly: 0 }, rowConfigOf(st), true), st.id).toBe(before)
      expect(tagOf({ ...busy, rs_nh_weekly: null }, rowConfigOf(st), true), st.id).toBe(before)
    }
    // a screen without the tag never says it, whatever the row carries
    expect(tagOf({ rs_nh_weekly: 1 }, rowConfigOf(LEADERS), false)).toBe('')
  })
})

describe('When gains Weekly', () => {
  test.each(WEEKLY_SCREENS.map(([st, age, weekly]) => [st.name, st, age, weekly]))('%s: the fourth choice swaps the daily age for the weekly flag', (_n, st, age, weekly) => {
    const when = whenOf(st)
    expect(when.keys).toEqual([age, weekly])
    expect(when.options.map(o => o.id)).toEqual(['today', 'week', 'month', 'weekly'])
    const option = when.options[3]
    expect(option.label).toBe('Weekly')
    expect(defaultOption(when).id).toBe('week')
    // as it opens: the daily age, no weekly clause, and the control reads This week
    expect(keyed(st.spec)[weekly]).toBeUndefined()
    expect(activeOption(when, { filters: keyed(st.spec), sort: st.spec.sort }).id).toBe('week')
    // Weekly chosen: the age clause is gone, the weekly flag is the only clause on the two keys
    const chosen = specWithOption(st.spec, when, option)
    expect(keyed(chosen)[age]).toBeUndefined()
    expect(keyed(chosen)[weekly]).toEqual({ op: 'eq', value: 1 })
    expect(activeOption(when, { filters: keyed(chosen), sort: chosen.sort }).id).toBe('weekly')
    // and back: a daily span takes the weekly clause off again
    const back = specWithOption(chosen, when, when.options[1])
    expect(keyed(back)[weekly]).toBeUndefined()
    expect(keyed(back)[age]).toEqual(keyed(st.spec)[age])
    // every other rule of the screen is untouched by the swap
    const rest = s => s.filters.filter(f => !when.keys.includes(f.key))
    expect(rest(chosen)).toEqual(rest(st.spec))
    expect(chosen.sort).toEqual(st.spec.sort)
  })

  test('the registry the server serves has both flags, so the drawer can show the clause', () => {
    const keys = SERVED.meta.filters.map(f => f.key)
    expect(keys).toEqual(expect.arrayContaining(['rs_nh_weekly', 'rs_nhbp_weekly']))
  })

  test('the method page says what the weekly reading is', () => {
    expect(SERVED.method.weekly).toMatch(/weekly closes in place of daily ones/)
    expect(SERVED.method.weekly).toContain('52 weeks')
  })
})

describe('on the page', () => {
  test('RS New Highs asks for the column and tags the rows whose weekly line made a high', async () => {
    const [nvda, mu, lly] = RS_ROWS
    net.rows = [
      { ...nvda, rs_nh_weekly: 1, days_to_earnings: null },
      { ...mu, rs_nh_weekly: 1, days_to_earnings: 1 },          // the report comes first
      { ...lly, rs_nh_weekly: 0, days_to_earnings: null },      // its own next tag, as before
    ]
    net.prefs = { [RS_NOTE_PREF]: '1' }
    pin(['starter_rs_new_high'])
    mount()
    await landedOn('RS New Highs')
    await waitFor(() => expect(tagEl('NVDA')).toHaveTextContent('Weekly RS high'))
    expect(tagEl('MU')).toHaveTextContent('Earnings tomorrow')
    expect(tagEl('LLY')?.textContent || '').not.toMatch(/Weekly/)
    expect(scanBodies()[0].columns).toContain('rs_nh_weekly')
    expect(tagEl('NVDA').className).not.toMatch(/newPill|newTag/)
  })

  test('a remembered Weekly choice opens the screen on the weekly flag in one scan', async () => {
    net.prefs = { [RS_NOTE_PREF]: '1', [RS_CONTROLS_PREF]: JSON.stringify({ starter_rs_nh_before_price: { when: 'weekly' } }) }
    pin(['starter_rs_nh_before_price'])
    mount()
    await landedOn('RS New High Before Price')
    await waitFor(() => expect(scanBodies().length).toBeGreaterThan(0))
    const filters = scanBodies().at(-1).filters
    expect(filters.find(f => f.key === 'rs_nhbp_weekly')).toEqual({ key: 'rs_nhbp_weekly', op: 'eq', value: 1 })
    expect(filters.find(f => f.key === 'rs_nhbp_age')).toBeUndefined()
    expect(scanBodies()).toHaveLength(1)
  })

  test('a screen without the tag asks for neither weekly column', async () => {
    net.prefs = { [RS_NOTE_PREF]: '1' }
    pin(['starter_rs_leaders'])
    mount()
    await landedOn('UCT RS Leaders')
    await waitFor(() => screen.getByTestId('focus-row-NVDA'))
    for (const b of scanBodies()) {
      expect(b.columns).not.toContain('rs_nh_weekly')
      expect(b.columns).not.toContain('rs_nhbp_weekly')
    }
  })
})
