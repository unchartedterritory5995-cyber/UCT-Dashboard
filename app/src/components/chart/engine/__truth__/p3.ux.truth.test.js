// P3 truth matrix, slice "ux" — THE MEMBER-VOICED READBACK AND THE MEMBER-SAFE
// REFUSAL ARE STILL THE DEFINITION'S OWN WORDS.
//
// Every case states ASKED / CLAIMED / DID and its outcome class. "Before" is the
// P2 readback (engineer voice): "RSI 14 > 70 (value) — a yes/no on every bar: 1
// when (the 14-bar RSI of close) is greater than 70 and 0 otherwise", "Look:
// candles painted #FFD700 where value is true …", "How unknown bars are treated
// is decided by the server when you save." on every readback, and refusals
// shown as `<message> [authoring:unrepresentable]` with schema paths.
// No model calls anywhere in this file.
import { describe, it, expect } from 'vitest'
import { parseFormula } from '../ast/parse'
import { sentenceFor } from '../ast/sentence'
import { declaredInputs } from '../ast/lint'
import { interpret } from '../ast/interpret'
import { applyPatch, applyTurn, newAuthoringState, openAuthoringState, readback } from '../../builder/authoring'
import {
  SEMANTICS_LINE, SEMANTICS_LINE_LEGACY, colourWords, slotWords, conditionWords, presentationLines,
} from '../../builder/authoring/readback'
import { memberError, memberSaveError, conversationEditability } from '../../builder/authoring/memberWords'

const P = (src) => {
  const r = parseFormula(src)
  if (!r.ok) throw new Error(`${src}: ${JSON.stringify(r)}`)
  return r.ast
}
const C = 'uct.authoring.patch/1'
const env = (state, ops, extra = {}) => ({ contract: C, baseRevision: state.revision, ops, assumptions: [], ...extra })
const GATE = { tf: 'D', symbol: 'SPY' }

function run(turns) {
  let s = newAuthoringState({ lineage: 'auth_000000000000' })
  let last = null
  for (const make of turns) {
    last = applyTurn(s, make(s), { gateCtx: GATE })
    if (last.result.status !== 'applied') throw new Error(JSON.stringify(last.result.errors))
    s = last.state
  }
  return { state: s, rb: last.readback }
}
const create = (src, extra = {}) => (s) => env(s, [{ op: 'create', name: 'x', outputs: [{ tree: P(src) }] }], extra)

