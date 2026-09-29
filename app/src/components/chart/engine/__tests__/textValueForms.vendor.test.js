// app/src/components/chart/engine/__tests__/textValueForms.vendor.test.js
//
// ─── ⭐⭐ TEXT VALUES A BINDING SETTLES (C15, objects-triage step 13) ──────────
//
// Two text forms, both measured on ema-ribbon-trend-filter-strixedge
// (`//@version=6`, NYSE:RDDT 1D, 2026-09-28):
//
//   `syminfo.ticker` in a cell      TradingView "RDDT"; this engine printed
//                                   "NaN" — a `symtext` tree nothing evaluates,
//                                   formatted as a number.
//   `timeframe.period == "D"`       TradingView "   1D" (the period is NOT "D" on
//   choosing a cell's text          a v6 daily chart); this engine answers "D"
//                                   for every version and drew "► 1D".
//
// The first is SERVED, from the binding's own constants. The second is
// WITHHELD: the spelling is one value three lanes read, so it is not changed
// from inside object text — but a text whose choice flips on it is not drawn.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { HARNESS_DIR } from './vendorHarness/harness'
import { enterMemberDoor, toProductBars, tfCodeOf, HARNESS_DEF_ID } from './vendorHarness/ourSide'
import * as registry from '../nativeRegistry'
import { objectReaderFor } from '../objectColumns'
import { evaluateObjects } from '../objectRuntime'
import { toRenderState } from '../objectRenderState'
import { translatePine } from '../ast/pine.js'

const RIBBON = 'ema-ribbon-trend-filter-strixedge-rddt-1d-2026-09-28'

function drawCapture(id, symbol) {
  const cap = JSON.parse(fs.readFileSync(path.join(HARNESS_DIR, `${id}.json`), 'utf8'))
  const door = enterMemberDoor(cap.source.text)
  try {
    expect(door.def, door.refusal || '').toBeTruthy()
    const bars = toProductBars(cap)
    const tf = tfCodeOf(cap.timeframe)
    const reader = objectReaderFor(door.def, bars, {
      inputs: undefined, tf, symbol, newestBarIsForming: cap.newestBarIsForming ?? null,
    })
    const run = evaluateObjects(reader.program, { barCount: bars.length, readNode: reader.readNode, readTime: reader.readTime })
    return { run, state: toRenderState(run.live, { bars, tf }), records: cap.objects.records }
  } finally { registry.uninstallUserDefinition(HARNESS_DEF_ID) }
}
const cellAt = (state, col, row) => state.tables[0].cells.find((c) => c.col === col && c.row === row)

describe('⭐ `syminfo.ticker` in a cell is the symbol\'s text', () => {
  it('⭐⭐ ema-ribbon\'s footer: "RDDT", as TradingView drew it', () => {
    const { state, records } = drawCapture(RIBBON, { ticker: 'RDDT', exchange: 'NYSE' })
    const vendor = records.tableCells.find((c) => c.col === 3 && c.row === 11)
    expect(vendor.t).toBe('RDDT')
    expect(cellAt(state, 3, 11).text).toBe(vendor.t)
  }, 60000)

  it('⛔ CONTROL — a binding that does not know the symbol draws NO footer, never "NaN"', () => {
    const { run, state } = drawCapture(RIBBON, undefined)
    expect(cellAt(state, 3, 11)).toBeUndefined()
    expect(state.dropped.cell).toBeGreaterThan(0)
    expect(run.stats.textsWithheld).toBeGreaterThan(0)
    expect(state.tables[0].cells.map((c) => c.text)).not.toContain('NaN')
  }, 60000)
})

describe('⛔ a text that flips on how a v6 `timeframe.period` is spelled is withheld', () => {
  it('⭐⭐ ema-ribbon row 9: the vendor drew "   1D", and we no longer draw "► 1D"', () => {
    const { state, records } = drawCapture(RIBBON, { ticker: 'RDDT', exchange: 'NYSE' })
    expect(records.tableCells.find((c) => c.col === 0 && c.row === 9).t).toBe('   1D')
    expect(cellAt(state, 0, 9)).toBeUndefined()
    // ⛔ CONTROL — its neighbours compare the period with a code BOTH spellings
    // answer alike ("15", "60", "240"), and they still draw, matching the vendor
    for (const row of [6, 7, 8]) {
      const v = records.tableCells.find((c) => c.col === 0 && c.row === row)
      expect(cellAt(state, 0, row) && cellAt(state, 0, row).text, `row ${row}`).toBe(v.t)
    }
  }, 60000)

  const LF = String.fromCharCode(10)
  const Q = String.fromCharCode(34)
  const cellOps = (version, cmp) => {
    const src = `//@version=${version}${LF}indicator(${Q}t${Q}, overlay = true)${LF}`
      + `var t = table.new(position.top_right, 1, 1)${LF}`
      + `if barstate.islast${LF}    table.cell(t, 0, 0, timeframe.period == ${Q}${cmp}${Q} ? ${Q}a${Q} : ${Q}b${Q})${LF}`
    const tr = translatePine(src, { strict: true, objects: true })
    return { cells: (tr.objects ? tr.objects.ops : []).filter((o) => o.k === 'cell'), diag: tr.objectDiagnostics }
  }

  it('⛔ v6, `== "D"`: refused by name', () => {
    const { cells, diag } = cellOps(6, 'D')
    expect(cells).toHaveLength(0)
    expect(diag.textFormatRefusals['timeframe.period:v6-spelling']).toBe(1)
  })

  it('⛔ CONTROLS — v5 `== "D"` and v6 `== "15"` still draw', () => {
    expect(cellOps(5, 'D').cells).toHaveLength(1)
    expect(cellOps(6, '15').cells).toHaveLength(1)
  })
})

