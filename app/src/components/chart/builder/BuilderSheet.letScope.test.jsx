// ⛔⛔ THE DECLARED-INPUT SCOPE REACHES THE `let` GATE, AND THE GATE'S POSITION
// REACHES THE MARK — the two defects W1b.5 was handed, pinned end to end.
//
// ─── (1) THE DOOR THREW AWAY WHERE IT REFUSED ───────────────────────────────
// `prepareSource` refuses with `{guard, error, line, column, token}` — all four,
// all in the member's own coordinates — and `pcf.js::READERS.native` kept only
// the guard and the sentence. Measured before the fix: `let a = 1\nlet a = 2\na`
// refuses at the SECOND binding (line 2, column 5 → offset 14), and with no
// position to forward a token search finds the FIRST at offset 4. A member got a
// red squiggle under correct code.
//
// ─── (2) THE POPUP WAS STRICTER THAN THE SAVE DOOR, OVER ONE GRAMMAR ────────
// `editor/completions.js::letBindings` hands `prepareSource` the declared-input
// scope, so the popup refused `let period = 5` beside a declared `period`
// (`let:shadow`). `readFormulaSource` handed it none, so the same text passed the
// text box AND `defSchema.validateAstCompute` — and the document SAVED with its
// declared knob inert: the pre-pass had rewritten every `period` to `(5)`, so
// turning the knob moved nothing. That is the stored defect `letPrepass.js`'s own
// docblock warns about, in the words it warns in.
//
// ⛔ THESE ARE WIRING RAILS, NOT GRAMMAR RAILS. `letPrepass.test.js` already pins
// that the grammar refuses WHEN HANDED A SCOPE. What can be silently dropped
// later is the HANDING IN — four links: the sheet → `FormulaField` →
// `evaluateFormula` → `readFormulaSource` → `READERS.native` → `prepareSource`.
// Every case below goes RED if any one of them stops passing it on.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import { SWRConfig } from 'swr'
import { Text } from '@codemirror/state'

import BuilderSheet from './BuilderSheet'
import { evaluateFormula, FORMULA_DEBOUNCE_MS } from './FormulaField'
import { BUILDER_INPUT_SCOPE } from './builderInputs'
import { toDiagnostics } from './editor/diagnostics'
import { readFormulaSource } from '../engine/ast/pcf'
import { prepareSource } from '../engine/ast/letPrepass'
import { validateUserDefinitions } from '../engine/nativeRegistry'
import { parseFormula, astHash } from '../engine/ast/parse'
import { AuthContext } from '../../../context/AuthContext'

const doc = (s) => Text.of(s.split('\n'))

// The duplicate-binding source the task measured, and the two offsets it names.
const DUP = 'let a = 1\nlet a = 2\na'
const SECOND_A = DUP.indexOf('a', DUP.indexOf('\n'))   // 14 — the binding that refuses
const FIRST_A = DUP.indexOf('a')                       // 4  — the one a token search finds

function stubFetch() {
  global.fetch = vi.fn(async (url, init = {}) => {
    const method = init.method || 'GET'
    if (method === 'GET') return { ok: true, status: 200, json: async () => ({ definitions: [] }) }
    return { ok: true, status: 200, json: async () => ({ def_id: 'u_aaaaaaaaaaaa', version: 1, rev: 1 }) }
  })
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

beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }); stubFetch() })
afterEach(() => { vi.useRealTimers(); cleanup(); vi.restoreAllMocks() })

describe('(1) the read door forwards WHERE the pre-pass refused', () => {
  it('🔴 a `let:*` refusal carries the pre-pass\'s own line, column and token', () => {
    // ⛔ DERIVED FROM THE GRAMMAR ITSELF, never retyped: the door must report
    // what `prepareSource` reported, so the expectation is `prepareSource`'s
    // answer. A hand-typed `line: 2` would still pass if BOTH moved together.
    const pre = prepareSource(DUP)
    expect(pre, 'the case must actually refuse, or this measures nothing')
      .toMatchObject({ ok: false, guard: 'let:shadow' })
    const { result } = readFormulaSource(DUP)
    expect(result.ok).toBe(false)
    expect(result.guard).toBe(pre.guard)
    expect(result.error).toBe(pre.error)
    expect(result.line).toBe(pre.line)
    expect(result.column).toBe(pre.column)
    expect(result.token).toBe(pre.token)
  })

  it('…and `evaluateFormula` hands the position on rather than dropping it again', () => {
    const ev = evaluateFormula(DUP, BUILDER_INPUT_SCOPE)
    expect(ev.ok).toBe(false)
    expect(ev.guard).toBe('let:shadow')
    expect(ev.line).toBe(2)
    expect(ev.column).toBe(5)
    expect(ev.token).toBe('a')
  })

  it('⛔ THE MEMBER-FACING OUTCOME: the mark lands on the SECOND binding, not the first', () => {
    // ⚠️ AN OUTCOME RAIL, NOT A RAIL ON THE FORWARD — say which it is. This
    // case already passes: `editor/diagnostics.js` carries W1a.4's stopgap,
    // which re-asks `prepareSource` itself and uses the answer only when the
    // guard still matches. The forward is what makes the stopgap unnecessary;
    // this is what must stay true either way, and it is the sentence the task
    // was raised on.
    const src = DUP
    const d = toDiagnostics(doc(src), evaluateFormula(src, BUILDER_INPUT_SCOPE))
    expect(d).toHaveLength(1)
    expect(d[0].from, 'the refusal is at the second binding').toBe(SECOND_A)
    expect(d[0].from, 'a token search would have found the first').not.toBe(FIRST_A)
    expect(d[0].to).toBe(SECOND_A + 1)
  })

  it('🔴 …and the forward is what places an INPUT-SHADOW refusal, where the stopgap cannot fire', () => {
    // ⭐ THE ONE GUARD FAMILY THE STOPGAP IS STRUCTURALLY BLIND TO. It re-asks
    // `prepareSource` with NO scope on purpose ("handing a scope in here would
    // let this module see a `let:shadow` the refusal being placed never had"),
    // so for an input shadow its own question answers `ok` and path 1 is out.
    // The position therefore has to have RIDDEN ON the refusal.
    const src = 'let span = 3\nlet period = 5\nsma(close, period) * span'
    const scope = { ...BUILDER_INPUT_SCOPE, period: true }
    expect(prepareSource(src).ok, 'scope-less, this source is fine — so the stopgap cannot fire').toBe(true)
    const ev = evaluateFormula(src, scope)
    expect(ev.guard, 'the scope must reach the grammar or this measures nothing').toBe('let:shadow')
    expect(ev.line, 'the door measured line 2 and said so').toBe(2)
    expect(ev.column).toBe(5)
    const d = toDiagnostics(doc(src), ev)
    expect(d[0].from, 'the binding on line 2 is the one refused').toBe(src.indexOf('period'))
  })
})

