// Ready-made boards in the Boards menu: every entry of the ONE list (starterBoards.js) is a real
// button with its one-sentence description, one click hands that entry to the shell, the member's
// own boards are still listed beside them, and the menu passes axe with the section showing.
// The pure half is starterBoards.test.js; the shell half is TerminalShell.starterBoards.test.jsx.
//
//     cd app && npx vitest run src/pages/terminal/BoardsMenu.starter.test.jsx --maxWorkers=2
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'
import { BoardsMenu } from './BoardsMenu'
import { DEFAULT_LAYOUT, emptyLibrary, saveBoard } from './boardModel'
import { STARTER_BOARDS } from './starterBoards'
import { expectNoAxeViolations } from '../journal-2-0/a11y/axeHarness'

function props(over = {}) {
  return {
    library: saveBoard(emptyLibrary(), 'Swing Board', DEFAULT_LAYOUT, {}, 1000).library,
    libraryWritable: true,
    currentName: null,
    onSave: vi.fn(),
    onOpen: vi.fn(),
    onDelete: vi.fn(),
    onPreset: vi.fn(),
    onKeepCalendar: vi.fn(),
    onShareCurrent: vi.fn(() => 'https://example.test/share'),
    onRestored: vi.fn(),
    onOpenStarter: vi.fn(),
    ...over,
  }
}

afterEach(() => cleanup())

