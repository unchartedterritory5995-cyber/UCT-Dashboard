// Audit 2026-10-08 (HELP P2, points 16/17/19): the function list a new member opens HELP for came
// after the rules, ranking, keys and addresses; and `HELP GP` showed the label but not the arguments.
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import HelpPanel, { argsLines } from './HelpPanel'
import { BY_CODE } from '../functions'

afterEach(cleanup)

describe('HELP', () => {
  it('lists the functions before the reference material', () => {
    render(<HelpPanel auth={{}} />)
    const help = screen.getByTestId('terminal-help')
    const firstFn = help.querySelector('ul button')
    const rules = screen.getByTestId('terminal-help-rules')
    // DOCUMENT_POSITION_FOLLOWING (4): the rules come after the first function row
    expect(firstFn.compareDocumentPosition(rules) & 4).toBeTruthy()
  })

  it('HELP GP says what GP takes, from args.js', () => {
    render(<HelpPanel auth={{}} focusCode="GP" />)
    expect(screen.getByTestId('terminal-help-args').textContent)
      .toBe('With a ticker (NVDA GP): takes a timeframe (D, W, M, 1, 5, 15, 30, 60).')
  })

  it('a code with no arguments says so, per variant', () => {
    expect(argsLines(BY_CODE.FLOW)).toEqual([
      'With a ticker (NVDA FLOW): takes no arguments.', 'Market-wide (FLOW): takes no arguments.'])
  })
})
