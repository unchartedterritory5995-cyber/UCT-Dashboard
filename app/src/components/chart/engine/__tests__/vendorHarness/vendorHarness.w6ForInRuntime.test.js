// app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.w6ForInRuntime.test.js
//
// ─── ⭐⭐⭐ W6-T6 — `for … in` THROUGH THE RUNTIME LANE, AGAINST TRADINGVIEW ─────────────────
//
// ⭐ THE WITNESS — `vw-forin-collections-rddt-1d-2026-10-01` (NYSE:RDDT 1D, from the listing;
// probe `tools/visual_conformance/probes/vw-forin-collections.pine`, Pine v5). The host object
// lane already replays its drawing steps (`vendorHarness.c48ForIn.test.js`); this rail runs the
// CAPTURE'S OWN PROGRAM, unchanged, through the runtime lane: the pane's build with its own
// drawings (`buildRuntimeIr` with `objectsInRun`, `pane: true`), lowered (`lowerIrProgram`) and run
// by the VM over the capture's bars. Every row is compared on every captured bar, and every
// object TradingView left is compared with ours:
//
//   F01 5 passes in index order        F02 0 passes over an empty list
//   F03 3 passes (the body SHIFTS)     F04 13 passes (the body PUSHES)    → the LIVE list
//   F05 the replaced slot's line is the one moved (y = 59)                 → read when reached
//   A01-A05 `box.all` is a SNAPSHOT: 4 passes deleting every box, 0 left  A06 positions 0, 1, 2
//   W01 the cap `while`                Z01-Z03 a sized list, every bar     C00 bar_index
//
// ⭐ CONTROLS: the same program with `for … in` read ONCE (a walk of the list it started with)
// and with `box.all` walked LIVE are written out below and must NOT match — so the rail can tell
// the rule from its two alternatives (and the mutation proof breaks each in the lowering).
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../../runtime/lowerIr.js'
import { execute } from '../../runtime/vm.js'

const DIR = path.resolve(process.cwd(), '..', 'tests/fixtures/vendor/harness')
const CAP = JSON.parse(fs.readFileSync(path.join(DIR, 'vw-forin-collections-rddt-1d-2026-10-01.json'), 'utf8'))
const PROBE = path.resolve(process.cwd(), '..', 'tools/visual_conformance/probes/vw-forin-collections.pine')

const barsOf = (cap) => cap.bars.rows.map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v: v == null ? 0 : v }))
const seriesOf = (bars) => ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(bars.map((b) => b[k])))
/** The capture's row titled `title`, aligned to its bars by time (NaN for `na`). */
const rowOf = (cap, title) => {
  const plot = cap.study.plots.find((p) => p.title === title)
  expect(plot, title).toBeTruthy()
  const at = cap.plotValues.fields.indexOf(plot.id)
  const byTime = new Map(cap.plotValues.rows.map((r) => [r[0], r[at] == null ? NaN : r[at]]))
  return cap.bars.rows.map((b) => (byTime.has(b[0]) ? byTime.get(b[0]) : undefined))
}
const TITLES = CAP.study.plots.map((p) => p.title)

function runLane(src, cap = CAP) {
  const bars = barsOf(cap)
  const built = buildRuntimeIr(src, { bars, inputs: {}, objectsInRun: true, pane: true, tf: 'D', basePeriod: 'D' })
  if (!built.ok) throw new Error(`refused ${built.refusal.guard}: ${built.refusal.message}`)
  const program = lowerIrProgram(built.ir, { historyFromListing: true })
  const r = execute(program, {
    bars: bars.length, series: seriesOf(bars), columns: program.columns, confirmed: true, barTimes: bars.map((b) => b.t),
  })
  return { outputs: r.outputs.map((o) => Array.from(o)), fin: r.objects.finish(), bars }
}
const same = (a, b) => (Number.isNaN(a) && Number.isNaN(b)) || (!Number.isNaN(a) && !Number.isNaN(b) && Math.abs(a - b) <= 1e-9)
/** Every row, every captured bar: the mismatches, per title. */
function gradeRows(outputs) {
  const bad = {}
  let compared = 0
  TITLES.forEach((title, k) => {
    rowOf(CAP, title).forEach((tv, i) => {
      if (tv === undefined) return
      compared += 1
      if (!same(outputs[k][i], tv)) (bad[title] = bad[title] || []).push({ i, tv, us: outputs[k][i] })
    })
  })
  return { compared, bad }
}
const byY = (a, b) => a[0] - b[0] || a[1] - b[1]
const objectsOf = (fin, lastBar) => ({
  lines: fin.live.filter((o) => o.family === 'line').map((o) => [o.props.y1, o.props.x1 - lastBar, o.props.x2 - lastBar]).sort(byY),
  boxes: fin.live.filter((o) => o.family === 'box')
    .map((o) => [o.props.bottom, o.props.top, o.props.left - lastBar, o.props.right - lastBar, String(o.props.text ?? '')]).sort(byY),
  labels: fin.live.filter((o) => o.family === 'label').map((o) => [o.props.y, o.props.x - lastBar, String(o.props.text ?? '')]).sort(byY),
})
const vendorObjects = (cap) => {
  const rec = cap.objects.records
  return {
    lines: rec.lines.map((l) => [l.y1, l.x1, l.x2]).sort(byY),
    boxes: rec.boxes.map((b) => [b.y2, b.y1, b.x1, b.x2, b.t]).sort(byY),
    labels: rec.labels.map((l) => [l.y, l.x, l.t]).sort(byY),
  }
}

