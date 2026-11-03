// app/src/components/chart/engine/__tests__/w3CapturedCells.vendor.test.js
//
// ─── ⭐⭐ W3-S1 (2026-11-02) — THE CAPTURED TABLE CELLS, THROUGH THE LIVE MEMBER DOOR ─
//
// The four committed captures that carry `tableCells` (artemis-oscillator-pro,
// ema-ribbon-trend-filter-strixedge, position-size-calc, vdubus-pattern-gen-v2; RDDT 1D
// and SPY 1D each) are drawn through the member door (`enterMemberDoor` → `objectReaderFor`
// → `evaluateObjects` → `toRenderState`) and every cell that draws is held to
// TradingView's text at the same table position, column and row. Two things are pinned:
//
//   1. EVERY DRAWN CELL'S TEXT EQUALS THE VENDOR'S — a cell this engine draws that
//      TradingView did not draw, or draws differently, is a red here;
//   2. HOW MANY CELLS DRAW, per capture — measured on 2026-11-02 before the S1 text
//      change landed (`PINNED`), so a cell that drew then and stops drawing is a red, and a
//      capability that makes one more cell draw raises the number deliberately, in the
//      same commit, with its text proven by (1).
//
// ⛔ vdubus draws no cells on either capture (its dashboard is off by default, and
// TradingView drew none either): the pinned count is 0 and the rail still runs it, so a
// cell this engine starts drawing where the vendor drew nothing is caught.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { HARNESS_DIR } from './vendorHarness/harness'
import { enterMemberDoor, toProductBars, tfCodeOf, HARNESS_DEF_ID } from './vendorHarness/ourSide'
import * as registry from '../nativeRegistry'
import { objectReaderFor } from '../objectColumns'
import { evaluateObjects } from '../objectRuntime'
import { toRenderState } from '../objectRenderState'

/** [capture id, symbol] → the number of cells this engine drew on 2026-11-02 (before S1). */
const PINNED = {
  'artemis-oscillator-pro-rddt-1d-2026-09-28': [{ ticker: 'RDDT', exchange: 'NYSE' }, -1],
  'artemis-oscillator-pro-spy-1d-2026-10-03': [{ ticker: 'SPY', exchange: 'AMEX' }, -1],
  'ema-ribbon-trend-filter-strixedge-rddt-1d-2026-09-28': [{ ticker: 'RDDT', exchange: 'NYSE' }, -1],
  'ema-ribbon-trend-filter-strixedge-spy-1d-2026-10-03': [{ ticker: 'SPY', exchange: 'AMEX' }, -1],
  'position-size-calc-rddt-1d-2026-09-28': [{ ticker: 'RDDT', exchange: 'NYSE' }, -1],
  'position-size-calc-spy-1d-2026-10-03': [{ ticker: 'SPY', exchange: 'AMEX' }, -1],
  'vdubus-pattern-gen-v2-restored-refined-rddt-1d-2026-09-28': [{ ticker: 'RDDT', exchange: 'NYSE' }, 0],
  'vdubus-pattern-gen-v2-restored-refined-spy-1d-2026-10-03': [{ ticker: 'SPY', exchange: 'AMEX' }, 0],
}

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
    return { state: toRenderState(run.live, { bars, tf }), records: cap.objects.records }
  } finally { registry.uninstallUserDefinition(HARNESS_DEF_ID) }
}

/** The vendor's cells keyed by `position|col|row` (a table is named by its position: every
 *  capture here places each table at its own position). */
function vendorCellsOf(records) {
  const posOf = new Map((records.tables || []).map((t) => [t.id, t.pos]))
  const out = new Map()
  for (const c of records.tableCells || []) out.set(`${posOf.get(c.tid)}|${c.col}|${c.row}`, c.t)
  return out
}

describe('⭐⭐ every drawn cell is TradingView\'s, and the drawn count is the pinned one', () => {
  it.each(Object.entries(PINNED))('%s', (id, [symbol, pinnedCount]) => {
    const { state, records } = drawCapture(id, symbol)
    const vendor = vendorCellsOf(records)
    expect(new Set((records.tables || []).map((t) => t.pos)).size, 'one table per position').toBe((records.tables || []).length)
    const drawn = []
    for (const tb of state.tables) {
      for (const c of tb.cells) {
        if (typeof c.text !== 'string') continue
        const key = `${tb.position}|${c.col}|${c.row}`
        expect(vendor.has(key), `${id}: a cell drawn at ${key} that TradingView did not draw`).toBe(true)
        expect(c.text, `${id}: the text at ${key}`).toBe(vendor.get(key))
        drawn.push(key)
      }
    }
    expect(drawn.length, `${id}: cells drawn`).toBe(pinnedCount)
  }, 120000)
})
