// RS screens (unit U5), item 3: the result row a starter's `row` describes: a place numeral,
// one lead number, the contract's caption and ONE tag, read in that order by a screen reader,
// under the list's memo contract (a price tick re-renders one row).
import { render, screen } from '@testing-library/react'
import { vi, beforeEach, expect, test, describe } from 'vitest'

// Probes: leadOf runs once per RS row render, so counting its calls by ticker counts row renders;
// rowDisplay runs once per row each time the list works out its captions and tags.
const calls = vi.hoisted(() => ({ byTicker: {}, displays: 0 }))
vi.mock('../rsRows', async (importOriginal) => {
  const real = await importOriginal()
  return {
    ...real,
    leadOf: row => { calls.byTicker[row.ticker] = (calls.byTicker[row.ticker] || 0) + 1; return real.leadOf(row) },
    rowDisplay: (...a) => { calls.displays += 1; return real.rowDisplay(...a) },
  }
})
import ResultList from '../ResultList'
import { rowConfigOf } from '../rsRows'
import { TOP_RATING, NEW_HIGHS, BEFORE_PRICE, LEADERS, EXIT_WARNINGS, RS_ROWS } from './rsScreensFixture'

const base = { rows: RS_ROWS, index: 0, onSelect: vi.fn(), onKeyDown: vi.fn(), livePrices: {}, radar: new Set(['NVDA']), sortLabel: 'Your ranking',
  total: 50, hasMore: false, onLoadMore: vi.fn(), isLoading: false }
const show = (starter, extra = {}) => render(<ResultList {...base} rsRow={rowConfigOf(starter)} {...extra} />)
const rowEl = t => screen.getByTestId(`focus-row-${t}`)
const part = (t, id) => rowEl(t).querySelector(`[data-testid="${id}"]`)

beforeEach(() => { calls.byTicker = {}; calls.displays = 0; vi.clearAllMocks() })

describe('the place numeral', () => {
  test('a column key shows that column\'s value', () => {
    show(TOP_RATING)
    expect(part('NVDA', 'rs-place')).toHaveTextContent('14')
    expect(part('XOM', 'rs-place')).toHaveTextContent('380')
  })
  test('"index" shows the 1-based position in the list, whatever the row\'s own place', () => {
    show(LEADERS)
    expect(RS_ROWS.map(r => part(r.ticker, 'rs-place').textContent)).toEqual(['Place 1, ', 'Place 2, ', 'Place 3, ', 'Place 4, ', 'Place 5, '])
  })
  test('null shows no numeral and keeps no column for one', () => {
    show(NEW_HIGHS)
    for (const r of RS_ROWS) expect(part(r.ticker, 'rs-place')).toBeNull()
  })
  test('a row without the place value keeps an empty cell, so the tickers stay in line', () => {
    show(TOP_RATING, { rows: [RS_ROWS[0], { ...RS_ROWS[1], rs_rating_pos: null }] })
    expect(part('MU', 'rs-place')).not.toBeNull()
    expect(part('MU', 'rs-place').textContent).toBe('')
  })
  test('a place past 999 is grouped', () => {
    show(TOP_RATING, { rows: [{ ...RS_ROWS[0], rs_rating_pos: 1204 }] })
    expect(part('NVDA', 'rs-place')).toHaveTextContent('1,204')
  })
})

describe('the lead number', () => {
  test('"RS <rs_rank>" on every RS screen, gold only from 90 up', () => {
    for (const st of [TOP_RATING, NEW_HIGHS, BEFORE_PRICE, LEADERS, EXIT_WARNINGS]) {
      const view = show(st)
      expect(part('NVDA', 'rs-lead')).toHaveTextContent('RS 97')
      expect(part('NVDA', 'rs-lead')).toHaveAttribute('data-top')
      expect(part('NVDA', 'rs-lead').className).toMatch(/leadTop/)
      expect(part('MU', 'rs-lead')).toHaveTextContent('RS 91')
      expect(part('AMD', 'rs-lead')).toHaveTextContent('RS 89')
      expect(part('AMD', 'rs-lead')).not.toHaveAttribute('data-top')
      expect(part('AMD', 'rs-lead').className).not.toMatch(/leadTop/)
      view.unmount()
    }
  })
  test('exactly 90 is gold; a row with no rank shows no number', () => {
    show(LEADERS, { rows: [{ ...RS_ROWS[0], rs_rank: 90 }, { ...RS_ROWS[1], rs_rank: null }] })
    expect(part('NVDA', 'rs-lead')).toHaveAttribute('data-top')
    expect(part('MU', 'rs-lead').textContent).toBe('')
  })
})

