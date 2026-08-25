import { render, screen, fireEvent } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'

// The widget's only data source + its color-group seam are mocked so the test
// drives render/interaction without a live poll or a WorkspaceProvider.
const swr = vi.fn()
vi.mock('../../../hooks/useMobileSWR', () => ({ default: (...a) => swr(...a) }))
const setGroupSym = vi.fn()
vi.mock('../WorkspaceContext', () => ({ useWorkspace: () => ({ setGroupSym }) }))
// usePlacedTheme (via the settings wiring) reads usePreferences — a bare default is enough.
vi.mock('../../../hooks/usePreferences', () => ({ default: () => ({ prefs: {}, setPref: vi.fn() }), parsePref: (_v, d) => d }))

import NewHighsLowsWidget from './NewHighsLowsWidget'

const TS = '2026-08-25T13:26:04-04:00'
const LIVE = {
  window: 'rth',
  asof: TS,
  highs_total: 143,   // universe-wide distinct-symbol counts (panel headers)
  lows_total: 88,
  highs: [
    { sym: 'RL', price: 356.01, count: 105, ts: TS, dir: 'high' },
    { sym: 'KGS', price: 57.81, count: 40, ts: TS, dir: 'high' },
  ],
  lows: [
    { sym: 'MNST', price: 78.34, count: 168, ts: TS, dir: 'low' },
  ],
}

beforeEach(() => {
  swr.mockReset()
  setGroupSym.mockReset()
})

