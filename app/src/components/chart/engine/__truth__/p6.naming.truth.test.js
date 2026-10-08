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
import { memberNamePhrases, derivedDefName, memberCueNames } from '../../builder/authoring/derivedName'
import { distinctNotUnderstood } from '../../builder/authoring/converseClient'

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

  it('⚰️ PROD 2026-10-08: a HIDDEN first output that is NOT primary keeps its OWN name (the RSI was stored as "EMA 20")', () => {
    const turn = env(0, [
      { op: 'create', name: 'RSI & EMA Table', placement: 'price', primary: 'ema20', outputs: [
        { key: 'rsi14', label: 'RSI 14', tree: P('rsi(close, 14)'), hidden: true },
        { key: 'ema20', label: 'EMA 20', tree: P('ema(close, 20)') }] },
      { op: 'set_table', position: 'top_right', cells: [
        { row: 0, col: 0, text: 'RSI 14' }, { row: 0, col: 1, output: 'rsi14', format: 'decimal2' },
        { row: 1, col: 0, text: 'EMA 20' }, { row: 1, col: 1, output: 'ema20', format: 'decimal2' }] }])
    const r = applyPatch(null, turn, { gateCtx: GATE, memberWords: 'Create a table in the top-right showing RSI 14 and EMA 20.' })
    expect(r.ok).toBe(true)
    const label = (d, k) => d.plots.find((p) => p.key === k).label
    expect(label(r.definition, 'rsi14')).toBe('RSI 14')
    expect(label(r.definition, 'ema20')).toBe('EMA 20')
    // REOPEN + a maths edit on the RSI: its auto label follows the maths, never the EMA's name
    const t = applyPatch(r.definition, env(1, [{ op: 'set_output_tree', output: 'rsi14', tree: P('rsi(close, 21)') }]), { gateCtx: GATE, revision: 1 })
    expect(t.ok).toBe(true)
    expect(label(t.definition, 'rsi14')).toBe('RSI 21')
    expect(label(t.definition, 'ema20')).toBe('EMA 20')
  })

  it('a PRIMARY plot 1 still follows the definition name (unchanged)', () => {
    const r = applyPatch(null, env(0, [{ op: 'create', name: 'x', outputs: [{ key: 'value', tree: P('ema(close, 20)') }] }]), { gateCtx: GATE })
    expect(r.definition.meta.name).toBe('EMA 20')
    const t = applyPatch(r.definition, to21, { gateCtx: GATE, revision: 1 })
    expect(t.definition.meta.name).toBe('EMA 21')
  })

  // ── STABILIZATION 3 — calculators and table-only indicators are named by their table ──
  const PI = (src) => { const r = parseFormula(src, { inputs: ['accountSize', 'riskPercent', 'entryPrice', 'stopPrice'] }); if (!r.ok) throw new Error(src); return r.ast }
  const INPUTS = [
    { key: 'accountSize', label: 'Account size', default: 0, min: 0 },
    { key: 'riskPercent', label: 'Risk %', default: 0, min: 0, max: 100 },
    { key: 'entryPrice', label: 'Entry price', default: 0, min: 0 },
    { key: 'stopPrice', label: 'Stop price', default: 0, min: 0 }]
  // the measured prod turn's shape (case C): Shares visible + primary, the rest hidden
  const CALC = [
    { op: 'create', name: 'Position Size Calculator', placement: 'pane', primary: 'Shares', inputs: INPUTS, outputs: [
      { key: 'Shares', label: 'Position size (shares)', tree: PI('floor(accountSize * riskPercent / 100 / abs(entryPrice - stopPrice))') },
      { key: 'RiskAmount', label: 'Risk amount ($)', hidden: true, tree: PI('accountSize * riskPercent / 100') },
      { key: 'RiskPerShare', label: 'Risk per share ($)', hidden: true, tree: PI('abs(entryPrice - stopPrice)') }] },
    { op: 'set_table', position: 'top_right', cells: [
      { row: 0, col: 0, text: 'Position Sizing', bold: true },
      { row: 1, col: 0, text: 'Risk amount' }, { row: 1, col: 1, output: 'RiskAmount', format: 'decimal2', prefix: '$' },
      { row: 2, col: 0, text: 'Risk per share' }, { row: 2, col: 1, output: 'RiskPerShare', format: 'decimal2', prefix: '$' },
      { row: 3, col: 0, text: 'Shares' }, { row: 3, col: 1, output: 'Shares', format: 'integer' }] },
  ]
  const words = 'Build me a position-sizing calculator with account size, risk percentage, entry price and stop price.'
  const plotLabel = (d, k) => d.plots.find((p) => p.key === k).label

  it('a CALCULATOR is named by its table title; its values by their row labels (no model call)', () => {
    const r = applyPatch(null, env(0, CALC), { gateCtx: GATE, memberWords: words })
    expect(r.ok, JSON.stringify(r.errors)).toBe(true)
    expect(r.definition.meta.name).toBe('Position Sizing')
    expect(plotLabel(r.definition, 'RiskAmount')).toBe('Risk amount')
    expect(plotLabel(r.definition, 'RiskPerShare')).toBe('Risk per share')
  })

  it('…without a title, by its row labels; with no table at all, by its settings', () => {
    const noTitle = CALC.map((o) => (o.op === 'set_table' ? { ...o, cells: o.cells.filter((c) => c.row !== 0) } : o))
    expect(applyPatch(null, env(0, noTitle), { gateCtx: GATE }).definition.meta.name).toBe('Risk amount · Risk per share +1')
    const bare = applyPatch(null, env(0, [CALC[0]]), { gateCtx: GATE })
    expect(bare.definition.meta.name).toBe('Calculator · Account size, Risk % +2')
    // removing the table later (case F) re-derives — it stays readable
    const withTable = applyPatch(null, env(0, CALC), { gateCtx: GATE }).definition
    const removed = applyPatch(withTable, env(1, [{ op: 'remove_table' }]), { gateCtx: GATE, revision: 1 })
    expect(removed.definition.meta.name).toBe('Calculator · Account size, Risk % +2')
  })

  it('an EMA that also shows a small table keeps its maths name (table naming is for calculators / table-only)', () => {
    const r = applyPatch(null, env(0, [
      { op: 'create', name: 'x', placement: 'price', outputs: [{ key: 'ema20', tree: P('ema(close, 20)') }] },
      { op: 'set_table', position: 'top_right', cells: [{ row: 0, col: 0, text: 'EMA' }, { row: 0, col: 1, output: 'ema20' }] }]), { gateCtx: GATE })
    expect(r.definition.meta.name).toBe('EMA 20')
  })

  it("a member's own name still wins", () => {
    const named = CALC.map((o) => (o.op === 'create' ? { ...o, name: 'My Sizer' } : o))
    const r = applyPatch(null, env(0, named), { gateCtx: GATE, memberWords: 'a position calculator, call it My Sizer' })
    expect(r.definition.meta.name).toBe('My Sizer')
  })

  it('an OLDER save stored the formula name — it is still automatic, so the next edit names it properly', () => {
    const r = applyPatch(null, env(0, [CALC[0]]), { gateCtx: GATE }).definition
    // what prod stored before this change: EXACTLY the formula-derived name (the old rule)
    const formulaName = derivedDefName({ rows: CALC[0].outputs.map((o) => ({ key: o.key, ast: o.tree, hidden: o.hidden })), scanKey: 'Shares' })
    const legacy = { ...r, meta: { ...r.meta, name: formulaName } }
    const t = applyPatch(legacy, env(1, [CALC[1]]), { gateCtx: GATE, revision: 1 })
    expect(t.ok, JSON.stringify(t.errors)).toBe(true)
    expect(t.definition.meta.name).toBe('Position Sizing')
    // …while a name the member typed (anything else) is kept
    const custom = applyPatch({ ...r, meta: { ...r.meta, name: 'My Sizer' } }, env(1, [CALC[1]]), { gateCtx: GATE, revision: 1 })
    expect(custom.definition.meta.name).toBe('My Sizer')
  })

  // ── ⚰️ PROD 2026-10-08 (stabilization acceptance): the model ignored the member's name ──
  const ema21 = env(0, [{ op: 'create', name: 'EMA 21', placement: 'price', primary: 'ema21',
    outputs: [{ key: 'ema21', label: 'EMA 21', tree: P('ema(close, 21)') }] }])

  it('"Add an EMA 21 and call it Swing Line" names it Swing Line even when the model sent "EMA 21"; it survives an edit', () => {
    const r = applyPatch(null, ema21, { gateCtx: GATE, memberWords: 'Add an EMA 21 and call it Swing Line.' })
    expect(r.definition.meta.name).toBe('Swing Line')
    const t = applyPatch(r.definition, env(1, [{ op: 'set_output_tree', output: 'ema21', tree: P('ema(close, 50)') }]), { gateCtx: GATE, revision: 1 })
    expect(t.definition.meta.name).toBe('Swing Line')
  })

  it('the name stops at the next instruction; quoted text and output labels are not names', () => {
    expect(memberCueNames('call it Swing Line and colour it red')).toEqual(['Swing Line'])
    expect(applyPatch(null, ema21, { gateCtx: GATE, memberWords: 'Add EMA 21, show "BUY" above it' }).definition.meta.name).toBe('EMA 21')
    const labelled = env(0, [{ op: 'create', name: 'x', outputs: [{ key: 'fast', tree: P('ema(close, 20)') },
      { key: 'slow', label: 'Slow line', tree: P('ema(close, 50)') }] }])
    expect(applyPatch(null, labelled, { gateCtx: GATE, memberWords: 'EMA 20 and an EMA 50 labelled Slow line' }).definition.meta.name).toBe('EMA 20 · EMA 50')
  })

  it("a naming clause is never listed as 'I didn't understand'", () => {
    const res = { ok: true, notUnderstood: [{ clause: 'call it Swing Line.', reason: 'not a supported concept' }, { clause: 'wobble', reason: 'unknown' }] }
    expect(distinctNotUnderstood(res).map((n) => n.clause)).toEqual(['wobble'])
  })
})
