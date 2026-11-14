// RS screens (unit U5), item 2 on the page: a quick control edits the working spec through the
// Filters drawer's own editor (so the scan, the Filters count and the "(edited)" mark agree), the
// choice is remembered per member per screen, and Reset restores the starter.
import { screen, waitFor, fireEvent, within, act } from '@testing-library/react'
import { vi, beforeEach, expect, test } from 'vitest'
vi.mock('../../../../components/StockChart', () => ({ default: p => <div data-testid="stockchart" data-sym={p.sym} /> }))
vi.mock('../ScreenerChartWidget', () => ({ default: p => <div data-testid="stockchart" data-sym={p.sym} /> }))
vi.mock('../../shell/ScannerShell', () => ({ default: () => <div data-testid="table-mode" /> }))
vi.mock('../../../../hooks/useRealtimePrices', () => ({ default: () => ({ prices: {} }) }))
vi.mock('../../../../hooks/useNeighborWarm', () => ({ useNeighborWarm: () => {} }))
vi.mock('../../../../utils/prefetchBars', () => ({ prefetchBars: () => {}, prefetchBarsToIDB: () => {}, warmMemFromIDB: () => {}, prewarmVisibleList: () => {} }))
import { __resetCountCache } from '../useLazyCounts'
import { __resetRevisionStateForTests } from '../../../../hooks/usePreferences'
import { lastScreenKey } from '../landing'
import { SPEC_PARAM, encodeSpec, decodeSpec } from '../../shell/specUrl'
import { specWithOption, controlsOf } from '../rsScreens'
import { net, resetNet, installFetch, mount, scanBodies, prefPosts, clauseOf, pin } from './rsHarness'
import { NEW_HIGHS, TOP_RATING, LEADERS, BEFORE_PRICE } from './rsScreensFixture'

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
const row = () => screen.getByTestId('rs-controls')
const group = name => within(row()).getAllByRole('radiogroup', { name })[0]
const checked = g => within(g).getAllByRole('radio').filter(r => r.getAttribute('aria-checked') === 'true').map(r => r.textContent)
const choose = (g, name) => fireEvent.click(within(group(g)).getByRole('radio', { name }))
const filterKeys = body => body.filters.map(f => f.key).sort()
const openScreen = async name => {
  fireEvent.click(screen.getByRole('button', { name: /Change screen/ }))
  fireEvent.click(await screen.findByRole('button', { name: new RegExp(`^Open ${name}`) }))
}
// The working spec as the page last wrote it to the URL (a debounced write). ⛔ Read from the URL,
// not from the scan calls, wherever a test RETURNS to a spec it already asked: the scan hook
// answers a revisit from its own kept answers and sends nothing.
const urlSpec = () => decodeSpec(new URLSearchParams(window.location.search).get(SPEC_PARAM))
const keyed = spec => Object.fromEntries(spec.filters.map(({ key, ...r }) => [key, r]))
const keyedUrl = spec => `/?${SPEC_PARAM}=${encodeSpec({ filters: Object.fromEntries(spec.filters.map(({ key, ...r }) => [key, r])), sort: spec.sort, view: spec.view, rank: spec.rank })}`

test('the controls row shows only on a screen whose starter declares controls', async () => {
  pin(['starter_power_play', 'starter_rs_new_high'])
  mount()
  await landedOn('Power plays')
  await waitFor(() => screen.getByTestId('focus-row-NVDA'))
  expect(screen.queryByTestId('rs-controls')).toBeNull()
  await openScreen('RS New Highs')
  await landedOn('RS New Highs')
  expect(within(row()).getAllByRole('radiogroup')).toHaveLength(3)
  expect(checked(group('When'))).toEqual(['This week'])
  // and it leaves again with the screen
  await openScreen('Power plays')
  await landedOn('Power plays')
  expect(screen.queryByTestId('rs-controls')).toBeNull()
})

