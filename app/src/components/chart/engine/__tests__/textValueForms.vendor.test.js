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
