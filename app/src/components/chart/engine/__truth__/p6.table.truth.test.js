// app/src/components/chart/engine/__truth__/p6.table.truth.test.js
//
// ─── OVERNIGHT D — A CHART TABLE, AUTHORED, ON THE EXISTING TABLE RENDERER ────────
//
// "Create a table in the top-right showing ADR and RVOL": two hidden outputs (the maths,
// UCT's own functions) and `set_table` — which writes a C3B object program that the
// existing runtime (`objectRuntime.evaluateObjects` → `toRenderState`) and DOM renderer
// (`objectTableDom.js`) already draw. Nothing here re-implements a table.

import { describe, it, expect } from 'vitest'
import { parseFormula } from '../ast/parse'
import { interpret } from '../ast/interpret'
import { bindObjectProgram, assertObjectProgram } from '../ast/objectProgram'
import { evaluateObjects } from '../objectRuntime'
import { toRenderState } from '../objectRenderState'
import { applyPatch, applyTurn, openAuthoringState } from '../../builder/authoring'
import { readback } from '../../builder/authoring/readback'
import { compactView } from '../../builder/authoring/compactView'
import { validatePatchShape } from '../../builder/authoring/patchValidate'
import { conversationEditability } from '../../builder/authoring/memberWords'

const P = (src) => { const r = parseFormula(src); if (!r.ok) throw new Error(src); return r.ast }
const C = 'uct.authoring.patch/1'
const env = (rev, ops) => ({ contract: C, baseRevision: rev, ops, assumptions: [] })
const GATE = { tf: 'D', symbol: 'AAPL' }

const BARS = Array.from({ length: 120 }, (_, i) => ({
  t: 1_700_000_000 + i * 86400, o: 100 + i * 0.1, h: 103 + i * 0.1, l: 99 + i * 0.1, c: 101 + i * 0.1,
  v: 1_000_000 + (i % 7) * 100_000,
}))

/** Draw a definition's object program over bars, the way the chart's object lane does. */
function render(def, bars = BARS) {
  const program = def.objects
  assertObjectProgram(program)
  const bound = bindObjectProgram(program, (i) => i)
  const cols = program.trees.map((tree) => Array.from(interpret(tree, bars, {}, undefined, undefined, { tf: 'D', unknownPropagates: true })))
  const res = evaluateObjects(bound, { barCount: bars.length, readNode: (n, b) => (cols[n] ? cols[n][b] : NaN), readTime: (i) => bars[i].t })
  return toRenderState(res.live, { bars })
}

const ADR = 'sma((high / low - 1) * 100, 20)'
const RVOL = 'volume / sma(volume, 50)'
const CREATE = [
  { op: 'create', name: 'ADR and RVOL', placement: 'price', outputs: [
    { key: 'adr', label: 'ADR %', tree: P(ADR), hidden: true },
    { key: 'rvol', label: 'RVOL', tree: P(RVOL), hidden: true }] },
  { op: 'set_table', position: 'top_right', cells: [
    { row: 0, col: 0, text: 'ADR', bold: true }, { row: 0, col: 1, output: 'adr', format: 'decimal2', suffix: '%' },
    { row: 1, col: 0, text: 'RVOL', bold: true }, { row: 1, col: 1, output: 'rvol', format: 'decimal2', suffix: 'x' }] },
]

