// RS screens (unit U5), item 3 on the page: the list asks the server for an RS row's columns
// ONLY on a screen whose starter carries `row`, and such a screen draws the RS row.
import { screen, waitFor, fireEvent, act } from '@testing-library/react'
import { vi, beforeEach, expect, test } from 'vitest'
vi.mock('../../../../components/StockChart', () => ({ default: p => <div data-testid="stockchart" data-sym={p.sym} /> }))
vi.mock('../ScreenerChartWidget', () => ({ default: p => <div data-testid="stockchart" data-sym={p.sym} /> }))
vi.mock('../../shell/ScannerShell', () => ({ default: () => <div data-testid="table-mode" /> }))
vi.mock('../../../../hooks/useRealtimePrices', () => ({ default: () => ({ prices: {} }) }))
vi.mock('../../../../hooks/useNeighborWarm', () => ({ useNeighborWarm: () => {} }))
vi.mock('../../../../utils/prefetchBars', () => ({ prefetchBars: () => {}, prefetchBarsToIDB: () => {}, warmMemFromIDB: () => {}, prewarmVisibleList: () => {} }))
import { __resetCountCache } from '../useLazyCounts'
import { __resetRevisionStateForTests } from '../../../../hooks/usePreferences'
import { lastScreenKey, landingSeedKey, readLastScreen, readLandingSeed, writeLastScreen, writeLandingSeed, rsExtras } from '../landing'
import { rowColumns, rowConfigOf } from '../rsRows'
import { net, resetNet, installFetch, mount, scanBodies, pin } from './rsHarness'
import { NEW_HIGHS, TOP_RATING, LEADERS, PLAIN_STARTERS, STARTERS_ON, RS_STARTERS } from './rsScreensFixture'

// What the list asked for before the unit, for a starter with two checkable filters.
const LEGACY = ['ticker', 'company', 'price', 'chg_pct_1d', 'base_render', 'base_pivot_px', 'vol_ratio', 'rvol_live', 'rs_rank',
  'market_cap', 'adr_pct', 'industry', 'sector', 'next_earnings_date', 'bars_asof']
// Columns only an RS row reads (none of them is in the legacy request).
const RS_ONLY = ['rs_setup', 'rs_tight', 'rs_flag', 'rs_rating_session', 'rs_rating_pos', 'rs_rating_pos_n', 'rs_nh_bars_ago', 'px_below_high_pct',
  'rs_nhbp_age', 'rs_nh_red_bars_ago', 'rs_rating_pos_prev20', 'rs_rating_chg_5']

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
const openScreen = async name => {
  fireEvent.click(screen.getByRole('button', { name: /Change screen/ }))
  fireEvent.click(await screen.findByRole('button', { name: new RegExp(`^Open ${name}`) }))
}
const rowEl = t => screen.getByTestId(`focus-row-${t}`)

test.each(RS_STARTERS.map(s => [s.name, s]))('%s asks for exactly its row\'s columns on top of the list\'s own', async (_n, st) => {
  pin([st.id])
  mount()
  await landedOn(st.name)
  await waitFor(() => screen.getByTestId('focus-row-NVDA'))
  const cols = scanBodies().at(-1).columns
  for (const c of [...LEGACY, ...rowColumns(rowConfigOf(st))]) expect(cols).toContain(c)
  // nothing RS-only beyond what this screen's row reads and its own filters check (the why strip's columns)
  const allowed = [...new Set([...rowColumns(rowConfigOf(st)), ...st.spec.filters.map(f => f.key)])]
  expect(cols.filter(c => RS_ONLY.includes(c)).sort()).toEqual(allowed.filter(c => RS_ONLY.includes(c)).sort())
  expect(new Set(cols).size).toBe(cols.length)
})

test('a screen without `row` asks for none of them, before and after an RS screen was open', async () => {
  pin(['starter_power_play', 'starter_rs_leaders'])
  mount()
  await landedOn('Power plays')
  await waitFor(() => screen.getByTestId('focus-row-NVDA'))
  const plain = scanBodies().at(-1).columns
  expect(plain.filter(c => RS_ONLY.includes(c))).toEqual([])
  expect(plain.slice(0, LEGACY.length)).toEqual(LEGACY)
  await openScreen('UCT RS Leaders')
  await waitFor(() => expect(scanBodies().at(-1).columns).toContain('rs_setup'))
  // every scan that asked for an RS column was for the RS screen (it is the ranked one)
  for (const b of scanBodies()) expect(b.columns.some(c => RS_ONLY.includes(c))).toBe(!!b.rank)
  await openScreen('Power plays')
  await landedOn('Power plays')
  expect(screen.queryByTestId('rs-controls')).toBeNull()
})

