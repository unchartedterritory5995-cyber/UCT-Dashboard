// app/src/components/chart/engine/__truth__/p6.calculator.truth.test.js
//
// ─── OVERNIGHT E — A POSITION-SIZING CALCULATOR, COMPOSED FROM WHAT EXISTS ─────────
//
// No calculator engine: member INPUTS (def.inputs, edited per instance in the settings
// Inspector), the formula language's own arithmetic (abs, floor), hidden outputs, and
// the authored chart TABLE (overnight D). Informational only — nothing places an order.

import { describe, it, expect } from 'vitest'
import { parseFormula } from '../ast/parse'
import { interpret } from '../ast/interpret'
import { bindObjectProgram } from '../ast/objectProgram'
import { evaluateObjects } from '../objectRuntime'
import { toRenderState } from '../objectRenderState'
import { applyPatch, applyTurn, openAuthoringState } from '../../builder/authoring'
import { readback } from '../../builder/authoring/readback'
import { validatePatchShape } from '../../builder/authoring/patchValidate'
import { conversationEditability } from '../../builder/authoring/memberWords'

const P = (src, inputs = []) => { const r = parseFormula(src, { inputs }); if (!r.ok) throw new Error(`${src}: ${JSON.stringify(r)}`); return r.ast }
const C = 'uct.authoring.patch/1'
const env = (rev, ops) => ({ contract: C, baseRevision: rev, ops, assumptions: [] })
const GATE = { tf: 'D', symbol: 'AAPL' }
const KEYS = ['account', 'riskPct', 'entry', 'stop']
const BARS = Array.from({ length: 30 }, (_, i) => ({ t: 1_700_000_000 + i * 86400, o: 50, h: 51, l: 49, c: 50, v: 1000 }))

const INPUTS = [
  { key: 'account', label: 'Account size', default: 0, min: 0 },
  { key: 'riskPct', label: 'Risk %', default: 0, min: 0, max: 100, step: 0.25 },
  { key: 'entry', label: 'Entry price', default: 0, min: 0 },
  { key: 'stop', label: 'Stop price', default: 0, min: 0 },
]
const F = {
  riskDollars: 'account * riskPct / 100',
  riskPerShare: 'abs(entry - stop)',
  shares: 'floor(account * riskPct / 100 / abs(entry - stop))',
  positionValue: 'floor(account * riskPct / 100 / abs(entry - stop)) * entry',
  stopPct: 'abs(entry - stop) / entry * 100',
}
const CREATE = [
  { op: 'create', name: 'Position size', placement: 'price', inputs: INPUTS,
    outputs: Object.entries(F).map(([key, src]) => ({ key, tree: P(src, KEYS), hidden: true })) },
  { op: 'set_table', position: 'top_right', cells: [
    { row: 0, col: 0, text: 'Risk $' }, { row: 0, col: 1, output: 'riskDollars', format: 'decimal2', prefix: '$' },
    { row: 1, col: 0, text: 'Risk / share' }, { row: 1, col: 1, output: 'riskPerShare', format: 'decimal2', prefix: '$' },
    { row: 2, col: 0, text: 'Shares' }, { row: 2, col: 1, output: 'shares', format: 'integer' },
    { row: 3, col: 0, text: 'Position' }, { row: 3, col: 1, output: 'positionValue', format: 'decimal2', prefix: '$' },
    { row: 4, col: 0, text: 'Stop distance' }, { row: 4, col: 1, output: 'stopPct', format: 'decimal2', suffix: '%' }] },
]

/** The table the chart draws for these input VALUES (the instance's settings). */
function table(def, overrides) {
  // the chart merges the instance's values over the declared defaults (nativeRegistry.resolveInputs)
  const values = { ...Object.fromEntries(def.inputs.map((x) => [x.key, x.default])), ...overrides }
  const bound = bindObjectProgram(def.objects, (i) => i)
  const cols = def.objects.trees.map((t) => Array.from(interpret(t, BARS, values, undefined, undefined, { tf: 'D', unknownPropagates: true })))
  const res = evaluateObjects(bound, { barCount: BARS.length, readNode: (n, b) => (cols[n] ? cols[n][b] : NaN), readTime: (i) => BARS[i].t })
  return toRenderState(res.live, { bars: BARS }).tables[0].cells.filter((c) => c.col === 1).map((c) => c.text)
}

