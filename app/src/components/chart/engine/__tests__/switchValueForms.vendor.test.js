// app/src/components/chart/engine/__tests__/switchValueForms.vendor.test.js
//
// ─── ⭐⭐ `size.*` / `position.*` / text computed by a `switch` (C15, objects-triage step 13) ─
//
// The corpus computes an enum VALUE from a member's menu with a `switch`:
//
//   string tblSize = switch tblSizeIn          (ema-ribbon-trend-filter-strixedge)
//       "Small" => size.small  …                — no default arm; `options` covers every arm
//   posOf(string p) => switch p                (artemis-oscillator-pro)
//       "Top Right" => position.top_right  …  => position.bottom_left
//   mtfLabel(string tf) => switch tf  …  => tf  (artemis — TEXT, with a parameter default)
//
// Before this the object reader could not read a `switch` at all: every cell's
// `text_size` was DROPPED (the renderer's default, not the author's choice) and
// every artemis table sat in the default corner. The vendor's own records carry
// the answer — `ts` on every cell, `pos` on every table — so that is what is
// asserted here, through the member door, on the vendor's bars.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { HARNESS_DIR } from './vendorHarness/harness'
import { enterMemberDoor, toProductBars, tfCodeOf, HARNESS_DEF_ID } from './vendorHarness/ourSide'
import * as registry from '../nativeRegistry'
import { objectReaderFor } from '../objectColumns'
import { evaluateObjects } from '../objectRuntime'
import { toRenderState } from '../objectRenderState'
import { buildObjectLane, runObjectLane } from '../runtime/objectLane.js'
import { translatePine } from '../ast/pine.js'

/** The member door on the capture's own bars → our render state + the vendor's records. */
function drawCapture(id) {
  const cap = JSON.parse(fs.readFileSync(path.join(HARNESS_DIR, `${id}.json`), 'utf8'))
  const door = enterMemberDoor(cap.source.text)
  try {
    expect(door.def, door.refusal || '').toBeTruthy()
    const bars = toProductBars(cap)
    const tf = tfCodeOf(cap.timeframe)
    const reader = objectReaderFor(door.def, bars, {
      inputs: undefined, tf, symbol: { ticker: 'RDDT', exchange: 'NYSE' }, newestBarIsForming: cap.newestBarIsForming ?? null,
    })
    const run = evaluateObjects(reader.program, { barCount: bars.length, readNode: reader.readNode, readTime: reader.readTime })
    return { state: toRenderState(run.live, { bars, tf }), records: cap.objects.records }
  } finally { registry.uninstallUserDefinition(HARNESS_DEF_ID) }
}

describe('⭐⭐ against the vendor\'s records', () => {
  it('⭐ ema-ribbon: every cell carries the vendor\'s `text_size` — from a default-less `switch`', () => {
    const { state, records } = drawCapture('ema-ribbon-trend-filter-strixedge-rddt-1d-2026-09-28')
    const ours = new Map(state.tables[0].cells.map((c) => [`${c.col},${c.row}`, c.text_size]))
    const compared = records.tableCells.filter((c) => ours.has(`${c.col},${c.row}`))
    expect(compared.length).toBeGreaterThan(30)           // NON-VACUITY — most of the 48 are drawn
    for (const c of compared) expect(ours.get(`${c.col},${c.row}`), `cell ${c.col},${c.row}`).toBe(c.ts)
    expect(new Set(compared.map((c) => c.ts))).toEqual(new Set(['small']))
  }, 60000)

  it('⭐ artemis: three tables in the three corners the vendor drew — from `posOf`\'s `switch`', () => {
    const { state, records } = drawCapture('artemis-oscillator-pro-rddt-1d-2026-09-28')
    expect(state.tables.map((t) => t.position)).toEqual(records.tables.map((t) => t.pos))
    // ⛔ CONTROL — they are not all the default corner
    expect(new Set(records.tables.map((t) => t.pos)).size).toBe(3)
  }, 60000)

  it('⭐ artemis: the MTF column labels come out of `mtfLabel`\'s `switch`, text for text', () => {
    const { state, records } = drawCapture('artemis-oscillator-pro-rddt-1d-2026-09-28')
    const mtf = state.tables[1]
    const vendorMtfId = records.tables[1].id
    for (const row of [1, 2, 3, 4]) {
      const v = records.tableCells.find((c) => c.tid === vendorMtfId && c.col === 0 && c.row === row)
      const o = mtf.cells.find((c) => c.col === 0 && c.row === row)
      expect(o && o.text, `MTF row ${row}`).toBe(v.t)
    }
  }, 60000)
})

