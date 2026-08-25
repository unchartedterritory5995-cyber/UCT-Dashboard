import { render, screen, fireEvent } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'

// The widget's only data source + its color-group seam are mocked so the test
// drives render/interaction without a live poll or a WorkspaceProvider.
const swr = vi.fn()
vi.mock('../../../hooks/useMobileSWR', () => ({ default: (...a) => swr(...a) }))
const setGroupSym = vi.fn()
vi.mock('../WorkspaceContext', () => ({ useWorkspace: () => ({ setGroupSym }) }))

import NewHighsLowsWidget from './NewHighsLowsWidget'

const TS = '2026-08-25T13:26:04-04:00'
const LIVE = {
  session: 'regular',
  asof: TS,
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

  it('clicking a row routes the symbol into the widget color group', () => {
    swr.mockReturnValue({ data: LIVE })
    render(<NewHighsLowsWidget color="A" opts={{}} onOptsChange={() => {}} />)
    fireEvent.click(screen.getByTitle(/^RL —/))
    expect(setGroupSym).toHaveBeenCalledWith('A', 'RL')
  })

  it('editing a filter persists through onOptsChange', () => {
    swr.mockReturnValue({ data: LIVE })
    const onOptsChange = vi.fn()
    render(<NewHighsLowsWidget color="A" opts={{ minCount: 1 }} onOptsChange={onOptsChange} />)
    fireEvent.change(screen.getByLabelText('Minimum price'), { target: { value: '5' } })
    expect(onOptsChange).toHaveBeenCalledWith(expect.objectContaining({ minPrice: 5, minCount: 1 }))
  })

  it('the live poll URL carries the persisted filters', () => {
    swr.mockReturnValue({ data: LIVE })
    render(<NewHighsLowsWidget color="A" opts={{ minPrice: 10, minCount: 3 }} onOptsChange={() => {}} />)
    expect(swr).toHaveBeenCalledWith(
      expect.stringContaining('min_price=10'), expect.any(Function), expect.any(Object))
    expect(swr.mock.calls[0][0]).toContain('min_count=3')
  })

  it('shows a market-closed notice outside regular hours', () => {
    swr.mockReturnValue({ data: { session: 'post_market', highs: [], lows: [] } })
    render(<NewHighsLowsWidget color="A" opts={{}} onOptsChange={() => {}} />)
    expect(screen.getByText(/Intraday scan runs during market hours/i)).toBeInTheDocument()
    expect(screen.queryByText('NEW HIGHS')).not.toBeInTheDocument()
  })
})