describe('the Boards menu lists the ready-made boards', () => {
  it('CONTROL: the list this menu reads is not empty', () => {
    expect(STARTER_BOARDS.length).toBeGreaterThan(0)
  })

  it('every entry is a button named by the board, with its codes and its one sentence', () => {
    render(<BoardsMenu {...props()} />)
    const list = screen.getByTestId('terminal-starter-boards')
    expect(list.tagName).toBe('UL')
    expect(within(list).getAllByRole('listitem')).toHaveLength(STARTER_BOARDS.length)
    // The list is named by its visible heading, in sentence case as written.
    expect(screen.getByRole('list', { name: 'Ready-made boards' })).toBe(list)
    for (const s of STARTER_BOARDS) {
      const row = screen.getByTestId(`terminal-starter-${s.id}`)
      const btn = within(row).getByRole('button')
      expect(btn.tagName).toBe('BUTTON')
      expect(btn.getAttribute('type')).toBe('button')
      // Label in name: the accessible name starts with the name a sighted member reads.
      expect(btn.textContent.startsWith(s.name)).toBe(true)
      for (const c of s.commands) expect(btn.textContent).toContain(c)
      // The sentence is on screen, and it is what the button is described by.
      const about = within(row).getByText(s.about)
      expect(about.id).toBeTruthy()
      expect(btn.getAttribute('aria-describedby')).toBe(about.id)
      expect(btn).toHaveAccessibleDescription(s.about)
    }
  })

  it('the menu says what a click does to the member\'s own boards before they click', () => {
    render(<BoardsMenu {...props()} />)
    expect(screen.getByTestId('terminal-boards-menu').textContent)
      .toContain('Your saved boards are not changed, and Back to my layout returns the board you have now.')
  })

  it('one click hands THAT entry to the shell, and calls nothing else', () => {
    const p = props()
    render(<BoardsMenu {...p} />)
    const pick = STARTER_BOARDS[STARTER_BOARDS.length - 1]
    fireEvent.click(screen.getByTestId(`terminal-starter-open-${pick.id}`))
    expect(p.onOpenStarter).toHaveBeenCalledTimes(1)
    expect(p.onOpenStarter).toHaveBeenCalledWith(pick)
    for (const k of ['onSave', 'onOpen', 'onDelete', 'onPreset', 'onKeepCalendar']) expect(p[k]).not.toHaveBeenCalled()
  })

  it('every ready-made button is in the tab order (keyboard reachable), none disabled', () => {
    render(<BoardsMenu {...props()} />)
    for (const s of STARTER_BOARDS) {
      const btn = screen.getByTestId(`terminal-starter-open-${s.id}`)
      expect(btn.disabled).toBe(false)
      expect(btn.tabIndex).toBe(0)
      btn.focus()
      expect(document.activeElement).toBe(btn)
    }
  })

  it('still opens when the saved boards cannot be read (opening writes nothing to them)', () => {
    const p = props({ libraryWritable: false })
    render(<BoardsMenu {...p} />)
    const btn = screen.getByTestId(`terminal-starter-open-${STARTER_BOARDS[0].id}`)
    expect(btn.disabled).toBe(false)
    fireEvent.click(btn)
    expect(p.onOpenStarter).toHaveBeenCalledWith(STARTER_BOARDS[0])
  })

  it('the member\'s own boards are still listed, above, exactly as before', () => {
    render(<BoardsMenu {...props()} />)
    const mine = screen.getByTestId('terminal-board-swing-board')
    const ready = screen.getByTestId('terminal-starter-boards')
    expect(within(mine).getByRole('button', { name: /^Swing Board\s*B:swing-board$/ })).toBeTruthy()
    expect(mine.compareDocumentPosition(ready) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(within(ready).queryByText('Swing Board')).toBeNull()
  })

  it('only the board that is open now carries the mark (aria-current and "Open now")', () => {
    const open = STARTER_BOARDS[1]
    render(<BoardsMenu {...props({ currentStarterId: open.id })} />)
    for (const s of STARTER_BOARDS) {
      const btn = screen.getByTestId(`terminal-starter-open-${s.id}`)
      const mark = screen.queryByTestId(`terminal-starter-current-${s.id}`)
      if (s.id === open.id) {
        expect(btn.getAttribute('aria-current')).toBe('true')
        expect(mark).toHaveTextContent('Open now')
      } else {
        expect(btn.hasAttribute('aria-current')).toBe(false)
        expect(mark).toBeNull()
      }
    }
    cleanup()
    render(<BoardsMenu {...props()} />)
    expect(screen.queryByText('Open now')).toBeNull()
  })

  it('with no handler there is no section at all (never a button that does nothing)', () => {
    render(<BoardsMenu {...props({ onOpenStarter: undefined })} />)
    expect(screen.queryByTestId('terminal-starter-boards')).toBeNull()
    expect(screen.queryByText('Ready-made boards')).toBeNull()
  })

  it('the list is data: a different list renders different boards, with nothing typed in the menu', () => {
    const starters = [{ id: 'x-one', name: 'Only one', about: 'A single fixture board.', commands: ['HILO'] }]
    render(<BoardsMenu {...props({ starters })} />)
    expect(within(screen.getByTestId('terminal-starter-boards')).getAllByRole('listitem')).toHaveLength(1)
    expect(screen.getByTestId('terminal-starter-open-x-one')).toHaveTextContent('Only one')
    for (const s of STARTER_BOARDS) expect(screen.queryByTestId(`terminal-starter-${s.id}`)).toBeNull()
  })
})

describe('axe: the Boards menu with the ready-made boards showing', () => {
  it('passes with saved boards beside them', async () => {
    const { container } = render(<BoardsMenu {...props()} />)
    await expectNoAxeViolations(container)
  })

  it('passes with no saved boards, and with one ready-made board marked open', async () => {
    const { container } = render(<BoardsMenu {...props({ library: emptyLibrary(), currentStarterId: STARTER_BOARDS[0].id })} />)
    expect(screen.getByText('No saved boards yet.')).toBeTruthy()
    await expectNoAxeViolations(container)
  })

  it('CONTROL: axe is really looking at this menu (an unnamed button in it is reported)', async () => {
    const { container } = render(<BoardsMenu {...props()} />)
    const bad = document.createElement('button')
    screen.getByTestId('terminal-starter-boards').firstChild.appendChild(bad)
    await expect(expectNoAxeViolations(container)).rejects.toThrow(/button-name/)
  })
})
