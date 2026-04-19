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
  }
}

const SETTINGS = {
  setups: ['VCP', 'Breakout'],
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
  it('renders the surviving sections', () => {
    render(<FiltersPanel {...baseProps} />)
    expect(screen.getByText('Date Range')).toBeInTheDocument()
    expect(screen.getByText('Symbol')).toBeInTheDocument()
    expect(screen.getByText('Side')).toBeInTheDocument()
    expect(screen.getByText('Setup')).toBeInTheDocument()
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
    const trades = [
      { id: '1', setup: 'Old Setup' },
      { id: '2', setup: 'VCP' },
    ]
    render(<FiltersPanel {...baseProps} trades={trades} />)
    expect(screen.getByLabelText('Breakout')).toBeInTheDocument()
    expect(screen.getByLabelText('VCP')).toBeInTheDocument()
    expect(screen.getByLabelText('Old Setup')).toBeInTheDocument()
  })

  it('Esc closes the panel', () => {
    const onClose = vi.fn()
    render(<FiltersPanel {...baseProps} onClose={onClose} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })
})