describe('(2) the save door reads the same grammar the popup does', () => {
  it('🔴 a binding that shadows a DECLARED input is refused at the read door', () => {
    const src = 'let period = 5\nsma(close, period)'
    // ⛔ BOTH DIRECTIONS ON ONE SOURCE. Without the scope the door must still
    // accept — that is the contract `letPrepass` documents ("absent is not
    // empty") and the reason the text box mid-type does not refuse a knob it
    // cannot see. WITH the scope it must refuse.
    expect(readFormulaSource(src).result.ok, 'no scope ⇒ no input-shadow gate').toBe(true)
    const refused = readFormulaSource(src, 'auto', { period: true }).result
    expect(refused.ok).toBe(false)
    expect(refused.guard).toBe('let:shadow')
    expect(refused.error).toContain('period')
    expect(refused.error).toContain('declared input')
  })

  it('⛔ …and the DOCUMENT can no longer be stored with its knob inert', () => {
    // The exact document `letPrepass.js`'s docblock describes: `period` is
    // declared, `let period = 5` rewrites every use of it, the tree agrees with
    // the source, and it USED TO SAVE. `validateUserDefinitions` is the shipped
    // door — nothing here builds a second validator.
    const ast = parseFormula('sma(close, 5)').ast
    const def = {
      schemaVersion: 1, id: 'u_0123456789ab', version: 1,
      compute: { kind: 'ast', fn: astHash(ast), rev: 1, ast, source: 'let period = 5\nsma(close, period)' },
      meta: {
        name: 'Inert knob', shortName: 'Inert', category: 'Custom', description: 'x',
        tags: ['custom'], tier: 'premium', repaint: 'non-repainting', freshness: 'live',
      },
      placement: { target: 'pane', pane: { height: 0.15 } },
      inputs: [
        { key: 'color', type: 'color', label: 'Color', default: '#c9a84c' },
        { key: 'lineWidth', type: 'int', label: 'Line width', default: 1, min: 1, max: 4, step: 1 },
        { key: 'period', type: 'int', label: 'Period', default: 5, min: 1, max: 500 },
      ],
      plots: [{ key: 'value', label: 'Inert', style: 'line', color: '$color', width: '$lineWidth', role: 'primary', legend: { decimals: 2 } }],
    }
    const { errors } = validateUserDefinitions([def])
    expect(errors.join('\n')).toMatch(/declared input/)

    // ⛔ THE CONTROL. The same document with the binding renamed is ACCEPTED, so
    // the refusal above is the shadow and not the `let` grammar itself.
    const ok = JSON.parse(JSON.stringify(def))
    ok.compute.source = 'let span = 5\nsma(close, span)'
    expect(validateUserDefinitions([ok]).errors).toEqual([])
  })

  it('🔴 THE WIRING: the SHEET hands its own declared inputs to the gate', async () => {
    // ⛔⛔ THIS IS THE CASE THE CONTROLLER AMENDMENT ASKED FOR, AND IT IS ABOUT
    // THE HANDING IN, NOT THE GRAMMAR. Nothing is stubbed: the member declares
    // `period` on the real form, types the real shadowing source, and the
    // refusal has to travel the whole chain to reach the chip.
    mount()
    await act(async () => { fireEvent.click(screen.getByTestId('add-input')) })
    await act(async () => { fireEvent.change(screen.getByLabelText('Input 1 name'), { target: { value: 'period' } }) })
    await type(screen.getByLabelText('Formula'), 'let period = 5\nsma(close, period)')
    await act(async () => { fireEvent.change(screen.getByLabelText(/^Name/i), { target: { value: 'x' } }) })

    const chip = screen.getByTestId('formula-error')
    expect(chip.getAttribute('data-guard')).toBe('let:shadow')
    expect(chip.textContent).toContain('declared input')
    expect(screen.getByRole('button', { name: /^Sav/ })).toBeDisabled()
  })

  it('⛔ …and the CONTROL: with no such input declared, the same text saves', async () => {
    // Without this the case above would pass against a sheet that refused every
    // `let` source, which is the opposite defect.
    mount()
    await type(screen.getByLabelText('Formula'), 'let period = 5\nsma(close, period)')
    await act(async () => { fireEvent.change(screen.getByLabelText(/^Name/i), { target: { value: 'x' } }) })
    expect(screen.queryByTestId('formula-error')).toBeNull()
    expect(screen.getByRole('button', { name: /^Sav/ })).not.toBeDisabled()
  })
})