describe('the caption and the tag', () => {
  test('the caption replaces the structure caption, in the contract\'s words', () => {
    show(LEADERS, { themes: { LLY: 'GLP-1' } })
    expect(part('NVDA', 'rs-caption')).toHaveTextContent('At pivot · Semiconductors')
    expect(part('LLY', 'rs-caption')).toHaveTextContent('Tight range · GLP-1')
    expect(part('AMD', 'rs-caption')).toHaveTextContent('Below its 50-day line · Semiconductors')
    // the structure read ("Flat base") is not on an RS row
    expect(rowEl('NVDA')).not.toHaveTextContent(/Flat base/i)
  })
  test('one tag per row: the first of the starter\'s list that applies', () => {
    show(NEW_HIGHS, { newSet: new Set(RS_ROWS.map(r => r.ticker)) })
    expect(part('MU', 'rs-tag')).toHaveTextContent('Before price')
    expect(part('LLY', 'rs-tag')).toHaveTextContent('New issue')
    expect(part('XOM', 'rs-tag')).toHaveTextContent('Buyout pending')
    expect(part('NVDA', 'rs-tag')).toHaveTextContent('New')
    for (const r of RS_ROWS) expect(rowEl(r.ticker).querySelectorAll('[data-testid="rs-tag"]')).toHaveLength(1)
  })
  test('"New" is the list\'s existing pill; the other tags are not green, and a row with no tag has none', () => {
    show(TOP_RATING, { newSet: new Set(['NVDA']) })
    expect(part('NVDA', 'rs-tag').className).toMatch(/newPill/)
    expect(part('LLY', 'rs-tag').className).not.toMatch(/newPill/)
    expect(part('MU', 'rs-tag')).toBeNull()
  })
  test('the company line still shows when the member turned it on', () => {
    show(LEADERS, { showCompany: true })
    expect(rowEl('NVDA')).toHaveTextContent('NVDA Corp')
  })
})

test('screen-reader order: place, ticker, "RS Rating 97", caption, tag', () => {
  show(TOP_RATING, { newSet: new Set(['NVDA']) })
  const text = rowEl('NVDA').textContent
  const at = s => { const i = text.indexOf(s); expect(i, s).toBeGreaterThanOrEqual(0); return i }
  const order = [at('Place 14'), at('NVDA'), at('RS Rating 97'), at('At pivot · was #41 a month ago'), at('New')]
  expect(order).toEqual([...order].sort((a, b) => a - b))
  // the visible "RS 97" is hidden from a screen reader, which hears "RS Rating 97" instead
  expect(part('NVDA', 'rs-lead').querySelector('[aria-hidden="true"]')).toHaveTextContent('RS 97')
  expect(part('NVDA', 'rs-lead').querySelector('.sr-only')).toHaveTextContent('RS Rating 97')
})

test('rows are listbox options with no button inside, and a click still selects', () => {
  show(LEADERS)
  expect(screen.getAllByRole('option')).toHaveLength(RS_ROWS.length)
  for (const r of RS_ROWS) expect(rowEl(r.ticker).querySelector('button, a, input, [tabindex]')).toBeNull()
  rowEl('LLY').click()
  expect(base.onSelect).toHaveBeenCalledWith(2)
  expect(rowEl('NVDA')).toHaveAttribute('aria-selected', 'true')
  expect(rowEl('NVDA').querySelector('[aria-label="On your radar"]')).not.toBeNull()
})

test('a live price for one ticker re-renders that row only', () => {
  const cfg = rowConfigOf(LEADERS)
  const themes = {}
  const live = t => Object.fromEntries(RS_ROWS.map(r => [r.ticker, { price: r.ticker === t ? 111 : 100, change_pct: 1.2 }]))
  const { rerender } = render(<ResultList {...base} rsRow={cfg} themes={themes} livePrices={live(null)} />)
  expect(calls.byTicker).toEqual({ NVDA: 1, MU: 1, LLY: 1, XOM: 1, AMD: 1 })
  // The price hook hands back a FRESH object for every ticker on every message.
  rerender(<ResultList {...base} rsRow={cfg} themes={themes} livePrices={live('MU')} />)
  expect(calls.byTicker).toEqual({ NVDA: 1, MU: 2, LLY: 1, XOM: 1, AMD: 1 })
  expect(rowEl('MU')).toHaveTextContent('111.00')
  // and the captions and tags were worked out once for the result set, not again for the tick
  expect(calls.displays).toBe(RS_ROWS.length)
})

test('without `rsRow` the list renders its own row: no place, no lead number, the structure caption', () => {
  render(<ResultList {...base} />)
  expect(rowEl('NVDA').querySelector('[data-testid="rs-lead"]')).toBeNull()
  expect(rowEl('NVDA')).not.toHaveAttribute('data-rs-row')
  expect(rowEl('NVDA')).toHaveTextContent(/Flat base/i)
  expect(calls.byTicker).toEqual({})
})