describe('W6-T6 — the capture', () => {
  it('is the committed probe, from the listing, and ran to the last bar', () => {
    expect(CAP.source.text.replace(/\r\n/g, '\n').trim()).toBe(fs.readFileSync(PROBE, 'utf8').replace(/\r\n/g, '\n').trim())
    expect(CAP.history.startsAtBar0).toBe(true)
    expect(CAP.study.status.type).toBe(2)
    expect(TITLES.slice(0, 4)).toEqual(['F01_forin_passes_5', 'F02_forin_passes_empty',
      'F03_forin_passes_body_shifts', 'F04_forin_passes_body_pushes'])
  })
})

describe('⭐⭐⭐ W6-T6 — the probe, unchanged, MATCHES through the runtime lane', () => {
  it('every row (F01-F04, A01-A05, W01, Z01-Z03, C00) on every captured bar', () => {
    const { outputs } = runLane(CAP.source.text)
    const g = gradeRows(outputs)
    expect(g.compared).toBe(TITLES.length * CAP.bars.rows.length)
    expect(g.bad).toEqual({})
  }, 240000)

  it('every object TradingView left (F05 y = 59 moved, A06 texts "0" "1" "2"): 24 lines, 3 boxes, 5 labels', () => {
    const { fin, bars } = runLane(CAP.source.text)
    expect(fin.status).toBe('ok')
    const ours = objectsOf(fin, bars.length - 1)
    const theirs = vendorObjects(CAP)
    expect(ours.lines).toHaveLength(24)
    expect(ours).toEqual(theirs)
    // F05: the replaced slot (y = 59) is the line the third pass moved; y = 52 was not
    const x2 = (y) => ours.lines.find((l) => l[0] === y)
    expect([x2(59)[2] - x2(59)[1], x2(52)[2] - x2(52)[1]]).toEqual([5, 1])
    // A06: positions in `box.all`, oldest first
    expect(ours.boxes.map((b) => b[4])).toEqual(['0', '1', '2'])
  }, 240000)
})

describe('⛔ CONTROLS — the two alternatives the capture rules out read differently here', () => {
  const lastOf = (outputs, title) => outputs[TITLES.indexOf(title)][CAP.bars.rows.length - 1]
  const src = CAP.source.text.replace(/\r\n/g, '\n')
  it('a walk of the list the loop STARTED with (a copy) makes 5 and 3 passes, not 3 and 13', () => {
    // the list the loop started with, written out by hand (a copy the body never changes)
    const byHand = src
      .replace('    for l in sh\n', '    line[] shc = array.copy(sh)\n    for l in shc\n')
      .replace('    for l in gr\n', '    line[] grc = array.copy(gr)\n    for l in grc\n')
    expect(byHand).not.toBe(src)
    const { outputs } = runLane(byHand)
    expect([lastOf(outputs, 'F03_forin_passes_body_shifts'), lastOf(outputs, 'F04_forin_passes_body_pushes')]).toEqual([5, 3])
    expect([CAP.plotValues.rows.at(-1)[3], CAP.plotValues.rows.at(-1)[4]]).toEqual([3, 13])
  }, 240000)
  it('`box.all` read LIVE (re-read every pass) leaves two boxes and makes 2 passes, not 0 and 4', () => {
    const live = src.replace('    for b in box.all\n        box.delete(b)\n        pa += 1\n',
      '    while pa < array.size(box.all)\n        box.delete(array.get(box.all, pa))\n        pa += 1\n')
    expect(live).not.toBe(src)
    const { outputs } = runLane(live)
    expect([lastOf(outputs, 'A04_forin_all_delete_passes'), lastOf(outputs, 'A05_box_all_size_after_walk')]).toEqual([2, 2])
  }, 240000)
})
