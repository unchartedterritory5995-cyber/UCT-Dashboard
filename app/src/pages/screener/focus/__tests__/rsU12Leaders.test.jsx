// RS screens, unit U12, item W2: a steadier UCT RS Leaders list. The server now decides who is on
// the list once a session (join at 50 or better, stay to 65) and stores `rs_leaders_member`; the
// screen is its filters plus that column equal to 1, in a PLAIN sort by the RS Rating score. So
// the client no longer sends a rank for it, still says "Sort: RS Rating" at the list head, still
// numbers the rows by position, and adds one quiet fact to the why strip: "Day 12 on this list".
// Read on the starters the SERVER serves (rsScreensFixture reads the server suite's goldens).
import { screen, waitFor, within } from '@testing-library/react'
import { vi, beforeEach, describe, expect, test } from 'vitest'
vi.mock('../../../../components/StockChart', () => ({ default: p => <div data-testid="stockchart" data-sym={p.sym} /> }))
vi.mock('../ScreenerChartWidget', () => ({ default: p => <div data-testid="stockchart" data-sym={p.sym} /> }))
vi.mock('../../shell/ScannerShell', () => ({ default: () => <div data-testid="table-mode" /> }))
vi.mock('../../../../hooks/useRealtimePrices', () => ({ default: () => ({ prices: {} }) }))
vi.mock('../../../../hooks/useNeighborWarm', () => ({ useNeighborWarm: () => {} }))
vi.mock('../../../../utils/prefetchBars', () => ({ prefetchBars: () => {}, prefetchBarsToIDB: () => {}, warmMemFromIDB: () => {}, prewarmVisibleList: () => {} }))
import { __resetCountCache } from '../useLazyCounts'
import { __resetRevisionStateForTests } from '../../../../hooks/usePreferences'
import { daysWords, rowConfigOf, rowColumns, rowFacts, captionOf, placeOf } from '../rsRows'
import { sortLabelOf, steadyOf, RS_NOTE_PREF, RS_SCREENS_COLUMNS } from '../rsScreens'
import { net, resetNet, installFetch, mount, pin, scanBodies } from './rsHarness'
import { TOP_RATING, NEW_HIGHS, BEFORE_PRICE, LEADERS, EXIT_WARNINGS, RS_STARTERS, RS_ROWS, STARTERS_ON } from './rsScreensFixture'

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
const sortButton = () => screen.getByRole('button', { name: /^Sort:/ })
// A ranked starter that names its own order: what UCT RS Leaders was before this unit.
const RANKED = { id: 'starter_ranked_named', name: 'Ranked named', group: 'Momentum leaders', description: 'A ranked screen',
  spec: { filters: [{ key: 'rs_rank', op: 'gte', min: 70 }], rank: { criteria: [{ key: 'rs_rank', weight: 1 }], top_n: 50 } },
  row: { place: 'index', caption: ['group'], tags: ['new'], sort_label: 'UCT score' } }

describe('what the server serves for UCT RS Leaders', () => {
  test('a filter on membership and a plain sort by the score, no rank', () => {
    expect(LEADERS.spec.rank).toBeUndefined()
    expect(LEADERS.spec.sort).toEqual({ key: 'rs_rating_score', dir: 'desc' })
    expect(LEADERS.spec.filters).toContainEqual({ key: 'rs_leaders_member', op: 'eq', value: 1 })
    expect(LEADERS.row.place).toBe('index')
    expect(LEADERS.row.sort_label).toBe('RS Rating')
    expect(LEADERS.row.facts).toEqual(['days'])
    expect(LEADERS.row.steady).toEqual({ key: 'rs_leaders_member', by: 'rs_rating_score', enter: 50, hold: 65 })
    // no control of the screen owns the membership clause: a quick control can never take it off
    for (const c of LEADERS.controls) expect(c.keys).not.toContain('rs_leaders_member')
    for (const st of [TOP_RATING, NEW_HIGHS, BEFORE_PRICE, EXIT_WARNINGS]) {
      expect(st.row.facts, st.id).toBeUndefined()
      expect(st.row.steady, st.id).toBeUndefined()
    }
    expect(RS_SCREENS_COLUMNS).toEqual(expect.arrayContaining(['rs_leaders_member', 'rs_leaders_days']))
  })
})

