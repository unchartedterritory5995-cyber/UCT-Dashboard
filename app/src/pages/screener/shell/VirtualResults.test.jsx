import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import VirtualResults from './VirtualResults'
import { COLUMN_DEFS, DESC_TRIGGER_W } from '../columnDefs'
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

// ── the honesty text, on screen ──
// `columnDefs.desc` exists so a member cannot misread the number (the $4M
// dark-pool block floor, the three-way-ambiguous blank). Before 2026-08-23 the
// only consumer was a native `title`: hover-only and unreachable by keyboard.
// The probe below is the accessible name of the disclosure button, so a test
// that passes is a test a screen-reader user could have driven.
const DESCRIBED = 'dp_notional_1d'
const infoButtons = () => screen.queryAllByRole('button', { name: /^What .+ means$/ })

describe('VirtualResults — column description surface', () => {
  const withCols = cols => ({
    ...base,
    columns: cols,
    rows: [{ ticker: 'AAA', price: 12, chg_pct_1d: 1.5, dp_notional_1d: 9.4e6 }],
  })

  it('renders the whole desc for a column that has one, opened from the keyboard', async () => {
    const user = userEvent.setup()
    render(<VirtualResults {...withCols(['ticker', 'price', DESCRIBED])} />)

    const btn = screen.getByRole('button', { name: 'What DP $ 1d means' })
    expect(btn).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('note')).toBeNull()

    // Reachable by TAB, not just by mouse — the 8/22 sweep's rule.
    let guard = 0
    while (document.activeElement !== btn && guard++ < 12) await user.tab()
    expect(document.activeElement).toBe(btn)

    await user.keyboard('{Enter}')
    const panel = screen.getByRole('note')
    // The FULL string, not a truncated hover hint. Read from COLUMN_DEFS so the
    // assertion cannot drift from the copy it is guarding.
    expect(panel).toHaveTextContent(COLUMN_DEFS[DESCRIBED].desc)
    expect(btn).toHaveAttribute('aria-expanded', 'true')
    expect(btn).toHaveAttribute('aria-controls', panel.id)

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('note')).toBeNull()
    expect(document.activeElement).toBe(btn)
  })

  it('the described column reserves the trigger its own width, so the label is not squeezed', () => {
    render(<VirtualResults {...withCols(['price', DESCRIBED])} />)
    // 92px is the plain numeric track; the described one is wider by exactly
    // the trigger. Without this the icon eats the label inside a 92px cell.
    expect(screen.getByRole('table').style.getPropertyValue('--grid-cols'))
      .toBe(`92px ${92 + DESC_TRIGGER_W}px`)
  })

  it('a column with no desc grows NO affordance — same probe, both populations', () => {
    // CONTROL. An empty tooltip is worse than none, so absence is the assertion;
    // absence alone proves nothing unless the same query finds one when a
    // described column IS present. Both halves run here, so a ColumnDesc that
    // rendered for everything and one that rendered for nothing each go red.
    const { unmount } = render(<VirtualResults {...withCols(['ticker', 'price', 'chg_pct_1d'])} />)
    expect(COLUMN_DEFS.price.desc).toBeUndefined()
    expect(infoButtons()).toHaveLength(0)
    unmount()

    render(<VirtualResults {...withCols(['ticker', 'price', 'chg_pct_1d', DESCRIBED])} />)
    expect(infoButtons().map(b => b.dataset.coldesc)).toEqual([DESCRIBED])
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
