// @vitest-environment jsdom
// app/src/pages/journal-2-0/a11y/newNoteMenu.a11y.test.jsx
//
// P0.1's "New note" split button on Research Home (components/notebook/NewNoteMenu.jsx)
// through 8A's axe harness. It arrived with no entry in a11y/notebookSurfaces.js, so
// `surfaceCoverage.test.js` failed by name. It gets a recipe of its own: Research Home's rail
// renders it only closed, and the interesting surface is the OPEN menu (role="menu" with its
// menuitem rows), so both states are read here, with every optional door present.
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { axeSurface } from './surface'
import { expectNoAxeViolations } from './axeHarness'
import NewNoteMenu from '../components/notebook/NewNoteMenu'

function mount() {
  return render(
    <main>
      <NewNoteMenu onBlank={vi.fn()} onFromOutline={vi.fn()} onVoice={vi.fn()} onToday={vi.fn()} />
    </main>,
  )
}

describe('Research Home\'s New note split button', () => {
  axeSurface('new-note-menu', async () => {
    const { container } = mount()
    // Non-vacuity: both buttons are there, and the menu is closed.
    if (!screen.getByRole('button', { name: /New note/ })) throw new Error('no New note button')
    const caret = screen.getByRole('button', { name: 'More ways to start a note' })
    if (caret.getAttribute('aria-expanded') !== 'false') throw new Error('the menu started open')
    return { root: container }
  })

  it('the open menu: axe finds 0 violations', async () => {
    const { container } = mount()
    fireEvent.click(screen.getByRole('button', { name: 'More ways to start a note' }))
    const items = within(screen.getByRole('menu', { name: 'Start a note' })).getAllByRole('menuitem')
    expect(items.map((b) => b.textContent.trim())).toEqual(['From an outline', 'Voice note', "Today's note"])
    await expectNoAxeViolations(container, { level: 'component' })
  }, 30000)
})
