// ⭐⭐ THE MEMBER'S OWN INPUTS, DRIVEN THROUGH THE REAL SHEET.
//
// The engine has taken a member-declared input for a while — `memberInputs.test.js`
// pins that. What did not exist was any way for a member to DECLARE one: the
// builder wrote a frozen `color`/`lineWidth` pair, so an authored indicator had
// its period baked in as a literal and was one instance of itself forever.
//
// ⛔ THIS FILE MOCKS NOTHING ON THE PATH UNDER TEST. A component test that
// rendered the input rows and asserted they appear would pass with the form
// wired to nothing — the exact blindness that let eight features ship "built,
// tested, green, connected to nothing" on 2026-08-08. Every assertion below goes
// through the real form to the real document.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import { SWRConfig } from 'swr'

import BuilderSheet, { buildDefinition } from './BuilderSheet'
import { BUILDER_INPUTS } from './builderInputs'
import { FORMULA_DEBOUNCE_MS } from './FormulaField'
import { AuthContext } from '../../../context/AuthContext'

function mount() {
  const writes = []
  const utils = render(
    <AuthContext.Provider value={{ user: { id: 7 }, isPaid: true, loading: false }}>
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, revalidateOnFocus: false }}>
        <BuilderSheet open onClose={() => {}} onSaved={() => {}} settings={null}
          onChange={(next) => writes.push(next)} />
      </SWRConfig>
    </AuthContext.Provider>,
  )
  return { ...utils, writes }
}

const field = () => screen.getByLabelText('Formula')
const addInput = () => screen.getByTestId('add-input')
const keyBox = (i = 0) => screen.getByLabelText(`Input ${i + 1} name`)

async function typeFormula(text) {
  await act(async () => { fireEvent.change(field(), { target: { value: text } }) })
  await act(async () => { vi.advanceTimersByTime(FORMULA_DEBOUNCE_MS + 10) })
}

beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }) })
afterEach(() => { vi.useRealTimers(); cleanup() })

describe('a member can declare an input and use it in the formula', () => {
  it('🔴 an added input makes its name RESOLVE — the formula stops refusing', async () => {
    // ⛔ THE WIRE, MEASURED IN BOTH DIRECTIONS ON ONE FORMULA. Before the input
    // exists `period` is an undeclared name and the surface refuses it; after,
    // the same text is admissible. A form rendered but not wired to the scope
    // passes nothing here.
    mount()
    await typeFormula('close * period')
    expect(screen.queryByTestId('readback'), 'undeclared name must refuse').toBeNull()

    await act(async () => { fireEvent.click(addInput()) })
    await act(async () => { fireEvent.change(keyBox(), { target: { value: 'period' } }) })
    // ⚠️ A DIFFERENT FORMULA ON PURPOSE. Re-firing `change` with the text already
    // in a controlled input produces no event, so re-typing the same string would
    // prove nothing about the scope — it would prove React skipped the update.
    await typeFormula('close + period')

    expect(screen.getByTestId('readback').textContent).toContain('period')
  })

  it('⛔ a key mid-typed WITH A SPACE does not split into two phantom names (FIX ROUND 1, MINOR 6)', async () => {
    // ⛔⛔ THE KEY BOX ONLY `.trim()`s — nothing stops an INTERIOR space while
    // the key is still invalid. `inputKeySig` used to join every declared name
    // with `' '` and split the same string back apart to rebuild the scope, so
    // a key typed `my period` — invalid (`inputKeyProblem`'s regex refuses a
    // space; Save stays shut on it) but still LIVE in the scope this render
    // hands the box — silently declared TWO names, `my` and `period`, through
    // that round trip. `period` is a name a LOT of authored indicators want.
    // The delimiter is now `'\n'`, which a single-line `<input>` cannot hold —
    // this is a serialisation fix, not a second legality check; the regex in
    // `inputKeyProblem` stays the one place a key's legality is decided.
    mount()
    await act(async () => { fireEvent.click(addInput()) })
    await act(async () => { fireEvent.change(keyBox(), { target: { value: 'my period' } }) })
    await typeFormula('close * period')
    expect(screen.queryByTestId('readback'),
      '`period` must stay undeclared — the key typed is `my period`, ONE name, not two').toBeNull()
  })

  it('⛔ a name the engine already computes is REFUSED, with the reason', async () => {
    // `close` as an input would be shadowed by the real series: the formula
    // would parse, lint, save and draw the wrong thing. Silent, so it refuses.
    mount()
    await act(async () => { fireEvent.click(addInput()) })
    await act(async () => { fireEvent.change(keyBox(), { target: { value: 'close' } }) })

    const problem = screen.getByTestId('member-input-problem-0')
    expect(problem.textContent).toContain('close')
    expect(problem.textContent).toContain('already a name this engine computes')
  })

  it('…and an invalid key SHUTS THE SAVE BUTTON, not just its own row', async () => {
    // ⛔ A row that reports a problem while the button stays live is a dead
    // control — the save would return silently and the member would not know why.
    mount()
    await typeFormula('close * 2')
    await act(async () => { fireEvent.click(addInput()) })
    await act(async () => { fireEvent.change(keyBox(), { target: { value: 'close' } }) })
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/^Name/i), { target: { value: 'Tunable' } })
    })
    expect(screen.getByRole('button', { name: /^Sav/ })).toBeDisabled()
  })
})

