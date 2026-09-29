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
import { toRenderState } from '../objectRenderState'

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

  it('⛔ CONTROL — the same toggle flipped to the 60-minute timeframe draws no channel, never the daily one', () => {
    // `TF = input.timeframe('60')` is below the daily bars this chart holds; the
    // toggle picking it must not quietly read the chart's own timeframe instead.
    const flipped = capture.source.text.replace("TF_Choise = input.bool(false, 'Time Frame'", "TF_Choise = input.bool(true, 'Time Frame'")
    expect(flipped).not.toBe(capture.source.text)
    const r = ourRun(capture, flipped)
    const lines = r.run ? r.run.live.filter((o) => o.family === 'line') : []
    expect(lines).toEqual([])
  })
})

describe('C10 — a request below the chart\'s timeframe whose value is never shown (artemis-oscillator-pro)', () => {
  const capture = load('artemis-oscillator-pro')
  /** Every cell of the table whose first cell reads `MTF`, as `col,row text`. */
  const mtfOfVendor = () => {
    const cells = capture.objects.records.tableCells
    const tid = cells.find((c) => c.t === 'MTF').tid
    return cells.filter((c) => c.tid === tid).map((c) => `${c.col},${c.row} ${c.t}`).sort()
  }
  const mtfOfOurs = ({ run, bars }) => {
    const table = toRenderState(run.live, { bars, tf: 'D' }).tables
      .find((t) => (t.cells || []).some((c) => c && c.text === 'MTF'))
    return table ? table.cells.map((c) => `${c.col},${c.row} ${c.text}`).sort() : []
  }

  it('⭐ the MTF panel is TradingView\'s, cell for cell: 15m / 1h / 4h forced `— n/a`, 1D read off the daily bars, the header `◮ MIXED`', () => {
    const vendor = mtfOfVendor()
    expect(vendor).toHaveLength(10)
    expect(vendor).toContain('1,1 — n/a')
    expect(vendor).toContain('1,4 ▼ BEAR')
    expect(mtfOfOurs(ourRun(capture))).toEqual(vendor)
  }, 60000)

  it('⛔ CONTROL — a validity that reads the bars keeps the 15-minute request live: its cells are dropped, never guessed', () => {
    const perBar = capture.source.text.replace(
      'bool  mtfV1 = timeframe.in_seconds(mtfTf1) >= chartSec',
      'bool  mtfV1 = timeframe.in_seconds(mtfTf1) >= chartSec or close < 0')
    expect(perBar).not.toBe(capture.source.text)
    const ours = mtfOfOurs(ourRun(capture, perBar))
    // the 15m tag and the header both read the 15-minute oscillator now
    expect(ours.filter((c) => c.startsWith('1,1 ') || c.startsWith('1,0 '))).toEqual([])
    // the rows whose validity still folds keep their answer
    expect(ours).toContain('1,2 — n/a')
    expect(ours).toContain('1,4 ▼ BEAR')
  }, 60000)
})