test('choosing an option edits exactly its clause in the scan, and the Filters count and (edited) mark follow', async () => {
  pin(['starter_rs_new_high'])
  mount()
  await landedOn('RS New Highs')
  await waitFor(() => expect(clauseOf(scanBodies().at(-1), 'rs_nh_bars_ago')).toEqual({ op: 'between', min: 0, max: 4 }))
  const before = scanBodies().at(-1)
  expect(screen.getByRole('button', { name: 'Filters, 5 active' })).toBeInTheDocument()
  choose('When', 'This month')
  await waitFor(() => expect(clauseOf(scanBodies().at(-1), 'rs_nh_bars_ago')).toEqual({ op: 'between', min: 0, max: 20 }))
  const after = scanBodies().at(-1)
  expect(filterKeys(after)).toEqual(filterKeys(before))
  for (const f of before.filters.filter(x => x.key !== 'rs_nh_bars_ago')) expect(after.filters.find(x => x.key === f.key)).toEqual(f)
  expect(after.sort).toEqual(NEW_HIGHS.spec.sort)
  // same key, so the count of filters is the same; the screen now reads as edited
  expect(screen.getByRole('button', { name: 'Filters, 5 active' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /^RS New Highs \(edited\)/ })).toBeInTheDocument()
  // an option that ADDS a clause moves the Filters count with it
  choose('Min RS Rating', '80')
  await waitFor(() => expect(clauseOf(scanBodies().at(-1), 'rs_rank')).toEqual({ op: 'gte', min: 80 }))
  expect(screen.getByRole('button', { name: 'Filters, 6 active' })).toBeInTheDocument()
  // and back to "Any" removes it
  choose(/^Min RS Rating/, 'Any')
  await waitFor(() => expect(screen.getByRole('button', { name: 'Filters, 5 active' })).toBeInTheDocument())
  await waitFor(() => expect(urlSpec().filters.rs_rank).toBeUndefined(), { timeout: 2000 })
  expect(urlSpec().filters.rs_nh_bars_ago).toEqual({ op: 'between', min: 0, max: 20 })
})

test('an option with a sort sets the sort, second key included; the URL keeps it across a refresh', async () => {
  pin(['starter_rs_top_rating'])
  const view = mount()
  await landedOn('Top RS Rating')
  await waitFor(() => expect(scanBodies().at(-1).sort).toEqual({ key: 'rs_rating_pos', dir: 'asc' }))
  choose('Rank by', 'Rising fastest')
  await waitFor(() => expect(scanBodies().at(-1).sort).toEqual({ key: 'rs_rating_chg_20', dir: 'desc', then: { key: 'rs_rating_pos', dir: 'asc' } }))
  const body = scanBodies().at(-1)
  expect(clauseOf(body, 'rs_rating_pos')).toEqual({ op: 'gte', min: 1 })
  expect(clauseOf(body, 'rs_rating_chg_20')).toEqual({ op: 'gte', min: 1 })
  expect(clauseOf(body, 'pct_vs_sma50')).toEqual({ op: 'gt', min: 0 })
  expect(checked(group(/^Rank by/))).toEqual(['Rising fastest'])
  // the debounced URL write carries the second sort key
  await waitFor(() => expect(decodeSpec(new URLSearchParams(window.location.search).get(SPEC_PARAM))?.sort)
    .toEqual({ key: 'rs_rating_chg_20', dir: 'desc', then: { key: 'rs_rating_pos', dir: 'asc' } }), { timeout: 2000 })
  // a remount on that URL (a refresh, Back from a full chart) is the same screen with the same control state
  view.unmount()
  sessionStorage.clear()
  mount()
  await landedOn('Top RS Rating \\(edited\\)')
  expect(checked(group(/^Rank by/))).toEqual(['Rising fastest'])
  expect(scanBodies().at(-1).sort).toEqual({ key: 'rs_rating_chg_20', dir: 'desc', then: { key: 'rs_rating_pos', dir: 'asc' } })
})

test('Reset restores the starter spec exactly and forgets the remembered choices of that screen only', async () => {
  net.prefs = { screener_rs_controls: JSON.stringify({ starter_rs_leaders: { show: 'near' } }) }
  pin(['starter_rs_new_high'])
  mount()
  await landedOn('RS New Highs')
  await waitFor(() => screen.getByTestId('focus-row-NVDA'))
  const start = scanBodies().at(-1)
  choose('When', 'Today')
  choose('Market', 'Down days only')
  await waitFor(() => expect(clauseOf(scanBodies().at(-1), 'rs_nh_red_bars_ago')).toEqual({ op: 'between', min: 0, max: 9 }))
  await waitFor(() => expect(prefPosts('screener_rs_controls').at(-1)).toEqual({ starter_rs_leaders: { show: 'near' }, starter_rs_new_high: { when: 'today', down: 'down' } }))
  fireEvent.click(within(row()).getByRole('button', { name: 'Reset' }))
  await waitFor(() => expect(urlSpec().filters).toEqual(keyed(NEW_HIGHS.spec)), { timeout: 2000 })
  expect(urlSpec().sort).toEqual(NEW_HIGHS.spec.sort)
  expect(start.filters).toEqual(NEW_HIGHS.spec.filters)
  expect(checked(group('When'))).toEqual(['This week'])
  expect(screen.queryByRole('button', { name: 'Reset' })).toBeNull()
  expect(screen.getByRole('button', { name: /^RS New Highs, / })).toBeInTheDocument()
  await waitFor(() => expect(prefPosts('screener_rs_controls').at(-1)).toEqual({ starter_rs_leaders: { show: 'near' } }))
})

