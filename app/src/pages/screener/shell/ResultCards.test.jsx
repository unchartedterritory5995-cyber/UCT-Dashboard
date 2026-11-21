import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import ResultCards from './ResultCards'

vi.mock('../../../components/TickerPopup', () => ({ default: ({ children }) => <span>{children}</span> }))
vi.mock('../../../components/TickerActions', () => ({
  default: () => null,
  useTickerActions: () => ({ longPressProps: () => ({}), menu: null, closeMenu: () => {} }),
}))

// jsdom has no layout engine — offsetWidth/offsetHeight are always 0, and
// react-virtual's default observeElementRect measures the real (zero) DOM
// rect synchronously on mount, overwriting `initialRect` before render()
// even returns. Stub observeElementRect too so the fixed 1200x800 sticks
// (same shim as VirtualResults.test.jsx / Task 8).
const VIRTUAL_OPTS = {
  initialRect: { width: 1200, height: 800 },
  observeElementRect: (_instance, cb) => { cb({ width: 1200, height: 800 }); return () => {} },
}

const rows = [
  { ticker: 'AAPL', company: 'Apple Inc.', price: 150.5, chg_pct_1d: 1.23,
    candle_score: 72, pole_pct: 18, rs_rank: 91, adr_pct: 3.2 },
  { ticker: 'MSFT', company: 'Microsoft Corp.', price: 310.2, chg_pct_1d: -0.85,
    candle_score: 55, pole_pct: 12, rs_rank: 80, adr_pct: 2.1 },
]
// picker-driven column order — REQUIRED_COLS (ticker/company/price/chg_pct_1d)
// first, then 4 more; line 2 must render only the first THREE non-required.
const base = {
  rows, columns: ['ticker', 'company', 'price', 'chg_pct_1d', 'candle_score', 'pole_pct', 'rs_rank', 'adr_pct'],
  livePrices: {}, hasMore: false, onLoadMore: vi.fn(), isLoading: false,
  virtualOpts: VIRTUAL_OPTS,
}

describe('ResultCards', () => {
  it('line 1 carries ticker, company, and price/chg — the row snapshot with no live tick', () => {
    render(<ResultCards {...base} />)
    expect(screen.getByText('AAPL')).toBeInTheDocument()
    expect(screen.getByText('Apple Inc.')).toBeInTheDocument()
    expect(screen.getByText('$150.50')).toBeInTheDocument()
    expect(screen.getByText(/\+1\.23%/)).toBeInTheDocument()
  })

  it('a live tick patches line-1 price/chg, overriding the row snapshot', () => {
    render(<ResultCards {...base} livePrices={{ AAPL: { price: 999.99, change_pct: -5 } }} />)
    expect(screen.getByText('$999.99')).toBeInTheDocument()
    expect(screen.getByText(/-5\.00%/)).toBeInTheDocument()
    // untouched ticker still shows its own snapshot values
    expect(screen.getByText('$310.20')).toBeInTheDocument()
  })

  it('line 2 renders exactly the first three picker-driven stats, excluding REQUIRED_COLS', () => {
    render(<ResultCards {...base} />)
    expect(screen.getAllByText('Score').length).toBe(2)   // candle_score
    expect(screen.getAllByText('Pole%').length).toBe(2)   // pole_pct
    expect(screen.getAllByText('RS').length).toBe(2)      // rs_rank
    expect(screen.queryByText('ADR%')).not.toBeInTheDocument() // adr_pct is the 4th — excluded
  })

  // Phone fit, part 3: the stats are one line and only a stat whose value is words is cut short
  // (ScannerShell.module.css), so that stat keeps its whole text where a reader can get it.
  it('a words stat carries its full text in title; a number stat carries none', () => {
    const named = [{ ...rows[0], sector: 'Communication Services', market_cap: 2.5e12, rvol: 1.3 },
      { ...rows[1], sector: null, market_cap: 3.1e12, rvol: 0.9 }]
    render(<ResultCards {...base} rows={named}
      columns={['ticker', 'company', 'price', 'chg_pct_1d', 'sector', 'market_cap', 'rvol']} />)
    const sector = screen.getByText('Communication Services')
    expect(sector.getAttribute('title')).toBe('Communication Services')
    expect(sector.parentElement.className).toContain('cardStatText')
    // the numbers beside it: no title, and not the class that lets a stat shrink
    const caps = screen.getAllByText('Mkt Cap').map((l) => l.nextElementSibling)
    expect(caps.length).toBe(2)
    for (const v of caps) {
      expect(v.hasAttribute('title')).toBe(false)
      expect(v.parentElement.className).not.toContain('cardStatText')
    }
    // a missing sector is a dash, not words: nothing to cut, nothing to title
    const dash = screen.getAllByText('Sector')[1].nextElementSibling
    expect(dash.textContent).toBe('—')
    expect(dash.hasAttribute('title')).toBe(false)
    expect(dash.parentElement.className).not.toContain('cardStatText')
  })
})
