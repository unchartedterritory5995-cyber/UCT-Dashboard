// THE NEW FORMULA WINDOW'S INPUTS TAB SHOWS A FORMULA'S OWN NUMBERS (Indicators backlog 45a).
//
// An indicator built from a description read "Inputs 0" here: its lengths and levels are literals
// in the formula. They are derived from the formula as parsed, and a change rewrites the formula
// text through the same door a typed edit uses.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act, within } from '@testing-library/react'
import { SWRConfig } from 'swr'

import BuilderSheet from './BuilderSheet'
import { writeMyself, formulaBox, openInputs } from './builderStart.testkit.js'
import { FORMULA_DEBOUNCE_MS } from './FormulaField'
import { AuthContext } from '../../../context/AuthContext'

function mount() {
  render(
    <AuthContext.Provider value={{ user: { id: 7 }, isPaid: true, loading: false }}>
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, revalidateOnFocus: false }}>
        <BuilderSheet open onClose={() => {}} onSaved={() => {}} settings={null} onChange={() => {}} />
      </SWRConfig>
    </AuthContext.Provider>,
  )
  writeMyself()
}
async function typeFormula(text) {
  await act(async () => { fireEvent.change(formulaBox(), { target: { value: text } }) })
  await act(async () => { vi.advanceTimersByTime(FORMULA_DEBOUNCE_MS + 10) })
}
const rows = () => within(screen.getByTestId('form-settings')).queryAllByTestId('studio-setting')
const box = (row) => within(row).getByRole('textbox')
const inputsCount = () => {
  const tab = [...document.querySelectorAll('button, [role="tab"]')].find((b) => /^Inputs\s*\d+$/.test(b.textContent.trim()))
  return tab ? Number(tab.textContent.replace(/\D+/g, '')) : null
}

beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }) })
afterEach(() => { vi.useRealTimers(); cleanup() })

describe('the Inputs tab shows the formula’s own numbers', () => {
  it('a formula with a length and a level counts two inputs and shows two fields', async () => {
    mount()
    await typeFormula('rsi(close, 14) >= 70')
    expect(inputsCount()).toBe(2)
    openInputs()
    expect(rows().map((r) => [r.getAttribute('data-role'), box(r).value])).toEqual([['length', '14'], ['level', '70']])
    expect(screen.getByTestId('form-settings').textContent).toMatch(/Numbers in this indicator/)
    expect(screen.getByTestId('form-settings').textContent).toMatch(/changes this indicator everywhere it is used/)
  })

  it('changing a field rewrites the formula, and the field follows it', async () => {
    mount()
    await typeFormula('rsi(close, 14) >= 70')
    openInputs()
    fireEvent.change(box(rows()[1]), { target: { value: '62.5' } })
    await act(async () => { fireEvent.keyDown(box(rows()[1]), { key: 'Enter' }) })
    await act(async () => { vi.advanceTimersByTime(FORMULA_DEBOUNCE_MS + 10) })
    expect(formulaBox().value).toBe('rsi(close, 14) >= 62.5')
    expect(box(rows()[1]).value).toBe('62.5')
    expect(inputsCount()).toBe(2)
  })

  it('a value a length cannot take is refused beside the field and the formula is untouched', async () => {
    mount()
    await typeFormula('rsi(close, 14) >= 70')
    openInputs()
    fireEvent.change(box(rows()[0]), { target: { value: '2.5' } })
    await act(async () => { fireEvent.keyDown(box(rows()[0]), { key: 'Enter' }) })
    expect(within(rows()[0]).getByRole('alert').textContent).toMatch(/whole number of at least 1/)
    expect(formulaBox().value).toBe('rsi(close, 14) >= 70')
  })

  it('CONTROL: a formula with nothing to tune counts none and shows no fields', async () => {
    mount()
    await typeFormula('close > open')
    expect(inputsCount()).toBe(0)
    openInputs()
    expect(rows()).toHaveLength(0)
    expect(screen.getByTestId('no-inputs')).toBeTruthy()          // the declared-inputs note is unchanged
  })
})
