// RS screens, unit U7: polish found on the real screens. Read on the starters the SERVER serves
// (rsScreensFixture reads the server suite's goldens), on the mounted page.
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
import { rankLabelOf } from '../rsScreens'
import { exitWarningWords, captionOf, rowConfigOf, rowColumns, EXIT_WARNING_NAMES } from '../rsRows'
import { net, resetNet, installFetch, mount, pin, scanBodies } from './rsHarness'
import { LEADERS, TOP_RATING, EXIT_WARNINGS, RS_STARTERS, RS_ROWS, SERVED, STARTERS_ON } from './rsScreensFixture'

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
const sortButton = () => screen.getByRole('button', { name: /^Sort:/ })

// ── P1: the sort label of a ranked screen ───────────────────────────────────
// A ranked starter that names nothing: today's product (UCT 50's shape).
const UCT50 = { id: 'starter_uct50_like', name: 'Ranked plain', group: 'Momentum leaders', description: 'A ranked screen',
  spec: { filters: [{ key: 'rs_rank', op: 'gte', min: 70 }], rank: { criteria: [{ key: 'rs_rank', weight: 1 }], top_n: 50 } } }

describe('P1: the list head names the order of a ranked screen', () => {
  test('the server names the order of UCT RS Leaders, and of no other of the five', () => {
    expect(LEADERS.row.sort_label).toBe('RS Rating')
    expect(TOP_RATING.row.sort_label).toBeUndefined()
  })

  test('UCT RS Leaders reads "Sort: RS Rating"', async () => {
    pin(['starter_rs_leaders'])
    mount()
    await landedOn('UCT RS Leaders')
    await waitFor(() => expect(sortButton()).toHaveAccessibleName('Sort: RS Rating'))
    expect(screen.queryByRole('button', { name: 'Sort: Your ranking' })).toBeNull()
  })

  test('a ranked screen whose starter names nothing still reads "Your ranking"', async () => {
    net.starters = [...STARTERS_ON, UCT50]
    pin([UCT50.id])
    mount()
    await landedOn('Ranked plain')
    await waitFor(() => expect(sortButton()).toHaveAccessibleName('Sort: Your ranking'))
  })

  test('a member\'s saved copy of UCT RS Leaders is their ranking', async () => {
    net.saved = [{ id: 9, name: 'My leaders', spec: LEADERS.spec }]
    pin(['9'])
    mount()
    await landedOn('My leaders')
    await waitFor(() => expect(sortButton()).toHaveAccessibleName('Sort: Your ranking'))
  })

  test('the label is the starter\'s only while the working rank is the starter\'s own', () => {
    const own = LEADERS.spec.rank
    expect(rankLabelOf(LEADERS, own)).toBe('RS Rating')
    // the same rank rebuilt (a URL round trip hands back a new object)
    expect(rankLabelOf(LEADERS, JSON.parse(JSON.stringify(own)))).toBe('RS Rating')
    // a rank the member changed is theirs: another cap, another criterion, another weight
    expect(rankLabelOf(LEADERS, { ...own, top_n: 20 })).toBeNull()
    expect(rankLabelOf(LEADERS, { ...own, criteria: [{ key: 'adr_pct', weight: 1 }] })).toBeNull()
    expect(rankLabelOf(LEADERS, { ...own, criteria: [...own.criteria, { key: 'adr_pct', weight: 1 }] })).toBeNull()
    expect(rankLabelOf(LEADERS, { ...own, criteria: own.criteria.map(c => ({ ...c, weight: 2 })) })).toBeNull()
    expect(rankLabelOf(LEADERS, null)).toBeNull()
    // from data, never from the id: no label, no name; a label without a rank of its own, no name
    expect(rankLabelOf({ ...LEADERS, row: { ...LEADERS.row, sort_label: undefined } }, own)).toBeNull()
    expect(rankLabelOf({ ...LEADERS, row: { ...LEADERS.row, sort_label: '  ' } }, own)).toBeNull()
    expect(rankLabelOf({ ...LEADERS, row: { ...LEADERS.row, sort_label: 7 } }, own)).toBeNull()
    expect(rankLabelOf({ ...TOP_RATING, row: { ...TOP_RATING.row, sort_label: 'RS Rating' } }, own)).toBeNull()
    expect(rankLabelOf(UCT50, UCT50.spec.rank)).toBeNull()
    expect(rankLabelOf(null, own)).toBeNull()
    // and any starter that carries one is read the same way
    expect(rankLabelOf({ ...UCT50, row: { sort_label: 'UCT score' } }, UCT50.spec.rank)).toBe('UCT score')
  })
})

