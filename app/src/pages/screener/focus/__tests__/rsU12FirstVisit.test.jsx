// RS screens, unit U12, item W3.1: the first-visit line is about the LIST screens. Its sentence is
// "The strongest liquid stocks, ranked. The line under each name says whether it is extended or
// near a buy point." That is true of Top RS Rating, RS New Highs, RS New High Before Price and
// UCT RS Leaders, and not of RS exit warnings, which lists stocks whose RS line just broke down.
// The server says which screens are lists (`row.list`); the client never reads a screen's id.
import { act, screen, waitFor } from '@testing-library/react'
import { vi, beforeEach, describe, expect, test } from 'vitest'
vi.mock('../../../../components/StockChart', () => ({ default: p => <div data-testid="stockchart" data-sym={p.sym} /> }))
vi.mock('../ScreenerChartWidget', () => ({ default: p => <div data-testid="stockchart" data-sym={p.sym} /> }))
vi.mock('../../shell/ScannerShell', () => ({ default: () => <div data-testid="table-mode" /> }))
vi.mock('../../../../hooks/useRealtimePrices', () => ({ default: () => ({ prices: {} }) }))
vi.mock('../../../../hooks/useNeighborWarm', () => ({ useNeighborWarm: () => {} }))
vi.mock('../../../../utils/prefetchBars', () => ({ prefetchBars: () => {}, prefetchBarsToIDB: () => {}, warmMemFromIDB: () => {}, prewarmVisibleList: () => {} }))
import { __resetCountCache } from '../useLazyCounts'
import { __resetRevisionStateForTests } from '../../../../hooks/usePreferences'
import { rowConfigOf } from '../rsRows'
import { FIRST_VISIT_TEXT } from '../RsScreenParts'
import { net, resetNet, installFetch, mount, pin } from './rsHarness'
import { TOP_RATING, NEW_HIGHS, BEFORE_PRICE, LEADERS, EXIT_WARNINGS, RS_STARTERS, PLAIN_STARTERS, STARTERS_ON } from './rsScreensFixture'

beforeEach(() => {
  __resetCountCache()
  __resetRevisionStateForTests()
  localStorage.clear()
  sessionStorage.clear()
  window.history.replaceState(null, '', '/')
  resetNet()
  net.prefs = {}                       // a member who has not dismissed the line
  installFetch()
})
const landedOn = name => waitFor(() => expect(screen.getByRole('button', { name: new RegExp(`^${name}.*Change screen`) })).toBeInTheDocument())
const settle = () => act(async () => { await new Promise(r => setTimeout(r, 80)) })
const LIST_SCREENS = [TOP_RATING, NEW_HIGHS, BEFORE_PRICE, LEADERS]

describe('which screens are lists', () => {
  test('the server marks the four list screens, and RS exit warnings carries no mark', () => {
    for (const st of LIST_SCREENS) expect(st.row.list, st.id).toBe(true)
    expect('list' in EXIT_WARNINGS.row).toBe(false)
    expect(RS_STARTERS.filter(s => s.row.list === true).map(s => s.id)).toEqual(LIST_SCREENS.map(s => s.id))
  })

  test('the row recipe reads it as a plain yes or no, from the data and never from the id', () => {
    for (const st of LIST_SCREENS) expect(rowConfigOf(st).list, st.id).toBe(true)
    expect(rowConfigOf(EXIT_WARNINGS).list).toBe(false)
    // only a real `true` counts: a word, a 1 or a missing key is not a list
    for (const v of ['yes', 1, null, undefined, {}]) expect(rowConfigOf({ ...LEADERS, row: { ...LEADERS.row, list: v } }).list, String(v)).toBe(false)
    // the same starter under another id reads the same
    expect(rowConfigOf({ ...EXIT_WARNINGS, id: 'starter_rs_leaders' }).list).toBe(false)
    expect(rowConfigOf({ ...LEADERS, id: 'starter_rs_exit_warning_5' }).list).toBe(true)
    for (const st of PLAIN_STARTERS) expect(rowConfigOf(st)).toBeNull()
  })
})

describe('the first-visit line', () => {
  test.each(LIST_SCREENS.map(st => [st.name, st]))('%s shows it', async (_n, st) => {
    pin([st.id])
    mount()
    await landedOn(st.name)
    const note = await screen.findByTestId('rs-first-visit')
    expect(note).toHaveTextContent(FIRST_VISIT_TEXT)
  })

  test('RS exit warnings does not, for a member who has never dismissed it', async () => {
    pin([EXIT_WARNINGS.id])
    mount()
    await landedOn('RS exit warnings')
    await waitFor(() => screen.getByTestId('focus-row-NVDA'))
    await settle()
    expect(screen.queryByTestId('rs-first-visit')).toBeNull()
    expect(screen.queryByText(/strongest liquid stocks/)).toBeNull()
    // and the screen is still an RS screen in every other way: its rows are RS rows
    expect(screen.getByTestId('focus-row-NVDA')).toHaveAttribute('data-rs-row')
    expect(net.prefs.screener_rs_note_seen).toBeUndefined()
  })

  test('a warnings screen marked as a list would show it: the mark decides, not the id', async () => {
    net.starters = STARTERS_ON.map(s => (s.id === EXIT_WARNINGS.id ? { ...s, row: { ...s.row, list: true } } : s))
    pin([EXIT_WARNINGS.id])
    mount()
    await landedOn('RS exit warnings')
    expect(await screen.findByTestId('rs-first-visit')).toBeInTheDocument()
  })

  test('a list screen that loses the mark stops showing it', async () => {
    net.starters = STARTERS_ON.map(s => (s.id === LEADERS.id ? { ...s, row: { ...s.row, list: false } } : s))
    pin([LEADERS.id])
    mount()
    await landedOn('UCT RS Leaders')
    await waitFor(() => screen.getByTestId('focus-row-NVDA'))
    await settle()
    expect(screen.queryByTestId('rs-first-visit')).toBeNull()
  })
})
