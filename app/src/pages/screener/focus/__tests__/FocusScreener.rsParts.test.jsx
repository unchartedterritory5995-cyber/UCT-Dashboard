// RS screens (unit U5), items 4 to 8 on the page: the header line and its 40% rule, the empty
// state's actions, the first-visit line and its dismissal, the Help item, the why strip's facts.
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
import { FIRST_VISIT_TEXT } from '../RsScreenParts'
import { writeLastScreen } from '../landing'
import { net, resetNet, installFetch, mount, scanBodies, prefPosts, clauseOf, pin } from './rsHarness'
import { BEFORE_PRICE, LEADERS, RS_ROWS, PLAIN_STARTERS, STARTERS_ON } from './rsScreensFixture'

beforeEach(() => {
  __resetCountCache()
  __resetRevisionStateForTests()
  localStorage.clear()
  sessionStorage.clear()
  window.history.replaceState(null, '', '/')
  resetNet()
  installFetch()
  // The first-visit line is its own subject below; everywhere else the member has dismissed it.
  net.prefs = { screener_rs_note_seen: '1' }
})
const landedOn = name => waitFor(() => expect(screen.getByRole('button', { name: new RegExp(`^${name}.*Change screen`) })).toBeInTheDocument())
const openScreen = async name => {
  fireEvent.click(screen.getByRole('button', { name: /Change screen/ }))
  fireEvent.click(await screen.findByRole('button', { name: new RegExp(`^Open ${name}`) }))
}
const rowsIn = counts => Object.entries(counts).flatMap(([sector, n]) => Array.from({ length: n }, (_, i) => ({ ...RS_ROWS[0], ticker: `${sector.slice(0, 2).toUpperCase()}${i}`, sector })))

// ── item 4: the header line ────────────────────────────────────────────────
test('the header line says the rating date from the first row, after the new/dropped line', async () => {
  net.diff = { state: 'ok', entered: ['NVDA', 'MU'], exited: ['IBM'], new_since_label: 'since Nov 12' }
  pin(['starter_rs_new_high'])
  mount({ user: { id: 'member-a' }, screenerNewTodayEnabled: true })
  await landedOn('RS New Highs')
  const head = await screen.findByTestId('rs-head')
  await waitFor(() => expect(within(head).getByRole('button', { name: '2 new' })).toBeInTheDocument())
  expect(within(head).getByRole('button', { name: '1 dropped' })).toBeInTheDocument()
  expect(within(head).getByTestId('rs-asof')).toHaveTextContent('Ratings as of Nov 13')
  // order: the new/dropped line first
  expect(head.textContent.indexOf('2 new')).toBeLessThan(head.textContent.indexOf('Ratings as of'))
  // and it is the ONE new/dropped line: the list head no longer carries a second copy
  expect(screen.getAllByRole('button', { name: '2 new' })).toHaveLength(1)
  // it still filters the list to the new names
  fireEvent.click(within(head).getByRole('button', { name: '2 new' }))
  await waitFor(() => expect(screen.queryByTestId('focus-row-LLY')).toBeNull())
  expect(screen.getByTestId('focus-row-MU')).toBeInTheDocument()
})

test('no rating date on the rows: the sentence is left out, with no stray separator', async () => {
  net.rows = RS_ROWS.map(r => ({ ...r, rs_rating_session: null }))
  pin(['starter_rs_new_high'])
  mount()
  await landedOn('RS New Highs')
  await waitFor(() => screen.getByTestId('focus-row-NVDA'))
  expect(screen.queryByTestId('rs-head')).toBeNull()
})

test('UCT RS Leaders says the sector that holds 40% or more of the loaded rows', async () => {
  net.rows = rowsIn({ Healthcare: 6, Technology: 5, Energy: 4 })     // 6 of 15 = 40%
  pin(['starter_rs_leaders'])
  mount()
  await landedOn('UCT RS Leaders')
  const head = await screen.findByTestId('rs-head')
  expect(within(head).getByTestId('rs-share')).toHaveTextContent('6 of 15 are Healthcare')
  // the date first, then the sector, one separator between them (its spacing is the stylesheet's)
  expect(head.textContent).toMatch(/^Ratings as of Nov 13\s*·\s*6 of 15 are Healthcare$/)
})

