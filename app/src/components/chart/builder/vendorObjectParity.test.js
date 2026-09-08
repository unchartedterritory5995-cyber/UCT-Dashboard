// app/src/components/chart/builder/vendorObjectParity.test.js
//
// ─── ⭐⭐ C3B-CLOSE ITEM 12 — OUR OBJECT MODEL, AGAINST TRADINGVIEW'S ────────
//
// The rail on `tests/fixtures/vendor/visual/object-semantics-spy-1d-2026-09-08.json`,
// which is the repo's first vendor observation of OBJECT semantics: one Pine
// script, read out of TradingView's own chart model — the study's
// `graphics().dwglines()/dwglabels()/dwgboxes()/dwgtables()/dwgtablecells()`
// primitive records, with the study's own resolved colour palette beside them.
//
// ⛔ WHAT A COMPARISON HERE CAN AND CANNOT BE. The vendor ran the script over
// ~8,458 bars of SPY; this runs it over 300 synthetic ones. So an ABSOLUTE id
// cannot be compared (the churn line is 8462 there and 302 here — both mean
// "one per bar"), and neither can an absolute price. What CAN be compared is
// every structural fact, and those are the facts the object model is made of:
// who owns an id, whether an update keeps one, whether a delete removes, which
// bar a coordinate is read from, and how a table is placed. Each assertion
// below names the vendor record it is measured against.
//
// ⚠️ THE VENDOR'S SCRIPT DRAWS AND DOES NOT PLOT, AND OURS CANNOT. This engine
// is built on columns: a document with no output has nothing to register. So
// the rail adds ONE `plot(close)` line and says so — it introduces a separate
// output and touches no object statement. That difference is itself a finding
// and is asserted at the bottom rather than papered over.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { translatePine } from '../engine/ast/pine'
import { objectReaderFor } from '../engine/objectColumns'
import { evaluateObjects } from '../engine/objectRuntime'

const V = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), '..',
  'tests/fixtures/vendor/visual/object-semantics-spy-1d-2026-09-08.json'), 'utf8'))

const NL = String.fromCharCode(10)
const BARS = 300
const HIGH = 106
const LOW = 94

const bars = Array.from({ length: BARS }, (_, i) => ({
  t: 1_700_000_000 + i * 86400, o: 100, h: HIGH, l: LOW,
  c: 100 + Math.sin(i / 7) * 5, v: 1_000_000,
}))

/** Translate the vendor's own script (plus the one plot this engine needs) and run it. */
function ours() {
  const t = translatePine(V.script.source + NL + 'plot(close, title = "C")' + NL)
  const ast = (t.outputs || []).map((o) => o.ast).find(Boolean)
  const def = {
    schemaVersion: 1, id: 'u_vendorobj001', version: 1, name: 'vendor object probe', inputs: [],
    compute: { kind: 'ast', trees: { value: ast }, scanPlot: 'value' },
    plots: [{ key: 'value', label: 'C', color: '#c9a84c', width: 1, style: 'line' }],
    objects: t.objects,
  }
  const reader = objectReaderFor(def, bars)
  const run = evaluateObjects(reader.program, {
    barCount: bars.length, readNode: reader.readNode, readTime: (i) => bars[i].t,
  })
  return { t, reader, run, live: run.live }
}

/** The model bar a vendor primitive's x actually names. */
const at = (x) => V.vendor.materialisedIndexes[x]
const bar = (i) => V.vendor.materialisedIndexBars.find((b) => b.i === i)