describe('OVERNIGHT D — set_table on the existing C3B table renderer', () => {
  const r = applyPatch(null, env(0, CREATE), { gateCtx: GATE })

  it('ASKED "a table in the top-right showing ADR and RVOL"; DID: a valid native object program (no Pine version), schema-valid ops, read back cell by cell (EXACT)', () => {
    expect(validatePatchShape(env(0, CREATE)).ok).toBe(true)
    expect(r.status, JSON.stringify(r.errors)).toBe('applied')
    const prog = r.definition.objects
    expect(prog.pineVersion).toBeUndefined()
    expect(prog.ops[0]).toMatchObject({ k: 'create', family: 'table', props: { position: { value: 'top_right' }, columns: { value: 2 }, rows: { value: 2 } } })
    const lines = readback(r.definition, {}, GATE).lines
    expect(lines).toContain('Look: a table in the top right of the chart (a value with no answer yet shows as a dash)')
    expect(lines).toContain('Look: table row 1: "ADR" | [latest ADR, 2 decimals]%')
    expect(lines).toContain('Name: ADR · RVOL') // STABILIZATION 3 — a table-only indicator is named by its table
    expect(lines).toContain('Look: table row 2: "RVOL" | [latest RVOL, 2 decimals]x')
  })

  it('RENDERED through the real object runtime: the latest values, formatted, in the right cells (EXACT)', () => {
    const state = render(r.definition)
    expect(state.tables).toHaveLength(1)
    const cells = state.tables[0].cells
    expect(cells.map((c) => `${c.col},${c.row}:${c.text}`)).toEqual([
      '0,0:ADR', expect.stringMatching(/^1,0:\d+\.\d\d%$/), '0,1:RVOL', expect.stringMatching(/^1,1:\d+\.\d\dx$/)])
    // the number is the output's own latest value
    const adr = Array.from(interpret(P(ADR), BARS, {}))
    expect(cells[1].text).toBe(`${adr[adr.length - 1].toFixed(2)}%`)
    expect(cells[0].text_formatting).toBe('bold')
  })

  it('UNKNOWN shows a dash, never "NaN" (too little history for a 50-bar average) (UNKNOWN)', () => {
    const state = render(r.definition, BARS.slice(0, 30))
    expect(state.tables[0].cells.find((c) => c.row === 1 && c.col === 1).text).toBe('—')
  })

  it('EDIT the maths: ADR over 10 days — the table follows in the same patch; the view round-trips the spec (EXACT)', () => {
    const v = compactView(r.definition, { revision: 1 }, GATE)
    expect(v.definition.table).toEqual({ position: 'top_right', cells: CREATE[1].cells })
    const slot = v.definition.outputs.find((o) => o.key === 'adr').slots.find((s) => s.value === 20)
    const t = applyPatch(r.definition, env(0, [{ op: 'set_slot', slot: slot.id, value: 10 }]), { gateCtx: GATE })
    expect(t.status, JSON.stringify(t.errors)).toBe('applied')
    const adr10 = Array.from(interpret(P('sma((high / low - 1) * 100, 10)'), BARS, {}))
    expect(render(t.definition).tables[0].cells[1].text).toBe(`${adr10[adr10.length - 1].toFixed(2)}%`)
    expect(compactView(t.definition, { revision: 2 }, GATE).definition.table.cells[1]).toMatchObject({ output: 'adr' })
  })

  it('MOVE / REPLACE / REMOVE, and an output a cell shows cannot be removed under it (EXACT / REFUSAL)', () => {
    const moved = applyPatch(r.definition, env(0, [{ op: 'set_table', position: 'bottom_left', cells: CREATE[1].cells }]), { gateCtx: GATE })
    expect(moved.definition.objects.ops[0].props.position.value).toBe('bottom_left')
    const blocked = applyPatch(r.definition, env(0, [{ op: 'remove_output', output: 'rvol' }]), { gateCtx: GATE })
    expect(blocked.errors[0].code).toBe('output:referenced')
    const gone = applyPatch(r.definition, env(0, [{ op: 'remove_table' }]), { gateCtx: GATE })
    expect(gone.status).toBe('applied')
    expect(gone.definition.objects).toBeUndefined()
    expect(applyPatch(r.definition, env(0, [{ op: 'set_table', cells: [{ row: 0, col: 0, output: 'nope' }] }]), { gateCtx: GATE }).errors[0].code).toBe('table:invalid')
  })

  it('SAVE / REOPEN / EDIT: the stored indicator reopens for conversation and keeps its table (EXACT)', () => {
    const saved = { ...r.definition, id: 'u_0123456789ab', version: 2 }
    expect(conversationEditability(saved).editable).toBe(true)
    const st = openAuthoringState(saved, { defId: saved.id, version: 2, lineage: 'auth_000000table' })
    const t = applyTurn(st, env(st.revision, [{ op: 'set_table', cells: [...CREATE[1].cells, { row: 2, col: 0, text: 'Source: UCT' }] }]), { gateCtx: GATE })
    expect(t.result.status, JSON.stringify(t.result.errors)).toBe('applied')
    expect(render(t.state.working).tables[0].cells).toHaveLength(5)
  })

  it('A YES/NO output shows Yes / No (a condition cell) (EXACT)', () => {
    const t = applyPatch(r.definition, env(0, [
      { op: 'add_output', key: 'busy', label: 'Busy', tree: P('volume > sma(volume, 50)'), hidden: true },
      { op: 'set_table', cells: [{ row: 0, col: 0, text: 'Busy?' }, { row: 0, col: 1, output: 'busy' }] }]), { gateCtx: GATE })
    expect(t.status, JSON.stringify(t.errors)).toBe('applied')
    expect(['Yes', 'No']).toContain(render(t.definition).tables[0].cells[1].text)
  })
})
