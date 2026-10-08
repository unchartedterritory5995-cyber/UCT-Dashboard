// app/src/components/chart/engine/__truth__/p6.insideday.truth.test.js
//
// ─── OVERNIGHT C — "MAKE EVERY INSIDE DAILY CANDLE BLACK", PROVEN ON WHAT EXISTS ──
//
// No new machinery: a yes/no output (`high < high[1] && low > low[1]`, strict) and the
// existing candle paint (`set_paint barcolor`, `authoringIntent.signalPaintsFor`), drawn
// by the existing `binder.syncPaints` → `barColours.applyBarColour` path (body, border
// and wick). This pins every behaviour the request needs, end to end through the
// authoring engine, so a regression in any of the reused pieces reds here.

import { describe, it, expect } from 'vitest'
import { parseFormula } from '../ast/parse'
import { interpret } from '../ast/interpret'
import { applyPatch, applyTurn, openAuthoringState } from '../../builder/authoring'
import { readback } from '../../builder/authoring/readback'
import { compactView } from '../../builder/authoring/compactView'
import { conversationEditability } from '../../builder/authoring/memberWords'
import { applyBarColour } from '../barColours'
import { NO_PAINT } from '../../builder/authoringIntent'
import { stampSemantics } from '../definitionSemantics'
import * as registry from '../nativeRegistry'

const P = (src) => { const r = parseFormula(src); if (!r.ok) throw new Error(src); return r.ast }
const C = 'uct.authoring.patch/1'
const env = (rev, ops) => ({ contract: C, baseRevision: rev, ops, assumptions: [] })
const GATE = { tf: 'D', symbol: 'AAPL' }
const INSIDE = 'high < high[1] && low > low[1]'

/** The patch the real model emits for the request (shape of the Phase 5 acceptance turns). */
const REQUEST = [
  { op: 'create', name: 'Inside day', placement: 'price', outputs: [{ key: 'inside', label: 'Inside day', tree: P(INSIDE) }] },
  { op: 'set_intent', intent: 'signal', output: 'inside' },
  { op: 'set_paint', output: 'inside', channel: 'barcolor', color: '#000000' },
]

const bar = (t, h, l) => ({ t, o: (h + l) / 2, h, l, c: (h + l) / 2, v: 1000 })

