/* TERM-065 — the screener grid onto the DataGrid seed, BYTE-IDENTICAL.
 *
 * The snapshot below was RECORDED BY THE HAND-ROLLED CODE, before the migration
 * (same method as journalGrids.seedParity.test.jsx). The migration may change
 * where the sort decisions come from; it may not change one byte a member or a
 * screen reader gets, one onSort request, or one row of the live re-sort order.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent, cleanup } from '@testing-library/react'
import VirtualResults from './VirtualResults'
import { sortRowsLive } from './liveSort'

vi.mock('../../../components/TickerPopup', () => ({ default: ({ children }) => <span>{children}</span> }))
vi.mock('../../../components/PatternFeedbackChip', () => ({ default: () => null }))
vi.mock('../../../components/TickerActions', () => ({
  default: () => null,
  useTickerActions: () => ({ longPressProps: () => ({}), menu: null, closeMenu: () => {} }),
}))

const VIRTUAL_OPTS = {
  initialRect: { width: 1200, height: 800 },
  observeElementRect: (_i, cb) => { cb({ width: 1200, height: 800 }); return () => {} },
}
const COLS = ['ticker', 'company', 'price', 'chg_pct_1d', 'rs_rank']
const ROWS = Array.from({ length: 12 }, (_, i) => ({
  ticker: `T${i}`, company: `Co ${i}`, price: 10 + i, chg_pct_1d: (i % 5) - 2, rs_rank: 90 - i }))

function header(sort) {
  const { container } = render(
    <VirtualResults rows={ROWS} columns={COLS} sort={sort} onSort={() => {}} livePrices={{}}
      density="compact" hasMore={false} onLoadMore={() => {}} isLoading={false}
      virtualOpts={VIRTUAL_OPTS} />)
  const html = container.querySelector('[role="row"]').outerHTML
  cleanup()
  return html
}

describe('screener grid — seed parity (recorded before the migration)', () => {
  it('header DOM is byte-identical in every sort state', () => {
    const states = [null, { key: 'price', dir: 'desc' }, { key: 'price', dir: 'asc' },
      { key: 'ticker', dir: 'asc' }, { key: 'rs_rank', dir: 'desc' }]
    expect(states.map(header)).toMatchSnapshot()
  })

  it('every header click requests the same next sort', () => {
    const asked = []
    const starts = [null, { key: 'price', dir: 'desc' }, { key: 'price', dir: 'asc' }]
    for (const start of starts) {
      for (const col of ['price', 'ticker']) {
        const onSort = vi.fn()
        const { container } = render(
          <VirtualResults rows={ROWS} columns={COLS} sort={start} onSort={onSort}
            livePrices={{}} density="compact" hasMore={false} onLoadMore={() => {}}
            isLoading={false} virtualOpts={VIRTUAL_OPTS} />)
        const hdr = [...container.querySelectorAll('[role="columnheader"]')]
          .find(h => h.textContent.includes(col === 'price' ? 'Price' : 'Ticker'))
        fireEvent.click(hdr.querySelector('button'))
        asked.push({ start, col, next: onSort.mock.calls[0][0](start) })
        cleanup()
      }
    }
    expect(asked).toMatchSnapshot()
  })

  it('the live re-sort order is identical, blanks and ties included', () => {
    let seed = 7
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 }
    const rows = Array.from({ length: 300 }, (_, i) => ({
      ticker: `L${i}`,
      price: rnd() < 0.1 ? null : Math.round(rnd() * 50) / 2,
      chg_pct_1d: rnd() < 0.1 ? undefined : Math.round(rnd() * 20 - 10),
    }))
    const live = {}
    rows.forEach((r, i) => { if (i % 3 === 0) live[r.ticker] = { price: Math.round(rnd() * 50) / 2, change_pct: i % 9 === 0 ? null : Math.round(rnd() * 8) } })
    const orders = []
    for (const key of ['price', 'chg_pct_1d', 'company']) {
      for (const dir of ['asc', 'desc']) {
        orders.push({ key, dir, order: sortRowsLive(rows, { key, dir }, live).map(r => r.ticker).join(',') })
      }
    }
    expect(orders).toMatchSnapshot()
  })
})
