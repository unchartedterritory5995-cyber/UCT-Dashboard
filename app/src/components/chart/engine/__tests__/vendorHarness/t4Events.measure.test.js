// app/src/components/chart/engine/__tests__/vendorHarness/t4Events.measure.test.js
//
// ─── ⭐⭐ T4 E2 — THE GRADE OF THE EVENT CAPTURES, LOCAL ONLY ─────────────────────────────────────────────────
//
// The E0 probe captures (`s4-closed-retake-2026-11-20`) and TradingView's built-in VWAP at its event anchors
// (`s4-vwap-anchors-retake3-2026-11-21`) are kept out of git (TradingView's values; the built-in is licence-held), and so
// is OUR side's supply (production's events door, `tools/vendor_harness/record_event_supply.py`, a held record: licensed
// vendor data). This grades them with the vendor harness, on the lane `UCT_T4_LANE` names (`production`: the runtime
// pane dark; `runtime-on`: as the corpus lane grants it), and writes counts and verdicts only to `UCT_T4_GRADE_OUT`.
//
// ⛔ OPT-IN, LOCAL: `UCT_T4_GRADE=1`. `UCT_T4_BEFORE=1` grades the parse as it was before E2
// (`pine.js::__eventRewriteOffForTests`): the grade diff's other side, in its own process.
//   cd app && UCT_T4_GRADE=1 UCT_T4_LANE=production UCT_T4_GRADE_OUT=<file> \
//     node node_modules/vitest/vitest.mjs run src/components/chart/engine/__tests__/vendorHarness/t4Events.measure.test.js
import { describe, it, expect, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { runHarness } from './harness'
import { __eventRewriteOffForTests } from '../../ast/pine'
import { __permitRuntimePaneForTests } from '../../runtimePaneGate'
import { __allowEveryRuntimeScriptForTests } from '../../runtimeKill'
import { __admitEveryRunHalfForTests } from '../../runHalfRailSeam'
import { memberDoorsAtCollection } from '../../../../../testing/runtimeGate'

const RUN = process.env.UCT_T4_GRADE === '1'
const LANE = process.env.UCT_T4_LANE === 'runtime-on' ? 'runtime-on' : 'production'
const OUT = process.env.UCT_T4_GRADE_OUT
const BEFORE = process.env.UCT_T4_BEFORE === '1'
const STORE = (process.env.UCT_VENDOR_CAPTURE_STORE || '').trim()
  || path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'uct-vendor-batch', 'runs')
const RUNS = (process.env.UCT_T4_RUNS || 's4-closed-retake-2026-11-20,s4-vwap-anchors-retake3-2026-11-21').split(',')
/** `UCT_T4_ONLY`: a comma list of capture-id substrings, to grade a few at a time */
const ONLY = (process.env.UCT_T4_ONLY || '').split(',').map((x) => x.trim()).filter(Boolean)

if (RUN) {
  if (BEFORE) __eventRewriteOffForTests(true)
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', LANE === 'runtime-on' ? '1' : '')
  if (LANE === 'runtime-on') {
    __permitRuntimePaneForTests()
    __allowEveryRuntimeScriptForTests()
    __admitEveryRunHalfForTests()
    memberDoorsAtCollection({ hkd: true })
  }
}

describe.skipIf(!RUN)('T4 E2 — the event captures, graded locally', () => {
  it(`grades every local event capture on the ${LANE} lane${BEFORE ? ' (BEFORE E2)' : ''}`, () => {
    const dirs = RUNS.map((r) => path.join(STORE, r, 'captures')).filter((d) => fs.existsSync(d))
    expect(dirs.length, `no local event capture run under ${STORE}`).toBeGreaterThan(0)
    const pick = ONLY.length ? dirs.flatMap((d) => fs.readdirSync(d).filter((f) => ONLY.some((o) => f.includes(o))).map((f) => path.join(d, f))) : dirs
    const run = runHarness(pick, { paints: false, objectColour: false })
    const rows = run.results.map((r) => ({
      file: path.basename(r.file), verdict: r.verdict, reason: String(r.reason || '').slice(0, 300),
      plots: (r.plots || []).map((p) => ({ title: p.title || p.name || p.plot, verdict: p.verdict,
        compared: p.compared ?? p.bars ?? null, divergent: p.divergent ?? null, withheld: p.withheld ?? p.notCompared ?? null,
        first: p.firstDivergence ? { bar: p.firstDivergence.time || p.firstDivergence.bar } : null,
        reason: String(p.reason || '').slice(0, 200) })),
    }))
    const counts = {}
    for (const r of rows) counts[r.verdict] = (counts[r.verdict] || 0) + 1
    if (OUT) fs.writeFileSync(OUT, JSON.stringify({ lane: LANE, before: BEFORE, counts, rows }, null, 1))
    console.log(`T4 E2 grade (${LANE}${BEFORE ? ', before' : ''}):`, JSON.stringify(counts))
    expect(rows.length).toBeGreaterThan(0)
  }, 1800000)
})
