// RS screens, the first night. Every RS screen filters on a column only the overnight rating
// pass writes, so until that pass has run under the flag each of them comes back empty. The
// ordinary empty state then blamed the member's filters ("No stocks match all 12 filters") and
// the coverage line said every stock "has no RS Rating" (seen on the live site, 2026-11-15).
// The server now says the lists are not built yet (`rs_pending: { text }` in the saved-screens
// payload, api/services/screener/rs_post_pass.py::pending) and the page says that instead.
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { vi, beforeEach, expect, test } from 'vitest'
vi.mock('../../../../components/StockChart', () => ({ default: p => <div data-testid="stockchart" data-sym={p.sym} /> }))
vi.mock('../ScreenerChartWidget', () => ({ default: p => <div data-testid="stockchart" data-sym={p.sym} /> }))
vi.mock('../../shell/ScannerShell', () => ({ default: () => <div data-testid="table-mode" /> }))
vi.mock('../../../../hooks/useRealtimePrices', () => ({ default: () => ({ prices: {} }) }))
vi.mock('../../../../hooks/useNeighborWarm', () => ({ useNeighborWarm: () => {} }))
vi.mock('../../../../utils/prefetchBars', () => ({ prefetchBars: () => {}, prefetchBarsToIDB: () => {}, warmMemFromIDB: () => {}, prewarmVisibleList: () => {} }))
import { __resetCountCache } from '../useLazyCounts'
import { __resetRevisionStateForTests } from '../../../../hooks/usePreferences'
import { RS_NOTE_PREF } from '../rsScreens'
import { net, resetNet, installFetch, mount, pin } from './rsHarness'
import { RS_ROWS } from './rsScreensFixture'

// The server's sentence (tests/test_rs_screens_first_night.py holds it there).
const PENDING = { text: 'This list is not ready yet. It fills after the overnight rating run, at about 4:15 AM Eastern.' }
// What the live site answered that night: nothing listed, every stock "not computable".
const EMPTY = { rows: [], total: 0, coverage: { dropped: 0, not_computable: 11176 } }
const COVERAGE = /stocks have no (RS Rating|value for one of these filters)/

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
const openScreen = async name => {
  fireEvent.click(screen.getByRole('button', { name: /Change screen/ }))
  fireEvent.click(await screen.findByRole('button', { name: new RegExp(`^Open ${name}`) }))
}
const waiting = () => screen.queryByTestId('rs-empty')

test('an RS screen that is empty because the lists are not built yet says so, in the server\'s words', async () => {
  net.pending = PENDING
  net.scan = () => EMPTY
  pin(['starter_rs_leaders'])
  mount()
  await landedOn('UCT RS Leaders')
  await waitFor(() => expect(waiting()).toBeInTheDocument())
  expect(waiting()).toHaveTextContent('This list is not ready yet.')
  expect(waiting()).toHaveTextContent('It fills after the overnight rating run, at about 4:15 AM Eastern.')
  // not the member's filters, and not "every stock has no RS Rating"
  expect(screen.queryByText(/No stocks match/)).toBeNull()
  expect(screen.queryByText(/Remove one filter/)).toBeNull()
  expect(screen.queryByText(COVERAGE)).toBeNull()
  // nothing to press: there is no setting that brings the list back tonight
  expect(waiting().querySelectorAll('button')).toHaveLength(0)
})

test('every RS screen says it, not only the first', async () => {
  net.pending = PENDING
  net.scan = () => EMPTY
  pin(['starter_rs_leaders'])
  mount()
  await landedOn('UCT RS Leaders')
  for (const name of ['Top RS Rating', 'RS New Highs', 'RS New High Before Price']) {
    await openScreen(name)
    await landedOn(name)
    await waitFor(() => expect(waiting()).toHaveTextContent('This list is not ready yet.'))
    expect(screen.queryByText(/No stocks match/)).toBeNull()
    expect(screen.queryByText(COVERAGE)).toBeNull()
  }
})

test('a list that came back with rows is shown, whatever the payload said at page load', async () => {
  // the page was opened before the run and the scan has since brought rows back
  net.pending = PENDING
  net.scan = () => ({ rows: RS_ROWS, total: RS_ROWS.length, coverage: { dropped: 0, not_computable: 4000 } })
  pin(['starter_rs_leaders'])
  mount()
  await landedOn('UCT RS Leaders')
  await waitFor(() => screen.getByTestId('focus-row-NVDA'))
  expect(waiting()).toBeNull()
  expect(screen.queryByText(/not ready yet/)).toBeNull()
  // and the coverage line is back: it describes a screen that ran
  expect(screen.getByText(COVERAGE)).toBeInTheDocument()
})

test('with no such key, an empty RS screen is the state it was: the filters and the coverage line', async () => {
  net.scan = () => EMPTY
  pin(['starter_rs_leaders'])
  mount()
  await landedOn('UCT RS Leaders')
  await waitFor(() => expect(screen.getByText(/No stocks match/)).toBeInTheDocument())
  expect(screen.queryByText(/not ready yet/)).toBeNull()
  expect(screen.getByText(COVERAGE)).toBeInTheDocument()
})

test.each([
  ['null', null],
  ['words that are not text', { text: 7 }],
  ['blank words', { text: '' }],
  ['a bare string', 'pending'],
])('a payload that carries no sentence (%s) changes nothing', async (_n, pending) => {
  net.pending = pending
  net.scan = () => EMPTY
  pin(['starter_rs_leaders'])
  mount()
  await landedOn('UCT RS Leaders')
  await waitFor(() => expect(screen.getByText(/No stocks match/)).toBeInTheDocument())
  expect(screen.queryByText(/not ready yet/)).toBeNull()
})

test('a screen that is not one of the RS screens keeps its own empty state', async () => {
  net.pending = PENDING
  net.scan = () => EMPTY
  pin(['starter_power_play'])
  mount()
  await landedOn('Power plays')
  await waitFor(() => expect(screen.getByText(/No stocks match/)).toBeInTheDocument())
  expect(waiting()).toBeNull()
  expect(screen.queryByText(/not ready yet/)).toBeNull()
})