describe('the list head still names the order', () => {
  test('a plain sort: the starter\'s label while the working sort is the starter\'s own', () => {
    const own = LEADERS.spec.sort
    expect(sortLabelOf(LEADERS, { sort: own })).toBe('RS Rating')
    expect(sortLabelOf(LEADERS, { sort: { ...own } })).toBe('RS Rating')
    // a sort the member changed is theirs: reversed, another column, a second key
    expect(sortLabelOf(LEADERS, { sort: { ...own, dir: 'asc' } })).toBeNull()
    expect(sortLabelOf(LEADERS, { sort: { key: 'adr_pct', dir: 'desc' } })).toBeNull()
    expect(sortLabelOf(LEADERS, { sort: { ...own, then: { key: 'adr_pct', dir: 'desc' } } })).toBeNull()
    expect(sortLabelOf(LEADERS, { sort: null })).toBeNull()
    // a rank laid over it is a ranking, and theirs
    expect(sortLabelOf(LEADERS, { sort: own, rank: RANKED.spec.rank })).toBeNull()
    // from data, never from the id
    expect(sortLabelOf({ ...LEADERS, row: { ...LEADERS.row, sort_label: undefined } }, { sort: own })).toBeNull()
    expect(sortLabelOf({ ...LEADERS, row: { ...LEADERS.row, sort_label: '  ' } }, { sort: own })).toBeNull()
    expect(sortLabelOf(TOP_RATING, { sort: TOP_RATING.spec.sort })).toBeNull()
    expect(sortLabelOf(null, { sort: own })).toBeNull()
    expect(sortLabelOf({ ...TOP_RATING, row: { ...TOP_RATING.row, sort_label: 'Place' } }, { sort: TOP_RATING.spec.sort })).toBe('Place')
  })

  test('a ranked starter that names its order is read as before: while the working rank is its own', () => {
    const own = RANKED.spec.rank
    expect(sortLabelOf(RANKED, { rank: own })).toBe('UCT score')
    expect(sortLabelOf(RANKED, { rank: JSON.parse(JSON.stringify(own)) })).toBe('UCT score')
    expect(sortLabelOf(RANKED, { rank: { ...own, top_n: 20 } })).toBeNull()
    expect(sortLabelOf(RANKED, { rank: null, sort: { key: 'rs_rank', dir: 'desc' } })).toBeNull()
  })

  test('UCT RS Leaders reads "Sort: RS Rating", sends its sort and no rank, and numbers rows by position', async () => {
    pin(['starter_rs_leaders'])
    mount()
    await landedOn('UCT RS Leaders')
    await waitFor(() => expect(sortButton()).toHaveAccessibleName('Sort: RS Rating'))
    const body = scanBodies()[0]
    expect(body.rank).toBeUndefined()
    expect(body.sort).toEqual({ key: 'rs_rating_score', dir: 'desc' })
    expect(body.filters).toContainEqual({ key: 'rs_leaders_member', op: 'eq', value: 1 })
    // the fact's column is asked for; the sort column rides on every row the server sends
    expect(body.columns).toContain('rs_leaders_days')
    await waitFor(() => screen.getByTestId('focus-row-NVDA'))
    const places = RS_ROWS.map(r => screen.getByTestId(`focus-row-${r.ticker}`).querySelector('[data-testid="rs-place"]')?.textContent)
    // ("Place " and ", " are for a screen reader; the numeral is the row's position in the list)
    expect(places).toEqual(RS_ROWS.map((_r, i) => `Place ${i + 1}, `))
  })

  test('a ranked starter that names its order still says so on the page', async () => {
    net.starters = [...STARTERS_ON, RANKED]
    pin([RANKED.id])
    mount()
    await landedOn('Ranked named')
    await waitFor(() => expect(sortButton()).toHaveAccessibleName('Sort: UCT score'))
  })

  test('a member\'s saved copy of UCT RS Leaders reads its sort column like any saved screen', async () => {
    net.saved = [{ id: 9, name: 'My leaders', spec: LEADERS.spec }]
    pin(['9'])
    mount()
    await landedOn('My leaders')
    await waitFor(() => expect(sortButton().getAttribute('aria-label') || sortButton().textContent).toMatch(/^Sort: /))
    expect(sortButton()).not.toHaveAccessibleName('Sort: RS Rating')
    expect(sortButton()).not.toHaveAccessibleName('Sort: Your ranking')
  })
})

