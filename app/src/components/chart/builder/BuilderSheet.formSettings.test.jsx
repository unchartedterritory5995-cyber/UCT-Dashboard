// THE NEW FORMULA WINDOW'S INPUTS TAB SHOWS A FORMULA'S OWN NUMBERS (Indicators backlog 45a).
//
// An indicator built from a description read "Inputs 0" here: its lengths and levels are literals
// in the formula. They are derived from the formula as parsed, and a change rewrites the formula
// text through the same door a typed edit uses.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act, within } from '@testing-library/react'
import { SWRConfig } from 'swr'

import BuilderSheet from './BuilderSheet'
import { writeMyself, formulaBox, openInputs } from '../../../testing/builder/builderStart.testkit.js'
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

// ⭐ 2026-11-18 — A CHECKED LIBRARY INDICATOR IN THE FORMULA TAB (`authoring/checkedLibrary.js`).
// Read in the live window: KAMA showed "Inputs 8" (every number of its formula); it has three
// settings, and its slow length sits in two places.
const KAMA = 'accum(close, self + pow(abs(close - close[10]) / sum(abs(close - close[1]), 10) * (2 / (2 + 1) - 2 / (30 + 1)) + 2 / (30 + 1), 2) * (close - self), 300)'
const nameField = () => screen.getByLabelText('Name')
const notice = () => screen.queryByTestId('library-title-dropped')

describe('a checked library indicator in the Formula tab', () => {
  it('shows the entry\'s own three settings, and one field moves every place the setting sits', async () => {
    mount()
    await typeFormula(KAMA)
    expect(inputsCount()).toBe(3)
    openInputs()
    expect(rows().map((r) => box(r).value)).toEqual(['10', '2', '30'])
    expect(screen.getByTestId('form-settings').textContent).toMatch(/Efficiency length[\s\S]*Fast length[\s\S]*Slow length/)
    fireEvent.change(box(rows()[2]), { target: { value: '40' } })
    await act(async () => { fireEvent.keyDown(box(rows()[2]), { key: 'Enter' }) })
    await act(async () => { vi.advanceTimersByTime(FORMULA_DEBOUNCE_MS + 10) })
    expect(formulaBox().value.match(/\(40 \+ 1\)/g)).toHaveLength(2)        // BOTH places, together
    expect(formulaBox().value).not.toMatch(/\(30 \+ 1\)/)                   // neither place was left behind
    expect(inputsCount()).toBe(3)                                          // still that indicator: still three
    // a value the maths cannot take is refused beside the field, and nothing moves
    fireEvent.change(box(rows()[2]), { target: { value: '5001' } })
    await act(async () => { fireEvent.keyDown(box(rows()[2]), { key: 'Enter' }) })
    expect(within(rows()[2]).getByRole('alert').textContent).toMatch(/whole number from 2 to 5000/)
    expect(formulaBox().value.match(/\(40 \+ 1\)/g)).toHaveLength(2)
  })

  it('a title that names it gives way when the formula is edited by hand, says so, and comes back with the formula', async () => {
    mount()
    await typeFormula(KAMA)
    await act(async () => { fireEvent.change(nameField(), { target: { value: 'Kaufman Adaptive Moving Average' } }) })
    expect(notice()).toBeNull()
    // the formula's own "2 / (fast + 1)" becomes "3 / ...": not Kaufman's formula any more
    await typeFormula(KAMA.replace('(2 / (2 + 1)', '(3 / (2 + 1)'))
    expect(nameField().value).not.toMatch(/kaufman/i)
    expect(nameField().value.length).toBeGreaterThan(0)
    expect(notice().textContent).toBe("No longer UCT's checked formula for Kaufman Adaptive Moving Average: the formula was edited.")
    expect(inputsCount()).toBeGreaterThan(3)                               // and its numbers are its own again
    // the formula put back: the title returns and the line goes
    await typeFormula(KAMA)
    expect(nameField().value).toBe('Kaufman Adaptive Moving Average')
    expect(notice()).toBeNull()
    // edited away again, and this time the member names it themselves before putting the formula back:
    // the line goes (the formula is the checked one again) and THEIR title stays
    await typeFormula(KAMA.replace('(2 / (2 + 1)', '(3 / (2 + 1)'))
    expect(notice()).not.toBeNull()
    await act(async () => { fireEvent.change(nameField(), { target: { value: 'My adaptive line' } }) })
    await typeFormula(KAMA)
    expect(nameField().value).toBe('My adaptive line')
    expect(notice()).toBeNull()
  })

  it('CONTROL: a title of the member\'s own is never touched, and a library title they type over another formula is theirs', async () => {
    mount()
    await typeFormula(KAMA)
    await act(async () => { fireEvent.change(nameField(), { target: { value: 'My trend line' } }) })
    await typeFormula(KAMA.replace('(2 / (2 + 1)', '(3 / (2 + 1)'))
    expect(nameField().value).toBe('My trend line')
    expect(notice()).toBeNull()
    // never agreed with a library formula in this sheet: typing the library's title claims nothing here
    await act(async () => { fireEvent.change(nameField(), { target: { value: 'On Balance Volume' } }) })
    await typeFormula('rsi(close, 14) >= 70')
    expect(nameField().value).toBe('On Balance Volume')
    expect(notice()).toBeNull()
  })
})

