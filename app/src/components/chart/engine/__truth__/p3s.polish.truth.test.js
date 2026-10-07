// app/src/components/chart/engine/__truth__/p3s.polish.truth.test.js
//
// ⭐ P3S — low-risk product defects measured in the P3R real-model run.
//   3. readback names: "RSI 28 · —", "TC2000", "CROSSOVER 70 (RSI 28)" (5A)
//   4. a condition that drives a paint is not also drawn as a 0/1 line (5B)
// Presentation only: no tree, type, truth, id or hash moves.

import { describe, it, expect } from 'vitest'
import { parseFormula } from '../ast/parse'
import { newAuthoringState, applyTurn } from '../../builder/authoring/authoringState'

const C = 'uct.authoring.patch/1'
const turn = (state, ops) => {
  const out = applyTurn(state, { contract: C, baseRevision: state.revision, ops }, { gateCtx: { symbol: 'XRPN', tf: 'D' } })
  expect(out.result.status).toBe('applied')
  return out.state
}
/** The P3R create: RSI 28 in a pane + an "above 70" condition that paints candles gold. */
const p3rRsi = () => turn(newAuthoringState(), [
  { op: 'create', name: 'RSI 28', placement: 'pane', primary: 'rsi', outputs: [
    { key: 'rsi', label: 'RSI 28', tree: parseFormula('rsi(close, 28)').ast },
    { key: 'overbought', label: 'RSI above 70', tree: parseFormula('rsi(close, 28) > 70').ast }] },
  { op: 'set_levels', values: [70, 30] },
  { op: 'set_paint', output: 'overbought', channel: 'barcolor', color: '#FFD700' },
])

// ═══ 3. READBACK NAMES (5A) — presentation only, never identity ═════════════════

import { chipName, isChipCut, untruncatedLabel } from '../labelText'
import { readback } from '../../builder/authoring/readback'
import { nameOfTree } from '../../builder/authoring/derivedName'

describe('3. READBACK NAMES — no dangling separator, no chip cut, readable events', () => {
  it('a chip cut never ends on a separator', () => {
    expect(chipName('RSI 28 · RSI 28 > 70')).toBe('RSI 28')
    expect(chipName('EMA 20 — fast')).toBe('EMA 20 — fast'.length <= 12 ? 'EMA 20 — fast' : 'EMA 20')
    expect(chipName('Short')).toBe('Short')
    expect(chipName('Above 50 on volume')).toBe('Above 50 on')   // the 2026-08-11 rail still holds
  })
  it('a STORED pre-P3S cut is still recognised (legends of saved documents keep expanding)', () => {
    expect(isChipCut('RSI 28 · RSI 28 > 70', 'RSI 28 ·')).toBe(true)
    expect(isChipCut('RSI 28 · RSI 28 > 70', 'RSI 28')).toBe(true)
    expect(isChipCut('RSI 28 · RSI 28 > 70', 'My own label')).toBe(false)
  })
  it('the P3R lines: "RSI 28 · —" is gone and the second output names the event', () => {
    let s = p3rRsi()
    s = turn(s, [{ op: 'set_output_tree', output: 'overbought', tree: parseFormula('crossOver(rsi(close, 28), 70)').ast }])
    const rb = readback(s.working, s, {})
    const names = rb.outputs.map((o) => o.name)
    expect(names[0]).toBe('RSI 28')
    expect(names.join(' ')).not.toMatch(/·\s*$|· —/)
    expect(s.working.meta.name).toBe('RSI 28 · RSI 28 crosses above 70')
    expect(nameOfTree(parseFormula('crossUnder(close, ema(close, 20))').ast)).toBe('Close crosses below EMA 20')
  })
  it('a one-output definition reads back its whole name, not its 12-character chip ("TC2000")', () => {
    const def = { id: 'u_x', plots: [{ key: 'value', label: 'TC2000', style: 'line' }], meta: { name: 'TC2000 XAVGC21' } }
    expect(untruncatedLabel(def, 'TC2000')).toBe('TC2000 XAVGC21')
  })
})

// ═══ 4. A PAINTED YES/NO IS NOT ALSO A 0/1 LINE (5B) — presentation only ═══════

describe('4. a condition that drives a paint is not drawn as a flat 0/1 line', () => {
  it('the P3R create: the painted condition is hidden (computed), the RSI line is drawn, the paint is kept', () => {
    const s = p3rRsi()
    const plots = Object.fromEntries(s.working.plots.map((p) => [p.key, p]))
    expect(plots.overbought.hidden).toBe(true)
    expect(plots.rsi.hidden).not.toBe(true)
    expect(s.working.paints).toEqual([expect.objectContaining({ kind: 'barcolor', colorMode: 'column:overbought', colorUp: '#FFD700' })])
    expect(s.working.compute.trees.overbought).toEqual(parseFormula('rsi(close, 28) > 70').ast)   // truth untouched
  })
  it('an explicit "show the line" in the same patch wins', () => {
    const s = turn(newAuthoringState(), [
      { op: 'create', name: 'x', placement: 'pane', outputs: [{ key: 'value', tree: parseFormula('close > ema(close, 20)').ast }] },
      { op: 'set_paint', output: 'value', channel: 'bgcolor', color: '#112233' },
      { op: 'set_style', output: 'value', hidden: false }])
    expect(s.working.plots.find((p) => p.key === 'value').hidden).not.toBe(true)
  })
  it('a later colour change does not re-hide a line the member chose to show', () => {
    let s = p3rRsi()
    s = turn(s, [{ op: 'set_style', output: 'overbought', hidden: false }])
    s = turn(s, [{ op: 'set_paint', output: 'overbought', channel: 'barcolor', color: '#00FF00' }])
    expect(s.working.plots.find((p) => p.key === 'overbought').hidden).not.toBe(true)
  })
  it('a NUMBER line that is painted by another output is untouched; a marker output is untouched', () => {
    const s = turn(p3rRsi(), [{ op: 'set_marker', output: 'overbought', shape: 'circle', position: 'belowBar' }])
    expect(s.working.plots.find((p) => p.key === 'rsi').hidden).not.toBe(true)
    // markers on the auto-hidden condition DRAW: asking for markers shows the output
    const ob = s.working.plots.find((p) => p.key === 'overbought')
    expect(ob.style).toBe('markers')
    expect(ob.hidden).not.toBe(true)
  })
})