test('with no RS screens in the payload nothing RS is ever asked for', async () => {
  net.starters = PLAIN_STARTERS
  mount()
  await landedOn('Power plays')
  await waitFor(() => screen.getByTestId('focus-row-NVDA'))
  for (const b of scanBodies()) expect(b.columns.filter(c => RS_ONLY.includes(c))).toEqual([])
})

test('an RS screen draws the RS row: place, lead number, the caption with the stock\'s theme, one tag', async () => {
  net.themes = { NVDA: 'AI chips' }
  pin(['starter_rs_leaders'])
  mount()
  await landedOn('UCT RS Leaders')
  await waitFor(() => expect(rowEl('NVDA')).toHaveAttribute('data-rs-row'))
  expect(rowEl('NVDA').querySelector('[data-testid="rs-place"]')).toHaveTextContent('1')
  expect(rowEl('MU').querySelector('[data-testid="rs-place"]')).toHaveTextContent('2')
  expect(rowEl('NVDA').querySelector('[data-testid="rs-lead"]')).toHaveTextContent('RS 97')
  await waitFor(() => expect(rowEl('NVDA').querySelector('[data-testid="rs-caption"]')).toHaveTextContent('At pivot · AI chips'))
  // no theme for this one: its industry
  expect(rowEl('LLY').querySelector('[data-testid="rs-caption"]')).toHaveTextContent('Tight range · Drug makers')
  expect(rowEl('LLY').querySelector('[data-testid="rs-tag"]')).toHaveTextContent('New issue')
  // arrow keys and the chart still follow the list
  fireEvent.keyDown(screen.getByRole('listbox'), { key: 'ArrowDown' })
  expect(screen.getByTestId('stockchart')).toHaveAttribute('data-sym', 'MU')
})

test('the New tag on an RS row is the list\'s own new-today marker', async () => {
  net.diff = { state: 'ok', entered: ['NVDA'], exited: [], new_since_label: 'since Nov 12' }
  pin(['starter_rs_top_rating'])
  mount({ user: { id: 'member-a' }, screenerNewTodayEnabled: true })
  await landedOn('Top RS Rating')
  await waitFor(() => expect(rowEl('NVDA').querySelector('[data-testid="rs-tag"]')).toHaveTextContent('New'))
  expect(rowEl('MU').querySelector('[data-testid="rs-tag"]')).toBeNull()
})

test('a plain screen keeps the list\'s own row', async () => {
  pin(['starter_power_play'])
  mount()
  await landedOn('Power plays')
  await waitFor(() => screen.getByTestId('focus-row-NVDA'))
  expect(rowEl('NVDA')).not.toHaveAttribute('data-rs-row')
  expect(rowEl('NVDA').querySelector('[data-testid="rs-lead"]')).toBeNull()
})

// The common open: the member's last-used screen lands from this browser before any read answers.
test('a last-used RS screen lands knowing its row: ONE scan, with the RS columns, and RS rows before the saved screens answer', async () => {
  net.savedDelay = 700
  writeLastScreen('member-a', { ...LEADERS, kind: 'starter' })
  expect(readLastScreen('member-a').row).toEqual(LEADERS.row)
  mount()
  await waitFor(() => expect(rowEl('NVDA')).toHaveAttribute('data-rs-row'), { timeout: 600 })
  expect(fetch.mock.results.length).toBeGreaterThan(0)
  expect(scanBodies()).toHaveLength(1)
  expect(scanBodies()[0].columns).toContain('rs_setup')
  expect(screen.getByTestId('rs-controls')).toBeInTheDocument()
  // the live payload then replaces the remembered copy of the same starter without asking again
  await waitFor(() => expect(fetch.mock.calls.some(([u]) => String(u).startsWith('/api/screener/saved-screens'))).toBe(true))
  await new Promise(r => setTimeout(r, 900))
  expect(scanBodies()).toHaveLength(1)
  expect(rowEl('NVDA')).toHaveAttribute('data-rs-row')
})