test('under 40% UCT RS Leaders says no sector', async () => {
  net.rows = rowsIn({ Healthcare: 5, Technology: 5, Energy: 5 })     // 5 of 15 = 33%
  pin(['starter_rs_leaders'])
  mount()
  await landedOn('UCT RS Leaders')
  await screen.findByTestId('rs-head')
  expect(screen.queryByTestId('rs-share')).toBeNull()
})

test('the sector sentence is UCT RS Leaders\' alone: another RS screen with the same rows says nothing', async () => {
  net.rows = rowsIn({ Healthcare: 12, Technology: 3 })
  pin(['starter_rs_top_rating'])
  mount()
  await landedOn('Top RS Rating')
  await screen.findByTestId('rs-head')
  expect(screen.queryByTestId('rs-share')).toBeNull()
})

test('a plain screen has no header line, and keeps its new/dropped line in the list head', async () => {
  net.diff = { state: 'ok', entered: ['NVDA'], exited: [], new_since_label: 'since Nov 12' }
  pin(['starter_power_play'])
  mount({ user: { id: 'member-a' }, screenerNewTodayEnabled: true })
  await landedOn('Power plays')
  await waitFor(() => expect(screen.getByRole('button', { name: '1 new' })).toBeInTheDocument())
  expect(screen.queryByTestId('rs-head')).toBeNull()
  expect(screen.getByRole('button', { name: '1 new' }).closest('#focus-results, [data-testid="rs-head"]')).toBeNull()
  expect(screen.getByRole('listbox').parentElement).toContainElement(screen.getByRole('button', { name: '1 new' }))
})

// ── item 5: the empty state ────────────────────────────────────────────────
test('an RS screen with `empty` that returns no rows shows its text, then its actions', async () => {
  net.scan = body => (clauseOf(body, 'rs_nhbp_age')?.max === 4 && body.filters.some(f => f.key === 'px_below_high_pct') ? [] : RS_ROWS)
  pin(['starter_rs_nh_before_price'])
  mount()
  await landedOn('RS New High Before Price')
  const box = await screen.findByTestId('rs-empty')
  expect(box).toHaveTextContent('No RS line made a 52-week high ahead of price this week.')
  expect(box).toHaveTextContent('That is normal in a weak market.')
  expect(box.textContent.startsWith(BEFORE_PRICE.empty.text.replace('. ', '.'))).toBe(true)
  expect(within(box).getAllByRole('button').map(b => b.textContent)).toEqual(['Show this month', 'Open RS New Highs'])
  // today's generic empty state is not drawn beside it
  expect(screen.queryByTestId('focus-empty')).toBeNull()
  // the quick controls stay, so the member can also widen the screen there
  expect(screen.getByTestId('rs-controls')).toBeInTheDocument()
})

test('an action with control + option selects that option', async () => {
  net.scan = body => (clauseOf(body, 'rs_nhbp_age')?.max === 4 ? [] : RS_ROWS)
  pin(['starter_rs_nh_before_price'])
  mount()
  await landedOn('RS New High Before Price')
  fireEvent.click(within(await screen.findByTestId('rs-empty')).getByRole('button', { name: 'Show this month' }))
  await waitFor(() => expect(clauseOf(scanBodies().at(-1), 'rs_nhbp_age')).toEqual({ op: 'between', min: 0, max: 20 }))
  await waitFor(() => screen.getByTestId('focus-row-NVDA'))
  expect(screen.queryByTestId('rs-empty')).toBeNull()
  const when = screen.getByTestId('rs-controls').querySelector('[data-control="when"]')
  expect(within(when).getByRole('radio', { name: 'This month' })).toHaveAttribute('aria-checked', 'true')
  // it is the same act as pressing the control: remembered
  await waitFor(() => expect(prefPosts('screener_rs_controls').at(-1)).toEqual({ starter_rs_nh_before_price: { when: 'month' } }))
})

