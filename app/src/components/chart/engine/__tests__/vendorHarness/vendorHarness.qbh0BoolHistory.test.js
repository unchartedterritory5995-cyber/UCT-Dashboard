// app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.qbh0BoolHistory.test.js
//
// ─── ⭐⭐ Q-BH0 — A PINE v6 `bool`'S HISTORY BEFORE HISTORY BEGINS READS `false`, AGAINST TRADINGVIEW ────────────────
//
// Captured on live TradingView charts 2026-11-19/20, from the listing (`history.startsAtBar0`), committed:
//   vw-v6-bool-history-bar0-rddt-1d-2026-11-19   NYSE:RDDT 1D, 670 bars
//   vw-v6-bool-history-bar0-spy-1d-2026-11-19    AMEX:SPY 1D, 8,511 bars
// The probe (`tools/visual_conformance/probes/vw-v6-bool-history-bar0.pine`, ours) holds `b = close > 0` (true on every
// bar), `u = close > open` and a `var bool c`, and draws H01-H10 (H00 is the `bar_index` control). TradingView draws 1
// on bar 0 for H01 `b[1] == false`, H03 `not b[1]`, H04 `b[1] != true`, H05 `b != b[1]`, H06 `b and not b[1]`,
// H07 `c[1] == false`, H08 `not c[1]`, H09 `u[1] == false`, and on bars 0 and 1 for H10 `b[2] == false`: a v6 bool's
// history before history begins is `false` ("To Pine Script version 6": "Boolean values cannot be na"). This engine
// read it as `na` and drew 0 there, on both lanes (engine 90: Q-BH0 DIVERGE on production and runtime-on).
// The rule: `pine.js::v6BoolHistory` (the columnar lane) and `pineRuntimeFrontend.js::v6BoolHistoryIr` (the run).
//
// ⭐ PINNED HERE, against the captures: every row MATCHES TradingView on every bar of both captures, on the production
// lane, the runtime-on lane and the runtime lane FORCED (`__forceRuntimeLaneForTests`), H02 `b[1] ? 1 : 0` (the history
// read as a condition, 0 either way) included. What the rule must NOT reach is `vendorHarness.qbh0Controls.test.js`.
import { describe, it, expect, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { gradeCapture, loadCapture } from './harness'
import { enterMemberDoor, HARNESS_DEF_ID } from './ourSide'
import * as registry from '../../nativeRegistry'
import { __permitRuntimePaneForTests } from '../../runtimePaneGate'
import { __allowEveryRuntimeScriptForTests } from '../../runtimeKill'
import { __forceRuntimeLaneForTests } from '../../../builder/memberPane/memberPaneDefinition'

const H = path.resolve(process.cwd(), '..', 'tests/fixtures/vendor/harness')
const CAPS = {
  rddt: 'vw-v6-bool-history-bar0-rddt-1d-2026-11-19.json',
  spy: 'vw-v6-bool-history-bar0-spy-1d-2026-11-19.json',
}
const capture = (k) => {
  const loaded = loadCapture(path.join(H, CAPS[k]))
  if (!loaded.capture) throw new Error(`not a capture — ${loaded.reason}`)
  return loaded.capture
}
const ROWS = ['H00_bar_index_CONTROL', 'H01_b1_eq_false', 'H02_b1_as_condition', 'H03_not_b1', 'H04_b1_ne_true',
  'H05_b_ne_b1', 'H06_edge_b_and_not_b1', 'H07_var_c1_eq_false', 'H08_var_not_c1', 'H09_u1_eq_false', 'H10_b2_eq_false']

const flagOf = (rel) => (fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8')
  .match(/source\.(VITE_[A-Z0-9_]+)\s*===\s*'1'/) || [])[1]
const OBJECTS_FLAG = flagOf('src/components/chart/engine/objectsOnlyPaneGate.js')
const RUNTIME_FLAG = flagOf('src/components/chart/engine/runtimePaneGate.js')
/** The three lanes the harness grades on: production (the runtime pane dark), runtime-on (the member door with the
 *  runtime pane on, every script permitted), and the runtime lane FORCED (the door answers with the run). */
const LANES = ['production', 'runtime-on', 'runtime lane forced']
const enterLane = (lane) => {
  vi.stubEnv(OBJECTS_FLAG, '1')
  vi.stubEnv(RUNTIME_FLAG, lane === 'production' ? '' : '1')
  if (lane !== 'production') { __permitRuntimePaneForTests(); __allowEveryRuntimeScriptForTests() }
  __forceRuntimeLaneForTests(lane === 'runtime lane forced')
}
afterEach(() => { __forceRuntimeLaneForTests(false); vi.unstubAllEnvs() })

describe('⭐⭐ Q-BH0 graded: every row MATCHES TradingView, bar for bar, on both captures and every lane', () => {
  for (const k of Object.keys(CAPS)) {
    for (const lane of LANES) {
      it(`${k}, ${lane}`, () => {
        enterLane(lane)
        const cap = capture(k)
        expect(cap.history.startsAtBar0).toBe(true)
        expect(/^\/\/@version=6/m.test(cap.source.text)).toBe(true)
        const door = enterMemberDoor(cap.source.text)
        registry.uninstallUserDefinition(HARNESS_DEF_ID)
        expect(door.built.ok, door.refusal || '').toBe(true)
        // the lane graded is the lane named: the host draws it on production, the run when forced
        if (lane === 'runtime lane forced') expect(door.built.lane).toBe('runtime')
        if (lane === 'production') expect(door.built.lane || 'host').not.toBe('runtime')
        const { verdict, ours, integrity } = gradeCapture(cap)
        expect(integrity.ok, (integrity.errors || []).join('; ')).toBe(true)
        const n = cap.bars.rows.length
        const plots = verdict.plots || []
        expect(plots.map((p) => p.title)).toEqual(ROWS)
        for (const p of plots) {
          expect(p.verdict, `${p.title}: ${p.reason}`).toBe('MATCH')
          expect(p.warmupBars, p.title).toBe(0)                   // from the listing: every bar is compared
          expect(p.stats.steady.compared, p.title).toBe(n)
          expect(p.stats.matching, p.title).toBe(n)
        }
        expect(verdict.verdict, verdict.reason).toBe('MATCH')
        // ⭐ the witness itself, read off our columns: bar 0 is TradingView's first row (H02 0, every other form 1)
        const col = (t) => ours.plots.find((p) => p.title === t).column
        const vendor0 = cap.plotValues.rows[0].slice(1)
        expect(vendor0).toEqual([0, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1])
        expect(ROWS.map((t) => col(t)[0])).toEqual(vendor0)
        expect(col('H10_b2_eq_false')[1]).toBe(1)                // `b[2]`: bars 0 AND 1 read before history
        expect(col('H01_b1_eq_false')[1]).toBe(0)                // and from bar 1 on, `b[1]` is `b`'s own past
      }, 300000)
    }
  }
})
