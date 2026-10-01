// app/src/components/chart/engine/__tests__/objectCollector.vendor.test.js
//
// ─── ⭐⭐ PINE'S OBJECT COLLECTOR, READ OFF TRADINGVIEW BY ID ────────────────
//
// Triage class C7 (`docs/pine/vendor-harness/objects-triage-2026-09-28.md`).
// TradingView documents `max_*_count` as approximate. Four probes
// (`tools/visual_conformance/probes/vw-object-gc-{a,b,c,d}.pine`) were captured
// live on AMEX:SPY 1D and 1W (two last-bar phases). Read by id, the rule is exact:
//
//   a create that takes a family past `cap + GC_BATCH` (5) deletes the OLDEST
//   objects until `cap` remain — skipping any created on the running bar and
//   any a drawing variable holds. Both kinds still count.
//
// This file pins it three ways, and each fails for a different reason:
//
//   A  our engine (member door → columnar lane) reproduces the vendor's held
//      set ID FOR ID on the six captures it can run — 18 families
//   B  probe D's own `label.all` plots (vendor-only; our door refuses `*.all`)
//      show the collector bar by bar: the sawtooth, the trigger, the cut
//   C  the runtime lane (`runObjectLane`) on synthetic scripts — one per clause
//      of the rule, each with a control that the clause is what decided it
//
// ⛔ A is the load-bearing half. Counts alone were misleading: the corpus rows
// read 50 / 51 / 51 / 504 and no count-level rule fitted all of them; the ids
// did.
import { describe, it, expect, afterAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { HARNESS_DIR } from './vendorHarness/harness'
import { enterMemberDoor, toProductBars, tfCodeOf, HARNESS_DEF_ID, barIndexStartsAtZero } from './vendorHarness/ourSide'
import * as registry from '../nativeRegistry'
import { objectReaderFor } from '../objectColumns'
import { evaluateObjects, OBJECT_STATUS } from '../objectRuntime'
import { GC_BATCH, collectsAbove } from '../objectPool'
import { buildObjectLane, runObjectLane } from '../runtime/objectLane.js'

const CAPTURE = (probe, tf) => path.join(HARNESS_DIR, `vw-object-gc-${probe}-spy-${tf}-2026-09-28.json`)
const load = (file) => JSON.parse(fs.readFileSync(file, 'utf8'))
const RECORD_KEY = { line: 'lines', label: 'labels', box: 'boxes' }

/** The vendor's held ids for one family, ascending. */
const vendorIds = (cap, fam) => ((cap.objects.records[RECORD_KEY[fam]]) || []).map((r) => r.id).sort((a, b) => a - b)

/** Our held ids for one family, ascending — the member door, the columnar lane. */
function ourIds(capture) {
  const door = enterMemberDoor(capture.source.text)
  try {
    expect(door.def, door.refusal || 'no definition').toBeTruthy()
    const bars = toProductBars(capture)
    const reader = objectReaderFor(door.def, bars, {
      inputs: undefined, tf: tfCodeOf(capture.timeframe), newestBarIsForming: capture.newestBarIsForming ?? null,
      // ⭐ C45 — the probes key what they create on `bar_index` (`bar_index % 5`,
      // a text that prints it), a value that is TradingView's only where the
      // series starts at the vendor's bar 0. The daily captures assert the listing
      // (`history.startsAtBar0`); the weekly ones assert nothing about a listing,
      // and prove the one fact `bar_index` needs themselves — the vendor's own
      // control row reads 0, 1, 2 … on their bars (`ourSide.barIndexStartsAtZero`,
      // the harness's own reading, not a second one).
      historyFromListing: !!(capture.history && capture.history.startsAtBar0 === true),
      barIndexFromFirstBar: barIndexStartsAtZero(capture),
    })
    const run = evaluateObjects(reader.program, {
      barCount: bars.length, readNode: reader.readNode, readTime: (i) => bars[i].t,
    })
    expect(run.status).toBe(OBJECT_STATUS.OK)
    const out = {}
    for (const fam of Object.keys(RECORD_KEY)) {
      out[fam] = run.live.filter((o) => o.family === fam).map((o) => o.id).sort((a, b) => a - b)
    }
    return out
  } finally {
    registry.uninstallUserDefinition(HARNESS_DEF_ID)
  }
}

afterAll(() => registry.uninstallUserDefinition(HARNESS_DEF_ID))

describe('A — the vendor held set, reproduced id for id', () => {
  it('⛔ CONTROL — the constant this file pins is the measured one', () => {
    // ⭐ Offsets 0–11 were scanned against the eight captures; only 5 fits all.
    expect(GC_BATCH).toBe(5)
    expect(collectsAbove(50)).toBe(55)
  })

  for (const probe of ['a', 'b', 'c']) {
    for (const tf of ['1d', '1w']) {
      it(`vw-object-gc-${probe} ${tf}: every family's held ids equal TradingView's`, () => {
        const capture = load(CAPTURE(probe, tf))
        const ours = ourIds(capture)
        for (const fam of Object.keys(RECORD_KEY)) {
          const vend = vendorIds(capture, fam)
          // ⛔ NON-VACUITY: every family of these probes holds something on the
          // vendor side, so an empty reading cannot pass as agreement.
          expect(vend.length, `${fam}: the capture holds nothing`).toBeGreaterThan(0)
          expect(ours[fam], `${probe} ${tf} ${fam}`).toEqual(vend)
        }
      })
    }
  }

  it('⭐ the held counts are OVER the cap — the strict rule could not have produced them', () => {
    // ⛔ A control for the whole of A: if every capture held exactly its cap,
    // "id-exact" would also be satisfied by the rule this replaced.
    const c1w = load(CAPTURE('c', '1w'))
    expect(vendorIds(c1w, 'box').length).toBe(8)       // cap 3
    expect(vendorIds(c1w, 'line').length).toBe(11)     // cap 7
    const a1d = load(CAPTURE('a', '1d'))
    expect(vendorIds(a1d, 'label').length).toBe(55)    // default cap 50
  })
})

describe('B — probe D: the collector as the script sees it (vendor only)', () => {
  // plot_3 = label.all BEFORE this bar's create, plot_4 AFTER, plot_5 = the
  // oldest held label's bar; plot_6/plot_8 = box.all / line.all sizes.
  const CAP = 5 // `max_labels_count = 5` in the probe

  for (const tf of ['1d', '1w']) {
    it(`${tf}: labels saw-tooth ${CAP}..${CAP + GC_BATCH}, cut to ${CAP} on the create that passes ${CAP + GC_BATCH}`, () => {
      const cap = load(CAPTURE('d', tf))
      const f = cap.plotValues.fields
      const col = (name) => f.indexOf(name)
      const rows = cap.plotValues.rows
      expect(rows.length).toBeGreaterThan(1000)
      let drops = 0
      for (const r of rows) {
        const before = r[col('plot_3')]
        const after = r[col('plot_4')]
        expect(after).toBeLessThanOrEqual(collectsAbove(CAP))
        if (after < before + 1) {
          drops += 1
          // ⭐ the only cut there is: at the trigger, down to exactly the cap
          expect([before, after]).toEqual([collectsAbove(CAP), CAP])
        }
        // ⭐ the bar-0 bursts (6 boxes at cap 3, 10 lines at cap 7) never pass
        // their own trigger, so nothing ever collects them — a strict rule
        // would read 3 and 7 here from bar 0 on
        expect(r[col('plot_6')]).toBe(6)
        expect(r[col('plot_8')]).toBe(10)
      }
      expect(drops, 'no collection happened — the fixture proves nothing').toBeGreaterThan(100)
      // ⛔ THE INSTRUMENT CHECK THE PROBE ASKED FOR: the labels actually held at
      // the end number D04's last value and are the newest by id.
      const held = vendorIds(cap, 'label')
      const lastAfter = rows[rows.length - 1][col('plot_4')]
      expect(held.length).toBe(lastAfter)
      expect(held[held.length - 1] - held[0]).toBe(held.length - 1)
    })
  }
})

describe('C — the runtime lane, one clause at a time', () => {
  const LF = String.fromCharCode(10)
  const Q = String.fromCharCode(34)
  const makeBars = (n) => Array.from({ length: n }, (_, i) => ({
    t: 1700000000 + i * 86400,
    o: 100 + (i % 7), h: 104 + (i % 5), l: 96 - (i % 3), c: 100 + (i % 11), v: 1000000 + i,
  }))
  const N = 40
  const BARS = makeBars(N)
  const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))
  const head = (decl) => `//@version=5${LF}indicator(${Q}t${Q}, overlay = true, ${decl})${LF}`
  const run = (src) => {
    const lane = buildObjectLane(src, { tf: 'D', newestBarIsForming: false, bars: BARS })
    expect(lane.ok, lane.ok ? '' : `refused ${(lane.refusal || {}).guard}`).toBe(true)
    const r = runObjectLane(lane, {
      bars: N, series: SERIES, confirmed: true, readTime: (i) => BARS[i].t, trace: true,
    })
    expect(r.status, r.reason).toBe(OBJECT_STATUS.OK)
    return r
  }
  const fam = (r, f) => r.live.filter((o) => o.family === f)

  it('⭐ BATCHED: one label per bar at cap 5 holds 5..10, never more, and the phase decides', () => {
    const r = run(head('max_labels_count = 5') + `label.new(bar_index, high, ${Q}x${Q})${LF}`)
    // 40 creates: the first cut is at 11 (bar 10), then every 6th — 29 past it,
    // 29 mod 6 = 5, so ten are held, bars 30..39.
    expect(fam(r, 'label').map((o) => o.createdBar)).toEqual([30, 31, 32, 33, 34, 35, 36, 37, 38, 39])
    // ⛔ CONTROL — a strict FIFO at the cap would hold exactly five
    expect(fam(r, 'label').length).toBeGreaterThan(5)
  })

  it('⭐ SPARE THIS BAR: a last-bar burst larger than the cap is held whole', () => {
    const burst = Array.from({ length: 10 }, (_, j) => `    line.new(bar_index, ${j + 2}.0, bar_index + 1, ${j + 2}.0, width = 1)`).join(LF)
    const r = run(head('max_lines_count = 7')
      + `line.new(bar_index, 1.0, bar_index + 1, 1.0, width = 2)${LF}`
      + `if barstate.islast${LF}${burst}${LF}`)
    const held = fam(r, 'line')
    expect(held.length).toBe(11)
    expect(held.every((o) => o.createdBar === N - 1), 'an older line outlived the burst').toBe(true)
    // ⛔ CONTROL — the same eleven lines spread one per bar are collected to ≤ cap + 5
    const spread = run(head('max_lines_count = 7') + `line.new(bar_index, 1.0, bar_index + 1, 1.0)${LF}`)
    expect(fam(spread, 'line').length).toBeLessThanOrEqual(collectsAbove(7))
  })

  it('⭐ HELD BY A VARIABLE: a `var` box survives every collection, and still counts', () => {
    const r = run(head('max_boxes_count = 3')
      + `var box keep = box.new(0, 3.0, 1, 2.0, text = ${Q}KEEP${Q})${LF}`
      + `box.new(bar_index, 1.0, bar_index + 1, 0.0, text = ${Q}B${Q})${LF}`)
    const held = fam(r, 'box')
    expect(held.some((o) => o.createdBar === 0 && o.props.text === 'KEEP'), 'the var-held box was collected').toBe(true)
    expect(held.length).toBeLessThanOrEqual(collectsAbove(3))
    // ⛔ CONTROL — the same box made on bar 0 but held by nothing is collected
    const loose = run(head('max_boxes_count = 3')
      + `if bar_index == 0${LF}    box.new(0, 3.0, 1, 2.0, text = ${Q}KEEP${Q})${LF}`
      + `box.new(bar_index, 1.0, bar_index + 1, 0.0, text = ${Q}B${Q})${LF}`)
    expect(fam(loose, 'box').some((o) => o.props.text === 'KEEP')).toBe(false)
  })
})