describe('P3 UX — the readback says the definition in a trader\'s words', () => {
  it('1 COMPARISON — ASKED "RSI overbought"; CLAIMED (before) "1 when (…) is greater than 70 and 0 otherwise"; DID (now) "true when the 14-bar RSI of close is above 70" (EXACT)', () => {
    const { rb } = run([create('rsi(close, 14) > 70')])
    expect(rb.lines[1]).toBe('RSI 14 > 70 — true when the 14-bar RSI of close is above 70')
    // the exact engine sentence is kept on the output for every other reader
    expect(rb.outputs[0].sentence).toBe('1 when (the 14-bar RSI of close) is greater than 70 and 0 otherwise')
    expect(rb.lines.join('\n')).not.toMatch(/\(value\)|0 otherwise/)
  })

  it('2 "TRUE WHEN" IS THE BARS THE ENGINE MARKS 1 — DID: on real evaluation, value = 1 exactly where both comparisons hold (EXACT)', () => {
    const tree = P('close > open && volume > 1000')
    const scope = declaredInputs({ inputs: [] })
    expect(conditionWords(tree, scope)).toBe('close is above open and volume is above 1000')
    const bars = [[10, 11, 2000], [10, 9, 2000], [10, 11, 500], [10, 12, 1001]]
      .map(([o, c, v], i) => ({ t: 1700000000 + i * 86400, o, h: 13, l: 8, c, v }))
    const said = bars.map((b) => (b.c > b.o && b.v > 1000 ? 1 : 0))
    for (const opts of [{}, { semantics: 2 }]) {
      expect(Array.from(interpret(tree, bars, {}, undefined, undefined, opts))).toEqual(said)
    }
  })

  it('3 NOT A PURE COMPARISON — ASKED a number used as a yes/no ("close && volume") or a yes/no compared as a number; DID: keep sentence.js\'s exact wording with the type in words (DISCLOSED DIFFERENCE, never smoothed)', () => {
    const scope = declaredInputs({ inputs: [] })
    expect(conditionWords(P('close && volume'), scope)).toBeNull()
    expect(conditionWords(P('(close > open) > 0'), scope)).toBeNull()
    expect(conditionWords(P('(close > open)[1]'), scope)).toBeNull()
    const { rb } = run([create('close && volume')])
    expect(rb.lines[1]).toBe(`${rb.outputs[0].name} — a yes/no on every bar: ${sentenceFor(P('close && volume'), scope)}`)
  })

  it('4 MIXED and/or — DID: grouping is said with parentheses, never flattened into an ambiguous sentence (EXACT)', () => {
    const scope = declaredInputs({ inputs: [] })
    expect(conditionWords(P('(close > open || close < low) && volume >= 10'), scope))
      .toBe('(close is above open or close is below low) and volume is at or above 10')
    expect(conditionWords(P('!(close > open)'), scope)).toBe('not (close is above open)')
  })

  it('5 KEYS — CLAIMED (before) "(value)" on every output; DID: the label only, the key only when two outputs share a label (EXACT)', () => {
    const { rb } = run([create('rsi(close, 14) > 70'),
      (s) => env(s, [{ op: 'add_output', key: 'rsi', tree: P('rsi(close, 14)'), label: 'RSI' }])])
    expect(rb.lines).toContain('RSI 14 — a number on every bar: the 14-bar RSI of close')
    expect(rb.lines.join('\n')).not.toMatch(/\((value|rsi)\)/)
    const twin = { meta: { name: 't' }, plots: [{ key: 'a', label: 'Same' }, { key: 'b', label: 'Same' }], paints: [] }
    expect(presentationLines(twin).slice(0, 2).map((l) => l.split(':')[0])).toEqual(['Same (a)', 'Same (b)'])
  })

  it('6 COLOURS — ASKED "gold candles"; CLAIMED (before) "#FFD700"; DID: "gold" for an exact palette hex, the hex itself otherwise (EXACT, no guessed names)', () => {
    expect(colourWords('#FFD700')).toBe('gold')
    expect(colourWords('#ffd700ff')).toBe('gold')
    expect(colourWords('#FFD701')).toBe('#FFD701')
    expect(colourWords('#ffd70080')).toBe('#ffd70080') // translucent is not the palette colour
    const { rb } = run([create('rsi(close, 14) > 70'),
      (s) => env(s, [{ op: 'set_paint', output: 'value', channel: 'barcolor', color: '#FFD700' }]),
      (s) => env(s, [{ op: 'set_paint', output: 'value', channel: 'bgcolor', color: '#123456' }])])
    expect(rb.lines).toContain('Look: candles painted gold where RSI 14 > 70 is true (normal colour otherwise)')
    expect(rb.lines).toContain('Look: background shaded #123456 where RSI 14 > 70 is true (no shading otherwise)')
  })

  it('7 UNKNOWN BARS — CLAIMED (before) "decided by the server" on EVERY readback; DID: the rule the store will apply, said as what shows, only where a comparison exists (EXACT)', () => {
    expect(run([create('rsi(close, 14) > 70')]).rb.lines).toContain(SEMANTICS_LINE)
    const series = run([create('rsi(close, 14)')]).rb.lines
    expect(series.some((l) => l === SEMANTICS_LINE || l === SEMANTICS_LINE_LEGACY)).toBe(false)
    // a Pine translation keeps semantics 1: comparisons on warm-up bars are false
    const pine = applyPatch(null, env({ revision: 0 }, [{ op: 'create', name: 'p', outputs: [{ tree: P('close > open') }] }])).definition
    const pineDef = { ...pine, meta: { ...pine.meta, recurrenceOrigin: 'pine' } }
    expect(readback(pineDef, openAuthoringState(pineDef)).lines).toContain(SEMANTICS_LINE_LEGACY)
    expect(readback(pineDef, openAuthoringState(pineDef)).lines).not.toContain(SEMANTICS_LINE)
  })

  it('8 ASSUMPTIONS — CLAIMED (before) "Assumed threshold of > = 70 (value)"; DID: "Assumed threshold 70"; model prose quoted as UCT Intelligence\'s, never stated as fact (DISCLOSED)', () => {
    const { rb } = run([create('rsi(close, 14) > 70', { assumptions: [{ slot: 'value#0.1', text: 'standard length' }, { slot: 'value#1', text: 'overbought' }] })])
    expect(rb.assumptions).toEqual(['Assumed RSI period 14', 'Assumed threshold 70'])
    expect(slotWords('constant in *')).toBe('multiplier')
    expect(slotWords('threshold of < (negated)')).toBe('threshold (negated)')
    const quoted = readback(run([create('close > open')]).state.working, { assumptions: [{ text: 'you meant daily bars' }] })
    expect(quoted.assumptions).toEqual(['UCT Intelligence assumed: "you meant daily bars"'])
  })

  it('9 COMPLETE — DID: outputs, look, alert, header value, assumptions and the unknown-bar rule are all still in the lines (EXACT, nothing dropped by the voice change)', () => {
    const { rb } = run([create('rsi(close, 14) > 70'),
      (s) => env(s, [{ op: 'set_marker', output: 'value', shape: 'circle', position: 'aboveBar' }]),
      (s) => env(s, [{ op: 'request_alert', output: 'value', triggerPolicy: 'becomes_true' }]),
      (s) => env(s, [{ op: 'add_output', key: 'rsi', tree: P('rsi(close, 14)'), label: 'RSI' }, { op: 'request_info_value', output: 'rsi', format: 'auto' }])])
    expect(rb.lines).toEqual([
      'Name: RSI 14 > 70 · RSI 14',
      'RSI 14 > 70 — true when the 14-bar RSI of close is above 70',
      'RSI 14 — a number on every bar: the 14-bar RSI of close',
      'Look: RSI 14 > 70: UCT gold circle above the bar where it is true',
      'Look: RSI 14: UCT gold line, width 1',
      'Look: drawn in its own pane',
      'Alert when RSI 14 > 70 becomes true',
      'Chart header shows the latest value of RSI 14',
      SEMANTICS_LINE,
    ])
  })
})