// ── P2: RS exit warnings rows say which warning and how old ─────────────────
describe('P2: an RS exit warnings row names its warning and its age', () => {
  test('the words: the name of the warning, then today, yesterday or N sessions ago', () => {
    expect(exitWarningWords({ rs_exit_last: 'Quick Break', rs_exit_bars_ago: 0 })).toBe('Quick Break today')
    expect(exitWarningWords({ rs_exit_last: 'Quicksand', rs_exit_bars_ago: 1 })).toBe('Quicksand yesterday')
    expect(exitWarningWords({ rs_exit_last: 'Grateful Dead Break', rs_exit_bars_ago: 3 })).toBe('Grateful Dead Break 3 sessions ago')
    expect(exitWarningWords({ rs_exit_last: 'Quicksand', rs_exit_bars_ago: 2 })).toBe('Quicksand 2 sessions ago')
  })

  test.each([
    ['no warning', { rs_exit_last: null, rs_exit_bars_ago: 2 }],
    ['no age', { rs_exit_last: 'Quicksand', rs_exit_bars_ago: null }],
    ['neither column on the row', {}],
    ['an age that is not a number', { rs_exit_last: 'Quicksand', rs_exit_bars_ago: '2' }],
    ['an age before today', { rs_exit_last: 'Quicksand', rs_exit_bars_ago: -1 }],
    ['a name the server does not offer', { rs_exit_last: 'Sell now', rs_exit_bars_ago: 0 }],
    ['an empty name', { rs_exit_last: '', rs_exit_bars_ago: 0 }],
  ])('nothing is said with %s, and no separator is left behind', (_n, over) => {
    const row = { industry: 'Banks', ...over }
    expect(exitWarningWords(row)).toBe('')
    expect(captionOf(row, rowConfigOf(EXIT_WARNINGS))).toBe('Banks')
  })
  test('nothing at all for no row', () => { expect(exitWarningWords(null)).toBe('') })

  test('the names the client may print are the ones the server offers for the filter, in its order', () => {
    const served = SERVED.meta.filters.find(f => f.key === 'rs_exit_last').presets.filter(p => p.op === 'eq')
    expect(served.map(p => p.value)).toEqual(EXIT_WARNING_NAMES)
    expect(served.map(p => p.label)).toEqual(EXIT_WARNING_NAMES)
    // and the Type control of the screen offers the same three
    expect(EXIT_WARNINGS.controls[0].options.filter(o => !o.default).map(o => o.label)).toEqual(EXIT_WARNING_NAMES)
  })

  test('the server puts the part on RS exit warnings only, ahead of the group, and the screen asks for both columns', () => {
    expect(RS_STARTERS.filter(s => s.row.caption.includes('exit_warning')).map(s => s.id)).toEqual(['starter_rs_exit_warning_5'])
    expect(EXIT_WARNINGS.row.caption).toEqual(['exit_warning', 'group'])
    const cols = rowColumns(rowConfigOf(EXIT_WARNINGS))
    expect(cols).toContain('rs_exit_last')
    expect(cols).toContain('rs_exit_bars_ago')
    // a screen without the part asks for neither on its row's account
    expect(rowColumns(rowConfigOf(LEADERS))).not.toContain('rs_exit_last')
    expect(rowColumns(rowConfigOf(LEADERS))).not.toContain('rs_exit_bars_ago')
  })

  test('on the page: the scan asks for the two columns and each row reads its warning', async () => {
    const [nvda, mu, lly, xom, amd] = RS_ROWS
    net.rows = [
      { ...nvda, rs_exit_last: 'Quicksand', rs_exit_bars_ago: 1 },
      { ...mu, rs_exit_last: 'Grateful Dead Break', rs_exit_bars_ago: 3 },
      { ...lly, rs_exit_last: 'Quick Break', rs_exit_bars_ago: 0 },
      { ...xom, rs_exit_last: null, rs_exit_bars_ago: null },
      { ...amd, rs_exit_last: 'Quicksand', rs_exit_bars_ago: null },
    ]
    pin(['starter_rs_exit_warning_5'])
    mount()
    await landedOn('RS exit warnings')
    const caption = t => screen.getByTestId(`focus-row-${t}`).querySelector('[data-testid="rs-caption"]')
    await waitFor(() => expect(caption('NVDA')).toHaveTextContent('Quicksand yesterday · Semiconductors'))
    expect(caption('MU')).toHaveTextContent('Grateful Dead Break 3 sessions ago · Semiconductors')
    expect(caption('LLY')).toHaveTextContent('Quick Break today · Drug makers')
    expect(caption('XOM').textContent).toBe('Oil and gas')
    expect(caption('AMD').textContent).toBe('Semiconductors')
    expect(scanBodies()[0].columns).toEqual(expect.arrayContaining(['rs_exit_last', 'rs_exit_bars_ago']))
  })
})