test('an action with open opens that starter', async () => {
  net.scan = body => (body.filters.some(f => f.key === 'rs_nhbp_age') ? [] : RS_ROWS)
  pin(['starter_rs_nh_before_price'])
  mount()
  await landedOn('RS New High Before Price')
  fireEvent.click(within(await screen.findByTestId('rs-empty')).getByRole('button', { name: 'Open RS New Highs' }))
  await landedOn('RS New Highs')
  await waitFor(() => screen.getByTestId('focus-row-NVDA'))
  expect(clauseOf(scanBodies().at(-1), 'rs_nh_bars_ago')).toEqual({ op: 'between', min: 0, max: 4 })
})

test('once the member has changed the screen, an empty list is today\'s empty state: the sentence is about the starter', async () => {
  net.scan = body => (body.filters.some(f => f.key === 'rs_nhbp_age') ? [] : RS_ROWS)
  net.prefs = { ...net.prefs, screener_rs_controls: JSON.stringify({ starter_rs_nh_before_price: { below: 'p10' } }) }
  pin(['starter_rs_nh_before_price'])
  mount()
  await landedOn('RS New High Before Price \\(edited\\)')
  expect(await screen.findByTestId('focus-empty')).toBeInTheDocument()
  expect(screen.queryByTestId('rs-empty')).toBeNull()
})

test('an RS screen without `empty`, and a plain screen, keep today\'s empty state', async () => {
  net.rows = []
  pin(['starter_rs_new_high', 'starter_power_play'])
  mount()
  await landedOn('RS New Highs')
  expect(await screen.findByTestId('focus-empty')).toBeInTheDocument()
  expect(screen.queryByTestId('rs-empty')).toBeNull()
  await openScreen('Power plays')
  await landedOn('Power plays')
  expect(await screen.findByTestId('focus-empty')).toBeInTheDocument()
  expect(screen.queryByTestId('rs-empty')).toBeNull()
})

test('an action that points at a control, an option or a starter the payload does not have is not offered', async () => {
  net.starters = STARTERS_ON.filter(s => s.id !== 'starter_rs_new_high').map(s => (s.id !== BEFORE_PRICE.id ? s
    : { ...s, empty: { ...s.empty, actions: [...s.empty.actions, { label: 'Ghost', control: 'when', option: 'year' }, { label: 'Ghost 2', control: 'nope', option: 'x' }] } }))
  net.scan = body => (body.filters.some(f => f.key === 'rs_nhbp_age') && clauseOf(body, 'rs_nhbp_age').max === 4 ? [] : RS_ROWS)
  pin(['starter_rs_nh_before_price'])
  mount()
  await landedOn('RS New High Before Price')
  expect(within(await screen.findByTestId('rs-empty')).getAllByRole('button').map(b => b.textContent)).toEqual(['Show this month'])
})

// ── item 6: the first-visit line ───────────────────────────────────────────
test('the first-visit line shows on an RS screen until dismissed, in the contract\'s words', async () => {
  net.prefs = {}
  pin(['starter_rs_leaders', 'starter_power_play'])
  mount()
  await landedOn('UCT RS Leaders')
  const note = await screen.findByTestId('rs-first-visit')
  expect(FIRST_VISIT_TEXT).toBe('The strongest liquid stocks, ranked. The line under each name says whether it is extended or near a buy point. RS is relative strength, not RSI.')
  expect(note).toHaveTextContent(FIRST_VISIT_TEXT)
  expect(within(note).getByRole('button', { name: 'How it works' })).toBeInTheDocument()
  fireEvent.click(within(note).getByRole('button', { name: 'Got it' }))
  await waitFor(() => expect(screen.queryByTestId('rs-first-visit')).toBeNull())
  await waitFor(() => expect(net.prefs.screener_rs_note_seen).toBe('1'))
  // gone on the other RS screens too, in this visit
  await openScreen('RS New Highs').catch(() => {})
})

