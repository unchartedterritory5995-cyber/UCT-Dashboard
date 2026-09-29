// app/src/components/chart/engine/__tests__/c10SecurityObjects.vendor.test.js
//
// ─── ⭐⭐ C10 — `request.security` FEEDING THE OBJECT LANE, READ OFF TRADINGVIEW ─
//
// Triage class C10 (`docs/pine/vendor-harness/objects-triage-2026-09-28.md`,
// fix-order step 20). The object lane resolves its values through the SAME
// `Resolver` the plot lane uses, so `securityAsNode` already reaches it: every
// `request.security` shape the plot lane serves (the chart's own timeframe as the
// identity, W / M as `tf`, `lookahead_on` W / M as `tf_live`, a roster ticker as
// `sym`) is already served to object text and coordinates. What stopped the C10
// scripts was never a missing seam — it was a request the SHARED resolver could
// not read. Each case here is a committed capture
// (`tests/fixtures/vendor/harness/`, NYSE:RDDT 1D, 2026-09-28) run through the
// member door and the columnar object lane, and compared with what TradingView
// held — by id, because a count alone can agree by accident.
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

/** The member door + the columnar object lane on the capture's bars, or the
 *  door's refusal. */
function ourRun(capture, source = capture.source.text) {
  const door = enterMemberDoor(source)
  try {
    if (!door.def) return { refusal: door.refusal }
    const bars = toProductBars(capture)
    const reader = objectReaderFor(door.def, bars, {
      inputs: undefined, tf: tfCodeOf(capture.timeframe), newestBarIsForming: capture.newestBarIsForming ?? null,
    })
    const run = evaluateObjects(reader.program, {
      barCount: bars.length, readNode: reader.readNode, readTime: (i) => bars[i].t,
      readUnknown: reader.readUnknown,
    })
    expect(run.status).toBe(OBJECT_STATUS.OK)
    return { run, bars, program: reader.program }
  } finally {
    registry.uninstallUserDefinition(HARNESS_DEF_ID)
  }
}

afterAll(() => registry.uninstallUserDefinition(HARNESS_DEF_ID))

describe('C10 — an MTF toggle written `input == false ? timeframe.period : tf` (linear-regression-channel)', () => {
  const capture = load('linear-regression-channel-tradingfinder-existing-trend-lines')
  // it draws lines and no plot, so the member door takes it only through the
  // objects-only pane, as the harness grades it
  beforeAll(() => { vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1') })
  afterAll(() => { vi.unstubAllEnvs() })
  const STYLE = { sol: 'solid', dsh: 'dashed' }

  it('⭐ the five channel lines TradingView holds, id for id, at its levels and styles', () => {
    const { run } = ourRun(capture)
    const rows = capture.bars.rows
    const vendor = capture.objects.records.lines
    expect(vendor.length).toBe(5)
    const ours = run.live.filter((o) => o.family === 'line').sort((a, b) => a.id - b.id)
    expect(ours.map((o) => o.id)).toEqual(vendor.map((r) => r.id).sort((a, b) => a - b))
    for (const [k, r] of vendor.entries()) {
      const o = ours[k]
      // `ta.linreg` and `ta.stdev` over the same bars: evaluation order only
      expect(Math.abs(o.props.y1 - r.y1), `y1 of ${r.id}`).toBeLessThan(1e-9 * Math.abs(r.y1))
      expect(Math.abs(o.props.y2 - r.y2), `y2 of ${r.id}`).toBeLessThan(1e-9 * Math.abs(r.y2))
      expect(o.props.style, `style of ${r.id}`).toBe(STYLE[r.st])
      // x is `time[n]` → `time` in bar time: the opening instants of the bar 100
      // back and of the newest bar (the vendor's own bar times, in ms)
      expect(o.props.xloc).toBe('bar_time')
      expect(o.props.x1).toBe(rows[rows.length - 1 - 100][0] * 1000)
      expect(o.props.x2).toBe(rows[rows.length - 1][0] * 1000)
    }
  })

  it('⭐ …and the two fills between them, attached to the lines TradingView fills', () => {
    const { run } = ourRun(capture)
    const vendor = capture.objects.records.linefills
    expect(vendor.length).toBe(2)
    const fills = run.live.filter((o) => o.family === 'linefill')
    expect(fills.length).toBe(2)
  })

  it('⛔ CONTROL — the same toggle flipped to the 60-minute timeframe refuses, never draws the daily channel', () => {
    // `TF = input.timeframe('60')` is below the daily bars this chart holds; the
    // toggle picking it must not quietly read the chart's own timeframe instead.
    const flipped = capture.source.text.replace("TF_Choise = input.bool(false, 'Time Frame'", "TF_Choise = input.bool(true, 'Time Frame'")
    expect(flipped).not.toBe(capture.source.text)
    const r = ourRun(capture, flipped)
    const lines = r.run ? r.run.live.filter((o) => o.family === 'line') : []
    expect(lines).toEqual([])
  })
})