describe('the saved document carries what the member declared', () => {
  it('🔴 buildDefinition writes the member rows BESIDE the chrome ones', () => {
    const period = { key: 'period', type: 'int', label: 'Period', default: 20, min: 4, max: 200 }
    const doc = buildDefinition({
      defId: 'd1', name: 'Tunable', source: 'close * period',
      ast: { type: 'op', name: '*', args: [{ type: 'series', name: 'close' }, { type: 'series', name: 'period' }] },
      mode: 'non-repainting', readback: 'x',
      inputs: [...BUILDER_INPUTS, period],
    })
    const keys = doc.inputs.map((spec) => spec.key)
    expect(keys).toContain('period')
    // ⛔ The chrome inputs are not replaced by the member's — every definition
    // still carries them, and dropping one would strip colour off the plot.
    for (const spec of BUILDER_INPUTS) expect(keys).toContain(spec.key)
  })

  it('⛔ …and the FRESHNESS scope reads that same list, not the frozen pair', () => {
    // 🔴 THE SECOND-AUTHORITY TRAP THIS FEATURE OPENED. `buildDefinition` derived
    // its freshness scope from `BUILDER_INPUTS` separately. The moment a member
    // list exists, a formula referencing `period` would be badged off a scope the
    // saved document does not carry — a badge computed from a different document
    // than the one stored. Proved by a tree only the member's input can resolve.
    const doc = buildDefinition({
      defId: 'd2', name: 'T', source: 'close * period',
      ast: { type: 'op', name: '*', args: [{ type: 'series', name: 'close' }, { type: 'series', name: 'period' }] },
      mode: 'non-repainting', readback: 'x',
      inputs: [...BUILDER_INPUTS, { key: 'period', type: 'int', label: 'P', default: 20 }],
    })
    // A freshness verdict at all means the scope resolved `period`; an unresolved
    // name is what the un-threaded version produced.
    expect(doc.meta.freshness).toBeTruthy()
    expect(doc.meta.freshness).not.toBe('unknown')
  })

  it('the default with NO member inputs is unchanged — nothing already saved moves', () => {
    const doc = buildDefinition({
      defId: 'd3', name: 'Plain', source: 'close',
      ast: { type: 'series', name: 'close' }, mode: 'non-repainting', readback: 'x',
    })
    expect(doc.inputs.map((s) => s.key).sort()).toEqual(BUILDER_INPUTS.map((s) => s.key).sort())
  })
})
