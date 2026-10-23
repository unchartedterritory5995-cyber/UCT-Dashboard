// N3 (re-review round 2): the chart's Keyboard Shortcuts overlay is a backdrop modal (aria-modal since R1)
// but it never took focus, so Tab walked the page behind it. It now moves focus to its Close button on
// open, keeps Tab inside, and returns focus to whatever opened it on close.
import { describe, it, expect } from 'vitest'
import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import KeyboardHelpOverlay from './KeyboardHelpOverlay'

function Harness() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Show shortcuts</button>
      <button type="button">Behind the overlay</button>
      <KeyboardHelpOverlay open={open} onClose={() => setOpen(false)} />
    </>
  )
}

describe('KeyboardHelpOverlay holds focus while open', () => {
  it('focus moves to Close, Tab stays inside, Escape closes and returns focus to the opener', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const opener = screen.getByRole('button', { name: 'Show shortcuts' })
    await user.click(opener)
    const dialog = screen.getByRole('dialog', { name: 'Keyboard shortcuts' })
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close' }))
    await user.tab()
    expect(dialog.contains(document.activeElement)).toBe(true)
    await user.tab({ shift: true })
    expect(dialog.contains(document.activeElement)).toBe(true)
    expect(document.activeElement).not.toBe(screen.getByRole('button', { name: 'Behind the overlay' }))
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Keyboard shortcuts' })).toBeNull()
    expect(document.activeElement).toBe(opener)
  })

  it('the Close button also returns focus to the opener', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const opener = screen.getByRole('button', { name: 'Show shortcuts' })
    await user.click(opener)
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(opener)
  })
})
