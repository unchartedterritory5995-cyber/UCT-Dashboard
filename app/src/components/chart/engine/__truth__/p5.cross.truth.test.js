// app/src/components/chart/engine/__truth__/p5.cross.truth.test.js
//
// ─── ⭐⭐ PHASE 5 — CROSS-CONTEXT + EXPRESSIVE OUTPUTS, THE BROWSER LANE ────────
//
// Each case states ASKED / CLAIMED / DID. The server twin is
// tests/test_phase5_cross_context.py; the parity vectors are ONE shared file
// (tests/fixtures/ast/p5_cross_context_parity.json) both interpreters must equal.

import { describe, it, expect, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { parseFormula, astHash } from '../ast/parse'
import { interpret } from '../ast/interpret'
import { applyPatch, applyTurn, newAuthoringState, openAuthoringState } from '../../builder/authoring'
import { gateTree, CROSS_CONTEXT, risingTree, aboveTree } from '../../builder/authoring/applyPatch'
import { compactView } from '../../builder/authoring/compactView'
import { readback } from '../../builder/authoring/readback'
import { slotsOfTree } from '../../builder/authoring/slots'
import { prepareSave } from '../../builder/authoring/authoringState'
import { conversationEditability } from '../../builder/authoring/memberWords'
import { helpersOfDefinition } from '../../builder/authoring/colorRules'
import { attachConversation, armConversationAlerts } from '../../builder/conversationSave'
import { withCalcFrame } from '../../builder/studio/chartPreview'
import { numericAlertRequest, signalAlertGate } from '../triggerPolicy'
import { crossSymbolAlertCode, STATUS } from '../evaluability'
import { BARE_AMBIGUOUS } from '../otherSymbols'
import * as registry from '../nativeRegistry'
import CROSS from '../../builder/authoring/crossContext.json'

const FX = JSON.parse(fs.readFileSync(path.resolve(globalThis.process.cwd(), '..', 'tests/fixtures/ast/p5_cross_context_parity.json'), 'utf8'))

const P = (src) => {
  const r = parseFormula(src)
  if (!r.ok) throw new Error(`${src}: ${JSON.stringify(r)}`)
  return r.ast
}
const C = 'uct.authoring.patch/1'
const env = (rev, ops) => ({ contract: C, baseRevision: rev, ops, assumptions: [] })
const GATE = { tf: 'D', symbol: 'AAPL' }
const STORED_ID = 'u_0123456789ab'
const apply = (def, ops, gateCtx = GATE, extra = {}) => applyPatch(def, env(0, ops), { gateCtx, ...extra })
const ok = (r) => { if (r.status !== 'applied') throw new Error(JSON.stringify(r.errors)); return r }
const create = (outputs, name = 'P5', more = [], gateCtx = GATE) => ok(apply(null, [
  { op: 'create', name, outputs: outputs.map(([key, src, label]) => ({ key, tree: P(src), ...(label ? { label } : {}) })) },
  ...more], gateCtx))
const plotOf = (d, k) => d.plots.find((p) => p.key === k)
const treeOf = (d, k) => (d.compute.trees ? d.compute.trees[k] : d.compute.ast)

// ═══ 1. parity vectors ═══════════════════════════════════════════════════════
describe('P5 parity — sym / tf / tf_live with missing other-symbol bars (shared with the Python lane)', () => {
  it.each(FX.cases.map((c) => [c.source, c]))('%s — the browser interpreter equals the independent oracle (EXACT / UNKNOWN)', (_s, c) => {
    const got = Array.from(interpret(c.ast, FX.bars, {}, undefined, undefined, { tf: FX.tf, symbols: FX.symbols }))
    expect(got).toHaveLength(c.expect.length)
    got.forEach((g, i) => {
      if (c.expect[i] === null) expect(Number.isFinite(g), `${i}`).toBe(false)
      else expect(g, `${i}`).toBeCloseTo(c.expect[i], 9)
    })
  })
})

// ═══ 2. cross-symbol authoring ══════════════════════════════════════════════
describe('P5 cross-symbol — sym authored, edited, bounded', () => {
  it('A ASKED "close above SPY\'s 50 EMA"; DID: one sym node around exactly the SPY read, a symbol slot, the read-back names SPY and the gap rule (EXACT)', () => {
    const r = create([['value', "close > sym('SPY', ema(close, 50))"]])
    const t = treeOf(r.definition, 'value')
    expect(t.args[1]).toMatchObject({ type: 'sym', value: 'SPY' })
    const slots = slotsOfTree('value', t)
    expect(slots.find((s) => s.kind === 'symbol')).toMatchObject({ id: 'value#1', value: 'SPY', label: 'symbol read' })
    const lines = readback(r.definition, {}, GATE).lines
    expect(lines.join('\n')).toMatch(/SPY’s|SPY's/)
    expect(lines).toContain('Reads SPY bar by bar on the same dates as this chart; a date SPY has no bar is left unknown, never filled in')
  })

  it('B ASKED "use QQQ instead of SPY"; DID: set_slot symbol — the tree reads QQQ, the maths identity (astHash) moves, the change records SPY → QQQ (EXACT / IDENTITY)', () => {
    const a = create([['value', "close > sym('SPY', ema(close, 50))"]]).definition
    const b = ok(apply(a, [{ op: 'set_slot', slot: 'value#1', symbol: 'QQQ' }]))
    expect(treeOf(b.definition, 'value').args[1].value).toBe('QQQ')
    expect(astHash(treeOf(b.definition, 'value'))).not.toBe(astHash(treeOf(a, 'value')))
    expect(b.changes.find((c) => c.kind === 'slot-set')).toMatchObject({ fromValue: 'SPY', toValue: 'QQQ' })
    // a symbol slot takes a symbol, never a number
    expect(apply(a, [{ op: 'set_slot', slot: 'value#1', value: 3 }]).errors[0].code).toBe('slot:kind')
  })

  it('C ASKED VIX / a hostile spelling; DID: refused by name, nothing applied (REFUSAL)', () => {
    for (const [tk, code] of [['VIX', 'tree:symbol-ambiguous'], ['SPY;X', 'tree:symbol-spelling'], ['spy', 'tree:symbol-spelling']]) {
      const r = applyPatch(null, env(0, [{ op: 'create', name: 'x', outputs: [{ tree: { type: 'op', name: '>', args: [{ type: 'series', name: 'close' }, { type: 'sym', value: tk, args: [{ type: 'series', name: 'close' }] }] } }] }]), { gateCtx: GATE })
      expect(r.status, tk).toBe('refused')
      expect(r.errors[0].code, tk).toBe(code)
    }
    // ⭐ ONE LIST: the engine's BARE_AMBIGUOUS is the bounds file's
    expect([...BARE_AMBIGUOUS].sort()).toEqual([...CROSS.ambiguousBare].sort())
  })

  it('D ASKED a third other symbol; DID: refused symbol:fan-out over the whole RESULT (REFUSAL)', () => {
    const a = create([['value', "sym('SPY', close) / sym('QQQ', close)"]]).definition
    const r = apply(a, [{ op: 'add_output', key: 'iwm', tree: P("sym('IWM', close)") }])
    expect(r.status).toBe('refused')
    expect(r.errors[0].code).toBe('symbol:fan-out')
    expect(r.definition).toBe(a)
    expect(CROSS_CONTEXT.maxOtherSymbols).toBe(2)
  })

  it('E sym OUTSIDE tf is authored; tf(sym(…)) is refused (the engine\'s own placement rule)', () => {
    expect(create([['value', "sym('SPY', tf(close, 'W'))"]]).status).toBe('applied')
    const r = applyPatch(null, env(0, [{ op: 'create', name: 'x', outputs: [{ tree: P("tf(sym('SPY', close), 'W')") }] }]), { gateCtx: GATE })
    expect(r.status).toBe('refused')
  })
})

// ═══ 3. timeframe authoring ═══════════════════════════════════════════════════
describe('P5 timeframes — tf (closed) by default, tf_live only when asked, W/M only', () => {
  it('F ASKED "weekly RSI"; DID: tf W, a timeframe slot, monthly by set_slot, non-repainting (EXACT)', () => {
    const a = create([['value', "tf(rsi(close, 14), 'W')"]]).definition
    const slot = slotsOfTree('value', treeOf(a, 'value')).find((s) => s.kind === 'timeframe')
    expect(slot).toMatchObject({ id: 'value#root', value: 'W', role: 'closed period' })
    const b = ok(apply(a, [{ op: 'set_slot', slot: 'value#root', timeframe: 'M' }])).definition
    expect(treeOf(b, 'value').value).toBe('M')
    expect(readback(b, {}, GATE).needsAck).toEqual([])
    expect(readback(a, {}, GATE).lines.join(' ')).toMatch(/weekly/)
  })

  it('G ASKED the FORMING week; DID: tf_live authored, marked repainting, the save needs the acknowledgement (DISCLOSED)', () => {
    const r = create([['value', "close > tf_live(high, 'W')"]])
    const st = { ...newAuthoringState(), working: r.definition }
    const rb = readback(r.definition, st, GATE)
    expect(rb.needsAck).toEqual(['value'])
    expect(rb.lines.some((l) => /forming/.test(l) && /repaints/.test(l))).toBe(true)
    expect(prepareSave(st).needsAck).toEqual(['value'])
  })

  it('H a daily / quarterly / intraday read INSIDE a formula is refused by the engine gate (REFUSAL)', () => {
    for (const t of [{ type: 'tf', value: 'D', args: [P('close')] }, { type: 'tf_live', value: '3M', args: [P('close')] }]) {
      expect(() => gateTree(t, {}, 'value')).toThrow(/weekly or monthly/)
    }
  })
})

// ═══ 4. per-bar colour + conditional clouds ══════════════════════════════════
describe('P5 expressive outputs — colour rules and clouds, derived, synced, editable', () => {
  it('I ASKED "green above zero, red below" on a histogram; DID: colorMode sign, read back exactly; the MATHS identity is untouched (EXACT / IDENTITY)', () => {
    const a = create([['value', 'ema(close, 12) - ema(close, 26)']], 'MACD line', [{ op: 'set_style', output: 'value', style: 'histogram' }]).definition
    const b = ok(apply(a, [{ op: 'set_color_rule', output: 'value', rule: 'sign', up: '#089981', down: '#F23645' }])).definition
    expect(plotOf(b, 'value')).toMatchObject({ colorMode: 'sign', colorUp: '#089981', colorDown: '#F23645' })
    expect(astHash(treeOf(b, 'value'))).toBe(astHash(treeOf(a, 'value')))
    expect(b.compute.treesHash || null).toBe(a.compute.treesHash || null)
    const look = readback(b, {}, GATE).lines.find((l) => l.startsWith('Look: ') && /histogram/.test(l))
    expect(look).toMatch(/coloured green at or above zero, red below/)
    expect(look).not.toMatch(/by \)/)                    // ⚰️ the old "by )" read-back
  })

  it('J ASKED "green while the EMA rises"; DID: a hidden derived column, re-derived when the EMA changes, removed with the rule (EXACT)', () => {
    const a = create([['value', 'ema(close, 20)']]).definition
    const b = ok(apply(a, [{ op: 'set_color_rule', output: 'value', rule: 'rising', up: '#089981', down: '#F23645' }])).definition
    expect(plotOf(b, 'value').colorMode).toBe('column:value_c')
    expect(plotOf(b, 'value_c').hidden).toBe(true)
    expect(astHash(treeOf(b, 'value_c'))).toBe(astHash(risingTree(treeOf(b, 'value'))))
    expect(helpersOfDefinition(b).get('value_c')).toEqual({ owner: 'value', kind: 'rising' })
    // the hidden column is not part of the derived name, and keeps its own label
    expect(b.meta.name).toBe('EMA 20')
    expect(plotOf(b, 'value_c').label).toBe('value colour rule')
    // the view: the helper is WHAT IT IS, no slots for the model to edit
    const v = compactView(b, { revision: 1 }, GATE)
    expect(v.definition.outputs.find((o) => o.key === 'value_c')).toMatchObject({ role: 'colour-rule-column', of: 'value' })
    expect(v.definition.outputs.find((o) => o.key === 'value_c').slots).toBeUndefined()
    expect(v.definition.outputs.find((o) => o.key === 'value').presentation.colorRule).toEqual({ rule: 'rising', up: '#089981', down: '#F23645' })
    // EMA 20 → 50: the helper follows
    const c = ok(apply(b, [{ op: 'set_slot', slot: 'value#1', value: 50 }])).definition
    expect(astHash(treeOf(c, 'value_c'))).toBe(astHash(risingTree(P('ema(close, 50)'))))
    expect(readback(c, {}, GATE).lines.some((l) => /coloured green while it rises, red otherwise/.test(l))).toBe(true)
    expect(readback(c, {}, GATE).lines.some((l) => /value colour rule|value_c/.test(l))).toBe(false)
    // rule none: back to one colour, the helper is gone
    const d = ok(apply(c, [{ op: 'set_color_rule', output: 'value', rule: 'none' }])).definition
    expect(plotOf(d, 'value').colorMode).toBeUndefined()
    expect(plotOf(d, 'value_c')).toBeUndefined()
  })

  it('K ASKED "colour the RSI by a yes/no"; DID: condition rule on an existing yes/no output; a number as the condition is refused (EXACT / REFUSAL)', () => {
    const a = create([['value', 'rsi(close, 14)'], ['strong', 'rsi(close, 14) > 50']]).definition
    const b = ok(apply(a, [{ op: 'set_color_rule', output: 'value', rule: 'condition', when: 'strong', up: '#089981', down: '#F23645' }])).definition
    expect(plotOf(b, 'value')).toMatchObject({ colorMode: 'column:strong' })
    expect(apply(a, [{ op: 'set_color_rule', output: 'strong', rule: 'condition', when: 'value', up: '#089981', down: '#F23645' }]).errors[0].code).toBe('color:condition-output')
    expect(apply(a, [{ op: 'set_color_rule', output: 'value', rule: 'sign' }]).errors[0].code).toBe('color:colours')
  })

  it('L ASKED "green cloud where fast is above slow, red below"; DID: a derived 0/1 column, re-derived on either edge, dropped with the fill (EXACT)', () => {
    const a = create([['fast', 'ema(close, 10)'], ['slow', 'ema(close, 30)']]).definition
    const b = ok(apply(a, [{ op: 'set_fill', output: 'fast', with: 'slow', colorAbove: '#089981', colorBelow: '#F23645' }])).definition
    expect(plotOf(b, 'fast').fill).toEqual({ with: 'slow', colorMode: 'column:fast_fc', colorUp: '#089981', colorDown: '#F23645' })
    expect(astHash(treeOf(b, 'fast_fc'))).toBe(astHash(aboveTree(treeOf(b, 'fast'), treeOf(b, 'slow'))))
    expect(b.meta.name).toBe('EMA 10 · EMA 30')
    const c = ok(apply(b, [{ op: 'set_slot', slot: 'slow#1', value: 50 }])).definition
    expect(astHash(treeOf(c, 'fast_fc'))).toBe(astHash(aboveTree(P('ema(close, 10)'), P('ema(close, 50)'))))
    const look = readback(c, {}, GATE).lines.find((l) => /area between/.test(l))
    expect(look).toMatch(/green where .* is above .*, red where below/)
    expect(readback(c, {}, GATE).lines).toContain('Where a colour rule has no answer yet, the line keeps its own colour and a cloud is left unshaded.')
    const d = ok(apply(c, [{ op: 'remove_fill', output: 'fast' }])).definition
    expect(plotOf(d, 'fast_fc')).toBeUndefined()
    expect(apply(a, [{ op: 'set_fill', output: 'fast', with: 'slow', colorAbove: '#089981' }]).errors[0].code).toBe('fill:colours')
  })

  it('M IMPORT FIDELITY: a carried two-colour rule (the Builder\'s value_c idiom) is first-class editable; a palette stays the import\'s (EXACT / REFUSAL)', () => {
    const base = create([['value', 'ema(close, 20)'], ['value_c', 'close > ema(close, 20)']]).definition
    const imported = { ...base, plots: base.plots.map((p) => (p.key === 'value' ? { ...p, colorMode: 'column:value_c', colorUp: '#00ff00', colorDown: '#ff0000' }
      : p.key === 'value_c' ? { ...p, hidden: true } : p)) }
    const v = compactView(imported, { revision: 0 }, GATE)
    expect(v.definition.outputs.find((o) => o.key === 'value').presentation.colorRule).toEqual({ rule: 'condition', when: 'value_c', up: '#00ff00', down: '#ff0000' })
    const r = ok(apply(imported, [{ op: 'set_color_rule', output: 'value', rule: 'condition', when: 'value_c', up: '#089981', down: '#F23645' }]))
    expect(plotOf(r.definition, 'value')).toMatchObject({ colorMode: 'column:value_c', colorUp: '#089981', colorDown: '#F23645' })
    const palette = { ...base, plots: base.plots.map((p) => (p.key === 'value' ? { ...p, colorMode: 'column:value_c', colorPalette: ['#00ff00', '#ff0000'] } : p)) }
    expect(apply(palette, [{ op: 'set_color_rule', output: 'value', rule: 'sign', up: '#089981', down: '#F23645' }]).errors[0].code).toBe('color:foreign')
  })
})

// ═══ 5. numeric alerts ═══════════════════════════════════════════════════════════
describe('P5 numeric alerts — the existing architecture, exact conditions', () => {
  it('N ASKED "alert me when RSI crosses above 70"; DID: a numeric request, its payload, its read-back; a yes/no output refuses a number (EXACT / REFUSAL)', () => {
    const a = create([['value', 'rsi(close, 14)'], ['hot', 'rsi(close, 14) > 70']]).definition
    const r = ok(apply(a, [{ op: 'request_alert', output: 'value', condition: 'cross_above', threshold: 70 }]))
    expect(r.requests.alerts).toEqual([{ plotKey: 'value', condition: 'cross_above', threshold: 70 }])
    expect(readback(r.definition, { requests: r.requests }, GATE).lines).toContain(
      'Alert when value crosses above 70 on a closed bar (a bar with no value never alerts)'.replace('value', readback(r.definition, {}, GATE).outputs[0].name))
    const stored = { ...r.definition, id: STORED_ID }
    const req = numericAlertRequest({ def: stored, key: 'value', condition: 'cross_above', threshold: 70, sym: 'aapl', tf: 'D', ctx: GATE })
    expect(req.ok).toBe(true)
    expect(req.payload).toEqual({ sym: 'AAPL', indicator: `${STORED_ID}.value`, condition: 'cross_above', threshold: 70, tf: 'D' })
    expect(JSON.stringify(req.payload)).not.toMatch(/"type"|rsi\(|"ast"/)
    const bad = apply(a, [{ op: 'request_alert', output: 'hot', condition: 'above', threshold: 1 }])
    expect(bad.status).toBe('refused')
    expect(bad.errors[0].code).toBe('alert:not-number')
  })

  it('O CROSS-SYMBOL + ALERT: a sym alert is admitted by the shared gate (the server supplies SPY); VIX / three tickers are withheld by name (SUPPLY / REFUSAL)', () => {
    const a = create([['value', "close > sym('SPY', ema(close, 50))"]]).definition
    expect(signalAlertGate({ ...a, id: STORED_ID }, 'value', GATE).status).toBe(STATUS.SUPPORTED)
    expect(ok(apply(a, [{ op: 'request_alert', output: 'value', triggerPolicy: 'becomes_true' }])).requests.alerts).toHaveLength(1)
    expect(crossSymbolAlertCode(['SPY', 'QQQ'])).toBeNull()
    expect(crossSymbolAlertCode(['VIX'])).toBe('other-symbol:ambiguous')
    expect(crossSymbolAlertCode(['SPY', 'QQQ', 'IWM'])).toBe('other-symbol:fan-out')
    expect(crossSymbolAlertCode(['BRK.B', 'BRK.B'])).toBeNull()
  })

  it('P armConversationAlerts sends the numeric payload, on the CALCULATION timeframe when one is set (EXACT)', async () => {
    const a = create([['value', 'rsi(close, 14)']]).definition
    const stored = { ...a, id: STORED_ID }
    const create_ = vi.fn(async () => ({ ok: true }))
    const out = await armConversationAlerts({ storedDoc: stored, requests: { alerts: [{ plotKey: 'value', condition: 'below', threshold: 30 }], infoValues: [], calculationTimeframe: 'D' },
      sym: 'AAPL', tf: '5', instanceId: 'i1', create: create_ })
    expect(create_).toHaveBeenCalledWith({ sym: 'AAPL', indicator: `${STORED_ID}.value`, condition: 'below', threshold: 30, tf: 'D', instance_id: 'i1' })
    expect(out[0]).toMatchObject({ kind: 'alert', ok: true })
    expect(out[0].text).toMatch(/is below 30/)
  })
})

// ═══ 6. whole-instance calculation timeframe ═════════════════════════════════
describe('P5 calculation timeframe — "a daily EMA on my 5-minute chart"', () => {
  it('Q ASKED a daily EMA on a 5-minute chart; DID: a request applied at save to the instance\'s own control; the preview carries it; lower is refused; sym refuses it (EXACT / REFUSAL)', () => {
    const g5 = { tf: '5', symbol: 'AAPL' }
    const r = create([['value', 'ema(close, 20)']], 'EMA 20', [{ op: 'set_calculation_timeframe', timeframe: 'D' }], g5)
    expect(r.requests.calculationTimeframe).toBe('D')
    expect(readback(r.definition, { requests: r.requests }, g5).lines.some((l) => /^Calculated on the .* timeframe \(the whole indicator\)/.test(l))).toBe(true)
    // the preview instance is computed the way Save will compute it
    expect(withCalcFrame({ instanceId: 'p', defId: 'u_studio-preview' }, 'D')).toMatchObject({ calculationTimeframe: 'D' })
    expect(withCalcFrame({ instanceId: 'p' }, null)).toEqual({ instanceId: 'p' })
    // lower than the chart: refused
    const low = applyPatch(r.definition, env(0, [{ op: 'set_calculation_timeframe', timeframe: '5' }]), { gateCtx: { tf: 'D', symbol: 'AAPL' } })
    expect(low.errors[0].code).toBe('calc-tf:lower')
    // another symbol: calculated on the chart's own timeframe only
    const s = create([['value', "sym('SPY', close)"]]).definition
    expect(apply(s, [{ op: 'set_calculation_timeframe', timeframe: 'W' }]).errors[0].code).toBe('calc-tf:other-symbol')
    // 'chart' clears it
    const cleared = applyPatch(r.definition, env(0, [{ op: 'set_calculation_timeframe', timeframe: 'chart' }]), { gateCtx: g5, requests: r.requests })
    expect(cleared.requests.calculationTimeframe).toBeUndefined()
  })

  it('R attachConversation writes it through setInstanceCalculationTimeframe and says so (EXACT)', () => {
    const a = create([['value', 'ema(close, 20)']]).definition
    const stored = { ...a, id: STORED_ID, version: 1 }
    const out = attachConversation({ storedDoc: stored, created: true, requests: { alerts: [], infoValues: [], calculationTimeframe: 'D' },
      settings: { indicatorInstances: [] }, registry })
    const inst = out.settings.indicatorInstances.find((i) => i.instanceId === out.instanceId)
    expect(inst.calculationTimeframe).toBe('D')
    expect(out.outcomes.find((o) => o.kind === 'calc_timeframe')).toMatchObject({ ok: true })
    registry.uninstallUserDefinition(STORED_ID)
  })
})

// ═══ 7. Phase 4 reopen / editing of every new feature ═══════════════════════════
describe('P5 × Phase 4 — a saved cross-context / coloured indicator reopens and edits', () => {
  it('S ASKED to reopen an indicator that reads SPY, has a rising rule and a cloud, and change it; DID: editable, no carried conflict, applied (EXACT)', () => {
    let d = create([['fast', "sym('SPY', ema(close, 10))"], ['slow', "sym('SPY', ema(close, 30))"]], 'SPY cloud').definition
    d = ok(apply(d, [
      { op: 'set_fill', output: 'fast', with: 'slow', colorAbove: '#089981', colorBelow: '#F23645' },
      { op: 'set_color_rule', output: 'fast', rule: 'rising', up: '#2962FF', down: '#787B86' },
    ])).definition
    const saved = { ...d, id: STORED_ID, version: 2 }
    expect(conversationEditability(saved).editable).toBe(true)
    const st = openAuthoringState(saved, { defId: STORED_ID, version: 2, lineage: 'auth_000000p5open' })
    const t = applyTurn(st, env(st.revision, [{ op: 'set_slot', slot: 'fast#root', symbol: 'QQQ' }]), { gateCtx: GATE })
    expect(t.result.status, JSON.stringify(t.result.errors)).toBe('applied')
    const w = t.state.working
    expect(treeOf(w, 'fast').value).toBe('QQQ')
    // both helpers re-derived from the QQQ edge
    expect(astHash(treeOf(w, 'fast_c'))).toBe(astHash(risingTree(treeOf(w, 'fast'))))
    expect(astHash(treeOf(w, 'fast_fc'))).toBe(astHash(aboveTree(treeOf(w, 'fast'), treeOf(w, 'slow'))))
    expect(readback(w, t.state, GATE).lines.join('\n')).toMatch(/Reads QQQ and SPY bar by bar/)
  })
})
