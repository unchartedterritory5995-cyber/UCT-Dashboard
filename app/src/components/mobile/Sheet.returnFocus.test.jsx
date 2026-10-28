// app/src/components/mobile/Sheet.returnFocus.test.jsx
//
// ⛔ WebKit (iOS Safari, VoiceOver's double-tap) does NOT focus a tapped <button>. A Sheet opened by a TAP therefore
// records `document.activeElement` at open as whatever held focus BEFORE -- in the Notebook, the "New note" sheet's
// own panel -- and its close put focus back there instead of on the button that opened it (WebKit + axe walk of the
// Template library, 2026-10-27). jsdom models the same thing: `fireEvent.click` never moves focus.
//
// `returnFocusTo` names the opener; it wins on close while it is still connected. The controls are the halves that
// must NOT change: no prop is the old restore exactly, and a named opener that has left the page falls back to it.
import { useRef, useState } from 'react'
import { act, render, screen, fireEvent } from '@testing-library/react'
import { test, expect } from 'vitest'
import Sheet from './Sheet'

const frames = (n = 2) => act(() => new Promise((resolve) => {
  const step = (k) => (k ? requestAnimationFrame(() => step(k - 1)) : resolve())
  step(n)
}))

function Host({ name = false, asRef = false, dropOpener = false }) {
  const [open, setOpen] = useState(false)
  const [showOpener, setShowOpener] = useState(true)
  const openerRef = useRef(null)
  const [openerEl, setOpenerEl] = useState(null)
  const named = !name ? undefined : (asRef ? openerRef : openerEl)
  return (
    <>
      <div tabIndex={-1} data-testid="outer">outer panel</div>
      {showOpener && (
        <button type="button" ref={(el) => { openerRef.current = el; if (el !== openerEl) setOpenerEl(el) }}
          onClick={() => setOpen(true)}>Preview</button>
      )}
      <Sheet open={open} onClose={() => { setOpen(false); if (dropOpener) setShowOpener(false) }} title="Detail"
        returnFocusTo={named}>
        <p>Body</p>
      </Sheet>
    </>
  )
}

/** A TAP in WebKit: focus stays where it was (the outer panel); the click lands on the button unfocused. */
async function tapOpen() {
  screen.getByTestId('outer').focus()
  fireEvent.click(screen.getByRole('button', { name: 'Preview' }))
  await frames(3)
  expect(document.activeElement).toBe(document.querySelector('[data-sheet-panel]'))
}

test('a named opener (element) gets focus back after a TAP-open closed by the x', async () => {
  render(<Host name />)
  await tapOpen()
  fireEvent.click(screen.getByRole('button', { name: 'Close' }))
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Preview' }))
})

test('a named opener given as a REF gets focus back after a TAP-open closed by Escape', async () => {
  render(<Host name asRef />)
  await tapOpen()
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Preview' }))
})

test('CONTROL: with no named opener a TAP-open restores to where focus was (the old behaviour, unchanged)', async () => {
  render(<Host />)
  await tapOpen()
  fireEvent.click(screen.getByRole('button', { name: 'Close' }))
  expect(document.activeElement).toBe(screen.getByTestId('outer'))
})

test('CONTROL: a named opener that has left the page falls back to the recorded restore, never to <body>', async () => {
  render(<Host name asRef dropOpener />)
  await tapOpen()
  fireEvent.click(screen.getByRole('button', { name: 'Close' }))
  expect(screen.queryByRole('button', { name: 'Preview' })).toBeNull()
  expect(document.activeElement).toBe(screen.getByTestId('outer'))
})
