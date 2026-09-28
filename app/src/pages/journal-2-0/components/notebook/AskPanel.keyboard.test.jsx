// F4 / A2R-06 (WCAG 2.4.3, 2.1.1). Lane 10E-2's keyboard walk on the desktop Ask panel:
// Tab walked out of it into the editor's toolbar, and Escape then left it OPEN with focus on
// a "Remove tag" button. The panel now contains Tab like the other sheets, and Escape closes
// it and gives focus back to the Ask toggle. Walked with the keyboard (user-event) on a page
// with focusable things before and after the panel, so a leak has somewhere to go.
//
// ⛔ And the thing the trap must NOT do: the desktop panel is anchored beside the note, not
// modal. A member who clicks back into the page keeps its Tab -- the trap acts only while
// focus is inside the panel.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AskPanel from './AskPanel'

beforeEach(() => {
  vi.restoreAllMocks()
  global.fetch = vi.fn(() => new Promise(() => {}))
})

function Page({ onClose }) {
  return (
    <div>
      <button type="button">Before the panel</button>
      <AskPanel scope="notebook" onClose={onClose} />
      <button type="button">After the panel</button>
    </div>
  )
}

async function openWithKeyboard(user) {
  const toggle = screen.getByRole('button', { name: /^Ask a question about/ })
  toggle.focus()
  await user.keyboard('{Enter}')
  const panel = await screen.findByRole('dialog', { name: /^Ask / })
  // the panel puts focus in its question field (two frames later)
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('textbox')))
  return { toggle, panel }
}

describe('the desktop Ask panel from the keyboard (F4, A2R-06)', () => {
  it('Tab and Shift+Tab stay inside the panel', async () => {
    const user = userEvent.setup()
    render(<Page />)
    const { panel } = await openWithKeyboard(user)
    for (let i = 0; i < 6; i += 1) {
      await user.tab()
      expect(panel.contains(document.activeElement)).toBe(true)
    }
    for (let i = 0; i < 6; i += 1) {
      await user.tab({ shift: true })
      expect(panel.contains(document.activeElement)).toBe(true)
    }
  })

  it('Escape closes it and focus goes back to the Ask toggle (no host onClose)', async () => {
    const user = userEvent.setup()
    render(<Page />)
    const { toggle } = await openWithKeyboard(user)
    await user.tab()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /^Ask / })).toBeNull())
    expect(document.activeElement).toBe(toggle)
  })

  it('with a host onClose, Escape calls it (the note editor puts focus back itself)', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<Page onClose={onClose} />)
    await openWithKeyboard(user)
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /^Ask / })).toBeNull())
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('⛔ CONTROL — focus the member put back in the page keeps the page\'s own Tab', async () => {
    const user = userEvent.setup()
    render(<Page />)
    await openWithKeyboard(user)
    const before = screen.getByRole('button', { name: 'Before the panel' })
    before.focus()
    await user.tab()
    // Tab from the page walks the page (to the toggle), not into the panel
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /^Ask a question about/ }))
  })
})
