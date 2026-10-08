// OVERNIGHT 4 — a name the MEMBER gave is kept; an automatic name still follows the maths.
//
// ⚰️ THE DEFECT: `create` always took the derived name, so "an EMA 20 called My Trend"
// was saved as "EMA 20" unless the model ALSO emitted `rename_definition` — and the
// prompt never asked it to. The fix reads the member's own words (`memberWords`) and
// only an explicit naming cue or a quoted phrase counts, so the P2 defect ("Add a 20
// EMA" → "make it 50" kept a lying "EMA 20") stays fixed.
import { describe, it, expect } from 'vitest'
import { parseFormula } from '../ast/parse'
import { applyPatch, applyTurn, openAuthoringState } from '../../builder/authoring'
import { memberNamePhrases } from '../../builder/authoring/derivedName'

const P = (src) => { const r = parseFormula(src); if (!r.ok) throw new Error(src); return r.ast }
const env = (rev, ops) => ({ contract: 'uct.authoring.patch/1', baseRevision: rev, ops, assumptions: [] })
const GATE = { tf: 'D', symbol: 'AAPL' }
const create = (name, label) => env(0, [{ op: 'create', name,
  outputs: [{ key: 'value', tree: P('ema(close, 20)') }, { key: 'slow', ...(label ? { label } : {}), tree: P('ema(close, 50)') }] }])
const to21 = env(1, [{ op: 'set_output_tree', output: 'value', tree: P('ema(close, 21)') }])

describe('member names survive; automatic names follow the maths', () => {
  it('reads only explicit naming cues and quoted phrases', () => {
    expect([...memberNamePhrases('Create an EMA 20 called My Trend')]).toEqual(['my trend'])
    expect([...memberNamePhrases('Build me a calculator, name it "Position size".')]).toEqual(['position size'])
    expect([...memberNamePhrases('Add a 20 EMA')]).toEqual([])
    expect([...memberNamePhrases('Make every inside daily candle black.')]).toEqual([])
  })

  it('ASKED "an EMA 20 called My Trend" (name only on create) → KEPT, and still kept after "make it 21"', () => {
    const words = 'Add EMA 20 and EMA 50, call it My Trend'
    const r = applyPatch(null, create('My Trend'), { gateCtx: GATE, memberWords: words })
    expect(r.ok).toBe(true)
    expect(r.definition.meta.name).toBe('My Trend')
    const t = applyPatch(r.definition, to21, { gateCtx: GATE, revision: 1 })
    expect(t.definition.meta.name).toBe('My Trend')
  })

  it('no member name → the derived name, which follows the maths (the P2 rule is unchanged)', () => {
    const r = applyPatch(null, create('20 EMA'), { gateCtx: GATE, memberWords: 'Add a 20 EMA and a 50 EMA' })
    expect(r.definition.meta.name).toBe('EMA 20 · EMA 50')
    const t = applyPatch(r.definition, to21, { gateCtx: GATE, revision: 1 })
    expect(t.definition.meta.name).toBe('EMA 21 · EMA 50')
  })

  it('a model-invented name the member never said is still replaced', () => {
    const r = applyPatch(null, create('Trend Ribbon'), { gateCtx: GATE, memberWords: 'Add EMA 20 and EMA 50' })
    expect(r.definition.meta.name).toBe('EMA 20 · EMA 50')
  })

  it('an output label the member named is kept; one the model invented follows the maths', () => {
    const kept = applyPatch(null, create('x', 'Slow line'), { gateCtx: GATE, memberWords: 'EMA 20 and an EMA 50 labelled "Slow line"' })
    expect(kept.definition.plots.find((p) => p.key === 'slow').label).toBe('Slow line')
    const derived = applyPatch(null, create('x', 'Slow line'), { gateCtx: GATE, memberWords: 'EMA 20 and EMA 50' })
    expect(derived.definition.plots.find((p) => p.key === 'slow').label).toBe('EMA 50')
  })

  it('applyTurn carries the member words through (the conversation door)', () => {
    const s = openAuthoringState(null)
    const out = applyTurn(s, create('My Trend'), { gateCtx: GATE, memberWords: 'two EMAs named My Trend' })
    expect(out.state.working.meta.name).toBe('My Trend')
    const none = applyTurn(s, create('My Trend'), { gateCtx: GATE })
    expect(none.state.working.meta.name).toBe('EMA 20 · EMA 50')
  })
})