describe('⭐⭐ a long concatenation of named texts is read to its end', () => {
  // ⚰️ `openName` was handed the TEXT walk's depth and refused past 8 — a hop
  // guard read as a nesting guard — so the ninth name in a `+` chain fell to the
  // numeric last resort and the whole text was dropped, unnamed.
  // MEASURED on reverse-stochastic-momentum-index-on-chart: its info box is one
  // label whose longer arm is nine concatenations; it is served now, character
  // for character (below).
  const LF = String.fromCharCode(10)
  const Q = String.fromCharCode(34)
  const labelText = (n) => {
    const names = Array.from({ length: n }, (_, i) => `n${i}`)
    const src = `//@version=5${LF}indicator(${Q}t${Q}, overlay = true)${LF}`
      + names.map((nm, i) => `${nm} = ${Q}${String.fromCharCode(97 + i)}${Q}${LF}`).join('')
      + `if barstate.islast${LF}    label.new(bar_index, close, ${names.join(' + ')})${LF}plot(close)${LF}`
    const tr = translatePine(src, { strict: true, objects: true })
    return { ops: (tr.objects ? tr.objects.ops : []).filter((o) => o.k === 'create'), diag: tr.objectDiagnostics }
  }

  it('⭐ twelve names, one text — the label is carried', () => {
    const { ops, diag } = labelText(12)
    expect(ops).toHaveLength(1)
    expect(diag.unresolvedValues).toBe(0)
  })

  it('⛔ CONTROL — eight names were carried before the fix too (the shape, not the length, is the case)', () => {
    expect(labelText(8).ops).toHaveLength(1)
  })

  it('⭐⭐ rsmi: the vendor\'s info box, character for character', () => {
    const cap = JSON.parse(fs.readFileSync(path.join(HARNESS_DIR, 'reverse-stochastic-momentum-index-on-chart-rddt-1d-2026-09-28.json'), 'utf8'))
    const door = enterMemberDoor(cap.source.text)
    try {
      expect(door.def, door.refusal || '').toBeTruthy()
      const bars = toProductBars(cap)
      const tf = tfCodeOf(cap.timeframe)
      const reader = objectReaderFor(door.def, bars, { inputs: undefined, tf, symbol: { ticker: 'RDDT', exchange: 'NYSE' }, newestBarIsForming: cap.newestBarIsForming ?? null })
      const run = evaluateObjects(reader.program, { barCount: bars.length, readNode: reader.readNode, readTime: reader.readTime })
      const held = run.live.filter((o) => o.family === 'label')
      expect(held.map((o) => o.props.text)).toEqual(cap.objects.records.labels.map((l) => l.t))
      // ⭐ and the id the vendor's single counter gave it
      expect(held.map((o) => o.id)).toEqual(cap.objects.records.labels.map((l) => l.id))
    } finally { registry.uninstallUserDefinition(HARNESS_DEF_ID) }
  }, 60000)
})

describe('⛔ a text whose READING explodes is refused by name, not walked forever', () => {
  // ⚰️ `s := c ? s + "x" : s`, repeated — both arms name `s`, so reading the text
  // doubles per step. screener-mean-reversion-channel does it forty times, and
  // once names could be opened at any depth that walk hung the member door.
  const LF = String.fromCharCode(10)
  const Q = String.fromCharCode(34)
  // (Written as a chain of DECLARATIONS — `s1 = c ? s0 + "x" : s0` — because a
  // top-level `:=` chain is a reassignment, which is C12's lane, not this one.)
  const accumulate = (n) => `//@version=5${LF}indicator(${Q}t${Q}, overlay = true)${LF}s0 = ${Q}${Q}${LF}`
    + Array.from({ length: n }, (_, i) => `s${i + 1} = close > ${i} ? s${i} + ${Q}x${Q} : s${i}${LF}`).join('')
    + `if barstate.islast${LF}    label.new(bar_index, close, s${n})${LF}plot(close)${LF}`

  it('⛔ sixteen doublings: refused, named, and fast', () => {
    const t0 = Date.now()
    const tr = translatePine(accumulate(16), { strict: true, objects: true })
    expect(Date.now() - t0).toBeLessThan(10000)
    expect((tr.objects ? tr.objects.ops : []).filter((o) => o.k === 'create')).toHaveLength(0)
    expect(tr.objectDiagnostics.textTooLarge.length).toBeGreaterThan(0)
  }, 30000)

  it('⛔ CONTROL — three doublings are an ordinary text and draw', () => {
    const tr = translatePine(accumulate(3), { strict: true, objects: true })
    expect((tr.objects ? tr.objects.ops : []).filter((o) => o.k === 'create')).toHaveLength(1)
    expect(tr.objectDiagnostics.textTooLarge).toBeUndefined()
  })
})
