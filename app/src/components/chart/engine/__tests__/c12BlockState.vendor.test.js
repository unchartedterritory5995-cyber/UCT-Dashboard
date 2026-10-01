// app/src/components/chart/engine/__tests__/c12BlockState.vendor.test.js
//
// ─── ⭐⭐ C12 — VALUES AND `var` STATE COMPUTED ACROSS A BLOCK, READ OFF TRADINGVIEW ─
//
// Triage class C12 (`docs/pine/vendor-harness/objects-triage-2026-09-28.md`):
// a value or `var` state computed across a multi-statement block
// (`pine:block`, `pine:state`, `pine:reassign`) in the OBJECT lane. Each case is
// a committed capture (`tests/fixtures/vendor/harness/`, NYSE:RDDT 1D,
// 2026-09-28, starts at bar 0) run through the member door and the columnar
// object lane, and compared with what TradingView held — BY ID where the id
// counter is ours to reproduce, because a count alone can agree by accident.
//
// ⛔ Each rule here is the one its capture DECIDES, and each case carries the
// reading that capture rules out, so the case cannot pass for a reason other
// than the rule.
import { describe, it, expect, afterAll, beforeAll, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { HARNESS_DIR } from './vendorHarness/harness'
import { enterMemberDoor, toProductBars, tfCodeOf, HARNESS_DEF_ID } from './vendorHarness/ourSide'
import * as registry from '../nativeRegistry'
import { objectReaderFor } from '../objectColumns'
import { evaluateObjects, OBJECT_STATUS } from '../objectRuntime'

const load = (slug) => JSON.parse(fs.readFileSync(
  path.join(HARNESS_DIR, `${slug}-rddt-1d-2026-09-28.json`), 'utf8'))
const RECORD_KEY = { line: 'lines', label: 'labels', box: 'boxes' }

const vendorIds = (cap, fam) => ((cap.objects.records[RECORD_KEY[fam]]) || [])
  .map((r) => r.id).sort((a, b) => a - b)

/** Our held objects at the last bar — the member door, the columnar lane —
 *  for the capture's own source, or for `source` when a case edits it. */
function ourRun(capture, source = capture.source.text) {
  const door = enterMemberDoor(source)
  try {
    expect(door.def, door.refusal || 'no definition').toBeTruthy()
    const bars = toProductBars(capture)
    const reader = objectReaderFor(door.def, bars, {
      inputs: undefined, tf: tfCodeOf(capture.timeframe), newestBarIsForming: capture.newestBarIsForming ?? null,
    })
    const run = evaluateObjects(reader.program, {
      barCount: bars.length, readNode: reader.readNode, readTime: (i) => bars[i].t,
      readUnknown: reader.readUnknown,
    })
    expect(run.status).toBe(OBJECT_STATUS.OK)
    return run
  } finally {
    registry.uninstallUserDefinition(HARNESS_DEF_ID)
  }
}

const idsOf = (run, fam) => run.live.filter((o) => o.family === fam).map((o) => o.id).sort((a, b) => a - b)

afterAll(() => registry.uninstallUserDefinition(HARNESS_DEF_ID))

describe('C12 — `x = if cond` with no `else` (atr-support-and-resistance)', () => {
  const capture = load('atr-support-and-resistance')
  /** ⭐ C45 RE-PIN. The script EXTENDS each zone every bar (`activeBox.set_right(
   *  bar_index)`, in loops over its lists) and this chart cannot run those loops.
   *  Until C45 the zones were drawn anyway — zero-width, where TradingView's are
   *  all extended — and this rail compared their ids. An object one of whose
   *  moves was lost is withheld now (`vendorHarness.c45LostUpdates`), so the
   *  script as written holds none.
   *  What C12 is about is which bars CREATE a zone, and that is unchanged: the
   *  rail reads it off the script with its eight list loops cut (they create and
   *  delete nothing — `array.remove` forgets a handle, it does not delete the
   *  object), which is the creation logic and nothing else. */
  const creationOnly = (text) => {
    const out = []
    let cutting = false
    for (const line of text.split('\n')) {
      if (/^if \(array\.size\(/.test(line)) { cutting = true; continue }
      if (cutting && (/^\s/.test(line) || line.trim() === '')) continue
      cutting = false
      out.push(line)
    }
    return out.join('\n')
  }

  it('the script as written holds no zone: the loops that extend them are lost, and C45 withholds what they move', () => {
    const run = ourRun(capture)
    expect(idsOf(run, 'line')).toEqual([])
    expect(idsOf(run, 'box')).toEqual([])
  })

  it('⭐ every line and box TradingView holds, id for id (20 + 20, one interleaved counter)', () => {
    const source = creationOnly(capture.source.text)
    // ⛔ non-vacuity of the cut: eight loops gone, every create still there
    expect((capture.source.text.match(/^if \(array\.size\(/gm) || []).length).toBe(8)
    expect((source.match(/^if \(array\.size\(/gm) || []).length).toBe(0)
    expect((source.match(/box\.new\(/g) || []).length).toBe((capture.source.text.match(/box\.new\(/g) || []).length)
    expect((source.match(/line\.new\(/g) || []).length).toBe((capture.source.text.match(/line\.new\(/g) || []).length)
    const run = ourRun(capture, source)
    for (const fam of ['line', 'box']) {
      expect(vendorIds(capture, fam).length, fam).toBe(20)
      expect(idsOf(run, fam), fam).toEqual(vendorIds(capture, fam))
    }
    expect(idsOf(run, 'label')).toEqual([])
  })

  it('⛔ CONTROL — the capture decides the fallthrough: an explicit `else` of 0 draws a different picture', () => {
    // `impUpWick = if impUp / open - low` is the wick test's numerator. With `na`
    // the test is false on a non-impulse bar (TradingView's 20 boxes); with 0 it
    // is TRUE there, so a box is pushed on nearly every bar. Writing the `else`
    // out makes the alternative reading a script of its own.
    const zeroed = creationOnly(capture.source.text)
      .replace('impDownWick = if impDown\n    high - open\n', 'impDownWick = if impDown\n    high - open\nelse\n    0\n')
      .replace('impUpWick = if impUp\n    open - low\n', 'impUpWick = if impUp\n    open - low\nelse\n    0\n')
    expect(zeroed).not.toBe(creationOnly(capture.source.text))
    const run = ourRun(capture, zeroed)
    expect(idsOf(run, 'box').length).toBeGreaterThan(vendorIds(capture, 'box').length)
  })
})

describe('C12 — a `var` before its warm-up is unknown, not `na` (market-structure-by-leviathan)', () => {
  const capture = load('market-structure-by-leviathan')
  // it draws objects and no plot, so the member door takes it only through the
  // objects-only pane (`objectsOnlyPaneGate.js`), as the harness grades it
  beforeAll(() => { vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1') })
  afterAll(() => { vi.unstubAllEnvs() })
  // one sequence over both families, in creation order: a label by its word and
  // level, a line by its level — the vendor's by id, ours by id
  const seqOfVendor = () => [
    ...capture.objects.records.lines.map((r) => ({ id: r.id, k: `line@${r.y1}` })),
    ...capture.objects.records.labels.map((r) => ({ id: r.id, k: `${r.t}@${r.y}` })),
  ].sort((a, b) => a.id - b.id).map((o) => o.k)
  const seqOfOurs = (run) => [...run.live].sort((a, b) => a.id - b.id)
    .map((o) => (o.family === 'line' ? `line@${o.props.y1}` : `${o.props.text}@${o.props.y}`))

  it('⭐ every object we draw is TradingView\'s, in order, word and level — its last 23 of 28', () => {
    const run = ourRun(capture)
    const vendor = seqOfVendor()
    const ours = seqOfOurs(run)
    expect(vendor.length).toBe(28)
    expect(ours.length).toBe(23)
    expect(ours).toEqual(vendor.slice(vendor.length - ours.length))
    expect(run.stats.withheldUnknown).toBeGreaterThan(0)
  })

  it('⭐ the five we withhold are all read off `prevHigh`/`prevLow` before bar 250 — the first vendor BOS sits at bar 2 of the sequence', () => {
    const vendor = seqOfVendor()
    // LH, LL, the 78.08 break (line + BOS), HH — TradingView's first five, whose
    // word or level is decided by a `var` the object lane cannot compute there
    expect(vendor.slice(0, 5)).toEqual(['LH@78.08', 'LL@49.13', 'line@78.08', 'BOS@78.08', 'HH@230.41'])
  })

  it('⛔ CONTROL — read as Pine\'s `na`, the warm-up draws a WRONG word: "LH" where TradingView says "HH"', () => {
    const door = enterMemberDoor(capture.source.text)
    try {
      const bars = toProductBars(capture)
      const reader = objectReaderFor(door.def, bars, {
        inputs: undefined, tf: tfCodeOf(capture.timeframe), newestBarIsForming: capture.newestBarIsForming ?? null,
      })
      const run = evaluateObjects(reader.program, {
        barCount: bars.length, readNode: reader.readNode, readTime: (i) => bars[i].t,
      })
      const ours = seqOfOurs(run)
      expect(ours).toContain('LH@230.41')
      expect(seqOfVendor()).not.toContain('LH@230.41')
    } finally {
      registry.uninstallUserDefinition(HARNESS_DEF_ID)
    }
  })
})

describe('C12 — crossover of a `var` inside its own update (institutional-smc-order-flow-matrix-pro)', () => {
  const capture = load('institutional-smc-order-flow-matrix-pro')
  const W = 250 // `accum`'s warm-up: the object lane reads no `var` state before it
  const levels = (recs) => recs.map((r) => `${r.st === 'sol' || r.style === 'solid' ? 'CHoCH' : 'BOS'}@${r.y1}`)

  it('⭐ every BOS / CHoCH line past the warm-up is TradingView\'s, in order, level and kind', () => {
    const run = ourRun(capture)
    const ours = run.live.filter((o) => o.family === 'line').sort((a, b) => a.id - b.id)
    const vendor = [...capture.objects.records.lines].sort((a, b) => a.id - b.id)
    expect(vendor.length).toBe(18)
    // the reset (`last_ph_s := na` after the break) is what keeps each level to ONE line
    expect(ours.length).toBe(13)
    expect(ours.every((o) => o.props.x2 >= W)).toBe(true)
    expect(levels(ours.map((o) => o.props))).toEqual(levels(vendor.slice(vendor.length - ours.length)))
  })

  it('⭐ the five TradingView holds beyond ours all break BEFORE the warm-up — nothing else is missing', () => {
    const run = ourRun(capture)
    const ours = run.live.filter((o) => o.family === 'line').length
    const vendor = [...capture.objects.records.lines].sort((a, b) => a.id - b.id)
    const closes = capture.bars.rows.map((r) => r[4])
    for (const rec of vendor.slice(0, vendor.length - ours)) {
      const up = rec.st !== 'sol' // BOS: close crosses above; CHoCH: below
      let at = -1
      for (let i = 1; i < closes.length && at < 0; i++) {
        const now = up ? closes[i] > rec.y1 : closes[i] < rec.y1
        const before = up ? closes[i - 1] <= rec.y1 : closes[i - 1] >= rec.y1
        if (now && before) at = i
      }
      expect(at, `${rec.st} ${rec.y1}`).toBeGreaterThan(0)
      expect(at, `${rec.st} ${rec.y1}`).toBeLessThan(W)
    }
  })

  it('⭐ the labels: TradingView\'s 16 ITH / ITL plus the 13 break labels past the warm-up', () => {
    const run = ourRun(capture)
    const count = (texts, t) => texts.filter((x) => x === t).length
    const ours = run.live.filter((o) => o.family === 'label').map((o) => String(o.props.text))
    const vendor = capture.objects.texts.labels
    for (const t of ['ITH', 'ITL']) expect(count(ours, t), t).toBe(count(vendor, t))
    expect(count(ours, 'BOS') + count(ours, 'CHoCH')).toBe(13)
    expect(count(vendor, 'BOS') + count(vendor, 'CHoCH')).toBe(18)
  })
})
