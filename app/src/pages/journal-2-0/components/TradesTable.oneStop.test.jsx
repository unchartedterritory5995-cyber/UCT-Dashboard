// Finish program, lane KEYS3 (Q6): the Trades list is ONE Tab stop.
//
// Linking a note to a trade on a keyboard was 22 keys at 1280 px (19 at 390 px) against a
// budget of 10. Eleven of them were Tabs down the table to the trade: every row was two stops
// (its symbol cell, which opens the trade, and its Setup select). The list now uses the same
// hook as the Notebook's notes list (lib/useGridRoving.js): Down and Up move trade to trade,
// Home and End go to the ends, Right and Left reach the row's Setup select. The phone cards
// are one stop too.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SWRConfig } from 'swr'

let phone = false
vi.mock('../../../hooks/useBreakpoint', async (importOriginal) => ({
  ...(await importOriginal()),
  useIsPhone: () => phone,
}))

import TradesTable, { buildTradesColumns } from './TradesTable'

const trade = (id, symbol, day) => ({
  id, symbol, side: 'Long', shares: 10, entryPrice: 10, entryDate: `2026-09-${day}T00:00:00Z`, exitPrice: 11,
  exitDate: `2026-09-${day}T00:00:00Z`, originalStop: 9, setup: null, pnlDollar: 10, pnlPercent: 0.1,
  rMultiple: 1, holdDays: 1, result: 'Win', source: 'manual',
})
// newest first is the table's default order: NVDA, TSLA, AAPL, CRWD
const TRADES = [trade('c', 'AAPL', '12'), trade('a', 'NVDA', '20'), trade('d', 'CRWD', '05'), trade('b', 'TSLA', '15')]

function renderTable(onRowAction = vi.fn()) {
  global.fetch = vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) }))
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <MemoryRouter>
        <button type="button">before</button>
        <TradesTable trades={TRADES} onRowAction={onRowAction} setups={['VCP', 'Flag']} onUpdateSetup={vi.fn()}
          visibleColumns={buildTradesColumns().filter((c) => !c.hiddenByDefault)} />
        <button type="button">after</button>
      </MemoryRouter>
    </SWRConfig>,
  )
  return onRowAction
}
afterEach(() => { cleanup(); phone = false; vi.restoreAllMocks() })

const key = (k) => fireEvent.keyDown(document.activeElement, { key: k })
const cell = (sym) => [...document.querySelectorAll('tbody td[data-grid-cell]')].find((td) => td.textContent.includes(sym))
const bodyStops = () => [...document.querySelectorAll('tbody [tabindex="0"]')]

describe('TradesTable: the rows are one Tab stop (lane KEYS3)', () => {
  it('one control of the whole body is in the Tab order: the first trade\'s symbol cell', () => {
    renderTable()
    expect(bodyStops()).toEqual([cell('NVDA')])
    expect(cell('TSLA').getAttribute('tabindex')).toBe('-1')
    // every row's Setup select is out of the Tab order too (it was the second stop of each row)
    const selects = [...document.querySelectorAll('tbody select')]
    expect(selects.length).toBe(4)
    expect(selects.every((s) => s.getAttribute('tabindex') === '-1')).toBe(true)
  })

  it('Down, End, Up and Home move trade to trade; the stop follows', () => {
    renderTable()
    cell('NVDA').focus()
    key('ArrowDown')
    expect(document.activeElement).toBe(cell('TSLA'))
    expect(bodyStops()).toEqual([cell('TSLA')])
    key('End')
    expect(document.activeElement).toBe(cell('CRWD'))     // the oldest trade, the last row
    key('ArrowUp')
    expect(document.activeElement).toBe(cell('AAPL'))
    key('Home')
    expect(document.activeElement).toBe(cell('NVDA'))
  })

  it('Enter on the cell still opens the trade, and Right reaches that row\'s Setup select', () => {
    const onRowAction = renderTable()
    cell('NVDA').focus()
    key('End')
    key('Enter')
    expect(onRowAction).toHaveBeenCalledWith('open', expect.objectContaining({ symbol: 'CRWD' }))
    key('ArrowRight')
    expect(document.activeElement.tagName).toBe('SELECT')
    expect(document.activeElement.closest('tr')).toBe(cell('CRWD').closest('tr'))
    key('ArrowLeft')
    expect(document.activeElement).toBe(cell('CRWD'))
  })

  it('the landing is unchanged: the table body, focusable by script only', () => {
    renderTable()
    const landing = document.querySelector('[data-route-landing]')
    expect(landing.tagName).toBe('TBODY')
    expect(landing.getAttribute('tabindex')).toBe('-1')
  })

  it('phone cards: one stop, moved with Down and End, and Enter opens the card\'s trade', () => {
    phone = true
    const onRowAction = renderTable()
    const cards = screen.getAllByTestId('trade-card')
    expect(cards.filter((c) => c.getAttribute('tabindex') === '0')).toEqual([cards[0]])
    cards[0].focus()
    key('ArrowDown')
    expect(document.activeElement).toBe(cards[1])
    key('End')
    expect(document.activeElement).toBe(cards[3])
    fireEvent.click(document.activeElement)
    expect(onRowAction).toHaveBeenCalledWith('open', expect.objectContaining({ symbol: 'CRWD' }))
  })
})

// Lane KEYS3 (Q6), second part. Measured in the browser after the list became one stop: the
// trade was still five Downs away (it is the sixth of many). A letter typed on a trade moves to
// the next trade whose symbol starts with it, and typing on narrows it. "g" as a FIRST letter is
// left alone: it starts the Journal's own "g then letter" shortcuts.
describe('TradesTable: typing a symbol moves to that trade (lane KEYS3)', () => {
  it('"c" goes to CRWD, Enter opens it, and the list says it takes letters', () => {
    const onRowAction = renderTable()
    cell('NVDA').focus()
    key('c')
    expect(document.activeElement).toBe(cell('CRWD'))
    key('Enter')
    expect(onRowAction).toHaveBeenCalledWith('open', expect.objectContaining({ symbol: 'CRWD' }))
    expect(document.querySelector('tbody').hasAttribute('data-grid-typeahead')).toBe(true)
  })

  it('typing on narrows ("ts" is TSLA), and a letter no symbol starts with moves nothing', () => {
    renderTable()
    cell('NVDA').focus()
    key('t'); key('s')
    expect(document.activeElement).toBe(cell('TSLA'))
    cell('NVDA').focus()
    key('z')
    expect(document.activeElement).toBe(cell('NVDA'))
  })

  it('"g" is a letter like any other here, and it does not reach the document (round 2)', () => {
    renderTable()
    cell('NVDA').focus()
    const seen = vi.fn()
    document.addEventListener('keydown', seen)
    fireEvent.keyDown(cell('NVDA'), { key: 'g' })
    fireEvent.keyDown(cell('NVDA'), { key: 'c', ctrlKey: true })     // Ctrl+C is not type-ahead
    document.removeEventListener('keydown', seen)
    expect(seen).toHaveBeenCalledTimes(1)                            // only the Ctrl one got out
    expect(document.activeElement).toBe(cell('NVDA'))
  })

  it('a letter typed in a row\'s Setup select is the select\'s own', () => {
    renderTable()
    const select = document.querySelector('tbody select')
    select.focus()
    key('c')
    expect(document.activeElement).toBe(select)
  })

  it('phone cards take letters too', () => {
    phone = true
    renderTable()
    const cards = screen.getAllByTestId('trade-card')
    cards[0].focus()
    key('c')
    expect(document.activeElement).toBe(cards[3])
  })
})
