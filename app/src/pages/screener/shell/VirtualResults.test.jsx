import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import VirtualResults from './VirtualResults'
import { sortRowsLive } from './liveSort'

vi.mock('../../../components/TickerPopup', () => ({ default: ({ children }) => <span>{children}</span> }))
vi.mock('../../../components/PatternFeedbackChip', () => ({ default: () => null }))
vi.mock('../../../components/TickerActions', () => ({
  default: () => null,
  useTickerActions: () => ({ longPressProps: () => ({}), menu: null, closeMenu: () => {} }),
}))

const rows = Array.from({ length: 500 }, (_, i) => ({
  ticker: `T${String(i).padStart(3, '0')}`, company: `Co ${i}`, price: 10 + i, chg_pct_1d: i % 7 - 3 }))
// jsdom has no layout engine — offsetWidth/offsetHeight are always 0, and
// react-virtual's default observeElementRect measures the real (zero) DOM
// rect synchronously on mount, overwriting `initialRect` before render()
// even returns. Stub observeElementRect too so the fixed 1200x800 sticks.
const VIRTUAL_OPTS = {
  initialRect: { width: 1200, height: 800 },
  observeElementRect: (_instance, cb) => { cb({ width: 1200, height: 800 }); return () => {} },
}
const base = {
  rows, columns: ['ticker', 'company', 'price', 'chg_pct_1d'],
  sort: { key: 'price', dir: 'desc' }, onSort: vi.fn(), livePrices: {},
  liveSortOn: false, density: 'compact', hasMore: false, onLoadMore: vi.fn(),
  isLoading: false, virtualOpts: VIRTUAL_OPTS,
}

describe('VirtualResults', () => {
  it('virtualizes: renders a window, not 500 rows', () => {
    render(<VirtualResults {...base} />)
    const rendered = screen.getAllByRole('row')
    expect(rendered.length).toBeGreaterThan(10)
    expect(rendered.length).toBeLessThan(120) // window + overscan, never the full set
    expect(screen.getByRole('table')).toHaveAttribute('aria-rowcount', '500')
  })

  it('headers carry aria-sort and toggle through onSort', () => {
    render(<VirtualResults {...base} />)
    const hdr = screen.getAllByRole('columnheader').find(h => h.textContent.includes('Price'))
    expect(hdr).toHaveAttribute('aria-sort', 'descending')
    fireEvent.click(hdr.querySelector('button'))
    expect(base.onSort).toHaveBeenCalled()
  })

  it('live dot is filled for subscribed tickers, hollow past the window', () => {
    render(<VirtualResults {...base} livePrices={{ T000: { price: 99, change_pct: 1 } }} />)
    const firstRow = screen.getAllByRole('row')[1]
    expect(firstRow.querySelector('[title="live price"]')).toBeTruthy()
    const second = screen.getAllByRole('row')[2]
    expect(second.querySelector('[title*="beyond the live window"]')).toBeTruthy()
  })
})

describe('sortRowsLive', () => {
  it('re-sorts loaded rows by live values, nulls last, original array untouched', () => {
    const r = [{ ticker: 'A', price: 1 }, { ticker: 'B', price: 2 }]
    const out = sortRowsLive(r, { key: 'price', dir: 'desc' }, { A: { price: 100 } })
    expect(out.map(x => x.ticker)).toEqual(['A', 'B'])
    expect(r[0].ticker).toBe('A') // pure
    const asc = sortRowsLive(r, { key: 'price', dir: 'asc' }, { A: { price: 100 } })
    expect(asc.map(x => x.ticker)).toEqual(['B', 'A'])
  })

  it('non-live sort keys pass through untouched', () => {
    const r = [{ ticker: 'A' }, { ticker: 'B' }]
    expect(sortRowsLive(r, { key: 'rs_rank', dir: 'desc' }, {})).toBe(r)
  })
})
