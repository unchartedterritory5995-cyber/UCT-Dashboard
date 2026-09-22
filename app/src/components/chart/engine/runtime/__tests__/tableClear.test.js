// app/src/components/chart/engine/runtime/__tests__/tableClear.test.js
//
// ─── ⭐⭐ `table.clear` — A CELL THE AUTHOR REMOVED MUST LEAVE THE DRAWING ────
//
// `table.clear(table_id, start_column, start_row, end_column, end_row)` removes
// every cell in an INCLUSIVE rectangle. Before this file it was read, named in
// `objectDiagnostics.unsupported`, and then DROPPED — no op, no `droppedOps`
// entry, no refusal. The table simply kept the cells the author had deleted.
//
// ⛔⛔ WHY THAT IS A WRONG TABLE AND NOT A MISSING ONE. The corpus idiom, and
// the acceptance dashboard's own line 108, is *clear the rectangle, then
// repopulate it*:
//
//     table.clear(dashboard, 0, 0, 5, MAX_SYMBOLS)
//     table.cell(dashboard, 0, 0, "Symbol", …)      // … and one row per symbol
//
// On a bar where FEWER symbols qualify than the bar before, the rows nobody
// rewrote stay on screen — last bar's numbers under this bar's header, with
// nothing to mark them stale. A member reads that as current data and trusts
// it. Ignoring the clear is not a smaller drawing, it is a confident wrong one,
// which is the single trade this pipeline refuses to make.
//
// ⭐ EVERY POSITIVE CASE HERE IS PAIRED WITH A CONTROL that removes the clear
// line and asserts the cell IS present. Without the pair, "the clear worked" is
// satisfied by a cell that was never written
// (`lesson_a_fixture_that_cannot_distinguish_is_not_a_rail`).
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { translatePine } from '../../ast/pine.js'
import { buildObjectLane, runObjectLane } from '../objectLane.js'

const REPO = path.resolve(process.cwd(), '..')

const N = 4
const BARS = Array.from({ length: N }, (_, i) => (
  { t: 1700000000 + i * 86400, o: 99 + i, h: 101 + i, l: 98 + i, c: 100 + i, v: 1000 + i }))
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))

const head = '//@version=6\nindicator("t", overlay = true)\n'

const build = (body) => buildObjectLane(head + body, { bars: BARS, inputs: {} })

const run = (body) => {
  const lane = build(body)
  if (!lane.ok) throw new Error(`refused by ${lane.lane}: ${lane.refusal.message}`)
  return runObjectLane(lane, { bars: N, series: SERIES })
}

/** The one table's cells, `col,row` → text. Asserts there is exactly one table
 *  for the same reason `objectLane.test.js` does: a `table.new` without `var`
 *  runs every bar, and reaching for the first of four reads bar 0's drawing. */
const cells = (r) => {
  const tables = (r.live || []).filter((o) => o.family === 'table')
  expect(tables.length, 'expected ONE table').toBe(1)
  const out = {}
  for (const c of tables[0].cells || []) out[`${c.col},${c.row}`] = (c.props || c).text
  return out
}

// Three cells in column 0, plus an ANCHOR in column 1.
//
// ⭐ THE ANCHOR EARNS ITS PLACE TWICE. It holds `str.tostring(close)` — a value
// only the runtime lane computes — which is what gives this lane an output at
// all: a table of pure literals refuses at `runtime:no-output` ("a script with
// nothing to plot") before any of this is reached. And because every rectangle
// below names column 0 only, a clear whose COLUMN bounds leak would take the
// anchor with it, which no row-only fixture could see.
const THREE_CELLS = 'var t = table.new(position.top_right, 2, 3)\n'
  + 'table.cell(t, 1, 0, str.tostring(close))\n'
  + 'table.cell(t, 0, 0, "top")\n'
  + 'table.cell(t, 0, 1, "middle")\n'
  + 'table.cell(t, 0, 2, "bottom")\n'