describe('OVERNIGHT E — a position-sizing calculator from inputs + formulas + the table', () => {
  const r = applyPatch(null, env(0, CREATE), { gateCtx: GATE })

  it('ASKED "a position-sizing calculator in the top-right"; DID: four member settings (all 0 = not set), five hidden outputs, a table; the read-back asks the member to set them (EXACT / NO ASSUMED ACCOUNT)', () => {
    expect(validatePatchShape(env(0, CREATE)).ok).toBe(true)
    expect(r.status, JSON.stringify(r.errors)).toBe('applied')
    expect(r.definition.inputs.filter((x) => KEYS.includes(x.key)).map((x) => [x.key, x.type, x.default])).toEqual(
      [['account', 'float', 0], ['riskPct', 'float', 0], ['entry', 'float', 0], ['stop', 'float', 0]])
    const lines = readback(r.definition, {}, GATE).lines
    expect(lines).toContain('Setting "Account size" = 0 (not set yet) — change it in the indicator\'s settings')
    // with nothing set, every computed cell is a dash, not a confident 0 shares
    expect(table(r.definition, {})).toEqual(['$0.00', '$0.00', '—', '—', '—'])
  })

  it('THE MATHS: $100,000 account, 1% risk, long entry 50, stop 48 → $1,000 risk, $2/share, 500 shares, $25,000, 4% (EXACT)', () => {
    expect(table(r.definition, { account: 100000, riskPct: 1, entry: 50, stop: 48 })).toEqual(['$1000.00', '$2.00', '500', '$25000.00', '4.00%'])
  })

  it('SHORT (stop above entry) sizes the same way; fractional shares floor down (EXACT)', () => {
    expect(table(r.definition, { account: 25000, riskPct: 0.5, entry: 40, stop: 41.5 })).toEqual(['$125.00', '$1.50', '83', '$3320.00', '3.75%'])
  })

  it('ZERO STOP DISTANCE (entry = stop) is a dash, never infinite shares (UNKNOWN)', () => {
    expect(table(r.definition, { account: 50000, riskPct: 1, entry: 50, stop: 50 })).toEqual(['$500.00', '$0.00', '—', '—', '0.00%'])
  })

  it('EDIT: rename a setting and give risk a 2% default; a setting a formula reads cannot be removed; SAVE / REOPEN keeps all of it (EXACT / REFUSAL)', () => {
    const t = applyPatch(r.definition, env(0, [{ op: 'set_input', input: { key: 'riskPct', label: 'Risk per trade %', default: 2, min: 0, max: 100 } }]), { gateCtx: GATE })
    expect(t.status, JSON.stringify(t.errors)).toBe('applied')
    expect(t.definition.inputs.find((x) => x.key === 'riskPct')).toMatchObject({ label: 'Risk per trade %', default: 2 })
    expect(applyPatch(r.definition, env(0, [{ op: 'remove_input', key: 'stop' }]), { gateCtx: GATE }).errors[0].code).toBe('input:referenced')
    expect(applyPatch(r.definition, env(0, [{ op: 'set_input', input: { key: 'close', label: 'x', default: 0 } }]), { gateCtx: GATE }).errors[0].code).toBe('input:name')
    const saved = { ...t.definition, id: 'u_0123456789ab', version: 3 }
    expect(conversationEditability(saved).editable).toBe(true)
    const st = openAuthoringState(saved, { defId: saved.id, version: 3, lineage: 'auth_00000calcul' })
    const u = applyTurn(st, env(st.revision, [{ op: 'set_table', position: 'bottom_right', cells: CREATE[1].cells }]), { gateCtx: GATE })
    expect(u.result.status, JSON.stringify(u.result.errors)).toBe('applied')
    expect(u.state.working.inputs.find((x) => x.key === 'riskPct').default).toBe(2)
    expect(u.state.working.objects.ops[0].props.position.value).toBe('bottom_right')
  })
})
