// app/src/components/chart/builder/pineBoxDownstreamScope.test.jsx
//
// ─── 🔴🔴 A DECLARED PINE INPUT REFUSED THE READ-BACK OF ITS OWN NAME ────────
//
// Compatibility Harness Layer C Checkpoint 02 (2026-09-06) found this on four
// real public scripts and called it "boolean-input-in-conditional" — booleans
// were the only variant actually observed, so that is what it was named.
//
// ⭐⭐ ROOT CAUSE, CONFIRMED HERE: it was never about booleans as a TYPE.
// `PineBox.jsx`'s own "downstream" verdict — `evaluateFormula(out.formula,
// BUILDER_INPUT_SCOPE)` — was called with ONLY the chrome scope (`color`,
// `lineWidth`) every document carries, never with the candidate's OWN declared
// inputs, which `memberInputTranslation` computes two lines above and stamps
// onto `out.memberInputs` for exactly this purpose. ANY declared input
// referenced by bare name in the printed formula hit this — booleans happened
// to dominate the sample because a numeric input used as a LENGTH is
// window-bound and folded back to a literal (never reaching the formula as a
// bare name), while a boolean used as a GATE almost never is.
//
// ⭐ THE FIX IS `downstreamScopeFor(out)`: `{...BUILDER_INPUT_SCOPE,
// ...declaredInputs({inputs: out.memberInputs})}` — merging in machinery that
// already existed and was already proven live for numeric knobs. No change
// anywhere in the translator, the interpreter, or the sentence read-back.
//
// ⛔⛔ AT SHIP TIME (Compatibility Remediation Tranche 1, 2026-09-06), THIS
// CLOSED THE GAP ONLY FOR A BARE, UNTYPED `input(true/false, …)` (Pine
// v3/v4's idiom) — `03-cm-williams-vix-fix.pine`'s `hp`/`sd` and
// `17-pocket-pivot-breakout.pine`'s `gapcandle`. An EXPLICIT `input.bool(…)`
// (v5/v6) — `18-minervini-trend-template.pine`'s `show_52_week_high_low`,
// `27-support-resistance-channels.pine`'s `showthema1en`/`showthema2en` —
// stayed blocked, because `builderInputs.js::FOLDED_INPUT_INEXPRESSIBLE`
// refused `input.bool` by name, gated behind an explicit owner instruction
// on `pine.js::PARAM_MANIFEST_ELIGIBLE_KINDS` ("Track F's v1 scope is
// int/float only") this file's own tests could not unilaterally cross.
//
// ⭐⭐ PROMOTED (Track F v1.1, same day, second authorization): the owner
// extended that scope to admit `input.bool`, on real corpus evidence this
// file's OWN prior run supplied. `input.bool` now moves to
// `FOLDED_INPUT_TYPES` (mapped to `'int'`, byte-identical to the bare-
// `input()` fold `pine.js::resolveInput` already treats it as), closing the
// Minervini/Support-Resistance-Channels half too — see
// `COMPATIBILITY_REMEDIATION_TRANCHE_1.md` for the Tranche-1 investigation
// and `pine.paramManifest.test.js`/`test_param_manifest.py` for Track F's
// OWN (separate) `compute.paramManifest` extension this promotion also
// required, to keep the two eligible-kind lists in the parity that test
// pins.
//
// ⛔ NON-VACUITY: reverting `downstreamScopeFor` to `BUILDER_INPUT_SCOPE`
// alone reproduces the exact `sentence:name` refusal these tests assert is
// now gone; reverting `input.bool`'s own move back into
// `FOLDED_INPUT_INEXPRESSIBLE` reproduces Minervini's own refusal
// specifically — both verified by hand before this file reached its current
// shape.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import fs from 'node:fs'
import path from 'node:path'

import PineBox from './PineBox'

const VIX_FIX = fs.readFileSync(path.resolve(process.cwd(),
  '../tests/fixtures/pine_community/03-cm-williams-vix-fix.pine'), 'utf8')
const MINERVINI = fs.readFileSync(path.resolve(process.cwd(),
  '../tests/fixtures/pine_community/18-minervini-trend-template.pine'), 'utf8')

// A minimal reduction, isolated from the real script's unrelated complexity —
// a bare, untyped boolean toggle gating a plot, the exact idiomatic v3/v4
// shape (`showX ? value : na`) `03-cm-williams-vix-fix.pine` uses.
const MINIMAL_BARE = `//@version=4
study("t")
showit = input(true, title="Show it")
level = close - 1
plot(showit ? level : na, title="Gated Level")
`

const type = (text) => {
  const area = screen.getByLabelText(/^(pine script|script or formula)$/i)
  fireEvent.change(area, { target: { value: text } })
}

beforeEach(() => { cleanup() })

describe('a declared Pine input reads back cleanly, wherever it lands in the formula', () => {
  it('⭐⭐ the minimal reduction: a bare, untyped boolean gate resolves, not `sentence:name`', async () => {
    render(<PineBox onPick={vi.fn()} />)
    type(MINIMAL_BARE)
    const formula = await screen.findByTestId('pine-formula-0')
    await vi.waitFor(() => {
      expect(formula.parentElement.querySelector('[data-guard]')).toBe(null)
    })
    expect(formula.parentElement.textContent).toMatch(/the input showit/)
  })

  it('⭐⭐ CM Williams Vix Fix — both `hp`-gated columns resolve, no `sentence:name`', async () => {
    render(<PineBox onPick={vi.fn()} />)
    type(VIX_FIX)
    await screen.findByText(/This script offers/i)
    const blocked = document.querySelectorAll('[data-guard="sentence:name"]')
    expect(blocked.length, [...blocked].map((b) => b.textContent).join('\n')).toBe(0)
    // ⭐ AND THE READ-BACK ACTUALLY SAYS THE INPUT'S NAME — not merely "no error".
    const readbacks = [...document.querySelectorAll('[class*="outReadback"]')]
      .map((n) => n.textContent).join(' | ')
    expect(readbacks).toMatch(/the input hp/)
    expect(readbacks).toMatch(/the input sd/)
  })

  it('⭐⭐ Minervini — Track F v1.1: `input.bool` now resolves, closing the Layer-A fidelity gap RISK-037 named', async () => {
    // ⚰️ THIS TEST USED TO PIN THE OPPOSITE: `show_52_week_high_low` (an
    // explicit `input.bool`) refusing both of Minervini's only 2 offered
    // columns at `sentence:name`, deliberately NOT fixed pending an owner
    // decision on Track F's scope. That decision landed the same day
    // (Track F v1.1) — see the file header. Both columns now resolve
    // cleanly, closing the exact gap RISK-037/Checkpoint 02 named: a script
    // Layer A's static benchmark calls `SUPPORTED` now ALSO has working
    // real-import outputs, not zero.
    render(<PineBox onPick={vi.fn()} />)
    type(MINERVINI)
    await screen.findByText(/This script offers/i)
    const blocked = document.querySelectorAll('[data-guard="sentence:name"]')
    expect(blocked.length, [...blocked].map((b) => b.textContent).join('\n')).toBe(0)
    const readbacks = [...document.querySelectorAll('[class*="outReadback"]')]
      .map((n) => n.textContent).join(' | ')
    expect(readbacks).toMatch(/the input show_52_week_high_low/)
  })
})
