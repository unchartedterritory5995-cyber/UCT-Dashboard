// app/src/components/mobile/Sheet.autoFocus.test.jsx
//
// ⛔ A Sheet's own panel focus must never take focus BACK from a child that
// already has it. The panel is focused one animation frame after open, and
// React's `autoFocus` focuses the field during commit — BEFORE that frame. An
// unconditional `panel.focus()` therefore defeated every autoFocus inside a
// Sheet: measured on a sandbox of the production code (wave 8, controller
// finding 2026-09-26), the Notebook's "Save view" dialog left the panel <div>
// focused at 0/50/150/600 ms and typed characters went nowhere.
//
// The control is the half that must NOT change: a panel with nothing focused
// inside still takes focus (screen readers land in the dialog; Escape works).
import { useState } from 'react'
import { act, render, screen, fireEvent } from '@testing-library/react'
import { test, expect } from 'vitest'
import Sheet from './Sheet'
import SavedViewEditor from '../../pages/journal-2-0/components/notebook/SavedViewEditor'

// Two animation frames, flushed for real (the panel focus is a rAF).
const frames = (n = 2) => act(() => new Promise((resolve) => {
  const step = (k) => (k ? requestAnimationFrame(() => step(k - 1)) : resolve())
  step(n)
}))

function Host({ autoFocus }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Open</button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Name it">
        <input aria-label="View name" autoFocus={autoFocus} />
        <button type="button">Save</button>
      </Sheet>
    </>
  )
}

test('a child with autoFocus KEEPS focus after the panel\'s open frame', async () => {
  render(<Host autoFocus />)
  fireEvent.click(screen.getByRole('button', { name: 'Open' }))
  const input = screen.getByRole('textbox', { name: 'View name' })
  expect(document.activeElement).toBe(input) // React focused it during commit
  await frames(3)
  expect(document.activeElement).toBe(input) // ...and the panel frame left it there
})

test('CONTROL: with nothing focused inside, the panel still takes focus on open', async () => {
  render(<Host autoFocus={false} />)
  fireEvent.click(screen.getByRole('button', { name: 'Open' }))
  await frames(3)
  expect(document.activeElement).toBe(document.querySelector('[data-sheet-panel]'))
})

test('the Notebook "Save view" dialog opens with its name field focused, ready to type', async () => {
  render(<SavedViewEditor open onClose={() => {}} onSave={() => {}} />)
  await frames(3)
  expect(document.activeElement).toBe(document.getElementById('save-view-name'))
})

// Wave 8, lane 8A (A4): the restore half. React focuses an autoFocus child
// during commit, BEFORE the Sheet's effect reads "where focus was" -- so the
// effect recorded the child's own field, and on close focused a field that no
// longer existed: focus fell to <body>. The opener is now captured at render.
function OpenerHost({ autoFocus }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Open</button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Name it">
        <input aria-label="View name" autoFocus={autoFocus} />
      </Sheet>
    </>
  )
}

test.each([[true], [false]])('closing gives focus back to the button that opened it (child autoFocus: %s)', async (autoFocus) => {
  render(<OpenerHost autoFocus={autoFocus} />)
  const opener = screen.getByRole('button', { name: 'Open' })
  opener.focus()
  fireEvent.click(opener)
  await frames(3)
  expect(document.activeElement).not.toBe(opener) // focus really went into the sheet
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(screen.queryByRole('textbox', { name: 'View name' })).toBeNull()
  expect(document.activeElement).toBe(opener)
})
