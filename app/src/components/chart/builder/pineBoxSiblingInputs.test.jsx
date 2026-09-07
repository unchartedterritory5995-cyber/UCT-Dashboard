// app/src/components/chart/builder/pineBoxSiblingInputs.test.jsx
//
// ─── ⭐⭐ C0R MECHANISM B: A CARRIED OUTPUT BRINGS THE INPUTS IT NAMES ────────
//
// ⚰️ WHAT THIS FILE EXISTS TO STOP, MEASURED ON THE FROZEN OOS CORPUS.
// C0.1 taught this door to hand back EVERY output of a multi-plot script. It
// projected each non-selected output to `{source, title, presentation}` — and
// dropped `memberInputs`. So a sibling's FORMULA travelled while the inputs that
// formula NAMES did not, and the saved document reached the closed table naming a
// symbol nobody had declared.
//
// Six of the eight C0 SAVE_BLOCKED scripts are exactly this, and every one of
// them fails on a SIBLING, never on output 0:
//   `mult` (waddah-attar) · `upLine` (cm-ultimate-rsi) · `showMa`
//   (volatility-of-returns) · `bandStdevMult` (3way-bollinger) · `showBand`
//   (master-line-lite) · `lv3` (rsi-levels-regime-map).
//
// ⭐ IT IS A PROJECTION DROPPING A FIELD — `lesson_a_projection_drops_what_it_
// does_not_name` — and the tell was that the refusal for `lv3` could suggest
// *"did you mean `lv1` or `lv2`?"*: those two ARE declared, because the selected
// column happens to name them. Nothing about traversal, ternaries or pruning.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import fs from 'node:fs'
import path from 'node:path'

import PineBox from './PineBox'

// The minimal reduction: output 0 names no input, output 1 gates on one. That
// asymmetry IS the bug's shape, reduced to the smallest script that has it.
const MINIMAL = `//@version=5
indicator("Sibling Input", overlay = false)
showMa = input.bool(true, "Show MA")
r = ta.rsi(close, 14)
plot(r, title = "RSI")
plot(showMa ? ta.sma(r, 9) : na, title = "Signal")
`

const REAL = fs.readFileSync(path.resolve(process.cwd(),
  '../tools/c0_oos_fixtures/long_tail__13-volatility-of-returns.pine'), 'utf8')

const type = (text) => {
  const area = screen.getByLabelText(/^(pine script|script or formula)$/i)
  fireEvent.change(area, { target: { value: text } })
}

/** Paste, wait for the report, Apply, and hand back what `onPick` received. */
async function applied(source) {
  const onPick = vi.fn()
  render(<PineBox onPick={onPick} />)
  type(source)
  await screen.findByText(/This script offers/i)
  const use = await screen.findByTestId('pine-use')
  await vi.waitFor(() => expect(use.disabled).toBe(false))
  await act(async () => { fireEvent.click(use) })
  expect(onPick).toHaveBeenCalledTimes(1)
  return onPick.mock.calls[0][0]
}

beforeEach(() => { cleanup() })

describe('every carried output hands back the inputs its own formula names', () => {
  it('⭐⭐ the minimal reduction: the SIBLING carries `showMa`, the selected column does not', async () => {
    const picked = await applied(MINIMAL)
    expect(typeof picked).toBe('object')
    expect(Array.isArray(picked.outputs)).toBe(true)
    expect(picked.outputs.length).toBeGreaterThan(1)

    // ⛔ THE ASYMMETRY IS THE ASSERTION. If the selected column ever starts
    // naming `showMa` too, this case stops testing the sibling path — so it is
    // pinned in BOTH directions rather than only on the sibling.
    const names = (o) => (o.inputs || []).map((r) => r.key)
    expect(names(picked.outputs[0])).not.toContain('showMa')
    expect(picked.outputs.slice(1).some((o) => names(o).includes('showMa'))).toBe(true)

    // And the top-level `inputs` — the selected output's rows, the ONLY set that
    // travelled before this fix — still does not carry it. That is precisely why
    // the union has to be taken downstream.
    expect((picked.inputs || []).map((r) => r.key)).not.toContain('showMa')
  })

  it('⛔ EVERY carried output declares an `inputs` array, even an empty one', async () => {
    // Absent and empty are different to a consumer that spreads it. A missing
    // field is how the original projection lost these in the first place.
    const picked = await applied(MINIMAL)
    for (const o of picked.outputs) expect(Array.isArray(o.inputs)).toBe(true)
  })

  it('⭐ the real OOS script: `showMa` rides its own output', async () => {
    // `long_tail__13-volatility-of-returns` — one of the six. Its selected
    // column is the volatility line (`annualize`, `annPeriod`); `showMa` belongs
    // to the moving-average plot, and was dropped on the way out of this door.
    const picked = await applied(REAL)
    const all = picked.outputs.flatMap((o) => (o.inputs || []).map((r) => r.key))
    expect(all).toContain('showMa')
    expect((picked.inputs || []).map((r) => r.key)).not.toContain('showMa')
  })
})
