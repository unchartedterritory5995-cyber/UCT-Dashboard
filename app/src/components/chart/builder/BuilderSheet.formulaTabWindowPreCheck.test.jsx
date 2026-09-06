// app/src/components/chart/builder/BuilderSheet.formulaTabWindowPreCheck.test.jsx
//
// ─── FORMULA-TAB WINDOW-ARGUMENT PRE-CHECK — MESSAGE PARITY WITH PINE IMPORT ─
//
// The Pine-import door (`builderInputs.js::inputsFromFolded`/`positionVerdict`)
// has ALWAYS refused, by name, a Pine input that would bind to a WINDOW slot —
// `interpret.js::windowLiteral` requires a whole-number LITERAL there, so a
// declared identifier in that position is a formula this engine can never
// compute. `BuilderSheet.plots.test.jsx` even carries a standing comment
// recording that its own author hit this exact wall by hand: *"THE BRIEF USED
// `ema(close, period)` HERE AND IT CANNOT PASS."*
//
// ⛔⛔ UNTIL THIS FILE, THE FORMULA TAB'S OWN HAND-AUTHORING PATH HAD NO SUCH
// PRE-CHECK. `inputKeyProblem` verified only a member input's KEY SPELLING —
// nothing checked whether the CURRENT formula binds that key to a window slot.
// A member typing `sma(close, period)` and declaring `period` as an input saw
// no red text and an ENABLED Save button; the document would save, and the
// member would meet `resolve:window` for the first time on a real chart, with
// no attribution back to which input caused it — the "confusing downstream
// failure" this file's fix closes.
//
// ⭐ THE FIX REUSES THE EXISTING DETECTOR, `formulaNameRoles` — the SAME
// function the Pine-import door's own `positionVerdict` calls for the
// identical question, per that file's own header ("two readers of one fact
// must not disagree"). Only the MESSAGE ‐ `formulaTabWindowRefusal` — is new,
// because `windowRefusal`'s own wording ("the default stays folded, so the
// column is still right") is TRUE on the Pine door and FALSE here (nothing
// folds a hand-typed identifier). No new syntax, no new runtime semantics, no
// way for an invalid formula to become valid — this is a narrated refusal of
// exactly the same fact `interpret.js::windowLiteral` already enforces.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import { SWRConfig } from 'swr'

import BuilderSheet from './BuilderSheet'
import { FORMULA_DEBOUNCE_MS } from './FormulaField'
import { AuthContext } from '../../../context/AuthContext'

const H = vi.hoisted(() => ({ requests: [], rows: [] }))
function stubFetch() {
  H.requests = []; H.rows = []
  global.fetch = vi.fn(async (url, init = {}) => {
    const method = init.method || 'GET'
    H.requests.push({ url: String(url), method, body: init.body ?? null })
    if (method === 'GET') return { ok: true, status: 200, json: async () => ({ definitions: H.rows }) }
    return { ok: true, status: 200, json: async () => ({ def_id: 'u_aaaaaaaaaaaa', version: 1, rev: 1 }) }
  })
}
const flush = async () => {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })
}
function mount() {
  return render(
    <AuthContext.Provider value={{ user: { id: 7 }, isPaid: true, loading: false }}>
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, revalidateOnFocus: false }}>
        <BuilderSheet open onClose={() => {}} />
      </SWRConfig>
    </AuthContext.Provider>,
  )
}
const settle = async () => { await act(async () => { vi.advanceTimersByTime(FORMULA_DEBOUNCE_MS + 10) }) }
const type = async (el, value) => {
  await act(async () => { fireEvent.change(el, { target: { value } }) })
  await settle()
}
const set = async (el, value) => { await act(async () => { fireEvent.change(el, { target: { value } }) }) }
const click = async (el) => { await act(async () => { fireEvent.click(el) }) }
const sent = () => JSON.parse(H.requests.find((r) => r.method !== 'GET').body).definition

beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }); stubFetch() })
afterEach(() => { vi.useRealTimers(); cleanup(); vi.restoreAllMocks() })

describe('a hand-typed formula binding a member input to a WINDOW slot', () => {
  it('⭐⭐ shows the pre-check message and disables Save — never silently saves an uncomputable formula', async () => {
    mount(); await flush()
    await type(screen.getByLabelText('Formula'), 'sma(close, period)')
    await click(screen.getByTestId('add-input'))
    await set(screen.getByLabelText('Input 1 name'), 'period')
    await settle()

    const problem = screen.getByTestId('member-input-problem-0')
    expect(problem.textContent).toMatch(/`period` lands in a WINDOW/)
    expect(problem.textContent).toMatch(/resolve:window/)
    expect(screen.getByLabelText('Input 1 name')).toHaveAttribute('aria-invalid', 'true')

    await set(screen.getByLabelText(/^Name/i), 'Window Bound Attempt')
    await settle()
    expect(screen.getByRole('button', { name: /^Sav/ })).toBeDisabled()
    // ⛔ NEVER SAVED. A disabled button cannot fire a click that reaches
    // `fetch` — asserted directly rather than trusted, per this repo's own
    // "a disabled button never fires a click" idiom.
    expect(H.requests.some((r) => r.method !== 'GET')).toBe(false)
  })

  it('⭐ moving the SAME key out of the window slot makes the message disappear on its own, and Save enables', async () => {
    mount(); await flush()
    await type(screen.getByLabelText('Formula'), 'sma(close, period)')
    await click(screen.getByTestId('add-input'))
    await set(screen.getByLabelText('Input 1 name'), 'period')
    await settle()
    expect(screen.getByTestId('member-input-problem-0')).toBeTruthy()

    // The member edits the formula so `period` no longer lands in a window
    // argument — the SAME declared input, a DIFFERENT position.
    await type(screen.getByLabelText('Formula'), 'sma(close, 20) * period')
    await set(screen.getByLabelText(/^Name/i), 'Window Bound Fixed')
    await settle()

    expect(screen.queryByTestId('member-input-problem-0')).toBeNull()
    expect(screen.getByLabelText('Input 1 name')).not.toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('button', { name: /^Sav/ })).not.toBeDisabled()

    await click(screen.getByRole('button', { name: /^Sav/ }))
    await flush()
    const doc = sent()
    expect(doc.compute.source).toBe('sma(close, 20) * period')
    expect(doc.inputs.some((i) => i.key === 'period' && i.default === 14)).toBe(true)
  })
})
