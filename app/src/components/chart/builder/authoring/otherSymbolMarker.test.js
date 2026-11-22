// app/src/components/chart/builder/authoring/otherSymbolMarker.test.js
//
// ─── A MARKER ON AN OUTPUT THAT READS ANOTHER SYMBOL ─────────────────────────
//
// Measured on production, 2026-11-15, twice (a SPY chart and an NVDA chart): a member asked
// Create Indicator for a relative strength line against SPY with a dot on each new high. The
// assistant wrote it, and the dock refused to apply it:
//
//   "This indicator reads `SPY` (`sym('SPY', …)`), and `SPY`'s bars for this timeframe are
//    not in hand, so every value that reads it is left blank. Nothing on the chart changed."
//
// The same line WITHOUT the dot previewed at once. The gate's refusal carried `pending`
// (the other symbol's bars simply had not arrived yet), `presentationVerdict` dropped the
// flag, and the marker and paint gates treated a not-yet as a never. The alert and
// header-value gates beside them already let a pending refusal through.

import { describe, it, expect } from 'vitest'
import { parseFormula } from '../../engine/ast/parse'
import { applyPatch } from './index'
import { presentationVerdict } from '../authoringIntent'
import { STATUS } from '../../engine/evaluability'

const P = (src) => { const r = parseFormula(src); if (!r.ok) throw new Error(`${src}: ${r.error}`); return r.ast }
const env = (ops) => ({ contract: 'uct.authoring.patch/1', baseRevision: 0, ops, assumptions: [] })
// No other-symbol bars in hand: the state the dock is in the moment a patch first arrives.
const GATE = { tf: 'D', symbol: 'NVDA' }

const RS_HIGH = 'close / sym("SPY", close) >= highest(close / sym("SPY", close), 20)'
const create = (tree) => ({ op: 'create', name: 'RS new high', placement: 'price', outputs: [
  { key: 'rsHigh', label: 'RS new high', tree: P(tree) }] })

describe('a marker or a paint on an output that reads another symbol', () => {
  it('applies while the other symbol\'s bars are still on their way', () => {
    const r = applyPatch(null, env([
      create(RS_HIGH),
      { op: 'set_marker', output: 'rsHigh', shape: 'circle', position: 'aboveBar', color: '#2962FF' },
    ]), { gateCtx: GATE })
    expect(r.status, JSON.stringify(r.errors)).toBe('applied')
    expect(r.definition.plots.find((p) => p.key === 'rsHigh')).toMatchObject({ style: 'markers' })
  })

  it('a background paint on the same output applies too', () => {
    const r = applyPatch(null, env([
      create(RS_HIGH),
      { op: 'set_paint', output: 'rsHigh', channel: 'bgcolor', color: '#2962FF' },
    ]), { gateCtx: GATE })
    expect(r.status, JSON.stringify(r.errors)).toBe('applied')
  })

  it('the verdict says the refusal is not final, so no caller has to guess', () => {
    const r = applyPatch(null, env([create(RS_HIGH)]), { gateCtx: GATE })
    expect(r.status, JSON.stringify(r.errors)).toBe('applied')
    const v = presentationVerdict(r.definition, 'rsHigh',
      { marker: { shape: 'circle', position: 'aboveBar' } }, GATE)
    if (v.status === STATUS.REFUSED) expect(v.pending).toBe(true)
    else expect(v.status).toBe(STATUS.SUPPORTED)
  })

  it('⛔ CONTROL: a refusal that IS final still refuses the marker', () => {
    // `ADVN` also names a market index elsewhere, so the engine refuses it by name and never
    // fetches it: not a not-yet. The fix must not have turned every other-symbol refusal into a pass.
    const r = applyPatch(null, env([
      create('close / sym("ADVN", close) >= highest(close / sym("ADVN", close), 20)'),
      { op: 'set_marker', output: 'rsHigh', shape: 'circle', position: 'aboveBar', color: '#2962FF' },
    ]), { gateCtx: GATE })
    expect(r.status).not.toBe('applied')
  })

  it('⛔ CONTROL: a marker on an ordinary output is unchanged', () => {
    const r = applyPatch(null, env([
      { op: 'create', name: 'Cross', placement: 'price', outputs: [
        { key: 'up', label: 'Up', tree: P('crossOver(close, ema(close, 20))') }] },
      { op: 'set_marker', output: 'up', shape: 'arrowUp', position: 'belowBar', color: '#089981' },
    ]), { gateCtx: GATE })
    expect(r.status, JSON.stringify(r.errors)).toBe('applied')
  })
})
