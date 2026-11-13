// @vitest-environment jsdom
// app/src/pages/journal-2-0/a11y/newNoteMenu.a11y.test.jsx
//
// The Notebook's menu engine (components/notebook/NewNoteMenu.jsx: `useMenuButton` + `MenuRows`) through 8A's axe
// harness. It began as P0.1's "New note" split button on Research Home; go-live wave 1 deleted that button with
// Research home, so the recipe now reads the engine as the notes list renders it ("+ New" and its ▾ inside the
// list toolbar), closed and open, with every optional door present.
import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axeSurface } from './surface'
import { expectNoAxeViolations } from './axeHarness'
import { MenuRows, useMenuButton } from '../components/notebook/NewNoteMenu'

// S11 (audit 2026-11-05): the list toolbar's "+ New ▾", built the way NotebookTab builds it, so axe and the keyboard
// read the engine the list actually renders (a named group included: the New menu's "Reviews").
function ListNewMenu({ items }) {
  const menu = useMenuButton()
  return (
    <div style={{ position: 'relative' }}>
      <button {...menu.triggerProps} type="button" className="btn btn-primary btn-sm" aria-label="More ways to start a note">▾</button>
      {menu.open && <div {...menu.menuProps} aria-label="Start a note"><MenuRows menu={menu} items={items} /></div>}
    </div>
  )
}
const LIST_ITEMS = [
  { key: 'blank', label: 'Blank', run: () => {} },
  { key: 'template', label: 'From a template', run: () => {} },
  { key: 'voice', label: 'Voice note', run: () => {} },
  { key: 'import', label: 'Import', run: () => {} },
  {
    key: 'reviews', group: 'Reviews', heading: true,
    items: [{ key: 'daily', label: "Today's recap", run: () => {} }, { key: 'weekly', label: "This week's review", run: () => {} }],
  },
]

function mount() {
  return render(
    <main>
      <div role="toolbar" aria-label="Notes list tools">
        <button type="button" className="btn btn-primary btn-sm">+ New</button>
        <ListNewMenu items={LIST_ITEMS} />
      </div>
    </main>,
  )
}

describe('the list\'s New menu (the menu engine)', () => {
  axeSurface('new-note-menu', async () => {
    const { container } = mount()
    // Non-vacuity: the trigger is there, and the menu is closed.
    const caret = screen.getByRole('button', { name: 'More ways to start a note' })
    if (caret.getAttribute('aria-expanded') !== 'false') throw new Error('the menu started open')
    return { root: container }
  })

  // Fix round 1 (review M5): the menu OPEN, inside a role="toolbar" as NotebookTab renders it.
  it('the open menu: axe finds 0 violations', async () => {
    const { container } = mount()
    fireEvent.click(screen.getByRole('button', { name: 'More ways to start a note' }))
    const menu = screen.getByRole('menu', { name: 'Start a note' })
    const items = within(menu).getAllByRole('menuitem')
    expect(items.map((b) => b.textContent.trim()))
      .toEqual(['Blank', 'From a template', 'Voice note', 'Import', "Today's recap", "This week's review"])
    expect(within(menu).getByRole('group', { name: 'Reviews' })).toBeTruthy()
    await expectNoAxeViolations(container, { level: 'component' })
  }, 30000)

  // Review follow-up R1: the keyboard route. A keyboard member opens the menu from the caret with
  // ArrowDown (first item) or ArrowUp (last item), and a Tab out of it closes it rather than leaving a
  // menu hanging open over the page. Both are asserted in the state axe then reads.
  it('keyboard: ArrowDown / ArrowUp on the caret open the menu on its first / last item; axe finds 0 violations', async () => {
    const { container } = mount()
    const caret = screen.getByRole('button', { name: 'More ways to start a note' })
    caret.focus()
    fireEvent.keyDown(caret, { key: 'ArrowDown' })
    const menu = screen.getByRole('menu', { name: 'Start a note' })
    const items = within(menu).getAllByRole('menuitem')
    expect(document.activeElement).toBe(items[0])
    await expectNoAxeViolations(container, { level: 'component' })
    fireEvent.keyDown(menu, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(caret)
    fireEvent.keyDown(caret, { key: 'ArrowUp' })
    const again = within(screen.getByRole('menu', { name: 'Start a note' })).getAllByRole('menuitem')
    expect(document.activeElement).toBe(again[again.length - 1])
  }, 30000)

  it('keyboard: Tab out of the open menu closes it', async () => {
    const user = userEvent.setup()
    render(
      <main>
        <div role="toolbar" aria-label="Notes list tools">
          <ListNewMenu items={LIST_ITEMS} />
        </div>
        <button type="button">After the menu</button>
      </main>,
    )
    const caret = screen.getByRole('button', { name: 'More ways to start a note' })
    fireEvent.keyDown(caret, { key: 'ArrowUp' })
    expect(screen.getByRole('menu', { name: 'Start a note' })).toBeTruthy()
    await user.tab()   // last item -> the next control on the page
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'After the menu' }))
    expect(caret).toHaveAttribute('aria-expanded', 'false')
  })
})
