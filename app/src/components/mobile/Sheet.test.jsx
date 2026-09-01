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


// ─── the focus trap ─────────────────────────────────────────────────────────
//
// ⛔⛔ THIS DID NOT EXIST, while this component's header and CLAUDE.md both said
// "focus-trap". `aria-modal="true"` constrains a screen reader's virtual cursor
// and does NOTHING to Tab, so a keyboard user tabbed straight out of the panel
// into the page the modal was covering, with no way back but Shift+Tab through
// the whole document.

const Body = () => (
  <>
    <button>first</button>
    <button>middle</button>
    <button>last</button>
  </>
)

const tab = (shiftKey = false) =>
  fireEvent.keyDown(document, { key: 'Tab', shiftKey })

// ⚠️ THE PANEL'S OWN CLOSE BUTTON IS THE FIRST FOCUSABLE, ahead of any child.
// My first draft of these cases asserted a wrap to the child named "first" and
// failed — the implementation was right and the EXPECTATION was wrong. Naming
// the real first control keeps the case honest about the DOM it tests.
const firstFocusable = () =>
  document.querySelector('[data-sheet-panel]').querySelector(
    'a[href],button:not([disabled]),input:not([disabled]),' +
    'select:not([disabled]),textarea:not([disabled]),summary,' +
    '[tabindex]:not([tabindex="-1"])')

test('focus trap: wraps forward from the LAST control back to the first', () => {
  render(<Sheet open onClose={() => {}} title="t"><Body /></Sheet>)
  screen.getByRole('button', { name: 'last' }).focus()
  tab()
  expect(firstFocusable()).toHaveFocus()
})

test('focus trap: wraps backward from the FIRST control round to the last', () => {
  render(<Sheet open onClose={() => {}} title="t"><Body /></Sheet>)
  firstFocusable().focus()
  tab(true)
  expect(screen.getByRole('button', { name: 'last' })).toHaveFocus()
})

test('focus trap: pulls focus BACK when it has escaped the panel', () => {
  render(
    <>
      <button>behind the modal</button>
      <Sheet open onClose={() => {}} title="t"><Body /></Sheet>
    </>,
  )
  screen.getByRole('button', { name: 'behind the modal' }).focus()
  tab()
  expect(firstFocusable()).toHaveFocus()
})

test('focus trap: does NOT engage while the sheet is closed', () => {
  render(
    <>
      <button>outside</button>
      <Sheet open={false} onClose={() => {}} title="t"><Body /></Sheet>
    </>,
  )
  const outside = screen.getByRole('button', { name: 'outside' })
  outside.focus()
  tab()
  // no handler is mounted, so nothing moved focus for us
  expect(outside).toHaveFocus()
})

test('focus trap: survives a panel with nothing focusable of its own', () => {
  render(<Sheet open onClose={() => {}} title="t"><p>just text</p></Sheet>)
  expect(() => tab()).not.toThrow()
  expect(document.body.contains(document.activeElement)).toBe(true)
})

test('focus trap: only the TOPMOST sheet traps, so nested sheets do not fight', () => {
  render(
    <>
      <Sheet open onClose={() => {}} title="outer">
        <button>outer-only</button>
      </Sheet>
      <Sheet open onClose={() => {}} title="inner"><Body /></Sheet>
    </>,
  )
  // focus sits in the OUTER sheet; the inner one is topmost and should claim it
  screen.getByRole('button', { name: 'outer-only' }).focus()
  tab()
  // the INNER (topmost) sheet claims it, so focus lands inside that panel
  const panels = document.querySelectorAll('[data-sheet-panel]')
  expect(panels[panels.length - 1].contains(document.activeElement)).toBe(true)
})
