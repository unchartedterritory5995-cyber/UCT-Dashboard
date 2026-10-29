// ⭐ The formula box shows the one-line fix (`formulaHints.js`) BESIDE the engine's
// verbatim refusal — asserted as RENDERED TEXT, never as state, because a hint that
// is computed and never drawn is the failure this repo has shipped twice.
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import FormulaField, { evaluateFormula } from './FormulaField'

afterEach(cleanup)

const show = (source) => render(
  <FormulaField value={source} onChange={() => {}} result={evaluateFormula(source, {})} />,
)

describe('the formula box names the fix', () => {
  it('avg(close, 20) — the refusal stays verbatim and the fix is drawn under it', () => {
    show('avg(close, 20)')
    expect(screen.getByTestId('formula-error')).toHaveTextContent(/unknown function "avg"/)
    expect(screen.getByTestId('formula-hint')).toHaveTextContent('UCT writes this as sma(close, 20).')
    expect(screen.getByLabelText('Formula').getAttribute('aria-describedby')).toMatch(/-error .*-hint$/)
  })

  it('hl2 — the table\'s own ruling', () => {
    show('hl2 > close')
    expect(screen.getByTestId('formula-hint')).toHaveTextContent('hl2 is written (high + low) / 2 here.')
  })

  it('no hint is drawn for a formula that is fine, or for a refusal with nothing honest to add', () => {
    show('supertrend(3, 10)')
    expect(screen.queryByTestId('formula-error')).toBeNull()
    expect(screen.queryByTestId('formula-hint')).toBeNull()
    cleanup()
    show('sma(close,')
    expect(screen.getByTestId('formula-error')).toBeTruthy()
    expect(screen.queryByTestId('formula-hint')).toBeNull()
  })
})