describe('P3 UX — refusals in member words, the code kept for support', () => {
  it('10 STALE — CLAIMED (before) "…written against revision 3; the indicator is now at 4 [patch:stale]"; DID: a sentence the member can act on; code + engine text in detail (CONTROLLED ERROR)', () => {
    const r = applyPatch(null, { contract: C, baseRevision: 4, ops: [{ op: 'rename_definition', name: 'x' }] }, { revision: 3 })
    const m = memberError(r.errors[0])
    expect(m.text).toBe('The indicator changed while that reply was on its way, so nothing was applied. Send it again.')
    expect(m.text).not.toMatch(/revision|patch:/)
    expect(m.detail).toMatch(/^patch:stale: /)
  })

  it('11 UNREPRESENTABLE — CLAIMED (before) the raw path list; DID: plain sentence, paths only in the detail (REFUSAL)', () => {
    const d = applyPatch(null, env({ revision: 0 }, [{ op: 'create', name: 'x', outputs: [{ tree: P('close > open') }] }])).definition
    // ⭐ PHASE 4 — the blocking case is maths the row model cannot hold.
    const odd = { ...d, compute: { ...d.compute, importedStage: { kind: 'foreign' } } }
    const r = applyPatch(odd, env({ revision: 0 }, [{ op: 'rename_definition', name: 'y' }]))
    const m = memberError(r.errors[0])
    expect(m.text).toBe('This indicator has parts UCT Intelligence cannot reproduce yet, so it cannot be changed by conversation. You can still edit it manually.')
    expect(m.text).not.toMatch(/compute|importedStage/)
    expect(m.detail).toMatch(/authoring:unrepresentable: .*compute\.importedStage/)
  })

  it('12 A MODEL FAULT — ASKED anything; the model sent a bad slot / schema; DID: the generic sentence, never the schema path (CONTROLLED ERROR)', () => {
    const s = run([create('close > open')]).state
    const bad = applyPatch(s.working, env(s, [{ op: 'set_slot', slot: 'nope#9', value: 3 }]), { revision: s.revision })
    expect(bad.status).toBe('refused')
    const m = memberError(bad.errors[0])
    expect(m.text).toMatch(/^UCT Intelligence proposed a change that does not fit this indicator/)
    expect(memberError({ code: 'schema:type', message: 'patch.ops[0].tree: expected object' }).text).toBe(m.text)
  })

  it('13 A GATE REFUSAL — ASKED "alert on the RSI line"; DID: the gate\'s own reason, with the output by its name (REFUSAL)', () => {
    const s = run([create('rsi(close, 14) > 70'), (s0) => env(s0, [{ op: 'add_output', key: 'rsi', tree: P('rsi(close, 14)'), label: 'RSI' }])]).state
    const r = applyPatch(s.working, env(s, [{ op: 'request_alert', output: 'rsi', triggerPolicy: 'becomes_true' }]), { revision: s.revision, gateCtx: GATE })
    expect(r.status).toBe('refused')
    const names = (k) => (k === 'rsi' ? 'RSI 14' : k)
    const m = memberError(r.errors[0], { nameOf: names })
    expect(m.text.startsWith('RSI 14: ')).toBe(true)
    expect(m.text).toBe(`RSI 14: ${r.errors[0].message.slice('rsi: '.length)}`)
    expect(m.code).toBe(r.errors[0].code)
  })

  it('14 SAVE — a failed save stage is a sentence, the store text kept as detail (CONTROLLED ERROR)', () => {
    expect(memberSaveError({ ok: false, stage: 'validate', error: 'plots[0].key: required' }))
      .toEqual({ text: 'This indicator is not valid yet, so it was not saved.', code: 'save:validate', detail: 'plots[0].key: required' })
  })
})

