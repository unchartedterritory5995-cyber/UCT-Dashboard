// app/src/components/chart/builder/pineBoxOfferedColumns.test.jsx
//
// ─── 🔴 WHAT THE MEMBER IS OFFERED, COUNTED ON SCREEN ────────────────────────
//
// ⛔⛔ THIS BOX ANNOUNCED "This script offers 18 columns" FOR A SCRIPT WITH FOUR.
//
// Both engines stamp `hidden` on a row that is not a column a screen can answer
// from — an author's `display.none`, or a tree that touches no bar and is
// therefore the same number for every symbol. `PineBox` filtered on `o.formula`
// alone and asked neither. MEASURED across the three corpora before the fix: the
// member was offered 173 columns and 126 could screen.
//
// `03-rsi-directional-momentum-scanner` is the sharpest case and it is why this
// file uses a REAL published script rather than a snippet: it ships four signal
// toggles as `input.bool` switched OFF, so four of its plots fold to the literal
// `0`, and with the ternary/`and` folds landing the count reached fourteen. Each
// arrived with a radio button and a title. One of them is "Cont 3rd Short" — a
// saveable scan matching NOTHING, on every symbol, forever, and indistinguishable
// on screen from a screen that simply had a quiet day.
//
// ⭐ AND THE HIDDEN ROWS ARE STILL SHOWN. A member who pasted eighteen plots and
// is handed four without a word has been told nothing about the other fourteen.
// The door's rule is to refuse BY NAME, at the place the member typed; so the row
// stays, loses its radio, and says which of the two reasons it is.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import fs from 'node:fs'
import path from 'node:path'

import PineBox from './PineBox'
import { translatePine, readsBars } from '../engine/ast/pine.js'
import { parseFormula } from '../engine/ast/parse.js'

const SRC = fs.readFileSync(path.resolve(process.cwd(),
  '../tests/fixtures/pine/03-rsi-directional-momentum-scanner.pine'), 'utf8')

const type = (text) => {
  const area = screen.getByLabelText(/^(pine script|script or formula)$/i)
  fireEvent.change(area, { target: { value: text } })
}

beforeEach(() => { cleanup() })

describe('the column count on screen is the count a member can use', () => {
  it('⭐⭐ offers only the columns that read a bar, and says so in the legend', async () => {
    // The engine's own view first, so the on-screen number is compared against a
    // measurement rather than against a number typed into this file.
    const out = translatePine(SRC)
    const withFormula = out.outputs.filter((o) => o.formula)
    const screenable = withFormula.filter((o) => !o.hidden)
    expect(withFormula.length).toBeGreaterThan(screenable.length + 8)  // the gap is real and large

    render(<PineBox onPick={vi.fn()} />)
    type(SRC)

    const legend = await screen.findByText(/This script offers/i)
    expect(legend).toHaveTextContent(`This script offers ${screenable.length} columns`)
    // ⛔ AND THE NUMBER IT MUST NOT SAY. Asserting only the right number passes
    // against a box that happens to render a different count for another reason.
    expect(legend).not.toHaveTextContent(`${withFormula.length} columns`)

    // One radio per screenable column — the count on screen, not just in the text.
    expect(screen.getAllByRole('radio')).toHaveLength(screenable.length)
  })

  it('⭐ every withheld plot is still SHOWN, with the reason it is not offered', async () => {
    const out = translatePine(SRC)
    const withheld = out.outputs.filter((o) => o.formula && o.hidden)
    expect(withheld.length).toBeGreaterThan(8)          // non-vacuity

    render(<PineBox onPick={vi.fn()} />)
    type(SRC)
    await screen.findByText(/This script offers/i)

    const rows = out.outputs
      .map((o, i) => (o.formula && o.hidden ? i : -1))
      .filter((i) => i >= 0)
      .map((i) => screen.getByTestId(`pine-output-hidden-${i}`))
    expect(rows).toHaveLength(withheld.length)
    for (const row of rows) {
      expect(row.textContent).toMatch(/same number on every bar|hides this plot/i)
      // ⛔ SHOWN, NOT OFFERED. A row a member can still select is the bug.
      expect(row.querySelector('input[type="radio"]')).toBe(null)
    }
  })

  it('⛔ and the withheld rows really are constants — the reason is not decorative', () => {
    // ⚠️ THE SENTENCE IS A CLAIM ABOUT THE COLUMN, so it is checked against the
    // engine's own predicate rather than trusted. A row labelled "the same number
    // on every bar" whose tree reads bars would be a false statement rendered to
    // a member, which is worse than the count it replaced.
    const out = translatePine(SRC)
    const constants = out.outputs.filter((o) => o.formula && o.hidden
      && o.hiddenReason === 'constant')
    expect(constants.length).toBeGreaterThan(8)
    for (const o of constants) {
      const p = parseFormula(o.formula)
      expect(p.ok, o.formula).toBe(true)
      expect(readsBars(p.ast), `${o.formula} was called a constant and reads bars`).toBe(false)
    }
  })
})
