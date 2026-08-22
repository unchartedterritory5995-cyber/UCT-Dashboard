import { render, screen, fireEvent } from '@testing-library/react'
import { test, expect, vi } from 'vitest'
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
  render(<Sheet open onClose={onClose} title="X">b</Sheet>)
  // backdrop is the portaled root; mousedown directly on it (target === currentTarget)
  const backdrop = document.querySelector('[class*="backdrop"]')
  fireEvent.mouseDown(backdrop)
  expect(onClose).toHaveBeenCalled()
})

test('a titled Sheet still carries its ariaLabel as the dialog name', () => {
  // The title is a heading, not a name — nothing wires aria-labelledby — so
  // a titled dialog used to be anonymous to assistive tech and to tests.
  render(<Sheet open onClose={() => {}} title="Cash flow" ariaLabel="Cash flow — ADI">b</Sheet>)
  expect(screen.getByRole('dialog', { name: 'Cash flow — ADI' })).toBeInTheDocument()
})

test('only the innermost open Sheet answers Escape', () => {
  // Both listen on document in the capture phase; stopPropagation cannot stop
  // a sibling listener on the same node, and the OUTER one registered first —
  // so without the topmost check one Escape closed the whole stack.
  const outer = vi.fn()
  const inner = vi.fn()
  const tree = (innerOpen) => (
    <Sheet open onClose={outer} title="Outer">
      <Sheet open={innerOpen} onClose={inner} title="Inner">b</Sheet>
    </Sheet>
  )
  const { rerender } = render(tree(false))
  rerender(tree(true)) // opened later, as a nested sheet always is
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(inner).toHaveBeenCalledTimes(1)
  expect(outer).not.toHaveBeenCalled()

  rerender(tree(false))
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(outer).toHaveBeenCalledTimes(1)
  expect(inner).toHaveBeenCalledTimes(1)
})