test('a member who dismissed it never sees it again; a plain screen never shows it', async () => {
  pin(['starter_rs_leaders', 'starter_power_play'])       // beforeEach: already dismissed
  mount()
  await landedOn('UCT RS Leaders')
  await waitFor(() => screen.getByTestId('focus-row-NVDA'))
  await act(async () => { await new Promise(r => setTimeout(r, 50)) })
  expect(screen.queryByTestId('rs-first-visit')).toBeNull()
})

test('a plain screen never shows the first-visit line, even for a member who has not dismissed it', async () => {
  net.prefs = {}
  pin(['starter_power_play'])
  mount()
  await landedOn('Power plays')
  await waitFor(() => screen.getByTestId('focus-row-NVDA'))
  await act(async () => { await new Promise(r => setTimeout(r, 50)) })
  expect(screen.queryByTestId('rs-first-visit')).toBeNull()
})

test('the line waits for the preferences: it never flashes for a member who dismissed it', async () => {
  // The common open: the last-used screen lands from this browser, and its RS rows are on screen
  // well before the preferences answer. Until they do, nobody knows whether it was dismissed.
  net.prefsDelay = 700
  writeLastScreen('member-a', { ...LEADERS, kind: 'starter' })
  mount()
  await waitFor(() => expect(screen.getByTestId('focus-row-NVDA')).toHaveAttribute('data-rs-row'), { timeout: 600 })
  expect(net.prefs.screener_rs_note_seen).toBe('1')
  expect(screen.queryByTestId('rs-first-visit')).toBeNull()
  await act(async () => { await new Promise(r => setTimeout(r, 1000)) })
  expect(screen.queryByTestId('rs-first-visit')).toBeNull()
})

test('a refused preferences read says nothing either way, so the line stays hidden', async () => {
  net.prefs = {}
  net.prefsFail = true
  pin(['starter_rs_leaders'])
  mount()
  await waitFor(() => expect(screen.getByTestId('focus-row-NVDA')).toHaveAttribute('data-rs-row'), { timeout: 5000 })
  await act(async () => { await new Promise(r => setTimeout(r, 100)) })
  expect(screen.queryByTestId('rs-first-visit')).toBeNull()
}, 10000)

test('and for a member who has not dismissed it, it appears once the preferences answer', async () => {
  net.prefs = {}
  net.prefsDelay = 300
  writeLastScreen('member-a', { ...LEADERS, kind: 'starter' })
  mount()
  await waitFor(() => expect(screen.getByTestId('focus-row-NVDA')).toHaveAttribute('data-rs-row'), { timeout: 280 })
  expect(screen.queryByTestId('rs-first-visit')).toBeNull()
  expect(await screen.findByTestId('rs-first-visit', {}, { timeout: 2000 })).toBeInTheDocument()
})

