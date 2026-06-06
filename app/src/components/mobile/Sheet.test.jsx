import { render, screen, fireEvent } from '@testing-library/react'
import { vi } from 'vitest'
import Sheet from './Sheet'

// matchMedia defaults to matches:false (desktop) via test-setup → variant 'auto' = modal.

test('does not render when closed', () => {
  render(<Sheet open={false} onClose={() => {}} title="Hi">body</Sheet>)
  expect(screen.queryByText('body')).toBeNull()
})

test('renders title + children when open', () => {
  render(<Sheet open onClose={() => {}} title="My Sheet">hello body</Sheet>)
  expect(screen.getByText('My Sheet')).toBeInTheDocument()
  expect(screen.getByText('hello body')).toBeInTheDocument()
  expect(screen.getByRole('dialog')).toBeInTheDocument()
})

test('close button calls onClose', () => {
  const onClose = vi.fn()
  render(<Sheet open onClose={onClose} title="X">b</Sheet>)
  fireEvent.click(screen.getByLabelText('Close'))
  expect(onClose).toHaveBeenCalledTimes(1)
})

test('Escape calls onClose', () => {
  const onClose = vi.fn()
  render(<Sheet open onClose={onClose} title="X">b</Sheet>)
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(onClose).toHaveBeenCalled()
})

test('backdrop click calls onClose when dismissOnBackdrop', () => {
  const onClose = vi.fn()
  const { container } = render(<Sheet open onClose={onClose} title="X">b</Sheet>)
  // backdrop is the portaled root; mousedown directly on it (target === currentTarget)
  const backdrop = document.querySelector('[class*="backdrop"]')
  fireEvent.mouseDown(backdrop)
  expect(onClose).toHaveBeenCalled()
})
