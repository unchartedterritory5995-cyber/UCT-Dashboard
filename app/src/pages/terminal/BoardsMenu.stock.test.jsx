// Stock boards in the Boards menu: every entry of the ONE list (stockBoards.js) is a row under the
// market boards, named with the ticker it will open for ("Stock at a glance · NVDA"); one click
// hands that entry AND that ticker to the shell. With no ticker the rows are disabled and say why
// in words. The pure half is stockBoards.test.js; the shell half is
// TerminalShell.stockBoards.test.jsx.
//
//     cd app && npx vitest run src/pages/terminal/BoardsMenu.stock.test.jsx --maxWorkers=2
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'
import { BoardsMenu } from './BoardsMenu'
import { DEFAULT_LAYOUT, emptyLibrary, saveBoard } from './boardModel'
import { STARTER_BOARDS } from './starterBoards'
import { STOCK_BOARDS } from './stockBoards'
import HelpPanel from './panels/HelpPanel'
import { readyBoardNames } from './FirstRunCard'
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
    onOpenStock: vi.fn(),
    stockSym: 'NVDA',
    ...over,
  }
}

afterEach(() => cleanup())

describe('the Boards menu lists the stock boards, for the ticker the board is on', () => {
  it('CONTROL: the list this menu reads is not empty', () => {
    expect(STOCK_BOARDS.length).toBeGreaterThan(0)
  })

  it('every entry is a button named by the board AND the ticker, with its codes and its one sentence', () => {
    render(<BoardsMenu {...props()} />)
    const list = screen.getByTestId('terminal-stock-boards')
    expect(list.tagName).toBe('UL')
    expect(within(list).getAllByRole('listitem')).toHaveLength(STOCK_BOARDS.length)
    expect(screen.getByRole('list', { name: 'Stock boards' })).toBe(list)
    for (const b of STOCK_BOARDS) {
      const row = screen.getByTestId(`terminal-stock-${b.id}`)
      const btn = within(row).getByRole('button')
      expect(btn.getAttribute('type')).toBe('button')
      expect(btn.disabled).toBe(false)
      expect(btn.tabIndex).toBe(0)
      // Label in name: it starts with what a sighted member reads, the ticker included.
      expect(btn.textContent.startsWith(`${b.name} · NVDA`)).toBe(true)
      expect(btn).toHaveAccessibleName(`${b.name} · NVDA ${b.codes.join(' · ')}`)
      for (const c of b.codes) expect(btn.textContent).toContain(c)
      expect(btn).toHaveAccessibleDescription(b.about)
      expect(within(row).queryByTestId(`terminal-stock-why-${b.id}`)).toBeNull()      // nothing to explain
    }
    const note = screen.getByTestId('terminal-stock-boards-note').textContent
    expect(note).toContain('Each opens for NVDA, the ticker your board is on')
    expect(note).toContain('a new ticker in any of them moves the whole board')
    expect(note).toContain('Or type NVDA STOCK.')
  })

  it('they sit in the ready-made section, UNDER the market boards, in a list of their own', () => {
    render(<BoardsMenu {...props()} />)
    const market = screen.getByTestId('terminal-starter-boards')
    const stock = screen.getByTestId('terminal-stock-boards')
    expect(market.compareDocumentPosition(stock) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(within(market).getAllByRole('listitem')).toHaveLength(STARTER_BOARDS.length)      // the market list is unchanged
    expect(screen.getAllByText('Ready-made boards')).toHaveLength(1)                          // one section, one heading
    const head = screen.getByText('Ready-made boards')
    expect(head.compareDocumentPosition(stock) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    for (const b of STOCK_BOARDS) expect(within(market).queryByText(b.about)).toBeNull()
  })

  it('one click hands THAT entry and THAT ticker to the shell, and calls nothing else', () => {
    const p = props({ stockSym: 'AMD' })
    render(<BoardsMenu {...p} />)
    const pick = STOCK_BOARDS[STOCK_BOARDS.length - 1]
    fireEvent.click(screen.getByTestId(`terminal-stock-open-${pick.id}`))
    expect(p.onOpenStock).toHaveBeenCalledTimes(1)
    expect(p.onOpenStock).toHaveBeenCalledWith(pick, 'AMD')
    for (const k of ['onSave', 'onOpen', 'onDelete', 'onPreset', 'onKeepCalendar', 'onOpenStarter']) expect(p[k]).not.toHaveBeenCalled()
  })

  it('with NO ticker: every row is disabled, says to pick a ticker first in words, and a click does nothing', () => {
    const p = props({ stockSym: null })
    render(<BoardsMenu {...p} />)
    expect(within(screen.getByTestId('terminal-stock-boards')).getAllByRole('listitem')).toHaveLength(STOCK_BOARDS.length)
    for (const b of STOCK_BOARDS) {
      const row = screen.getByTestId(`terminal-stock-${b.id}`)
      const btn = screen.getByTestId(`terminal-stock-open-${b.id}`)
      expect(btn.disabled).toBe(true)
      expect(btn.textContent.startsWith(b.name)).toBe(true)
      expect(btn.textContent).not.toContain(' · NVDA')
      // The reason is TEXT in the row (not a tooltip, not the cursor), and the button is described by it.
      const why = within(row).getByTestId(`terminal-stock-why-${b.id}`)
      expect(why.textContent.trim()).toBe('Pick a ticker first.')
      expect(btn.contains(why), 'the reason is outside the greyed button, at full strength').toBe(false)
      expect(btn.getAttribute('aria-describedby').split(' ')).toContain(why.id)
      expect(btn).toHaveAccessibleDescription(`${b.about} Pick a ticker first.`)
      fireEvent.click(btn)
    }
    expect(p.onOpenStock).not.toHaveBeenCalled()
    const note = screen.getByTestId('terminal-stock-boards-note').textContent
    expect(note).toContain('your board is not on one yet')
    expect(note).toContain('Type a ticker on the command line first (NVDA)')
    expect(note).toContain('NVDA STOCK')
    // The market boards beside them still open: they need no ticker.
    for (const s of STARTER_BOARDS) expect(screen.getByTestId(`terminal-starter-open-${s.id}`).disabled).toBe(false)
  })

  it('still opens when the saved boards cannot be read (opening writes nothing to them)', () => {
    const p = props({ libraryWritable: false })
    render(<BoardsMenu {...p} />)
    const btn = screen.getByTestId(`terminal-stock-open-${STOCK_BOARDS[0].id}`)
    expect(btn.disabled).toBe(false)
    fireEvent.click(btn)
    expect(p.onOpenStock).toHaveBeenCalledWith(STOCK_BOARDS[0], 'NVDA')
  })

  it('only the board that is open now carries the mark, across both lists', () => {
    const open = STOCK_BOARDS[1]
    render(<BoardsMenu {...props({ currentStarterId: open.id })} />)
    for (const b of STOCK_BOARDS) {
      const btn = screen.getByTestId(`terminal-stock-open-${b.id}`)
      const mark = screen.queryByTestId(`terminal-stock-current-${b.id}`)
      if (b.id === open.id) {
        expect(btn.getAttribute('aria-current')).toBe('true')
        expect(mark).toHaveTextContent('Open now')
      } else {
        expect(btn.hasAttribute('aria-current')).toBe(false)
        expect(mark).toBeNull()
      }
    }
    expect(screen.getAllByText('Open now')).toHaveLength(1)
  })

  it('with no stock handler there is no stock list at all, and the market boards are as they were', () => {
    render(<BoardsMenu {...props({ onOpenStock: undefined })} />)
    expect(screen.queryByTestId('terminal-stock-boards')).toBeNull()
    expect(screen.queryByText('Stock boards')).toBeNull()
    expect(within(screen.getByTestId('terminal-starter-boards')).getAllByRole('listitem')).toHaveLength(STARTER_BOARDS.length)
    cleanup()
    // …and with only the stock handler, the section and its heading still show.
    render(<BoardsMenu {...props({ onOpenStarter: undefined })} />)
    expect(screen.queryByTestId('terminal-starter-boards')).toBeNull()
    expect(screen.getByText('Ready-made boards')).toBeTruthy()
    expect(within(screen.getByTestId('terminal-stock-boards')).getAllByRole('listitem')).toHaveLength(STOCK_BOARDS.length)
    cleanup()
    render(<BoardsMenu {...props({ onOpenStarter: undefined, onOpenStock: undefined })} />)
    expect(screen.queryByText('Ready-made boards')).toBeNull()
  })

  it('the list is data: a different list renders different boards, with nothing typed in the menu', () => {
    const stockBoards = [{ id: 'x-one', word: 'ONE', name: 'Only one', about: 'A single fixture board.', codes: ['GP'] }]
    render(<BoardsMenu {...props({ stockBoards })} />)
    expect(within(screen.getByTestId('terminal-stock-boards')).getAllByRole('listitem')).toHaveLength(1)
    expect(screen.getByTestId('terminal-stock-open-x-one')).toHaveTextContent('Only one · NVDA')
    for (const b of STOCK_BOARDS) expect(screen.queryByTestId(`terminal-stock-${b.id}`)).toBeNull()
  })
})

describe('HELP and the welcome card: what they say about ready-made boards stays true', () => {
  it('HELP has one more sentence under Start here: every stock board by name, and the command to type', () => {
    render(<HelpPanel auth={{}} />)
    const start = screen.getByTestId('terminal-help-start')
    const line = within(start).getByTestId('terminal-help-stock-boards')
    for (const b of STOCK_BOARDS) expect(line.textContent).toContain(b.name)
    expect(line.textContent.replace(/\s+/g, ' ')).toContain('or type NVDA STOCK.')
    // The market sentence above it is unchanged: market boards only, then the stock sentence.
    const market = within(start).getByTestId('terminal-help-ready-boards')
    for (const s of STARTER_BOARDS) expect(market.textContent).toContain(s.name)
    for (const b of STOCK_BOARDS) expect(market.textContent).not.toContain(b.name)
    expect(market.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // …and the rule is in the Advanced list, from the same data.
    const rules = screen.getByTestId('terminal-help-rules').textContent
    for (const b of STOCK_BOARDS) expect(rules).toContain(`is ${b.name} (${b.codes.join(', ')})`)
  })

  it('HELP for one code does not show it', () => {
    render(<HelpPanel auth={{}} focusCode="GP" />)
    expect(screen.queryByTestId('terminal-help-stock-boards')).toBeNull()
  })

  it('the welcome card still names the market boards only (it needs no ticker to be true)', () => {
    for (const s of STARTER_BOARDS) expect(readyBoardNames()).toContain(s.name)
    for (const b of STOCK_BOARDS) expect(readyBoardNames()).not.toContain(b.name)
  })
})

describe('axe: the Boards menu with the stock boards showing', () => {
  it('passes with a ticker (rows enabled, one marked open)', async () => {
    const { container } = render(<BoardsMenu {...props({ currentStarterId: STOCK_BOARDS[0].id })} />)
    await expectNoAxeViolations(container)
  })

  it('passes with no ticker (rows disabled, each with its reason)', async () => {
    const { container } = render(<BoardsMenu {...props({ stockSym: null, library: emptyLibrary() })} />)
    expect(screen.getAllByText('Pick a ticker first.')).toHaveLength(STOCK_BOARDS.length)
    await expectNoAxeViolations(container)
  })

  it('CONTROL: axe is really looking at this list (an unnamed button in it is reported)', async () => {
    const { container } = render(<BoardsMenu {...props()} />)
    screen.getByTestId('terminal-stock-boards').firstChild.appendChild(document.createElement('button'))
    await expect(expectNoAxeViolations(container)).rejects.toThrow(/button-name/)
  })
})