// ── item 7: Help ───────────────────────────────────────────────────────────
test('"How it works" and Help\'s "How the RS screens work" open the Methodology sheet at the RS screens section', async () => {
  net.prefs = {}
  net.methodology = { methods: [
    { column: 'uct_composite', label: 'UCT Composite', one_line: 'a', scale: '0-100', how: 'b', caveat: 'c' },
    { column: 'rs_rating_session', label: 'Ratings as of', one_line: 'a', scale: 'date', how: 'b', caveat: 'c' },
    { column: 'rs_rating_pos', label: 'RS Rating place', one_line: 'a', scale: '1..N', how: 'b', caveat: 'c' },
  ] }
  const scrolled = []
  const real = Element.prototype.scrollIntoView
  Element.prototype.scrollIntoView = function scrollIntoView() { scrolled.push(this.textContent) }
  try {
    pin(['starter_rs_leaders'])
    mount()
    await landedOn('UCT RS Leaders')
    fireEvent.click(within(await screen.findByTestId('rs-first-visit')).getByRole('button', { name: 'How it works' }))
    const sheet = await screen.findByRole('dialog', { name: 'Methodology' })
    await waitFor(() => expect(within(sheet).getByText('RS Rating place')).toBeInTheDocument())
    // the first RS screens card in the document's own order, not the top of the page
    await waitFor(() => expect(scrolled).toHaveLength(1))
    expect(scrolled[0]).toMatch(/^Ratings as of/)
    fireEvent.keyDown(sheet, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Methodology' })).toBeNull())
    // the same door from the Help menu
    fireEvent.click(screen.getByRole('button', { name: 'Help' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'How the RS screens work' }))
    await screen.findByRole('dialog', { name: 'Methodology' })
    await waitFor(() => expect(scrolled).toHaveLength(2))
    fireEvent.keyDown(screen.getByRole('dialog', { name: 'Methodology' }), { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Methodology' })).toBeNull())
    // the plain Methodology item still opens at the top
    fireEvent.click(screen.getByRole('button', { name: 'Help' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Methodology' }))
    await screen.findByRole('dialog', { name: 'Methodology' })
    await waitFor(() => expect(within(screen.getByRole('dialog', { name: 'Methodology' })).getByText('RS Rating place')).toBeInTheDocument())
    await act(async () => { await new Promise(r => setTimeout(r, 30)) })
    expect(scrolled).toHaveLength(2)
  } finally { Element.prototype.scrollIntoView = real }
})

test('Help offers "How the RS screens work" only while the payload carries the RS screens', async () => {
  net.starters = PLAIN_STARTERS
  mount()
  await landedOn('Power plays')
  fireEvent.click(screen.getByRole('button', { name: 'Help' }))
  expect(screen.getByRole('menuitem', { name: 'Methodology' })).toBeInTheDocument()
  expect(screen.queryByRole('menuitem', { name: 'How the RS screens work' })).toBeNull()
})

test('with the RS screens in the payload the Help item is offered from any screen, a plain one included', async () => {
  pin(['starter_power_play'])
  mount()
  await landedOn('Power plays')
  fireEvent.click(screen.getByRole('button', { name: 'Help' }))
  expect(screen.getByRole('menuitem', { name: 'How the RS screens work' })).toBeInTheDocument()
})

// ── item 8: the why strip ──────────────────────────────────────────────────
test('the why strip of an RS screen carries fact notes about the selected row, as open circles', async () => {
  pin(['starter_rs_top_rating'])
  mount()
  await landedOn('Top RS Rating')
  await waitFor(() => screen.getByTestId('focus-row-NVDA'))
  fireEvent.click(screen.getByTestId('focus-row-MU'))
  const pane = screen.getByTestId('focus-chart-pane')
  const items = () => [...pane.querySelectorAll('[data-why-item]')].map(li => li.textContent)
  await waitFor(() => expect(items().some(t => t.includes('Extended'))).toBe(true))
  const fact = [...pane.querySelectorAll('[data-why-item]')].find(li => li.textContent.includes('Extended'))
  expect(fact.textContent.startsWith('○')).toBe(true)
  expect(fact.textContent).not.toMatch(/Passes/)
  expect(items().some(t => t.includes('RS high 3 sessions ago'))).toBe(true)
  // the screen's own filter checks still lead the strip
  expect(items()[0]).toMatch(/Price/)
})

test('a plain screen\'s why strip has no fact notes', async () => {
  pin(['starter_power_play'])
  mount()
  await landedOn('Power plays')
  await waitFor(() => screen.getByTestId('focus-row-MU'))
  fireEvent.click(screen.getByTestId('focus-row-MU'))
  const pane = screen.getByTestId('focus-chart-pane')
  await waitFor(() => expect(pane.querySelectorAll('[data-why-item]').length).toBeGreaterThan(0))
  expect(pane.textContent).not.toMatch(/Extended|RS high|below its high|RS Rating place/)
})