describe('C3B-CLOSE item 12 — vendor object semantics', () => {
  const { t, reader, run, live } = ours()

  it('the fixture is a real observation, not a shape', () => {
    expect(V.provenance.platform).toBe('TradingView')
    expect(V.market.symbol).toBe('SPY')
    expect(V.market.resolution).toBe('1D')
    expect(V.vendor.lines).toHaveLength(2)
    expect(V.vendor.labels).toHaveLength(3)
    expect(V.vendor.boxes).toHaveLength(4)
    expect(V.vendor.tables).toHaveLength(1)
    expect(V.vendor.tableCells).toHaveLength(4)
  })

  it('and our side translated it, so the comparison is not vacuous', () => {
    expect(t.ok).toBe(true)
    expect(reader).toBeTruthy()
    expect(reader.failed).toEqual([])
    expect(run.status).toBe('ok')
  })

  // ── A. IDENTITY ───────────────────────────────────────────────────────────
  it('⭐⭐ ONE MONOTONIC COUNTER, SHARED BY EVERY FAMILY — the vendor mints 1, 2, 3 in script order', () => {
    // Vendor: anchor line id 1, table id 3 — a line and a table on adjacent
    // integers. There is no per-family id space on either side.
    const vLine = V.vendor.lines.find((l) => l.id === 1)
    const vTable = V.vendor.tables[0]
    expect(vLine).toBeTruthy()
    expect(vTable.id).toBe(3)

    const anchor = live.find((o) => o.family === 'line' && o.createdBar === 0)
    const table = live.find((o) => o.family === 'table')
    expect(anchor.id).toBe(vLine.id)     // 1
    expect(table.id).toBe(vTable.id)     // 3
    expect(anchor.id).toBeLessThan(table.id)
  })

  it('⭐⭐ AN UPDATED OBJECT KEEPS ITS ID; A RE-CREATED ONE DOES NOT', () => {
    // The vendor's discrimination, verbatim: the anchor is moved with set_xy
    // every bar and is still id 1; the churn line is rebuilt every bar and is
    // id 8462 over ~8,458 bars. A re-creating engine cannot show a small id and
    // an updating one cannot show a large one, so the PAIR is the test.
    const vAnchor = V.vendor.lines.find((l) => l.id === 1)
    const vChurn = V.vendor.lines.find((l) => l.id !== 1)
    expect(vAnchor).toBeTruthy()
    expect(vChurn.id).toBeGreaterThan(V.market.lastBarIndexInPine)

    const lines = live.filter((o) => o.family === 'line').sort((a, b) => a.id - b.id)
    expect(lines).toHaveLength(2)
    expect(lines[0].id).toBe(1)
    expect(lines[0].createdBar).toBe(0)
    expect(lines[1].createdBar).toBe(BARS - 1)
    expect(lines[1].id).toBeGreaterThan(BARS)
    // the anchor was UPDATED, not re-made: its id never moved across 300 bars
    expect(run.stats.updated).toBeGreaterThan(BARS)
  })

  it('⛔ DELETE REALLY REMOVES — one churn line alive on both sides', () => {
    expect(V.vendor.lines).toHaveLength(2)             // anchor + newest churn
    expect(run.stats.peakLive.line).toBe(2)
    expect(run.stats.deleted).toBe(BARS - 1)           // every earlier churn line
    expect(run.stats.writesToDeleted).toBe(0)
  })

  // ── B. COORDINATES ────────────────────────────────────────────────────────
  it('⭐⭐ THE ANCHOR SPANS TWENTY BARS ENDING ON THE LAST ONE — the same span, bar for bar', () => {
    const v = V.vendor.lines.find((l) => l.id === 1)
    expect(at(v.x2)).toBe(V.market.barsInChartModel - 1)   // 299
    expect(at(v.x2) - at(v.x1)).toBe(20)
    expect(v.y1).toBe(bar(at(v.x2)).c)                     // y is the LAST bar's close
    expect(v.y1).toBe(v.y2)

    const anchor = live.find((o) => o.id === 1)
    expect(anchor.props.x2).toBe(BARS - 1)
    expect(anchor.props.x2 - anchor.props.x1).toBe(20)
    expect(anchor.props.y1).toBe(anchor.props.y2)
    expect(anchor.props.y1).toBeCloseTo(bars[BARS - 1].c, 10)
  })

  it('⭐⭐ FOUR SIMULTANEOUS BOXES AT THE SAME FOUR X-SPANS', () => {
    const vSpans = V.vendor.boxes.map((b) => [at(b.x1), at(b.x2)])
    expect(vSpans).toEqual([[259, 264], [269, 274], [279, 284], [289, 294]])

    const boxes = live.filter((o) => o.family === 'box').sort((a, b) => a.props.left - b.props.left)
    expect(boxes).toHaveLength(4)
    expect(boxes.map((b) => [b.props.left, b.props.right])).toEqual(vSpans)
    // every one born on the SAME bar, which is what "simultaneous" means here
    expect(new Set(boxes.map((b) => b.createdBar))).toEqual(new Set([BARS - 1]))
  })

  it('⛔⛔ A COORDINATE IS READ FROM THE BAR THE OBJECT WAS CREATED ON, NOT THE BAR IT IS DRAWN AT', () => {
    // The vendor's boxes sit up to forty bars back and every one of them uses
    // the LAST bar's high and low: y1 = high(299) + 4..1, y2 = low(299) - 4..1.
    // An engine that read each box's own left-hand bar would produce four
    // different bases and still look entirely plausible on a chart.
    const last = bar(V.market.barsInChartModel - 1)
    expect(V.vendor.boxes.map((b) => b.y1)).toEqual([last.h + 4, last.h + 3, last.h + 2, last.h + 1])
    expect(V.vendor.boxes.map((b) => b.y2)).toEqual([last.l - 4, last.l - 3, last.l - 2, last.l - 1])

    const boxes = live.filter((o) => o.family === 'box').sort((a, b) => a.props.left - b.props.left)
    expect(boxes.map((b) => b.props.top)).toEqual([HIGH + 4, HIGH + 3, HIGH + 2, HIGH + 1])
    expect(boxes.map((b) => b.props.bottom)).toEqual([LOW - 4, LOW - 3, LOW - 2, LOW - 1])
  })

  it('⛔ THE CHURN LINE SITS ON THE HIGH AND SPANS FIVE BARS', () => {
    const v = V.vendor.lines.find((l) => l.id !== 1)
    expect(v.y1).toBe(bar(at(v.x2)).h)
    expect(at(v.x2) - at(v.x1)).toBe(5)

    const churn = live.filter((o) => o.family === 'line').sort((a, b) => a.id - b.id)[1]
    expect(churn.props.y1).toBe(HIGH)
    expect(churn.props.x2 - churn.props.x1).toBe(5)
  })

  // ── C. TABLE ──────────────────────────────────────────────────────────────
  it('⭐⭐ A TABLE IS PANE-ANCHORED AND CARRIES NO COORDINATES — on both sides', () => {
    const v = V.vendor.tables[0]
    expect(v.pos).toBe('top_right')
    expect(Object.keys(v)).not.toContain('x1')
    expect(Object.keys(v)).not.toContain('y1')
    expect(v.rows).toBe(2)
    expect(v.cols).toBe(2)

    const table = live.find((o) => o.family === 'table')
    expect(table.props.position).toBe('top_right')
    expect(table.props.rows).toBe(2)
    expect(table.props.columns).toBe(2)
    expect(table.props.x1).toBeUndefined()
    expect(table.props.y1).toBeUndefined()
  })

  it('⛔ AND A CELL REFERENCES ITS TABLE BY ID rather than nesting inside it', () => {
    const tid = V.vendor.tables[0].id
    expect(V.vendor.tableCells.every((c) => c.tid === tid)).toBe(true)
    expect(V.vendor.tableCells.map((c) => [c.col, c.row])).toEqual([[0, 0], [1, 0], [0, 1], [1, 1]])
    // our program addresses a cell the same way — a handle plus (column, row)
    const cells = t.objects.ops.filter((o) => o.k === 'cell')
    expect(cells).toHaveLength(4)
  })

  // ── D. COLOUR ─────────────────────────────────────────────────────────────
  it('⭐⭐ THE COLOURS ARE THE VENDOR OWN RESOLVED PALETTE, AND OURS MATCH', () => {
    // The palette is the study's `properties().state().palettes.palette_common`,
    // so these hexes are TradingView's answer, not a reading of a screenshot.
    const P = V.vendor.palette
    expect(P['0']).toBe('#FFEB3B')   // color.yellow
    expect(P['1']).toBe('#FF5252')   // color.red — the C3A-CLOSE correction, re-confirmed
    expect(P['4']).toBe('#4CAF50')   // color.green

    const anchor = live.find((o) => o.id === 1)
    const churn = live.filter((o) => o.family === 'line').sort((a, b) => a.id - b.id)[1]
    const box = live.find((o) => o.family === 'box')
    expect(anchor.props.color.toUpperCase()).toBe(P['0'].toUpperCase())
    expect(churn.props.color.toUpperCase()).toBe(P['1'].toUpperCase())
    expect(box.props.border_color.toUpperCase()).toBe(P['4'].toUpperCase())
  })

  // ── E. THE DIVERGENCE, NAMED ──────────────────────────────────────────────
  it('⚰️ THE VENDOR DRAWS THREE LABELS AND WE DRAW NONE — and the cause is the VALUE lane, not the object model', () => {
    // The vendor's label guard is `bar_index >= last_bar_index - 2`.
    // `last_bar_index` is a name this engine does not hold — it is in
    // `PINE_KNOWN_BUILTINS` so the refusal is named rather than "undefined",
    // but there is no column behind it — so the create's GUARD cannot resolve
    // and the object lane drops the create, fail-closed and with a reason.
    //
    // ⛔ THIS IS THE CLASSIFICATION THE WAVE ASKS FOR, and it is not an
    // object-model failure: the create op is present, its family is right, and
    // the same guarded-create shape works wherever `barstate.islast` is used
    // (`c3b_02_label_text` draws two labels live, on a real chart). Recording
    // it as an OBJECT gap would blame the wrong lane and send the fix to the
    // wrong file.
    expect(V.vendor.labels).toHaveLength(3)
    expect(live.filter((o) => o.family === 'label')).toHaveLength(0)
    const d = t.objectDiagnostics
    expect(d.droppedOps).toBe(1)
    expect(d.dropReasons).toEqual({ 'guard:create': 1 })
    expect(d.loopBlocked).toBe(0)
    expect(d.unsupported).toEqual([])
  })

  it('⚰️ AND A SCRIPT THAT ONLY DRAWS DOES NOT TRANSLATE AT ALL — this engine needs one output', () => {
    // The vendor's script has no plot(). Recorded here because the rail above
    // adds one, and a reader is entitled to know what that addition bought.
    const bare = translatePine(V.script.source)
    expect(bare.ok).toBe(false)
    expect((bare.outputs || []).length).toBe(0)
  })
})