test('a first-timer\'s seeded landing knows its row too, and the seed is written with it', async () => {
  net.savedDelay = 700
  writeLandingSeed('member-a', [{ ...LEADERS, kind: 'starter' }, { ...PLAIN_STARTERS[0], kind: 'starter' }])
  mount()
  await waitFor(() => expect(rowEl('NVDA')).toHaveAttribute('data-rs-row'), { timeout: 600 })
  expect(scanBodies()[0].columns).toContain('rs_setup')
  await waitFor(() => expect(readLandingSeed('member-a')?.length).toBeGreaterThan(2), { timeout: 2000 })
  const seed = readLandingSeed('member-a')
  expect(seed[0]).toMatchObject({ id: 'starter_rs_leaders', row: LEADERS.row, controls: LEADERS.controls })
  // a plain starter's entry is what it was before the unit: four keys, nothing more
  expect(Object.keys(seed.find(x => x.id === 'starter_power_play')).sort()).toEqual(['id', 'kind', 'name', 'spec'])
})

test('choosing a screen remembers it with what its starter adds; a plain one with nothing more', async () => {
  pin(['starter_power_play', 'starter_rs_new_high'])
  mount()
  await landedOn('Power plays')
  await openScreen('RS New Highs')
  await landedOn('RS New Highs')
  const kept = JSON.parse(localStorage.getItem(lastScreenKey('member-a')))
  expect(kept).toMatchObject({ id: NEW_HIGHS.id, kind: 'starter', spec: NEW_HIGHS.spec, row: NEW_HIGHS.row, controls: NEW_HIGHS.controls })
  expect(kept.empty).toBeUndefined()
  await openScreen('Power plays')
  await landedOn('Power plays')
  expect(Object.keys(JSON.parse(localStorage.getItem(lastScreenKey('member-a')))).sort()).toEqual(['id', 'kind', 'name', 'spec'])
  expect(localStorage.getItem(landingSeedKey('member-a'))).toBeTruthy()
})

test('when the RS screens leave the payload mid-visit, the open screen stops being an RS screen', async () => {
  pin(['starter_power_play', 'starter_rs_leaders'])
  mount()
  await landedOn('Power plays')
  await openScreen('UCT RS Leaders')
  await waitFor(() => expect(rowEl('NVDA')).toHaveAttribute('data-rs-row'))
  // the flag goes off: the next read of the saved screens carries no RS starter at all
  net.starters = PLAIN_STARTERS
  // (SWR re-reads on reconnect at once; a focus event is throttled for five seconds after mount)
  await act(async () => { window.dispatchEvent(new Event('online')) })
  await waitFor(() => expect(rowEl('NVDA')).not.toHaveAttribute('data-rs-row'), { timeout: 3000 })
  expect(screen.queryByTestId('rs-controls')).toBeNull()
  await waitFor(() => expect(scanBodies().at(-1).columns).not.toContain('rs_setup'))
})

test('rsExtras keeps only the three optional objects', () => {
  expect(rsExtras(TOP_RATING)).toEqual({ controls: TOP_RATING.controls, row: TOP_RATING.row })
  expect(rsExtras(PLAIN_STARTERS[0])).toEqual({})
  expect(rsExtras({ row: 'x', controls: null, empty: 0, hidden: true, aliases: ['a'] })).toEqual({})
  expect(rsExtras(null)).toEqual({})
  expect(STARTERS_ON.filter(s => Object.keys(rsExtras(s)).length).map(s => s.id)).toEqual(RS_STARTERS.map(s => s.id))
})

test('a remembered row is dropped when the live payload no longer carries it (the flag went off)', async () => {
  // this browser remembers UCT RS Leaders as an RS screen; the server now sends it plain
  writeLastScreen('member-a', { ...LEADERS, kind: 'starter' })
  net.starters = [{ id: LEADERS.id, name: LEADERS.name, group: LEADERS.group, description: LEADERS.description, spec: LEADERS.spec }, ...PLAIN_STARTERS]
  net.savedDelay = 700
  mount()
  await waitFor(() => expect(rowEl('NVDA')).toHaveAttribute('data-rs-row'), { timeout: 600 })
  await waitFor(() => expect(rowEl('NVDA')).not.toHaveAttribute('data-rs-row'), { timeout: 2000 })
  expect(screen.queryByTestId('rs-controls')).toBeNull()
  expect(scanBodies().at(-1).columns).not.toContain('rs_setup')
})
