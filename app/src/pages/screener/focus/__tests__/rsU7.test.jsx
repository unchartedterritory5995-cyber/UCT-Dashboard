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
import { net, resetNet, installFetch, mount, pin } from './rsHarness'
import { LEADERS, TOP_RATING, STARTERS_ON } from './rsScreensFixture'

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
