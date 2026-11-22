// app/src/components/chart/engine/ast/draw1DrawingObjects.test.js
//
// ─── ⭐⭐ DRAW-1 (2026-11-16) — DRAWING OBJECTS: CASTS, NAMES, `na` ROWS, HEADS ─────────
//
// 1. The runtime lane reads `line(na)`, `label(na)`, `box(na)`, `table(na)`, `linefill(na)` and
//    `polyline(na)` as the reference states them ("Casts na to box"): `na`, typed as that
//    family's handle, so `var b = box(na)` IS `var box b = na`.
// 2. The value build names a drawing read through its method form (`b.get_top()` on a name
//    bound to a drawing) `runtime:object-op`, as it names `box.get_top(b)`, so the member door
//    asks the DRAWING build (`runtimeObjectsDoor.js`). It said "the closed table does not
//    declare this builtin".
// 3. The host lane no longer carries `pine:constant-only` beside a clean object program whose
//    every plot is the literal `na` (a plot of `na` draws nothing on TradingView or here).
// 4. A dropped drawing step (`guard:<kind>`) always carries a guard in `guardRefusals`.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { translatePine, isNaConstantTree } from './pine.js'
import { probeRuntimeProgram } from '../runtime/runtimeColumns'
import { memberPaneDefinition } from '../../builder/memberPane/memberPaneDefinition'

const v5 = (body) => `//@version=5\nindicator("draw1", overlay = true)\n${body}`

describe('DRAW-1 — the drawing casts on the runtime lane', () => {
  const CAST = v5([
    'var b = box(na)',
    'var l = line(na)',
    'if barstate.islast',
    '    b.delete()',
    '    b := box.new(bar_index - 5, high, bar_index, low)',
    '    l := line.new(bar_index - 5, close, bar_index, close)',
    'plot(close)',
  ].join('\n'))

  it('a script that writes `box(na)` / `line(na)` builds with its drawings', () => {
    const p = probeRuntimeProgram(CAST, { objectsInRun: true })
    expect(p.ok, JSON.stringify(p.refusal)).toBe(true)
    expect(p.objectOps).toBeGreaterThanOrEqual(3)
  })

  it('…and the value build stands too (the drawing statements are the object pass\'s)', () => {
    const p = probeRuntimeProgram(CAST)
    expect(p.ok, JSON.stringify(p.refusal)).toBe(true)
  })

  it('CONTROL: a cast of something that is not `na` is not served', () => {
    const p = probeRuntimeProgram(CAST.replace('var b = box(na)', 'var b = box(1)'), { objectsInRun: true })
    expect(p.ok).toBe(false)
  })
})

describe('DRAW-1 — a drawing read by its method form is named a drawing operation', () => {
  const READ = (decl) => v5([
    decl,
    'if barstate.islast',
    '    b := box.new(bar_index - 5, high, bar_index, low)',
    't = b.get_top()',
    'plot(t)',
  ].join('\n'))

  it('`b.get_top()` on `var b = box(na)` refuses `runtime:object-op` in the value build', () => {
    const p = probeRuntimeProgram(READ('var b = box(na)'))
    expect(p.ok).toBe(false)
    expect(p.refusal.guard).toBe('runtime:object-op')
  })

  it('…and on `var box b = na`, the written type, read BEFORE any `b := box.new(…)`', () => {
    // the read stands above the only assignment, so only the declaration's written type says `b` is a box
    const p = probeRuntimeProgram(v5([
      'var box b = na',
      't = b.get_top()',
      'plot(t)',
      'if barstate.islast',
      '    b := box.new(bar_index - 5, high, bar_index, low)',
    ].join('\n')))
    expect(p.ok).toBe(false)
    expect(p.refusal.guard).toBe('runtime:object-op')
  })

  it('CONTROL: a method on a name that holds no drawing keeps its own refusal', () => {
    const p = probeRuntimeProgram(v5(['var float b = na', 'b := close', 't = b.get_top()', 'plot(t)'].join('\n')))
    expect(p.ok).toBe(false)
    expect(p.refusal.guard).not.toBe('runtime:object-op')
  })
})

describe('DRAW-1 — a clean drawing whose every plot is `na` carries no screener refusal on the host lane', () => {
  const ROWS = (extra = '') => v5([
    'show = input.bool(false, "show")',
    'plotshape(show ? close > open : na, "a")',
    extra,
    'var label lb = na',
    'if barstate.islast',
    '    lb := label.new(bar_index, high, "x")',
  ].join('\n'))

  it('the literal `na` is `0 / 0`, and only that', () => {
    expect(isNaConstantTree({ type: 'op', name: '/', args: [{ type: 'num', value: 0 }, { type: 'num', value: 0 }] })).toBe(true)
    expect(isNaConstantTree({ type: 'num', value: 50 })).toBe(false)
    expect(isNaConstantTree({ type: 'op', name: '/', args: [{ type: 'num', value: 1 }, { type: 'num', value: 0 }] })).toBe(false)
  })

  it('host lane: `ok`, no refusal, the drawing program clean', () => {
    const t = translatePine(ROWS(), { strict: true })
    expect(t.ok).toBe(true)
    expect((t.refusals || []).map((r) => r.guard)).toEqual([])
    expect(t.objectDiagnostics.droppedOps).toBe(0)
  })

  it('CONTROL: a constant NUMBER plot (a line TradingView draws, hidden here) keeps `pine:constant-only`', () => {
    const t = translatePine(ROWS('plot(50, "c")'), { strict: true })
    expect((t.refusals || []).map((r) => r.guard)).toContain('pine:constant-only')
  })

  it('CONTROL: the screener lane still has no column to filter on', () => {
    const t = translatePine(ROWS())
    expect(t.ok).toBe(false)
    expect((t.refusals || []).map((r) => r.guard)).toContain('pine:constant-only')
  })
})

describe('DRAW-1 — a dropped drawing step always names a guard', () => {
  const CORPUS = path.resolve(process.cwd(), '..', 'corpus', 'committed')
  // committed scripts whose census rows (engine 60) carried `guard:<kind>` drops with no head
  const FILES = ['fx-market-sessions__3KZoMPYziy.pine', 'htf-liquidity-dashboard-tfo__ec8f8316a4.pine',
    'multi-timeframe-fvg-tfo__adbed9f590.pine', 'smt-divergence-ict-killzones__c932d56665.pine',
    'ict-killzones-pivots-tfo__d0b8be94f1.pine']
  for (const f of FILES) {
    it(f, () => {
      const d = memberPaneDefinition({ source: fs.readFileSync(path.join(CORPUS, f), 'utf8'), id: 'u_draw1', name: 'd' })
      const diag = (d.translation && d.translation.objectDiagnostics) || {}
      const heads = new Set((diag.guardRefusals || []).map((e) => String(e).split('@')[0]))
      const guardKeys = Object.keys(diag.dropReasons || {}).filter((k) => k.startsWith('guard:') && diag.dropReasons[k] > 0)
      expect(guardKeys.length, 'non-vacuous: the script drops a guarded step').toBeGreaterThan(0)
      for (const k of guardKeys) {
        const kind = k.slice('guard:'.length)
        if (kind === 'partial') {
          expect((diag.guardPartial || []).length, k).toBeGreaterThan(0)
          for (const e of diag.guardPartial) expect(String(e)).not.toMatch(/: refused$/)
        } else {
          expect(heads.has(kind), `${k} has no head in ${JSON.stringify(diag.guardRefusals)}`).toBe(true)
        }
      }
    })
  }
})
