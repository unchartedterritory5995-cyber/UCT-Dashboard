import { render, screen, fireEvent } from '@testing-library/react'
import { vi } from 'vitest'
import FilterPanel from './FilterPanel'

const meta = {
  categories: [{ key: 'technical', label: 'Technical' }],
  filters: [{
    key: 'rsi14', label: 'RSI (14)', category: 'technical', type: 'range',
    allow_custom: true, unit: '',
    presets: [{ label: 'Any' }, { label: 'Oversold (<30)', op: 'lte', max: 30 }],
  }],
}

test('selecting a preset emits a spec', () => {
  const onChange = vi.fn()
  render(<FilterPanel meta={meta} activeFilters={{}} onChange={onChange}
    activeTab="technical" setActiveTab={() => {}} />)
  fireEvent.change(screen.getByLabelText('RSI (14)'),
    { target: { value: 'Oversold (<30)' } })
  expect(onChange).toHaveBeenCalledWith('rsi14', { op: 'lte', max: 30 })
})

test('selecting Any clears the filter', () => {
  const onChange = vi.fn()
  render(<FilterPanel meta={meta} activeFilters={{ rsi14: { op: 'lte', max: 30 } }}
    onChange={onChange} activeTab="technical" setActiveTab={() => {}} />)
  fireEvent.change(screen.getByLabelText('RSI (14)'), { target: { value: 'Any' } })
  expect(onChange).toHaveBeenCalledWith('rsi14', null)
})

test('shows active-count badge on the category tab', () => {
  render(<FilterPanel meta={meta} activeFilters={{ rsi14: { op: 'lte', max: 30 } }}
    onChange={() => {}} activeTab="technical" setActiveTab={() => {}} />)
  // Both the Technical tab and the All tab show a "1" count badge.
  expect(screen.getAllByText('1').length).toBeGreaterThanOrEqual(1)
})
