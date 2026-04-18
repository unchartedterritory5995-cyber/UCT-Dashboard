import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import FiltersPanel from './FiltersPanel'
import { EMPTY_FILTERS } from '../hooks/useJ2Filters'

function emptyFilters() {
  return {
    ...EMPTY_FILTERS,
    sides: new Set(),
    setups: new Set(),
    navBuckets: new Set(),
    powerTrends: new Set(),
  }
}

const SETTINGS = {
  setups: ['VCP', 'Breakout'],
  journalColumns: { marketNavIndex: 'NYA', breadthMetric: 'NASI RSI' },
}

const baseProps = {
  open: true,
  anchorRef: { current: null },
  filters: emptyFilters(),
  setFilter: vi.fn(),
  toggleSetMember: vi.fn(),
  resetFilters: vi.fn(),
  activeCount: 0,
  onClose: vi.fn(),
  settings: SETTINGS,
  trades: [],
}

describe('FiltersPanel', () => {
  it('renders all 9 sections', () => {
    render(<FiltersPanel {...baseProps} />)
    expect(screen.getByText('Date Range')).toBeInTheDocument()
    expect(screen.getByText('Symbol')).toBeInTheDocument()
    expect(screen.getByText('RS Rating Minimum (at entry)')).toBeInTheDocument()
    expect(screen.getByText(/NASI RSI \(at entry\)/)).toBeInTheDocument()
    expect(screen.getByText('Side')).toBeInTheDocument()
    expect(screen.getByText('Setup')).toBeInTheDocument()
    expect(screen.getByText('Nav Count (market exposure)')).toBeInTheDocument()
    expect(screen.getByText('Power Trend')).toBeInTheDocument()
    expect(screen.getByText('Rally Day')).toBeInTheDocument()
  })

  it('does not render when open=false', () => {
    render(<FiltersPanel {...baseProps} open={false} />)
    expect(screen.queryByText('Date Range')).not.toBeInTheDocument()
  })

  it('symbol input fires setFilter on change', async () => {
    const user = userEvent.setup()
    const setFilter = vi.fn()
    render(<FiltersPanel {...baseProps} setFilter={setFilter} />)
    const input = screen.getByLabelText('Symbol starts-with filter')
    await user.type(input, 'n')
    expect(setFilter).toHaveBeenCalledWith('symbol', 'n')
  })

  it('side checkbox fires toggleSetMember', async () => {
    const user = userEvent.setup()
    const toggleSetMember = vi.fn()
    render(<FiltersPanel {...baseProps} toggleSetMember={toggleSetMember} />)
    const longCheckbox = screen.getByRole('checkbox', { name: 'Long' })
    await user.click(longCheckbox)
    expect(toggleSetMember).toHaveBeenCalledWith('sides', 'Long')
  })

  it('Clear all only renders when activeCount > 0', () => {
    const { rerender } = render(<FiltersPanel {...baseProps} activeCount={0} />)
    expect(screen.queryByText('Clear all')).not.toBeInTheDocument()
    rerender(<FiltersPanel {...baseProps} activeCount={3} />)
    expect(screen.getByText('Clear all')).toBeInTheDocument()
  })

  it('Clear all fires resetFilters', async () => {
    const user = userEvent.setup()
    const resetFilters = vi.fn()
    render(
      <FiltersPanel {...baseProps} activeCount={2} resetFilters={resetFilters} />,
    )
    await user.click(screen.getByText('Clear all'))
    expect(resetFilters).toHaveBeenCalled()
  })

  it('merges settings setups with historical setups from trades', () => {
    // settings has VCP + Breakout; trade carries a retired setup "Old Setup"
    const trades = [
      { id: '1', setup: 'Old Setup', contextAtEntry: {} },
      { id: '2', setup: 'VCP', contextAtEntry: {} },
    ]
    render(<FiltersPanel {...baseProps} trades={trades} />)
    expect(screen.getByLabelText('Breakout')).toBeInTheDocument()
    expect(screen.getByLabelText('VCP')).toBeInTheDocument()
    expect(screen.getByLabelText('Old Setup')).toBeInTheDocument()
  })

  it('breadth section header reflects live settings metric name', () => {
    const custom = {
      ...SETTINGS,
      journalColumns: { marketNavIndex: 'NYA', breadthMetric: '% Above 50MA' },
    }
    render(<FiltersPanel {...baseProps} settings={custom} />)
    expect(screen.getByText(/% Above 50MA \(at entry\)/)).toBeInTheDocument()
  })

  it('NASI dir pill toggle sets value; second click clears it', async () => {
    const user = userEvent.setup()
    const setFilter = vi.fn()
    render(<FiltersPanel {...baseProps} setFilter={setFilter} />)
    await user.click(screen.getByRole('button', { name: 'Above' }))
    expect(setFilter).toHaveBeenLastCalledWith('nasiDir', 'Above')

    // Second render: filter.nasiDir already 'Above' → clicking Above clears
    render(
      <FiltersPanel
        {...baseProps}
        setFilter={setFilter}
        filters={{ ...emptyFilters(), nasiDir: 'Above' }}
      />,
    )
    const abovePills = screen.getAllByRole('button', { name: 'Above' })
    await user.click(abovePills[abovePills.length - 1])
    expect(setFilter).toHaveBeenLastCalledWith('nasiDir', '')
  })

  it('Esc closes the panel', () => {
    const onClose = vi.fn()
    render(<FiltersPanel {...baseProps} onClose={onClose} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })
})
