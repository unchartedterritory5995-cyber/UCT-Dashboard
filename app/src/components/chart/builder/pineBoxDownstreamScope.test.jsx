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
// ⛔⛔ THIS CLOSES THE GAP ONLY FOR A BARE, UNTYPED `input(true/false, …)`
// (Pine v3/v4's idiom) — `03-cm-williams-vix-fix.pine`'s `hp`/`sd` and
// `17-pocket-pivot-breakout.pine`'s `gapcandle`. It does NOT close it for an
// EXPLICIT `input.bool(…)` (v5/v6) — `18-minervini-trend-template.pine`'s
// `show_52_week_high_low` and `27-support-resistance-channels.pine`'s
// `showthema1en`/`showthema2en` — because `builderInputs.js::
// FOLDED_INPUT_INEXPRESSIBLE` refuses `input.bool` BY NAME, a SEPARATE,
// pre-existing, deliberate exclusion. Verified directly (Compatibility
// Remediation Tranche 1, 2026-09-06) that moving `input.bool` into
// `FOLDED_INPUT_TYPES` DOES close Minervini's and Support Resistance
// Channels' gaps too — same mechanism, byte-identical fold — but that change
// was NOT shipped: `pine.js::PARAM_MANIFEST_ELIGIBLE_KINDS`'s own comment
// records an explicit owner instruction ("Track F's v1 scope is int/float
// only"), pinned against `FOLDED_INPUT_TYPES` by
// `pine.paramManifest.test.js` specifically so the two cannot drift apart —
// admitting `bool` here without the same decision on that list would be
// exactly the silent scope-widening that pin exists to catch. Classified and
// deferred, not implemented, pending an explicit owner decision.
//
// ⛔ NON-VACUITY: reverting `downstreamScopeFor` to `BUILDER_INPUT_SCOPE`
// alone reproduces the exact `sentence:name` refusal these tests assert is
// now gone for the bare-`input()` cases — verified by hand before this test
// was written.

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

  it('⛔⛔ Minervini — `input.bool` stays correctly, deliberately excluded (classified, not fixed)', async () => {
    // ⚰️ This is a REGRESSION-PINNING test for the CURRENT boundary, not a
    // claim that the underlying limitation is desirable. See the file header:
    // the fix that would close this is known, verified working in isolation,
    // and deliberately NOT shipped because it collides with an explicit
    // owner-instructed Track F v1 scope boundary (int/float only). If this
    // test ever goes red because `input.bool` starts resolving, that is a
    // SIGNAL to update this test to match a deliberate scope decision — not a
    // regression to chase back to `BUILDER_INPUT_SCOPE`.
    render(<PineBox onPick={vi.fn()} />)
    type(MINERVINI)
    await screen.findByText(/This script offers/i)
    const blocked = document.querySelectorAll('[data-guard="sentence:name"]')
    expect(blocked.length).toBe(2)
    expect([...blocked].every((b) => b.textContent.includes('show_52_week_high_low'))).toBe(true)
  })
})