/** `close` on the last of the four bars. */
const ANCHOR = { '1,0': '103' }

describe('⭐⭐ `table.clear` removes the cells it names', () => {
  it('⛔ CONTROL — without the clear, all three cells are in the drawing', () => {
    // If this ever fails, every assertion below is measuring the wrong thing:
    // a cell that was never written is trivially "cleared".
    expect(cells(run(THREE_CELLS)))
      .toEqual({ ...ANCHOR, '0,0': 'top', '0,1': 'middle', '0,2': 'bottom' })
  })

  it('⭐⭐ the five-argument rectangle takes exactly the cells inside it', () => {
    const r = run(`${THREE_CELLS}table.clear(t, 0, 1, 0, 1)\n`)
    expect(r.status).toBe('ok')
    expect(cells(r)).toEqual({ ...ANCHOR, '0,0': 'top', '0,2': 'bottom' })
  })

  it('⭐ the three-argument form defaults end to start — one cell, not the rest', () => {
    // Pine's `end_column`/`end_row` default to `start_column`/`start_row`. A
    // reader that treated the missing pair as 0 would clear (0,0) instead, and a
    // reader that treated it as "to the end" would take the whole column — the
    // fixture's three distinct cells tell all three outcomes apart.
    const r = run(`${THREE_CELLS}table.clear(t, 0, 2)\n`)
    expect(r.status).toBe('ok')
    expect(cells(r)).toEqual({ ...ANCHOR, '0,0': 'top', '0,1': 'middle' })
  })

  it('⭐ a rectangle spanning several rows takes all of them', () => {
    const r = run(`${THREE_CELLS}table.clear(t, 0, 0, 0, 1)\n`)
    expect(r.status).toBe('ok')
    expect(cells(r)).toEqual({ ...ANCHOR, '0,2': 'bottom' })
  })
})

// ── a bound the RUNTIME computes, not a literal ──────────────────────────────
//
// ⭐⭐ THIS CASE EXISTS BECAUSE A MUTATION SURVIVED WITHOUT IT. Every rectangle
// above is written with integer literals, which fold to constants — so deleting
// the `startCol`/`startRow`/`endCol`/`endRow` binding in `bindObjectProgram`
// left all of them GREEN. The binding is what turns a `{v:'tree'}` reference
// into something the runtime can read; unbound, it reads as an unknown kind and
// answers `undefined`, and a bound that is not a whole number clears NOTHING.
// So the failure it guards is a `table.clear` that silently stops working.
//
// ⛔ AND IT IS NOT HYPOTHETICAL: the corpus writes computed bounds —
// `table.clear(plTable, 0, 0, cols - 1, rows - 1)`,
// `table.clear(fpTable, 0, 2, 2 * windowInput + 3, nViewRows + 1)`.
const COMPUTED_BOUNDS = `${THREE_CELLS}clearCol = close > 0 ? 0 : 1\n`
  + 'clearRow = close > 0 ? 1 : 0\n'

describe('⭐ a rectangle whose bounds are COMPUTED', () => {
  it('⛔ CONTROL — the bounds really are runtime values, not folded literals', () => {
    // Both read `close`, so neither can be a constant — which is the whole
    // reason this fixture can see a binding the literal cases cannot.
    expect(COMPUTED_BOUNDS).toMatch(/close > 0 \? 0 : 1/)
    expect(cells(run(COMPUTED_BOUNDS)))
      .toEqual({ ...ANCHOR, '0,0': 'top', '0,1': 'middle', '0,2': 'bottom' })
  })

  it('⭐⭐ takes the cell those bounds name, and only it', () => {
    // `close` is positive on every bar, so the rectangle is (0,1)..(0,1).
    // A bound lost on the way to the runtime clears nothing and leaves
    // "middle" behind; one misread as 0 would take "top" instead. The three
    // distinct cells tell those apart.
    const r = run(`${COMPUTED_BOUNDS}table.clear(t, clearCol, clearRow, clearCol, clearRow)\n`)
    expect(r.status).toBe('ok')
    expect(cells(r)).toEqual({ ...ANCHOR, '0,0': 'top', '0,2': 'bottom' })
  })
})