test('a choice is remembered: the preference is written per screen and per control', async () => {
  pin(['starter_rs_nh_before_price'])
  mount()
  await landedOn('RS New High Before Price')
  await waitFor(() => screen.getByTestId('focus-row-NVDA'))
  choose('Below its high by', '10%')
  await waitFor(() => expect(prefPosts('screener_rs_controls').at(-1)).toEqual({ starter_rs_nh_before_price: { below: 'p10' } }))
  choose('When', 'Today')
  await waitFor(() => expect(prefPosts('screener_rs_controls').at(-1)).toEqual({ starter_rs_nh_before_price: { below: 'p10', when: 'today' } }))
})

test('opening a screen fresh re-applies the remembered choices in ONE scan, shown as the edit they are', async () => {
  net.prefs = { screener_rs_controls: JSON.stringify({ starter_rs_new_high: { when: 'month', min: 'r90' } }) }
  pin(['starter_power_play', 'starter_rs_new_high'])
  mount()
  await landedOn('Power plays')
  await waitFor(() => screen.getByTestId('focus-row-NVDA'))
  await openScreen('RS New Highs')
  await waitFor(() => expect(clauseOf(scanBodies().at(-1), 'rs_nh_bars_ago')).toEqual({ op: 'between', min: 0, max: 20 }))
  expect(clauseOf(scanBodies().at(-1), 'rs_rank')).toEqual({ op: 'gte', min: 90 })
  expect(checked(group(/^When/))).toEqual(['This month'])
  expect(checked(group(/^Min RS Rating/))).toEqual(['90'])
  expect(checked(group('Market'))).toEqual(['Any day'])
  expect(screen.getByRole('button', { name: /^RS New Highs \(edited\)/ })).toBeInTheDocument()
  // never the starter's default window first: the open asked once, with the choices in it
  expect(scanBodies().some(b => clauseOf(b, 'rs_nh_bars_ago')?.max === 4)).toBe(false)
})

test('a first open that lands on a pinned RS screen applies the remembered choices too', async () => {
  net.prefs = { screener_rs_controls: JSON.stringify({ starter_rs_leaders: { min: 'r90' } }) }
  mount()
  await landedOn('UCT RS Leaders \\(edited\\)')
  expect(clauseOf(scanBodies().at(-1), 'rs_rank')).toEqual({ op: 'gte', min: 90 })
  expect(scanBodies().at(-1).rank).toEqual(LEADERS.spec.rank)
  expect(checked(group(/^Min RS Rating/))).toEqual(['90'])
})

test('a last-used screen lands at once from this browser, and takes the remembered choices when both reads answer', async () => {
  net.prefs = { screener_rs_controls: JSON.stringify({ starter_rs_new_high: { when: 'today' } }) }
  net.savedDelay = 120
  net.prefsDelay = 60
  localStorage.setItem(lastScreenKey('member-a'), JSON.stringify({ id: NEW_HIGHS.id, name: NEW_HIGHS.name, kind: 'starter', spec: NEW_HIGHS.spec }))
  mount()
  // at once, on the starter's own spec (neither read has answered)
  await waitFor(() => expect(clauseOf(scanBodies().at(-1), 'rs_nh_bars_ago')).toEqual({ op: 'between', min: 0, max: 4 }), { timeout: 100 })
  expect(screen.queryByTestId('rs-controls')).toBeNull()
  // then the controls, with the remembered choice applied
  await waitFor(() => expect(clauseOf(scanBodies().at(-1), 'rs_nh_bars_ago')).toEqual({ op: 'between', min: 0, max: 0 }), { timeout: 2000 })
  expect(checked(group(/^When/))).toEqual(['Today'])
})

test('a member who has already touched the page keeps the screen they landed on', async () => {
  net.prefs = { screener_rs_controls: JSON.stringify({ starter_rs_new_high: { when: 'today' } }) }
  net.savedDelay = 150
  localStorage.setItem(lastScreenKey('member-a'), JSON.stringify({ id: NEW_HIGHS.id, name: NEW_HIGHS.name, kind: 'starter', spec: NEW_HIGHS.spec }))
  mount()
  await waitFor(() => screen.getByTestId('focus-row-NVDA'))
  fireEvent.keyDown(screen.getByRole('listbox'), { key: 'ArrowDown' })
  await waitFor(() => expect(screen.getByTestId('rs-controls')).toBeInTheDocument(), { timeout: 2000 })
  await act(async () => { await new Promise(r => setTimeout(r, 400)) })
  expect(checked(group('When'))).toEqual(['This week'])
  expect(scanBodies().every(b => clauseOf(b, 'rs_nh_bars_ago')?.max === 4)).toBe(true)
})