describe('the rule, one clause at a time, on the runtime lane', () => {
  const LF = String.fromCharCode(10)
  const Q = String.fromCharCode(34)
  const N = 5
  const BARS = Array.from({ length: N }, (_, i) => ({ t: 1700000000 + i * 86400, o: 1, h: 2, l: 0.5, c: 1.5, v: 10 }))
  const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))
  const table = (decls, pos, size) => `//@version=6${LF}indicator(${Q}t${Q}, overlay = true)${LF}${decls}`
    + `var t = table.new(${pos}, 1, 1)${LF}if barstate.islast${LF}    table.cell(t, 0, 0, ${Q}x${Q}, text_size = ${size})${LF}`
  const draw = (src) => {
    const lane = buildObjectLane(src, { tf: 'D', newestBarIsForming: false, bars: BARS })
    expect(lane.ok, lane.ok ? '' : `refused ${(lane.refusal || {}).guard}`).toBe(true)
    const r = runObjectLane(lane, { bars: N, series: SERIES, confirmed: true, readTime: (i) => BARS[i].t })
    return toRenderState(r.live, { bars: BARS, tf: 'D' }).tables[0]
  }
  const sizeSwitch = (options, arms) => `sz = input.string(${Q}Large${Q}, ${Q}s${Q}, options = [${options.map((o) => Q + o + Q).join(', ')}])${LF}`
    + `string s = switch sz${LF}${arms.map(([k, v]) => `    ${Q}${k}${Q} => ${v}`).join(LF)}${LF}`

  it('⭐ a default-less switch whose arms cover every option: the member\'s pick is the value', () => {
    const t = draw(table(sizeSwitch(['Small', 'Large'], [['Small', 'size.small'], ['Large', 'size.large']]), 'position.bottom_left', 's'))
    expect(t.cells[0].text_size).toBe('large')
    expect(t.position).toBe('bottom_left')
  })

  it('⛔ CONTROL — an option no arm covers could be `na`, so the size is dropped, not guessed', () => {
    const src = table(sizeSwitch(['Small', 'Large', 'Huge'], [['Small', 'size.small'], ['Large', 'size.large']]), 'position.bottom_left', 's')
    const t = translatePine(src, { strict: true, objects: true })
    const cell = t.objects.ops.find((o) => o.k === 'cell')
    expect(cell, 'the cell itself still draws').toBeTruthy()
    expect(cell.props.text_size).toBeUndefined()
    expect(t.objectDiagnostics.enumUnreadable).toBe(1)
    // …and the covered version of the same script DOES carry it (same reader, one option less)
    const covered = translatePine(src.replace(`, ${String.fromCharCode(34)}Huge${String.fromCharCode(34)}`, ''), { strict: true, objects: true })
    expect(covered.objects.ops.find((o) => o.k === 'cell').props.text_size).toBeTruthy()
  })

  it('⭐ a function whose body is a switch, with a default arm, places the table', () => {
    const fn = `posOf(string p) =>${LF}    switch p${LF}        ${Q}TR${Q} => position.top_right${LF}        => position.bottom_left${LF}`
      + `where = input.string(${Q}TR${Q}, ${Q}w${Q})${LF}`
    expect(draw(table(fn, 'posOf(where)', 'size.small')).position).toBe('top_right')
    // ⛔ CONTROL — the default arm answers when the pick matches nothing
    const other = fn.replace(`input.string(${Q}TR${Q}`, `input.string(${Q}XX${Q}`)
    expect(draw(table(other, 'posOf(where)', 'size.small')).position).toBe('bottom_left')
  })
})
