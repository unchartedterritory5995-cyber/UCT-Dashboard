import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import TypeFilterControl from './TypeFilterControl'

const FILTER = { key: 'security_type', label: 'Type', options: ['Stock', 'ADR', 'ETF'] }

describe('TypeFilterControl', () => {
  it('checking types emits an Include (op:in) spec with the singular bucket values', () => {
    const onChange = vi.fn()
    render(<TypeFilterControl filter={FILTER} value={null} onChange={onChange} />)
    fireEvent.click(screen.getByLabelText('Include Stocks'))
    expect(onChange).toHaveBeenLastCalledWith({ op: 'in', values: ['Stock'] })
  })

  it('unchecking the last type clears the filter (null)', () => {
    const onChange = vi.fn()
    render(<TypeFilterControl filter={FILTER} value={{ op: 'in', values: ['ETF'] }} onChange={onChange} />)
    fireEvent.click(screen.getByLabelText('Include ETFs'))   // it is checked → unchecks
    expect(onChange).toHaveBeenLastCalledWith(null)
  })

  it('Exclude is selectable BEFORE any type is checked, then a check emits not_in', () => {
    const onChange = vi.fn()
    render(<TypeFilterControl filter={FILTER} value={null} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'Exclude' }))
    // the toggle lights up even with nothing checked (the derived-mode bug)
    expect(screen.getByRole('button', { name: 'Exclude' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByLabelText('Exclude ETFs'))
    expect(onChange).toHaveBeenLastCalledWith({ op: 'not_in', values: ['ETF'] })
  })

  it('the Exclude toggle flips the op while keeping the picks', () => {
    const onChange = vi.fn()
    render(<TypeFilterControl filter={FILTER} value={{ op: 'in', values: ['ETF'] }} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'Exclude' }))
    expect(onChange).toHaveBeenLastCalledWith({ op: 'not_in', values: ['ETF'] })
  })

  it('renders pluralised labels and reflects the active mode', () => {
    render(<TypeFilterControl filter={FILTER} value={{ op: 'not_in', values: ['ADR'] }} onChange={() => {}} />)
    expect(screen.getByRole('button', { name: 'Exclude' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByLabelText('Exclude ADRs')).toBeChecked()
    expect(screen.getByText('Stocks')).toBeInTheDocument()
  })
})
