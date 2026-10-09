// Wave 9 lane 6: every HELP row shows one realistic example, what the code takes, and the note a
// feed-backed code carries. Derived from the registry (FUNCTIONS, exampleFor, args.js), never typed.
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, within } from '@testing-library/react'
import HelpPanel, { takesLine } from './HelpPanel'
import { FUNCTIONS, FUNCTION_GROUPS, BY_CODE, exampleFor } from '../functions'

afterEach(cleanup)

describe('HELP rows', () => {
  it('every code is listed once, under its own group, with its example', () => {
    render(<HelpPanel auth={{}} />)
    expect(FUNCTIONS.every((f) => FUNCTION_GROUPS.includes(f.group))).toBe(true)
    for (const f of FUNCTIONS) {
      const ex = screen.getByTestId(`terminal-help-example-${f.code}`)
      expect(ex.querySelector('kbd').textContent).toBe(exampleFor(f))
      const section = ex.closest('section')
      expect(section.querySelector('h3').textContent).toBe(f.group)
    }
    expect(screen.getByTestId('terminal-help-example-CHK').textContent).toContain('NVDA CHK')
    expect(screen.getByTestId('terminal-help-example-BRKO').textContent).toContain('BRKO')
  })

  it('a code that takes arguments says what, from args.js; one that takes none says nothing', () => {
    render(<HelpPanel auth={{}} />)
    expect(takesLine(BY_CODE.GP)).toBe('a timeframe (D, W, M, 1, 5, 15, 30, 60)')
    expect(screen.getByTestId('terminal-help-example-GP').textContent).toContain('takes a timeframe')
    expect(takesLine(BY_CODE.BRKO)).toBeNull()
    expect(screen.getByTestId('terminal-help-example-BRKO').textContent).not.toContain('takes')
    expect(takesLine(BY_CODE.REL)).toContain('tickers to compare')
    for (const f of FUNCTIONS) {
      const has = [...(f.ticker?.args || []), ...(f.market?.args || [])].some((a) => a.kind !== 'mine')
      expect(takesLine(f) != null, f.code).toBe(has)
    }
  })

  it('a code whose feed can be switched off at the server says so on its row', () => {
    render(<HelpPanel auth={{}} />)
    const noted = FUNCTIONS.filter((f) => f.note)
    expect(noted.map((f) => f.code)).toEqual(expect.arrayContaining(['TWT', 'SENT', 'GRADE']))
    for (const f of noted) expect(screen.getByTestId(`terminal-help-example-${f.code}`).textContent).toContain(f.note)
  })

  it('HELP CHK shows that one row, with its example', () => {
    render(<HelpPanel auth={{}} focusCode="CHK" />)
    const help = screen.getByTestId('terminal-help')
    expect(within(help).getByTestId('terminal-help-example-CHK')).toBeTruthy()
    expect(help.querySelectorAll('[data-testid^="terminal-help-example-"]').length).toBe(1)
  })
})