describe('NewHighsLowsWidget', () => {
  it('renders both panels with symbols and running counts', () => {
    swr.mockReturnValue({ data: LIVE })
    render(<NewHighsLowsWidget color="A" opts={{}} onOptsChange={() => {}} />)
    expect(screen.getByText('NEW HIGHS')).toBeInTheDocument()
    expect(screen.getByText('NEW LOWS')).toBeInTheDocument()
    expect(screen.getByText('RL')).toBeInTheDocument()
    expect(screen.getByText('MNST')).toBeInTheDocument()
    expect(screen.getByText('105')).toBeInTheDocument()   // RL's running new-high count
    expect(screen.getByText('168')).toBeInTheDocument()   // MNST's running new-low count
  })

  it('panel headers show the universe-wide totals, not the visible-row counts', () => {
    swr.mockReturnValue({ data: LIVE })
    render(<NewHighsLowsWidget color="A" opts={{}} onOptsChange={() => {}} />)
    // 143 / 88 come from highs_total/lows_total even though only 2 / 1 rows show.
    expect(screen.getByText('143')).toBeInTheDocument()
    expect(screen.getByText('88')).toBeInTheDocument()
  })

  it('clicking a row routes the symbol into the widget color group', () => {
    swr.mockReturnValue({ data: LIVE })
    render(<NewHighsLowsWidget color="A" opts={{}} onOptsChange={() => {}} />)
    fireEvent.click(screen.getByTitle(/^RL —/))
    expect(setGroupSym).toHaveBeenCalledWith('A', 'RL')
  })

  it('editing a filter persists through onOptsChange (committed on blur)', () => {
    swr.mockReturnValue({ data: LIVE })
    const onOptsChange = vi.fn()
    render(<NewHighsLowsWidget color="A" opts={{ minCount: 1 }} onOptsChange={onOptsChange} />)
    const input = screen.getByLabelText('Minimum price')
    fireEvent.change(input, { target: { value: '5' } })
    fireEvent.blur(input)   // debounced: commits on blur (or after a pause)
    expect(onOptsChange).toHaveBeenCalledWith(expect.objectContaining({ minPrice: 5, minCount: 1 }))
  })

  it('the live poll URL carries the persisted filters', () => {
    swr.mockReturnValue({ data: LIVE })
    render(<NewHighsLowsWidget color="A" opts={{ minPrice: 10, minCount: 3 }} onOptsChange={() => {}} />)
    expect(swr).toHaveBeenCalledWith(
      expect.stringContaining('min_price=10'), expect.any(Function), expect.any(Object))
    expect(swr.mock.calls[0][0]).toContain('min_count=3')
  })

  it('shows the panels during post-market (not just RTH)', () => {
    swr.mockReturnValue({ data: { ...LIVE, window: 'post' } })
    render(<NewHighsLowsWidget color="A" opts={{}} onOptsChange={() => {}} />)
    expect(screen.getByText('POST-MARKET')).toBeInTheDocument()
    expect(screen.getByText('NEW HIGHS')).toBeInTheDocument()
    expect(screen.getByText('RL')).toBeInTheDocument()
  })

  it('switching scope persists the dimension and clears the stale category', () => {
    swr.mockReturnValue({ data: LIVE })
    const onOptsChange = vi.fn()
    render(<NewHighsLowsWidget color="A" opts={{ scopeValue: 'Old' }} onOptsChange={onOptsChange} />)
    fireEvent.click(screen.getByTitle('Group by'))                    // open scope menu
    fireEvent.click(screen.getByRole('option', { name: 'Sector' }))   // pick a dimension
    expect(onOptsChange).toHaveBeenCalledWith(expect.objectContaining({ scope: 'sector', scopeValue: '' }))
  })

  it('shows the category dropdown (busiest first) when a scope is active', () => {
    swr.mockReturnValue({ data: { ...LIVE, group: 'sector', categories: { Healthcare: 3, Technology: 12 } } })
    render(<NewHighsLowsWidget color="A" opts={{ scope: 'sector' }} onOptsChange={() => {}} />)
    fireEvent.click(screen.getByTitle('Pick a sector'))              // open category menu
    const labels = screen.getAllByRole('option').map(o => o.textContent)
    expect(labels[0]).toMatch(/All sectors/)
    expect(labels[1]).toMatch(/Technology.*12/)   // busiest first
    expect(labels[2]).toMatch(/Healthcare.*3/)
  })

  it('threads scope + value into the poll URL', () => {
    swr.mockReturnValue({ data: LIVE })
    render(<NewHighsLowsWidget color="A" opts={{ scope: 'sector', scopeValue: 'Technology' }} onOptsChange={() => {}} />)
    expect(swr.mock.calls[0][0]).toContain('group=sector')
    expect(swr.mock.calls[0][0]).toContain('value=Technology')
  })

  it('renders the % change on stock rows (colored by sign)', () => {
    swr.mockReturnValue({ data: { ...LIVE, highs: [
      { sym: 'RL', price: 356.01, pct: 12.4, count: 105, ts: TS, dir: 'high' },
    ], lows: [] } })
    render(<NewHighsLowsWidget color="A" opts={{}} onOptsChange={() => {}} />)
    const pct = screen.getByText('+12.4%')
    expect(pct).toBeInTheDocument()
    expect(pct).toHaveAttribute('data-sign', 'up')
  })

  it('in a group overview, a row click drills into that group (no chart, no price)', () => {
    swr.mockReturnValue({ data: {
      ...LIVE, group: 'industry', value: null,
      highs: [{ sym: 'Biotechnology', price: null, count: 32, ts: TS, dir: 'high', group: true }],
      lows: [],
    } })
    const onOptsChange = vi.fn()
    render(<NewHighsLowsWidget color="A" opts={{ scope: 'industry' }} onOptsChange={onOptsChange} />)
    fireEvent.click(screen.getByText('Biotechnology'))
    // clicking a group row drills (sets the 2nd dropdown value), never charts it
    expect(onOptsChange).toHaveBeenCalledWith(expect.objectContaining({ scopeValue: 'Biotechnology' }))
    expect(setGroupSym).not.toHaveBeenCalled()
  })

  it('shows a market-closed notice only when the window is closed', () => {
    swr.mockReturnValue({ data: { window: 'closed', highs: [], lows: [] } })
    render(<NewHighsLowsWidget color="A" opts={{}} onOptsChange={() => {}} />)
    expect(screen.getByText(/Market closed/i)).toBeInTheDocument()
    expect(screen.queryByText('NEW HIGHS')).not.toBeInTheDocument()
  })
})
