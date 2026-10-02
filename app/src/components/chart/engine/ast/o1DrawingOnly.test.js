// app/src/components/chart/engine/ast/o1DrawingOnly.test.js
//
// ─── O1 (step 67) — DRAWING-ONLY SCRIPTS: the rails for what this lane changed ──
//
// `docs/pine/vendor-harness/objects-triage-2026-09-28.md`, section O1, holds the
// triage of the 33 `pine:no-output` + 6 `pine:object-removal-lost` corpus
// scripts. Every rail here has a control that must stay as it was.
import { describe, it, expect } from 'vitest'
import { translatePine } from './pine'

const LF = String.fromCharCode(10)
const v5 = (...lines) => ['//@version=5', 'indicator("t", overlay=true)', ...lines].join(LF)
const host = (s) => translatePine(s, { strict: true })
const diag = (t) => t.objectDiagnostics || {}

describe('O1 — the sentence behind a dropped create (`createDropWhy`)', () => {
  it('a create dropped for a refused coordinate names the slot and the refusal', () => {
    const t = host(v5(
      'x = 0.0',
      'for i = 0 to 3',
      '    x := x + close[i]',
      'if barstate.islast',
      '    label.new(bar_index, x, "t")',
    ))
    expect(diag(t).dropReasons['create:label']).toBe(1)
    const why = diag(t).createDropWhy || []
    expect(why.length).toBe(1)
    expect(why[0]).toMatch(/^create label@7 y: pine:reassign /)
  })

  it('⛔ CONTROL — a create that converts records no sentence', () => {
    const t = host(v5('if barstate.islast', '    label.new(bar_index, close, "t")'))
    expect(diag(t).droppedOps).toBe(0)
    expect(diag(t).createDropWhy).toBeUndefined()
  })

  it('a guard the reader refuses keeps its sentence beside its short name', () => {
    const t = host(v5(
      'x = 0.0',
      'for i = 0 to 3',
      '    x := x + close[i]',
      'if x > 0',
      '    label.new(bar_index, close, "t")',
    ))
    const short = diag(t).guardRefusals || []
    const long = diag(t).guardRefusalWhy || []
    expect(short.length).toBeGreaterThan(0)
    expect(long.length).toBe(short.length)
    expect(long[0].startsWith(`${short[0]} :: `)).toBe(true)
  })
})
