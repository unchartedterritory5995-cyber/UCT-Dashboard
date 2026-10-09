// HELP's "Start here" (owner decision 2026-10-08, product item #1). A new member opens HELP to
// find out where to begin: the first heading is "Start here", its rows are daily functions (not
// rules), each runs a real example on click, and it comes before the full list and the expert
// rules. The numbered full list is unchanged, so "3 + Enter" still opens the row labelled 3.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import HelpPanel from './HelpPanel'
import { START_HERE } from '../grammar'
import { BY_CODE, FUNCTIONS, FUNCTION_GROUPS } from '../functions'
import parseCommand from '../parseCommand'

afterEach(cleanup)

describe('the Start here list, as data', () => {
  it('is short, and every row is a registered code whose example opens that code', () => {
    expect(START_HERE.length).toBeGreaterThanOrEqual(4)
    expect(START_HERE.length).toBeLessThanOrEqual(8)
    for (const s of START_HERE) {
      expect(BY_CODE[s.code], s.code).toBeTruthy()
      expect(parseCommand(s.example), s.example).toMatchObject({ ok: true, type: 'function', code: s.code })
      expect(s.what.length, s.code).toBeGreaterThan(10)
    }
  })
})

describe('HELP opens with Start here', () => {
  it('the first heading is "Start here", and its first row is a function, not a rule', () => {
    render(<HelpPanel auth={{}} />)
    const help = screen.getByTestId('terminal-help')
    expect(help.querySelector('h3').textContent).toBe('Start here')
    const firstButton = help.querySelector('button')
    expect(firstButton.getAttribute('data-testid')).toBe(`terminal-help-start-${START_HERE[0].code}`)
  })

  it('comes before the full numbered list and before the expert rules', () => {
    render(<HelpPanel auth={{}} />)
    const start = screen.getByTestId('terminal-help-start')
    const firstNumbered = screen.getByTestId('terminal-help').querySelector('[data-panel-row]')
    const rules = screen.getByTestId('terminal-help-rules')
    expect(start.compareDocumentPosition(firstNumbered) & 4).toBeTruthy()
    expect(start.compareDocumentPosition(rules) & 4).toBeTruthy()
  })

  it('a row runs its example as typed', () => {
    const onRun = vi.fn()
    render(<HelpPanel auth={{}} onRun={onRun} />)
    fireEvent.click(screen.getByTestId('terminal-help-start-GP'))
    expect(onRun).toHaveBeenCalledWith('NVDA GP')
    expect(within(screen.getByTestId('terminal-help-start-GP')).getByText('NVDA GP').tagName).toBe('KBD')
  })

  it('leaves the numbered list alone: rows still number from 1 in rendered order', () => {
    const onRows = vi.fn()
    render(<HelpPanel auth={{}} onRows={onRows} />)
    const expected = FUNCTION_GROUPS.flatMap((g) => FUNCTIONS.filter((f) => f.group === g)).map((f) => f.code)
    expect(onRows).toHaveBeenLastCalledWith(expected)
    // Start here rows carry no row number and are not numbered rows.
    expect(screen.getByTestId('terminal-help-start').querySelector('[data-panel-row]')).toBeNull()
    const first = screen.getByTestId('terminal-help').querySelector('[data-panel-row]')
    expect(first.textContent.startsWith(`1${expected[0]}`)).toBe(true)
  })

  it('HELP GP (one code) shows that code, not the Start here list', () => {
    render(<HelpPanel auth={{}} focusCode="GP" />)
    expect(screen.queryByTestId('terminal-help-start')).toBeNull()
  })
})