// ── the failure mode this op exists for, in its real shape ───────────────────
//
// A row written on an EARLIER bar and not rewritten on this one. Every case
// above clears a cell the same bar wrote it, which is the easy half: the hard
// half is that a table persists between bars, so what the author removed has to
// stay removed. This is the shape the acceptance dashboard is in on a bar where
// fewer symbols qualify than the bar before.
const STALE_ROW = 'var t = table.new(position.top_right, 2, 3)\n'
  + 'table.cell(t, 1, 0, str.tostring(close))\n'
  + 'if bar_index < 2\n'
  + '    table.cell(t, 0, 1, "stale")\n'

describe('⛔⛔ a row nobody rewrote does not survive the clear', () => {
  it('⛔ CONTROL — without the clear, bar 0\'s row is STILL on the last bar', () => {
    // This is the bug in one assertion: the table outlives the bar that wrote
    // it, so an ignored clear is not a smaller drawing, it is last bar's data
    // presented as this bar's.
    expect(cells(run(STALE_ROW))).toEqual({ ...ANCHOR, '0,1': 'stale' })
  })

  it('⭐⭐ a later bar\'s clear removes it', () => {
    const r = run(`${STALE_ROW}if bar_index > 2\n    table.clear(t, 0, 1, 0, 1)\n`)
    expect(r.status).toBe('ok')
    expect(cells(r)).toEqual(ANCHOR)
  })
})

// -- and on REAL Pine, not just a fixture ------------------------------------
const CORPUS_DASHBOARD = fs.readFileSync(
  path.join(REPO, 'corpus/committed/strong-start-rvol-dashboard__36140b1cbe.pine'), 'utf8')

describe('⭐ the silent omission is gone', () => {
  it('⭐⭐ a clear reaches the PROGRAM as a real op', () => {
    // ⛔ NOT merely absent from `unsupported` — deleting the diagnostic push
    // would achieve that and change nothing about the drawing. The op has to BE
    // there, which is the difference between the fix and its appearance.
    const t = translatePine(`${head}${THREE_CELLS}table.clear(t, 0, 1, 0, 1)\n`,
      { strict: true })
    expect((t.objects.ops || []).map((o) => o.k)).toContain('clear')
  })

  it('⛔⛔ a real corpus script stops calling it unsupported', () => {
    const t = translatePine(CORPUS_DASHBOARD, { strict: true })
    expect(t.objectDiagnostics.unsupported).not.toContain('table.clear')
  })

  it('and when it still cannot convert, it is COUNTED and NAMED', () => {
    // This script's two clears do NOT reach the program, and that is a
    // pre-existing limit unrelated to this op: both sit under a guard the
    // converter cannot translate, which is the same reason 8 of this very
    // script's CELLS drop (`guard:cell`). `guard:clear` comes from the shared
    // `dropped(`guard:${op.k}`)` step, so the new kind was named by machinery
    // that already existed.
    //
    // The improvement is exactly this: before, the call was read, filed under
    // `unsupported`, and then vanished -- absent from the ops AND absent from
    // `droppedOps`, so nothing downstream could tell it had ever been there.
    // Now an untranslatable one is a counted drop with a reason, like every
    // other op this converter cannot carry.
    const t = translatePine(CORPUS_DASHBOARD, { strict: true })
    expect(t.objectDiagnostics.dropReasons['guard:clear']).toBe(2)
  })

  it('CONTROL -- this script really does call it, so the two above can fail', () => {
    // An assertion over a script that never calls `table.clear` passes for the
    // wrong reason forever
    // (`lesson_a_fixture_that_cannot_distinguish_is_not_a_rail`).
    expect(CORPUS_DASHBOARD.match(/table\.clear\s*\(/g)).toHaveLength(2)
  })
})