describe('P3 UX — the conversation says up front what it cannot edit', () => {
  it('15 EDITABILITY AGREES WITH THE FIRST TURN — DID: conversationEditability is the engine\'s own guards; it is editable exactly when a first change would not be refused for its kind/fidelity (EXACT)', () => {
    const plain = applyPatch(null, env({ revision: 0 }, [{ op: 'create', name: 'x', outputs: [{ tree: P('close > open') }] }])).definition
    const native = { id: 'rsi', meta: { name: 'RSI' }, compute: { kind: 'native', fn: 'rsi' }, plots: [{ key: 'rsi' }] }
    const odd = { ...plain, compute: { ...plain.compute, importedStage: { kind: 'foreign' } } }
    const imported = { ...odd, meta: { ...odd.meta, recurrenceOrigin: 'pine' } }
    // ⭐ PHASE 4 — a carried presentation field is EDITABLE (and the first turn applies).
    const carried = { ...plain, plots: plain.plots.map((p) => ({ ...p, legend: { decimals: 4 } })) }
    expect(conversationEditability(carried)).toMatchObject({ editable: true, carried: 1 })
    for (const def of [plain, native, odd, imported, carried]) {
      const first = applyPatch(def, env({ revision: 0 }, [{ op: 'rename_definition', name: 'y' }]))
      const kindOrFidelity = first.status === 'refused' && /^authoring:/.test(first.errors[0].code)
      expect(conversationEditability(def).editable).toBe(!kindOrFidelity)
    }
    expect(conversationEditability(native)).toMatchObject({ editable: false, code: 'authoring:kind',
      text: 'This indicator is built in a form UCT Intelligence cannot edit yet. You can still edit it manually.' })
    expect(conversationEditability(imported)).toMatchObject({ editable: false, code: 'authoring:unrepresentable',
      text: 'This indicator was imported in a form UCT Intelligence cannot edit yet. You can still edit it manually.' })
  })
})
