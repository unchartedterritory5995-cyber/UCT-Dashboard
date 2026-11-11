// app/src/components/chart/engine/__tests__/w3CapturedCells.vendor.test.js
//
// ─── ⭐⭐ W3-S1 (2026-11-02) — THE CAPTURED TABLE CELLS, THROUGH THE HARNESS'S OWN DOOR ─
//
// The four committed captures that carry `tableCells` (artemis-oscillator-pro,
// ema-ribbon-trend-filter-strixedge, position-size-calc, vdubus-pattern-gen-v2; RDDT 1D
// and SPY 1D each) are drawn by `runOurSide` — the member door, the capture's own listing
// and `bar_index` facts, the objects-only pane armed as `vendorHarness.c22Vdubus` arms it
// — and every cell that draws is held to TradingView's text at the same table position,
// column and row. Two things are pinned:
//
//   1. EVERY DRAWN CELL'S TEXT EQUALS THE VENDOR'S — a cell this engine draws that
//      TradingView did not draw, or draws differently, is a red here;
//   2. HOW MANY CELLS DRAW, per capture — `PINNED` is the count the MERGE BASE drew
//      (30bdc91367, measured 2026-11-02 before the S1 text change), so a cell that drew
//      on master and stops drawing is a red, and a capability that makes one more cell
//      draw raises the number deliberately, in the same commit, with its text proven by (1).
//
// ⛔ vdubus draws no cells on either capture (its dashboard is off by default, and
// TradingView drew none either): the rail still runs it, so a cell this engine starts
// drawing where the vendor drew nothing is caught.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import path from 'node:path'

import { HARNESS_DIR, loadCapture } from './vendorHarness/harness'
import { runOurSide } from './vendorHarness/ourSide'

/** capture id → the number of cells the merge base drew (before S1). */
const PINNED = {
  'artemis-oscillator-pro-rddt-1d-2026-09-28': 16,
  // ⭐ DIV-1 RE-PIN (2026-11-09): was 15. The SPY capture is now replayed over SPY's proved
  // history from its listing (as the member's daily chart computes it) and draws the same
  // 16 TradingView cells as RDDT, which starts at its listing (TradingView draws 21).
  'artemis-oscillator-pro-spy-1d-2026-10-03': 16,
  'ema-ribbon-trend-filter-strixedge-rddt-1d-2026-09-28': 37,
  'ema-ribbon-trend-filter-strixedge-spy-1d-2026-10-03': 37,
  'position-size-calc-rddt-1d-2026-09-28': 9,
  'position-size-calc-spy-1d-2026-10-03': 9,
  'vdubus-pattern-gen-v2-restored-refined-rddt-1d-2026-09-28': 0,
  'vdubus-pattern-gen-v2-restored-refined-spy-1d-2026-10-03': 0,
}

beforeAll(() => { vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1') })
afterAll(() => { vi.unstubAllEnvs() })

/** The vendor's cells keyed by `position|col|row` (a table is named by its position:
 *  the rail asserts each capture places each table at its own position). */
function vendorCellsOf(records) {
  const posOf = new Map((records.tables || []).map((t) => [t.id, t.pos]))
  const out = new Map()
  for (const c of records.tableCells || []) out.set(`${posOf.get(c.tid)}|${c.col}|${c.row}`, c.t)
  return out
}

describe('⭐⭐ every drawn cell is TradingView\'s, and the drawn count is the merge base\'s', () => {
  it.each(Object.entries(PINNED))('%s', (id, pinnedCount) => {
    const loaded = loadCapture(path.join(HARNESS_DIR, `${id}.json`))
    expect(loaded.capture, loaded.reason).toBeTruthy()
    const records = loaded.capture.objects.records
    const ours = runOurSide(loaded.capture)
    expect(ours.ok, ours.refusal || '').toBe(true)
    const vendor = vendorCellsOf(records)
    expect(new Set((records.tables || []).map((t) => t.pos)).size, 'one table per position').toBe((records.tables || []).length)
    const drawn = []
    const tables = (ours.objects && ours.objects.ok && ours.objects.tables) || []
    for (const tb of tables) {
      for (const c of tb.cells || []) {
        const key = `${tb.position}|${c.col}|${c.row}`
        expect(vendor.has(key), `${id}: a cell drawn at ${key} that TradingView did not draw`).toBe(true)
        expect(c.text, `${id}: the text at ${key}`).toBe(vendor.get(key))
        drawn.push(key)
      }
    }
    expect(typeof pinnedCount, `${id}: the merge base's count is pinned`).toBe('number')
    expect(drawn.length, `${id}: cells drawn`).toBe(pinnedCount)
  }, 120000)
})
