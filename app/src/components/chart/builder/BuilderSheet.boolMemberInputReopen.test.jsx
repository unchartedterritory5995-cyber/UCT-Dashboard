// app/src/components/chart/builder/BuilderSheet.boolMemberInputReopen.test.jsx
//
// ─── THE OTHER MECHANISM — THE ONE THAT ACTUALLY FIXED MINERVINI/SRC ───────
//
// `BuilderSheet.boolParamReopen.test.jsx` proves Track F's OWN mechanism
// (`compute.paramManifest` / `ParamControls`'s checkbox / `param_manifest.py`'s
// strict {0,1} server validation) — but that mechanism attaches ONLY to a
// boolean bound DIRECTLY into a position that cannot become a named identifier
// (a window slot), which structurally can never have both toggle states valid
// (`interpret.js::windowLiteral` requires >=1).
//
// Minervini's `show_52_week_high_low` and Support Resistance Channels'
// `showthema1en`/`showthema2en` do NOT do that — they gate a TERNARY
// CONDITION directly (`show ? ... : na`), which is a DIFFERENT, SEPARATE
// mechanism: `builderInputs.js`'s `memberInputTranslation`/`inputsFromFolded`
// (W1b.9, pre-existing before Track F v1.1), which prints the Pine input as a
// bound, symbolic IDENTIFIER in the formula text (never folding it away) and
// declares it as a plain `document.inputs[]` row of `type:'int'` (per
// `FOLDED_INPUT_TYPES['input.bool'] = 'int'` — deliberately NOT Track F's own
// `type:'bool'`, see that map's own header comment). This file proves THAT
// mechanism's default-true/default-false/branch/save/reopen/toggle/
// persisted-state/changed-executable-behavior claims directly — the ones the
// real corpus fix actually depends on — rather than only the synthetic
// window-bound Track F fixture.
//
// ⛔⛔ AN HONEST CONTRACT CORRECTION, FOUND WHILE BUILDING THIS FILE: this
// mechanism's `type:'int'` row carries NO {0,1} domain restriction —
// `defSchema.validateInputValue`'s `'int'` case only requires an integer, and
// `inputsFromFolded` never sets `min`/`max` for a plain `input.bool()` (Pine's
// bool has no `minval`/`maxval` to carry). So unlike Track F's paramManifest
// bool (strictly 0 or 1, both client and server), a memberInputs-declared
// bool-origin `int` can be set to ANY integer via a chart instance's settings
// (`instanceControls.js::coerce`'s `'int'` case, unbounded) — this is NOT new
// to this tranche; it is the SAME behavior the already-shipped bare
// `input(true/false)` has always had (`FOLDED_INPUT_TYPES.input.bool` maps to
// `'int'` specifically to stay byte-identical to it). At the EXECUTION layer
// `interpret.js`'s `TERNARY = (t,a,b) => t!==0 ? a : b` (verified by reading
// the function directly) treats ANY nonzero number as Pine's own "true" and
// exactly `0` as "false" — Pine's native numeric-truthiness convention, NOT a
// JS string/object coercion (the value is a genuine JS number end to end,
// never a string, never a JS boolean, at every layer of this mechanism).
// TRACK F's OWN paramManifest bool is the ONLY place in this codebase where a
// Pine boolean gets a strictly-enforced {0,1} domain — that guarantee does
// NOT extend to this mechanism, and this file documents that difference
// rather than overstating the narrower Track F claim onto the broader one.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act, within } from '@testing-library/react'
import { SWRConfig } from 'swr'

import BuilderSheet from './BuilderSheet'
import { pineMemberInputs } from './builderInputs'
import { translatePine } from '../engine/ast/pine'
import { computeFor } from '../engine/nativeRegistry'
import { parseFormula, astHash } from '../engine/ast/parse'
import { FORMULA_DEBOUNCE_MS } from './FormulaField'
import { PINE_DEBOUNCE_MS } from './PineBox'
import { AuthContext } from '../../../context/AuthContext'

// A minimal reduction of Minervini's own shape — a typed `input.bool` gating a
// ternary DIRECTLY, the idiom `pine.js`'s own `PARAM_MANIFEST_ELIGIBLE_KINDS`
// comment names as excluded from Track F's OWN mechanism (constant-folds
// there) but which this SEPARATE mechanism handles correctly.
const TRUE_FIXTURE = `//@version=5
indicator("Direct Conditional Bool")
showit = input.bool(true, "Show It")
level = close - 1
plot(showit ? level : na, title="Gated Level")
`
const FALSE_FIXTURE = `//@version=5
indicator("Direct Conditional Bool")
showit = input.bool(false, "Show It")
level = close - 1
plot(showit ? level : na, title="Gated Level")
`

