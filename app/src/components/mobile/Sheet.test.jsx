import { useState } from 'react'
import { act, createEvent, render, screen, fireEvent } from '@testing-library/react'
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

// Wave I real-browser finding: the panelStyle ternary only special-cased
// bottom-sheet, so 'fullscreen' fell into the maxWidth branch and got
// capped to the desktop-modal default (520px) — invisible on the one prior
// fullscreen caller (MobileSymbolSheet, touch-only, already narrower than
// 520px) but very visible the first time a fullscreen Sheet mounted on a
// wide desktop viewport (DocumentPreviewSheet's PDF preview rendered in a
// ~520px column instead of filling the screen).
test('a fullscreen Sheet carries no maxWidth cap (would otherwise inherit the modal default)', () => {
  render(<Sheet open onClose={() => {}} variant="fullscreen" ariaLabel="Full">body</Sheet>)
  const panel = document.querySelector('[data-sheet-panel]')
  expect(panel.style.maxWidth).toBe('')
})

test('a modal Sheet still gets its maxWidth (default 520px) — the fullscreen fix must not remove it elsewhere', () => {
  render(<Sheet open onClose={() => {}} variant="modal" ariaLabel="Modal">body</Sheet>)
  const panel = document.querySelector('[data-sheet-panel]')
  expect(panel.style.maxWidth).toBe('520px')
})