test('a URL that already carries an edited spec is never overridden by remembered choices', async () => {
  net.prefs = { screener_rs_controls: JSON.stringify({ starter_rs_nh_before_price: { below: 'p10', when: 'month' } }) }
  const ctl = controlsOf(BEFORE_PRICE).find(c => c.id === 'below')
  const edited = specWithOption(BEFORE_PRICE.spec, ctl, ctl.options.find(o => o.id === 'p5'))
  window.history.replaceState(null, '', keyedUrl(edited))
  mount()
  await landedOn('RS New High Before Price \\(edited\\)')
  expect(checked(group(/^Below its high by/))).toEqual(['5%'])
  expect(checked(group('When'))).toEqual(['This week'])
  await act(async () => { await new Promise(r => setTimeout(r, 300)) })
  expect(scanBodies().every(b => clauseOf(b, 'px_below_high_pct')?.max === -5)).toBe(true)
  expect(scanBodies().every(b => clauseOf(b, 'rs_nhbp_age')?.max === 4)).toBe(true)
})

test('a re-sort from the Sort menu makes Rank by read Custom on the page, with the dot and Reset', async () => {
  pin(['starter_rs_top_rating'])
  mount()
  await landedOn('Top RS Rating')
  await waitFor(() => screen.getByTestId('focus-row-NVDA'))
  fireEvent.click(screen.getByRole('button', { name: /^Sort:/ }))
  fireEvent.click(screen.getByRole('menuitem', { name: 'Price' }))
  await waitFor(() => expect(scanBodies().at(-1).sort).toEqual({ key: 'price', dir: 'desc' }))
  expect(checked(group(/^Rank by/))).toEqual(['Custom'])
  expect(row().querySelector('[data-control="rank_by"]')).toHaveAttribute('data-changed')
  expect(checked(group('Show'))).toEqual(['All'])
  fireEvent.click(within(row()).getByRole('button', { name: 'Reset' }))
  await waitFor(() => expect(checked(group('Rank by'))).toEqual(['Overall']))
  await waitFor(() => expect(urlSpec().sort).toEqual({ key: 'rs_rating_pos', dir: 'asc' }), { timeout: 2000 })
})

test('back or forward to a spec no starter was made of by its controls alone is a custom screen, without the row', async () => {
  const custom = { ...NEW_HIGHS.spec, filters: [...NEW_HIGHS.spec.filters, { key: 'rs_rank', op: 'gte', min: 77 }] }
  pin(['starter_rs_new_high'])
  mount()
  await landedOn('RS New Highs')
  await waitFor(() => screen.getByTestId('focus-row-NVDA'))
  // a value no option carries, arriving from outside the page's own editor
  window.history.pushState(null, '', keyedUrl(custom))
  await act(async () => { window.dispatchEvent(new PopStateEvent('popstate')) })
  await waitFor(() => expect(clauseOf(scanBodies().at(-1), 'rs_rank')).toEqual({ op: 'gte', min: 77 }))
  // (a spec no starter was made of by its controls alone is a custom screen: no row at all)
  expect(screen.queryByTestId('rs-controls')).toBeNull()
  expect(screen.getByRole('button', { name: /^Custom screen/ })).toBeInTheDocument()
})

test('a saved copy of an RS screen is the member\'s own screen: no quick controls', async () => {
  net.saved = [{ id: 7, name: 'My monthly highs', spec: specWithOption(NEW_HIGHS.spec, controlsOf(NEW_HIGHS)[0], controlsOf(NEW_HIGHS)[0].options[2]) }]
  pin(['7'])
  mount()
  await landedOn('My monthly highs')
  await waitFor(() => screen.getByTestId('focus-row-NVDA'))
  expect(screen.queryByTestId('rs-controls')).toBeNull()
})

test('Top RS Rating has two controls: one inline plus Adjust', async () => {
  pin(['starter_rs_top_rating'])
  mount()
  await landedOn('Top RS Rating')
  expect(controlsOf(TOP_RATING)).toHaveLength(2)
  expect(within(row()).getAllByRole('radiogroup')).toHaveLength(2)
  expect(within(row()).getByRole('button', { name: 'Adjust' })).toBeInTheDocument()
})
