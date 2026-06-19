import { render, screen, fireEvent } from '@testing-library/react'
import { vi } from 'vitest'
import FilterChips from './FilterChips'

const meta = { filters: [
  { key: 'rsi14', label: 'RSI (14)', unit: '', presets: [{ label: 'Any' }, { label: '40–60', op: 'between', min: 40, max: 60 }] },
  { key: 'sector', label: 'Sector', unit: null, presets: [{ label: 'Any' }] },
] }

test('renders a chip per active filter and removes one', () => {
  const onRemove = vi.fn()
  render(<FilterChips meta={meta}
    activeFilters={{ rsi14: { op: 'between', min: 40, max: 60 }, sector: { op: 'eq', value: 'Technology' } }}
    onRemove={onRemove} onClear={() => {}} />)
  expect(screen.getByText('RSI (14): 40–60')).toBeInTheDocument()
  expect(screen.getByText('Sector: Technology')).toBeInTheDocument()
  fireEvent.click(screen.getByLabelText('Remove RSI (14) filter'))
  expect(onRemove).toHaveBeenCalledWith('rsi14')
})

test('renders nothing when no active filters', () => {
  const { container } = render(<FilterChips meta={meta} activeFilters={{}} onRemove={() => {}} onClear={() => {}} />)
  expect(container.firstChild).toBeNull()
})