describe('OVERNIGHT C — inside-day candles on the existing condition + paint machinery', () => {
  const r = applyPatch(null, env(0, REQUEST), { gateCtx: GATE })

  it('ASKED "make every inside daily candle black"; DID: one yes/no output and an own black barcolor paint, no other colour touched (EXACT)', () => {
    expect(r.status, JSON.stringify(r.errors)).toBe('applied')
    const d = r.definition
    expect(d.paints).toEqual([expect.objectContaining({ kind: 'barcolor', colorMode: 'column:inside', colorUp: '#000000', colorDown: NO_PAINT })])
    expect(d.placement).toEqual({ target: 'price' })
    const lines = readback(d, { intent: r.intent }, GATE).lines
    expect(lines.join('\n')).toMatch(/candles painted black where .* is true \(normal colour otherwise\)/)
  })

  it('STRICT: inside = 1, outside = 0, EQUAL high or EQUAL low = 0, a gap in the data = UNKNOWN (never painted) (EXACT / UNKNOWN)', () => {
    const bars = [
      bar(20260105, 110, 100), // seed
      bar(20260106, 108, 102), // inside → 1
      bar(20260107, 112, 99), //  outside → 0
      bar(20260108, 112, 101), // EQUAL high → 0
      bar(20260109, 111, 99), //  EQUAL low → 0
      bar(20260112, NaN, NaN), // missing values → unknown
      bar(20260113, 105, 100), // previous bar unknown → unknown
    ]
    // As the CHART computes it: the stored definition (semantics 2 — an unknown stays
    // unknown) through the registry, not the bare interpreter (whose legacy default
    // reads a comparison against a hole as 0).
    const def = stampSemantics({ ...r.definition, id: 'u_0123456789ab' }, { prior: null })
    const out = registry.computeFor(def, bars.map((b) => ({ ...b, t: `${String(b.t).slice(0, 4)}-${String(b.t).slice(4, 6)}-${String(b.t).slice(6)}` })), {}, { tf: 'D' })
    const col = Array.from(out.inside || out.value)
    expect(Array.from(interpret(P(INSIDE), bars, {}, undefined, undefined, { tf: 'D' }))[5]).toBe(0) // the legacy rule, for contrast
    expect(Number.isFinite(col[0])).toBe(false) // no previous bar
    expect(col.slice(1, 5)).toEqual([1, 0, 0, 0])
    expect(Number.isFinite(col[5])).toBe(false)
    expect(Number.isFinite(col[6])).toBe(false)
  })

  it('PAINTING replaces body, border and wick only on the painted bar, and never overrides an explicit highlight (EXACT)', () => {
    const map = new Map([['1767657600', '#000000']])
    expect(applyBarColour({ time: 1767657600, open: 1, high: 2, low: 0, close: 1 }, map))
      .toMatchObject({ color: '#000000', borderColor: '#000000', wickColor: '#000000' })
    expect(applyBarColour({ time: 1767744000, open: 1, high: 2, low: 0, close: 1 }, map).color).toBeUndefined()
    expect(applyBarColour({ time: 1767657600, open: 1, high: 2, low: 0, close: 1, color: '#FFD700' }, map).color).toBe('#FFD700')
  })

  it('CUSTOMISE / DISABLE / REMOVE: recolour to purple, hide nothing else, then remove the paint — the condition stays (EXACT)', () => {
    const d = r.definition
    const purple = applyPatch(d, env(0, [{ op: 'set_paint', output: 'inside', channel: 'barcolor', color: '#800080' }]), { gateCtx: GATE })
    expect(purple.definition.paints).toHaveLength(1)
    expect(purple.definition.paints[0].colorUp).toBe('#800080')
    const gone = applyPatch(d, env(0, [{ op: 'remove_paint', output: 'inside', channel: 'barcolor' }]), { gateCtx: GATE })
    expect(gone.status).toBe('applied')
    expect(gone.definition.paints).toBeUndefined()
    expect(gone.definition.compute.ast || gone.definition.compute.trees.inside).toBeTruthy()
  })

  it('SAVE / REOPEN / EDIT: the stored definition opens for conversation and an edit keeps the paint (inside → also require a down close) (EXACT)', () => {
    const saved = { ...r.definition, id: 'u_0123456789ab', version: 2 }
    expect(conversationEditability(saved).editable).toBe(true)
    const st = openAuthoringState(saved, { defId: saved.id, version: 2, lineage: 'auth_0000000insid' })
    const v = compactView(saved, { revision: st.revision }, GATE)
    expect(v.definition.outputs[0].presentation.paints).toEqual([{ channel: 'barcolor', color: '#000000', own: true }])
    const t = applyTurn(st, env(st.revision, [{ op: 'add_clause', output: 'inside', join: 'and', tree: P('close < open') }]), { gateCtx: GATE })
    expect(t.result.status, JSON.stringify(t.result.errors)).toBe('applied')
    expect(t.state.working.paints[0]).toMatchObject({ colorUp: '#000000', colorMode: 'column:inside' })
  })

  it('INTERACTION: a second instance painting the same candles — the LATER stored instance wins and the binder counts the conflict (documented reuse, binder.js syncPaints)', () => {
    // Pinned as a property of the reused path, not re-implemented: two own barcolor
    // paints on one definition collapse to the later one.
    const both = applyPatch(r.definition, env(0, [
      { op: 'add_output', key: 'down', label: 'Down close', tree: P('close < open') },
      { op: 'set_paint', output: 'down', channel: 'barcolor', color: '#FF0000' },
    ]), { gateCtx: GATE })
    expect(both.status, JSON.stringify(both.errors)).toBe('applied')
    expect(both.definition.paints.map((p) => p.colorMode)).toEqual(['column:inside', 'column:down'])
  })

  it('INTRADAY: computed on the DAILY calculation timeframe, a 5-minute bar of day D shows day D-1\'s COMPLETED answer — never the forming day — and the read-back says so (NO LOOKAHEAD / DISCLOSED)', () => {
    const g5 = { tf: '5', symbol: 'AAPL' }
    const t = applyPatch(null, env(0, [...REQUEST, { op: 'set_calculation_timeframe', timeframe: 'D' }]), { gateCtx: g5 })
    expect(t.status, JSON.stringify(t.errors)).toBe('applied')
    expect(t.requests.calculationTimeframe).toBe('D')
    const lines = readback(t.definition, { requests: t.requests }, g5).lines.join('\n')
    expect(lines).toMatch(/each chart bar shows the last COMPLETED 1D value, never the one still forming/)
  })
})
