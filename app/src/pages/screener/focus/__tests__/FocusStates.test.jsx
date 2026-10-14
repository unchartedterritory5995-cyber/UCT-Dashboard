import { render, screen, fireEvent } from '@testing-library/react'
import { vi } from 'vitest'
import { EmptyState, ErrorState, ListSkeleton } from '../FocusStates'

test('empty names the emptying change and offers undo', () => {
  const onUndo = vi.fn()
  render(<EmptyState filterCount={5} lastChange={{ label: '8-wk gain ≥ 200%', from: 31 }} onUndo={onUndo} onOpenFilters={vi.fn()} />)
  expect(screen.getByText('No stocks match all 5 filters')).toBeInTheDocument()
  expect(screen.getByText(/took the list from 31 to 0/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Undo that change' }))
  expect(onUndo).toHaveBeenCalled()
})
test('empty without a known change has no undo', () => {
  render(<EmptyState filterCount={1} lastChange={null} onUndo={vi.fn()} onOpenFilters={vi.fn()} />)
  expect(screen.getByText('No stocks match this filter')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Undo that change' })).toBeNull()
})
test('error has one action', () => {
  const onRetry = vi.fn()
  render(<ErrorState message="The server took too long to answer." onRetry={onRetry} />)
  expect(screen.getByRole('alert')).toHaveTextContent("The screen didn't load")
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
  expect(onRetry).toHaveBeenCalled()
})
test('skeleton is announced as loading', () => {
  render(<ListSkeleton />)
  expect(screen.getByRole('status')).toHaveTextContent('Loading results')
})

test('empty with zero filters names the screen, and is a status region', () => {
  render(<EmptyState filterCount={0} lastChange={null} onUndo={vi.fn()} onOpenFilters={vi.fn()} />)
  expect(screen.getByText('No stocks match this screen')).toBeInTheDocument()
  expect(screen.getByRole('status')).toBeInTheDocument()
})
test('error message and kept-filters note are two sentences whatever the punctuation', () => {
  const { rerender } = render(<ErrorState message="Timed out." onRetry={vi.fn()} />)
  expect(screen.getByRole('alert')).toHaveTextContent('Timed out. Your filters are kept.')
  rerender(<ErrorState message="Timed out" onRetry={vi.fn()} />)
  expect(screen.getByRole('alert')).toHaveTextContent('Timed out. Your filters are kept.')
  rerender(<ErrorState message="" onRetry={vi.fn()} />)
  expect(screen.getByRole('alert')).toHaveTextContent("The screen didn't loadYour filters are kept.")
})
