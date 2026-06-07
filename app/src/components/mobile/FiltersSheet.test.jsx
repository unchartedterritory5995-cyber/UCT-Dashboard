import { render, screen, fireEvent } from '@testing-library/react'
import { vi } from 'vitest'
import FiltersSheet from './FiltersSheet'

test('renders title, children, and Apply', () => {
  render(
    <FiltersSheet open onClose={vi.fn()} onApply={vi.fn()}>
      <div>filter controls</div>
    </FiltersSheet>,
  )
  expect(screen.getByText('Filters')).toBeInTheDocument()
  expect(screen.getByText('filter controls')).toBeInTheDocument()
  expect(screen.getByText('Apply')).toBeInTheDocument()
})

test('shows Clear all + count when filters are active and fires onClear', () => {
  const onClear = vi.fn()
  render(<FiltersSheet open onClose={vi.fn()} onClear={onClear} activeCount={3}>x</FiltersSheet>)
  expect(screen.getByText('Filters · 3')).toBeInTheDocument()
  fireEvent.click(screen.getByText('Clear all'))
  expect(onClear).toHaveBeenCalled()
})

test('Apply shows the active count and fires onApply', () => {
  const onApply = vi.fn()
  render(<FiltersSheet open onClose={vi.fn()} onApply={onApply} activeCount={2}>x</FiltersSheet>)
  fireEvent.click(screen.getByText('Apply (2)'))
  expect(onApply).toHaveBeenCalled()
})

test('renders nothing when closed', () => {
  render(<FiltersSheet open={false} onClose={vi.fn()}>x</FiltersSheet>)
  expect(screen.queryByText('Filters')).toBeNull()
})
