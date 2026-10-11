// app/src/components/chart/engine/__tests__/vendorHarness/uieRuntimeAcceptance.measure.test.js
//
// ⭐⭐ UIE PHASE B (2026-10-11) — RUNTIME ACCEPTANCE: grade the six runtime-only scripts
// of `docs/pine/runtime-pane-switch-on-plan.md` against EVERY TradingView capture
// committed for them, with the runtime pane switched on IN THIS TEST ONLY (`vi.stubEnv`,
// the pattern every runtime measure in this directory uses). Nothing is enabled anywhere
// else and no pinned verdict file is rewritten: it PRINTS the harness's own verdicts.
//
// ⛔ OPT-IN (UIE_RUNTIME_ACCEPTANCE=1), like every *.measure test here:
//   cd app && UIE_RUNTIME_ACCEPTANCE=1 node node_modules/vitest/vitest.mjs run --maxWorkers=1 \
//     src/components/chart/engine/__tests__/vendorHarness/uieRuntimeAcceptance.measure.test.js
import { it, vi, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { gradeCapture, loadCapture, HARNESS_DIR } from './harness'
import { cap3Signature } from './cap3Signature'
import { enterMemberDoor, toProductBars, tfCodeOf } from './ourSide'
import { computeRuntimeColumns } from '../../runtime/runtimeColumns'

const SCRIPTS = [
  'adx-and-di-for-v4', 'inside-bar-range-mother-candle', 'delta-rsi-oscillator-strategy',
  'fibonacci-dolphintradebot', 'trend-targets-algoalpha', 'wyckoff-accumulation-distribution',
]

it.skipIf(!process.env.UIE_RUNTIME_ACCEPTANCE)('grades every capture of the six runtime-only scripts, runtime pane on', () => {
  const files = fs.readdirSync(HARNESS_DIR).filter((f) => f.endsWith('.json') && SCRIPTS.some((s) => f.startsWith(s))).sort()
  expect(files.length).toBeGreaterThanOrEqual(SCRIPTS.length)
  const rows = []
  for (const f of files) {
    vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
    vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
    const loaded = loadCapture(path.join(HARNESS_DIR, f))
    if (!loaded.capture) { rows.push({ id: f, verdict: 'NOT-A-CAPTURE', reason: loaded.reason }); vi.unstubAllEnvs(); continue }
    const t0 = Date.now()
    let sig
    let why = null
    try {
      const graded = gradeCapture(loaded.capture)
      sig = cap3Signature(graded.verdict)
      // the FULL reason of the first plot that was not compared, for the acceptance report
      const first = (graded.verdict.plots || []).find((p) => p && p.verdict === 'INCONCLUSIVE')
      why = first ? String(first.reason || first.detail || JSON.stringify(first)).slice(0, 600) : null
      // ⭐ and WHICH guard the runtime run stopped on: the same door, the same bars, the same
      // listing fact the harness states (`ourSide.runOurSide`), run directly.
      if (first) {
        const door = enterMemberDoor(loaded.capture.source && loaded.capture.source.text)
        if (door.def && door.def.compute && door.def.compute.kind === 'runtime') {
          try {
            computeRuntimeColumns(door.def, toProductBars(loaded.capture), {
              tf: tfCodeOf(loaded.capture.timeframe),
              historyFromListing: !!(loaded.capture.history && loaded.capture.history.startsAtBar0 === true),
            })
            why += ' | the runtime run itself computed'
          } catch (e) {
            why += ` | runtime stop: ${(e && e.guard) || (e && e.name) || 'error'} — ${String(e && e.message).slice(0, 160)}`
          }
        } else if (door.def) {
          why += ` | lane: ${door.def.compute && door.def.compute.kind}`
        }
      }
    } catch (e) { sig = { verdict: 'ERROR', reason: String(e && e.message).slice(0, 200) } }
    rows.push({ id: f.replace(/\.json$/, ''), ms: Date.now() - t0, ...sig, ...(why ? { why } : {}) })
    vi.unstubAllEnvs()
  }
  console.log(`UIE_ACCEPTANCE ${JSON.stringify(rows)}`)
}, 3600000)
