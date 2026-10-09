// Wave 5 (HELP, lane 10 P3 + product item #1): the rules, suggestion order, keys and addresses
// are reference material. They sit under a closed "Advanced" disclosure below "Start here" and
// the function list, so a new member opening HELP sees where to begin, not the grammar.
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import HelpPanel from './HelpPanel'

afterEach(cleanup)

describe('HELP Advanced disclosure', () => {
  it('folds rules, keys and addresses under a closed "Advanced" disclosure', () => {
    render(<HelpPanel auth={{}} />)
    const adv = screen.getByTestId('terminal-help-advanced')
    expect(adv.tagName).toBe('DETAILS')
    expect(adv.open).toBe(false)
    const toggle = screen.getByTestId('terminal-help-advanced-toggle')
    expect(toggle.tagName).toBe('SUMMARY')                // a native, keyboard-operable control
    expect(toggle.textContent).toMatch(/^Advanced/)
    for (const id of ['terminal-help-rules', 'terminal-help-keys', 'terminal-help-addresses', 'terminal-help-ranking']) {
      expect(adv.contains(screen.getByTestId(id))).toBe(true)
    }
  })

  it('keeps "Start here" and the function list outside it, and before it', () => {
    render(<HelpPanel auth={{}} />)
    const adv = screen.getByTestId('terminal-help-advanced')
    const start = screen.getByTestId('terminal-help-start')
    const firstFn = screen.getByTestId('terminal-help').querySelector('button[data-panel-row]')
    expect(adv.contains(start)).toBe(false)
    expect(adv.contains(firstFn)).toBe(false)
    expect(start.compareDocumentPosition(adv) & 4).toBeTruthy()
    expect(firstFn.compareDocumentPosition(adv) & 4).toBeTruthy()
  })

  it('opens when its summary is activated', () => {
    render(<HelpPanel auth={{}} />)
    fireEvent.click(screen.getByTestId('terminal-help-advanced-toggle'))
    expect(screen.getByTestId('terminal-help-advanced').open).toBe(true)
  })

  it('HELP <code> shows no Advanced section', () => {
    render(<HelpPanel auth={{}} focusCode="GP" />)
    expect(screen.queryByTestId('terminal-help-advanced')).toBeNull()
  })
})
