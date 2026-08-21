import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import FilterRail from './FilterRail'

const META = {
  categories: [{ key: 'descriptive', label: 'Descriptive' }, { key: 'momentum', label: 'Momentum' }],
  filters: [
    { key: 'price', label: 'Price', category: 'descriptive', type: 'range', allow_custom: true, presets: [{ label: 'Any' }] },
    { key: 'sector', label: 'Sector', category: 'descriptive', type: 'enum', presets: [{ label: 'Any' }] },
    { key: 'pole_pct', label: 'Prior Run (Pole %)', category: 'momentum', type: 'range', allow_custom: true, presets: [{ label: 'Any' }] },
  ],
}

beforeEach(() => localStorage.clear())

describe('FilterRail', () => {
  it('renders every category the server sends — nothing hardcoded', () => {
    render(<FilterRail meta={META} activeFilters={{}} onChange={() => {}} onClear={() => {}} />)
    expect(screen.getByRole('button', { name: /descriptive/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /momentum/i })).toBeInTheDocument()
    expect(screen.getByLabelText('Price')).toBeInTheDocument()
  })

  it('collapsing a group hides its controls and persists', () => {
    const { unmount } = render(<FilterRail meta={META} activeFilters={{}} onChange={() => {}} onClear={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /descriptive/i }))
    expect(screen.queryByLabelText('Price')).toBeNull()
    unmount()
    render(<FilterRail meta={META} activeFilters={{}} onChange={() => {}} onClear={() => {}} />)
    expect(screen.queryByLabelText('Price')).toBeNull()   // remembered closed
    expect(screen.getByLabelText('Prior Run (Pole %)')).toBeInTheDocument()
  })

  it('search narrows by label and reaches inside collapsed groups', () => {
    render(<FilterRail meta={META} activeFilters={{}} onChange={() => {}} onClear={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /momentum/i }))          // collapse
    fireEvent.change(screen.getByLabelText('Find a filter'), { target: { value: 'pole' } })
    expect(screen.getByLabelText('Prior Run (Pole %)')).toBeInTheDocument()     // force-open
    expect(screen.queryByLabelText('Price')).toBeNull()                          // no match
    expect(screen.queryByRole('button', { name: /descriptive/i })).toBeNull()   // empty group hidden
  })

  it('active counts pip the group head and Clear N clears', () => {
    const onClear = vi.fn()
    render(<FilterRail meta={META} activeFilters={{ price: { op: 'gte', min: 10 } }}
      onChange={() => {}} onClear={onClear} />)
    expect(screen.getByRole('button', { name: /descriptive/i })).toHaveTextContent('1')
    fireEvent.click(screen.getByRole('button', { name: /clear 1/i }))
    expect(onClear).toHaveBeenCalled()
  })
})