describe('a directly-conditional input.bool declares correctly (pure translation, no UI)', () => {
  it('default true: declared as an int-typed memberInput at 1, formula stays SYMBOLIC (not folded)', () => {
    const { ok, formula, inputs, skipped } = pineMemberInputs(translatePine, TRUE_FIXTURE)
    expect(ok).toBe(true)
    expect(skipped).toEqual([])
    // ⭐ `level` (an ordinary `let`, not an input) is inlined to `close - 1` —
    // only INPUT-bound names survive translation as identifiers. `na` compiles
    // to `0 / 0`, this engine's NaN literal.
    expect(formula).toBe('showit ? close - 1 : 0 / 0')
    expect(inputs).toEqual([{ key: 'showit', type: 'int', label: 'Show It', default: 1 }])
  })

  it('default false: declared at 0 — no truthy/falsy coercion, the default is the genuine folded number', () => {
    const { inputs, formula } = pineMemberInputs(translatePine, FALSE_FIXTURE)
    expect(inputs).toEqual([{ key: 'showit', type: 'int', label: 'Show It', default: 0 }])
    expect(formula).toBe('showit ? close - 1 : 0 / 0')
  })
})

describe('the SAME AST, toggled through the REAL compute path — changed canonical/executable behavior, not just changed metadata', () => {
  it('true branch computes the gated column; false branch computes na (NaN) on every bar', () => {
    const { formula, inputs } = pineMemberInputs(translatePine, TRUE_FIXTURE)
    const parsed = parseFormula(formula)
    expect(parsed.ok, parsed.error).toBe(true)
    const def = {
      compute: { kind: 'ast', fn: astHash(parsed.ast), ast: parsed.ast, source: formula },
      inputs,
      plots: [{ key: 'value', label: 'Gated Level', style: 'line', color: '$color', width: 1, role: 'primary' }],
    }
    const bars = [
      { t: 1, o: 10, h: 11, l: 9, c: 10 },
      { t: 2, o: 11, h: 12, l: 10, c: 11 },
      { t: 3, o: 12, h: 13, l: 11, c: 12 },
    ]
    // ⭐ THE DECLARED DEFAULT (1) IS WHAT `nativeRegistry.resolveInputs` READS
    // when no per-instance override is handed in — this is the SAME path a
    // real chart takes, not a BuilderSheet-only preview (that preview's own
    // `evaluateFormula` scope is a "this name is declared" flag map, not a
    // value binding — verified by reading `lint.js::declaredInputs`, which is
    // exactly why this test calls the real `computeFor`/`interpret` chain
    // instead of asserting anything about BuilderSheet's live preview).
    const onCols = computeFor(def, bars)
    expect(Array.from(onCols.value)).toEqual([9, 10, 11]) // close - 1, the TRUE branch

    // Overriding the SAME AST's input to 0 (exactly what toggling the
    // memberInput's default and re-saving does — see the end-to-end test
    // below) computes the FALSE branch (`na` = NaN) on every bar. Same tree,
    // same interpreter, only the input value differs — this is the
    // "changed canonical/executable behavior" claim, proven directly.
    const offCols = computeFor(def, bars, { showit: 0 })
    expect(Array.from(offCols.value).every((v) => Number.isNaN(v))).toBe(true)
    expect(offCols.value.length).toBe(3)
  })
})

// ─── save / reopen / toggle / persisted state, through the real product UI ──

const H = vi.hoisted(() => ({ requests: [], store: new Map(), counter: 0 }))

function stubStatefulFetch() {
  H.requests = []
  H.store = new Map()
  H.counter = 0
  global.fetch = vi.fn(async (url, init = {}) => {
    const method = init.method || 'GET'
    const u = String(url)
    H.requests.push({ url: u, method, body: init.body ?? null })

    if (method === 'GET' && u.startsWith('/api/user-definitions')) {
      return { ok: true, status: 200, json: async () => ({ definitions: [...H.store.values()] }) }
    }
    if (method === 'POST' && u === '/api/user-definitions') {
      const { definition } = JSON.parse(init.body)
      H.counter += 1
      const defId = `u_${String(H.counter).padStart(12, '0')}`
      const row = {
        def_id: defId, version: 1, rev: 1, ast_hash: definition.compute.fn,
        definition: { ...definition, id: defId }, created_at: Date.now(),
      }
      H.store.set(defId, row)
      return { ok: true, status: 200, json: async () => row }
    }
    if (method === 'PUT' && u.startsWith('/api/user-definitions/')) {
      const defId = decodeURIComponent(u.slice('/api/user-definitions/'.length))
      const prior = H.store.get(defId)
      const { definition } = JSON.parse(init.body)
      const row = {
        def_id: defId, version: (prior?.version || 1) + 1, rev: 1, ast_hash: definition.compute.fn,
        definition: { ...definition, id: defId }, created_at: prior?.created_at || Date.now(),
      }
      H.store.set(defId, row)
      return { ok: true, status: 200, json: async () => row }
    }
    return { ok: true, status: 200, json: async () => ({}) }
  })
}

const flush = async () => {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })
}
const flushSwr = async () => {
  await act(async () => { vi.advanceTimersByTime(1000) })
  await flush()
}
const noop = () => {}