test('a modal Sheet honors an explicit maxWidth override', () => {
  render(<Sheet open onClose={() => {}} variant="modal" maxWidth={640} ariaLabel="Modal">body</Sheet>)
  const panel = document.querySelector('[data-sheet-panel]')
  expect(panel.style.maxWidth).toBe('640px')
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


// ─── a parent re-render must never move focus ───────────────────────────────
//
// ⛔⛔ Callers pass `onClose` inline, a new function on every render. The focus
// effect was keyed on `[open, onClose]`, so every parent render restored focus
// to whatever held it on open and then focused the panel a frame later. On the
// deployed build (386px, touch tier) every keystroke in Ask's question box
// moved focus to the Ask toggle behind the sheet and then to the panel, which
// on a phone closes the keyboard after each character. The panel is focused
// ONCE per open, focus is restored ONCE per close, and Escape calls the
// caller's LATEST onClose.

// Two animation frames, flushed for real: the panel focus is scheduled with
// requestAnimationFrame, so a check that does not wait for it cannot fail.
const frames = (n = 2) => act(() => new Promise((resolve) => {
  const step = (k) => (k ? requestAnimationFrame(() => step(k - 1)) : resolve())
  step(n)
}))

function TypingHost({ onClosed, variant }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Open search</button>
      {/* Inline, and closing over `q`: a new function on every keystroke. */}
      <Sheet open={open} onClose={() => { onClosed(q); setOpen(false) }} title="Search" variant={variant}>
        <input aria-label="query" value={q} onChange={(e) => setQ(e.target.value)} />
      </Sheet>
    </>
  )
}

test('re-renders with a fresh inline onClose never move focus out of an input inside the sheet', async () => {
  const onClosed = vi.fn()
  render(<TypingHost onClosed={onClosed} />)
  const opener = screen.getByRole('button', { name: 'Open search' })
  opener.focus()
  fireEvent.click(opener)
  await frames()

  const panel = document.querySelector('[data-sheet-panel]')
  expect(document.activeElement).toBe(panel) // focused on open, as before
  let panelFocuses = 0
  panel.addEventListener('focus', () => { panelFocuses += 1 })

  const input = screen.getByRole('textbox', { name: 'query' })
  input.focus()
  for (const value of ['a', 'ab', 'abc']) {
    fireEvent.change(input, { target: { value } })
    await frames()
    expect(document.activeElement).toBe(input)
  }
  expect(panelFocuses).toBe(0)

  // Escape calls the LATEST onClose: the one that closes over "abc".
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(onClosed).toHaveBeenCalledTimes(1)
  expect(onClosed).toHaveBeenCalledWith('abc')
  await frames()
  expect(document.querySelector('[data-sheet-panel]')).toBeNull()
  expect(document.activeElement).toBe(opener) // restored once, on close
})

test('the backdrop calls the LATEST onClose too', async () => {
  const onClosed = vi.fn()
  render(<TypingHost onClosed={onClosed} />)
  fireEvent.click(screen.getByRole('button', { name: 'Open search' }))
  await frames()
  const input = screen.getByRole('textbox', { name: 'query' })
  fireEvent.change(input, { target: { value: 'xy' } })
  fireEvent.mouseDown(document.querySelector('[class*="backdrop"]'))
  expect(onClosed).toHaveBeenCalledWith('xy')
})

test('drag-to-dismiss calls the LATEST onClose too', async () => {
  const onClosed = vi.fn()
  render(<TypingHost onClosed={onClosed} variant="bottom-sheet" />)
  fireEvent.click(screen.getByRole('button', { name: 'Open search' }))
  await frames()
  fireEvent.change(screen.getByRole('textbox', { name: 'query' }), { target: { value: 'dr' } })
  const grip = document.querySelector('[class*="grip"]')
  fireEvent.pointerDown(grip, { clientY: 100, pointerId: 1 })
  fireEvent.pointerMove(grip, { clientY: 300, pointerId: 1 })
  fireEvent.pointerUp(grip, { clientY: 300, pointerId: 1 })
  expect(onClosed).toHaveBeenCalledWith('dr')
})

// ⛔ A drag-dismiss calls onClose ONCE, from the pointerup handler, never from
// inside a state updater. It used to decide inside `setDragY((d) => ...)`. When
// a pointermove's update is still pending as pointerup lands (the moves and
// the release in one task, outside act -- the G-064 close-out re-review's
// reproduction), React cannot run that updater eagerly: it runs during
// Sheet's RENDER, twice (update rebasing), so the caller's onClose ran twice,
// inside a render, with React's "Cannot update a component while rendering a
// different component" warning. No StrictMode is involved.
test('a fast drag-dismiss calls onClose exactly once, outside any render, with no React warning', async () => {
  const calls = []
  const errors = []
  const spy = vi.spyOn(console, 'error').mockImplementation((...args) => { errors.push(String(args[0])) })
  function Host() {
    const [open, setOpen] = useState(true)
    return (
      <Sheet
        open={open}
        variant="bottom-sheet"
        title="T"
        onClose={() => {
          calls.push(new Error().stack.includes('renderWithHooks') ? 'in-render' : 'in-handler')
          setOpen(false)
        }}
      >
        body
      </Sheet>
    )
  }
  render(<Host />)
  const grip = document.querySelector('[class*="grip"]')
  const prev = globalThis.IS_REACT_ACT_ENVIRONMENT
  globalThis.IS_REACT_ACT_ENVIRONMENT = false
  try {
    grip.dispatchEvent(createEvent.pointerDown(grip, { clientY: 100, pointerId: 1 }))
    grip.dispatchEvent(createEvent.pointerMove(grip, { clientY: 300, pointerId: 1 }))
    grip.dispatchEvent(createEvent.pointerUp(grip, { clientY: 300, pointerId: 1 }))
    await new Promise((resolve) => setTimeout(resolve, 50))
  } finally {
    globalThis.IS_REACT_ACT_ENVIRONMENT = prev
    spy.mockRestore()
  }
  expect(calls).toEqual(['in-handler'])
  expect(errors.filter((e) => /Cannot update a component/.test(e))).toEqual([])
  expect(document.querySelector('[data-sheet-panel]')).toBeNull() // it did close
})

test('a short drag springs back and does not close', () => {
  const onClose = vi.fn()
  render(<Sheet open variant="bottom-sheet" onClose={onClose} title="T">body</Sheet>)
  const grip = document.querySelector('[class*="grip"]')
  fireEvent.pointerDown(grip, { clientY: 100, pointerId: 1 })
  fireEvent.pointerMove(grip, { clientY: 180, pointerId: 1 })
  fireEvent.pointerUp(grip, { clientY: 180, pointerId: 1 })
  expect(onClose).not.toHaveBeenCalled()
  expect(document.querySelector('[data-sheet-panel]').style.transform).toBe('')
})
