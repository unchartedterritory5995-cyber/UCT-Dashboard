// app/src/components/chart/builder/BuilderSheet.savePending.test.jsx
//
// ─── 🔴🔴 "SILENT SAVE NO-OP" — FIRST SCRUTINY (Compatibility Remediation
// Tranche 1, 2026-09-06) ─────────────────────────────────────────────────────
//
// Checkpoint 02 reported two distinct observations under one name:
//
//   1. Clicking Save on a column whose readback still carries an error —
//      TRACED HERE and confirmed NOT a defect: `canSaveFormula(result,…)`
//      already returns `false` for any `!result.ok`, so `disabled={!canSave}`
//      already, correctly, shuts the button. A disabled `<button>` never
//      fires `onClick` at all — there is nothing to fix in `save()` itself.
//   2. A fresh, VALID, hand-typed formula whose first Save click "did not
//      appear to persist," fixed by clicking a second time — this one is
//      real, and root-caused here: `result`/`canSave` reflect the LAST
//      SETTLED (250ms-debounced) evaluation, not the current textarea value.
//      For up to 250ms after a keystroke, the button can still be showing
//      the PREVIOUS formula's (disabled) verdict — a click in that window is
//      swallowed by the browser (no `onClick` on a disabled element), with
//      no toast, no error, nothing: the user cannot tell "still checking"
//      from "broken."
//
// ⭐ THE FIX (`FormulaField`'s `onPendingChange` + this sheet's `pending`
// state) is INFORMATION ONLY. It changes no gate, no disabled state, no
// button label — only the `save-hint` paragraph, which already existed for
// exactly this purpose (explaining a shut gate). "Checking your formula…"
// converts the silent gap into an explained one, satisfying "Save must
// either persist or clearly refuse" without moving `canSave` at all.
//
// ⛔⛔ WHY NOT GATE `canSave` ON IT TOO: doing so was tried and reverted — it
// changes WHEN the button is clickable, which is a real behavior change with
// its own, larger blast radius (multiple existing suites assert the button's
// enabled state and its exact label synchronously after a change). The
// reported defect was a swallowed click, not a wrong save; the informational
// fix closes exactly that without touching anything those suites depend on.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import { SWRConfig } from 'swr'

import BuilderSheet from './BuilderSheet'
import { FORMULA_DEBOUNCE_MS } from './FormulaField'
import { AuthContext } from '../../../context/AuthContext'

function mount() {
  return render(
    <AuthContext.Provider value={{ user: { id: 7 }, isPaid: true, loading: false }}>
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, revalidateOnFocus: false }}>
        <BuilderSheet open onClose={() => {}} onSaved={() => {}} settings={null} onChange={() => {}} />
      </SWRConfig>
    </AuthContext.Provider>,
  )
}

const field = () => screen.getByLabelText('Formula')
const nameBox = () => screen.getByLabelText(/name/i)
const saveBtn = () => screen.getByRole('button', { name: /^Sav/ })

beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }) })
afterEach(() => { vi.useRealTimers(); cleanup() })

describe('the Save button explains a mid-debounce click instead of swallowing it', () => {
  it('⭐⭐ "Checking your formula…" appears the instant text changes, before the 250ms settle', async () => {
    mount()
    await act(async () => { fireEvent.change(field(), { target: { value: 'close > sma(close, 20)' } }) })
    // ⛔ NOT ADVANCED YET. This is the exact window Checkpoint 02's second
    // click landed past — the first click's own window, still open here.
    expect(screen.getByTestId('save-hint').textContent).toBe('Checking your formula…')
  })

  it('⛔⛔ the Save button itself is UNTOUCHED — same label, same disabled state as before this fix', async () => {
    mount()
    const before = { text: saveBtn().textContent, disabled: saveBtn().disabled }
    await act(async () => { fireEvent.change(field(), { target: { value: 'close > sma(close, 20)' } }) })
    // Mid-debounce: the button's own text/disabled state must not have moved,
    // even though the hint beside it now explains why nothing happens yet.
    expect(saveBtn().textContent).toBe(before.text)
    expect(saveBtn().disabled).toBe(before.disabled)
  })

  it('⭐ once the debounce settles on a valid, named formula, the hint clears and Save enables', async () => {
    mount()
    await act(async () => { fireEvent.change(nameBox(), { target: { value: 'Above 20SMA' } }) })
    await act(async () => { fireEvent.change(field(), { target: { value: 'close > sma(close, 20)' } }) })
    expect(screen.getByTestId('save-hint').textContent).toBe('Checking your formula…')
    await act(async () => { vi.advanceTimersByTime(FORMULA_DEBOUNCE_MS + 10) })
    expect(screen.queryByTestId('save-hint')).toBeNull()
    expect(saveBtn().disabled).toBe(false)
  })

  it('⛔ a genuinely invalid formula still gets its OWN hint once settled, not "Checking…" forever', async () => {
    mount()
    await act(async () => { fireEvent.change(nameBox(), { target: { value: 'x' } }) })
    await act(async () => { fireEvent.change(field(), { target: { value: 'close * nosuchname' } }) })
    await act(async () => { vi.advanceTimersByTime(FORMULA_DEBOUNCE_MS + 10) })
    // A real refusal shows its own chip elsewhere; the hint paragraph is
    // silent for a formula-shaped gate (see the file this hint's own
    // ordering rule lives in) — the point under test is only that it is NOT
    // stuck reading "Checking your formula…" forever.
    expect(screen.queryByTestId('save-hint')?.textContent).not.toBe('Checking your formula…')
    expect(saveBtn().disabled).toBe(true)
  })
})