describe('the place numeral', () => {
  test('by position on UCT RS Leaders, whatever the row carries', () => {
    const cfg = rowConfigOf(LEADERS)
    expect(cfg.place).toBe('index')
    expect([0, 1, 49].map(i => placeOf({ rs_rating_pos: 900 }, cfg, i))).toEqual([1, 2, 50])
  })
})

describe('"Day N on this list": a why strip fact, never part of the caption', () => {
  test('the words', () => {
    expect(daysWords({ rs_leaders_days: 12 })).toBe('Day 12 on this list')
    expect(daysWords({ rs_leaders_days: 1 })).toBe('Day 1 on this list')
    for (const v of [0, -3, null, undefined, 2.5, '4', NaN, true]) expect(daysWords({ rs_leaders_days: v }), String(v)).toBe('')
    expect(daysWords(null)).toBe('')
  })

  test('the screen that carries the fact asks for its column; the others do not', () => {
    expect(rowConfigOf(LEADERS).facts).toEqual(['days'])
    expect(rowColumns(rowConfigOf(LEADERS))).toContain('rs_leaders_days')
    for (const st of RS_STARTERS.filter(s => s.id !== LEADERS.id)) {
      expect(rowConfigOf(st).facts, st.id).toEqual([])
      expect(rowColumns(rowConfigOf(st)), st.id).not.toContain('rs_leaders_days')
    }
  })

  test('it leads the facts on UCT RS Leaders and is in no caption', () => {
    const row = { ...RS_ROWS[0], rs_leaders_days: 12 }
    const cfg = rowConfigOf(LEADERS)
    expect(rowFacts(row, cfg).map(f => f.label)[0]).toBe('Day 12 on this list')
    expect(rowFacts(row, cfg).slice(1)).toEqual(rowFacts(row))
    expect(captionOf(row, cfg)).not.toMatch(/day/i)
    // a row that carries no count, and a screen that does not carry the fact, read as before
    expect(rowFacts({ ...row, rs_leaders_days: null }, cfg)).toEqual(rowFacts(row))
    expect(rowFacts(row, rowConfigOf(TOP_RATING))).toEqual(rowFacts(row))
    expect(rowFacts(row, null)).toEqual(rowFacts(row))
  })

  test('on the page: the selected row says how long it has been on the list', async () => {
    net.rows = RS_ROWS.map((r, i) => ({ ...r, rs_leaders_days: i === 0 ? 12 : null }))
    pin(['starter_rs_leaders'])
    mount()
    await landedOn('UCT RS Leaders')
    await waitFor(() => screen.getByTestId('focus-row-NVDA'))
    await waitFor(() => expect(screen.getByText('Day 12 on this list')).toBeInTheDocument())
    expect(within(screen.getByTestId('focus-row-NVDA')).queryByText(/Day 12/)).toBeNull()
  })
})

describe('how the list is kept, for "Why isn\'t a stock here?"', () => {
  test('the rule is read from the starter\'s data, with the screen\'s own qualifying rules', () => {
    const steady = steadyOf(LEADERS)
    expect(steady).toMatchObject({ key: 'rs_leaders_member', by: 'rs_rating_score', enter: 50, hold: 65 })
    expect(steady.gate).toEqual(LEADERS.spec.filters.filter(f => f.key !== 'rs_leaders_member'))
    expect(steady.gate.map(f => f.key)).not.toContain('rs_leaders_member')
    for (const st of RS_STARTERS.filter(s => s.id !== LEADERS.id)) expect(steadyOf(st), st.id).toBeNull()
    expect(steadyOf(null)).toBeNull()
    // a rule with a part missing is no rule
    for (const bad of [{ key: '', by: 'x', enter: 50, hold: 65 }, { key: 'a', by: 'b', enter: '50', hold: 65 }, { key: 'a', by: 'b', enter: 50 }, 'steady', null]) {
      expect(steadyOf({ ...LEADERS, row: { ...LEADERS.row, steady: bad } })).toBeNull()
    }
  })
})