function mountFresh() {
  return render(
    <AuthContext.Provider value={{ user: { id: 7 }, isPaid: true, loading: false }}>
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, revalidateOnFocus: false }}>
        <BuilderSheet open onClose={noop} />
      </SWRConfig>
    </AuthContext.Provider>,
  )
}

const formulaField = () => screen.getByLabelText('Formula')
const pineField = () => screen.getByTestId('pine-box').querySelector('textarea')
const tab = (name) => screen.getByRole('tab', { name })

async function settlePine() {
  await act(async () => { vi.advanceTimersByTime(PINE_DEBOUNCE_MS + 1) })
  await flush()
}
async function settleFormula() {
  await act(async () => { vi.advanceTimersByTime(FORMULA_DEBOUNCE_MS + 1) })
  await flush()
}
async function paste(script) {
  fireEvent.click(tab(/^import$/i))
  fireEvent.change(pineField(), { target: { value: script } })
  await settlePine()
}

beforeEach(() => {
  vi.useFakeTimers()
  stubStatefulFetch()
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('reopening a saved directly-conditional bool through the real "Your formulas" door', () => {
  it('⭐⭐⭐ import -> default ON shown as a NUMBER field (not a checkbox) -> save -> close -> reopen -> attached at the saved value -> toggle -> save -> reopen again -> persisted', async () => {
    // ── 1. Import and save ──────────────────────────────────────────────
    mountFresh()
    await flush()
    await paste(TRUE_FIXTURE)
    fireEvent.click(screen.getByTestId('pine-use'))
    await settleFormula()

    expect(formulaField().value).toBe('showit ? close - 1 : 0 / 0')

    // ⛔ THIS IS `memberInputs`, NOT Track F's ParamControls — a plain
    // "Inputs you can change later" row with a NUMBER field, no checkbox, no
    // "Adjustable parameters" heading, and no `param-input-*` testid.
    expect(screen.getByText('Inputs you can change later')).toBeTruthy()
    expect(screen.queryByText('Adjustable parameters')).toBeNull()
    expect(screen.getByTestId('member-input-0')).toBeTruthy()
    expect(screen.getByLabelText('Input 1 name')).toHaveValue('showit')
    expect(screen.getByLabelText('Input 1 default')).toHaveValue(1)

    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: 'Direct Cond Bool Test' } })
    await settleFormula()
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }))
    await flush()

    const firstPost = H.requests.find((r) => r.method === 'POST' && r.url === '/api/user-definitions')
    expect(firstPost, 'the create POST never fired').toBeTruthy()
    const [defId, firstRow] = [...H.store.entries()][0]
    expect(firstRow.definition.compute.source).toBe('showit ? close - 1 : 0 / 0')
    expect(firstRow.definition.inputs).toContainEqual({ key: 'showit', type: 'int', label: 'Show It', default: 1 })

    // ── 2. Genuine unmount, then reopen through the real "Your formulas" door
    cleanup()
    mountFresh()
    await flushSwr()
    const savedRow = screen.getByText('Direct Cond Bool Test')
    const listRow = savedRow.closest('li')
    expect(listRow, '"Your formulas" did not render the saved row').toBeTruthy()
    fireEvent.click(within(listRow).getByRole('button', { name: /^Edit Direct Cond Bool Test$/i }))
    await settleFormula()

    expect(formulaField().value).toBe('showit ? close - 1 : 0 / 0')
    expect(screen.getByLabelText('Input 1 name')).toHaveValue('showit')
    expect(screen.getByLabelText('Input 1 default')).toHaveValue(1)

    // ── 3. Toggle: edit the default field from 1 to 0, then Save.
    fireEvent.change(screen.getByLabelText('Input 1 default'), { target: { value: '0' } })
    await settleFormula()
    // ⛔ THE FORMULA TEXT ITSELF DOES NOT CHANGE — unlike Track F's
    // astPath-locator mechanism, this one keeps the identifier symbolic;
    // `document.inputs[].default` is the knob, not the AST.
    expect(formulaField().value).toBe('showit ? close - 1 : 0 / 0')

    fireEvent.click(screen.getByRole('button', { name: /^save changes$/i }))
    await flush()

    const putReq = H.requests.find((r) => r.method === 'PUT')
    expect(putReq, 'the edit PUT never fired').toBeTruthy()
    const putBody = JSON.parse(putReq.body).definition
    expect(putBody.inputs).toContainEqual({ key: 'showit', type: 'int', label: 'Show It', default: 0 })
    expect(H.store.get(defId).definition.inputs).toContainEqual(
      { key: 'showit', type: 'int', label: 'Show It', default: 0 })

    // ── 4. Reload again and confirm the TOGGLE persisted, not just the
    //        create-time default. ─────────────────────────────────────────
    cleanup()
    mountFresh()
    await flushSwr()
    const savedRow2 = screen.getByText('Direct Cond Bool Test')
    fireEvent.click(within(savedRow2.closest('li')).getByRole('button', { name: /^Edit Direct Cond Bool Test$/i }))
    await settleFormula()
    expect(screen.getByLabelText('Input 1 default')).toHaveValue(0)
  })
})
