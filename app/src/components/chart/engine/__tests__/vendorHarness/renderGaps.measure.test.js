// app/src/components/chart/engine/__tests__/vendorHarness/renderGaps.measure.test.js
//
// ─── RENDER GAPS OVER EVERY CAPTURE ON DISK (census tools, opt-in) ───────────────────────────────────
//
// A SERVED script attaches with nothing refused; whether every drawing it makes lands on the member's chart
// is a second question, answered per capture by the render state (`renderGaps.js`: unplaced drawings by
// family and by reason class, `coordinate` / `textWithheld`, plus families withheld whole by name). This is
// the served-set render sweep made permanent: one row per capture, keys and counts only, joined to the
// sample by `tools/pine_coverage/render_gaps.py` and folded into the coverage map by
// `coverage_map.py --render-gaps` (parity_roadmap then splits member-served into servedFully /
// servedWithDisclosedGap / servedUnmeasured).
//
// ⭐ THE LANE MEMBERS ARE ON: runtime-on, armed exactly as `vendorHarness.corpus.test.js` arms it for
// VENDOR_HARNESS_RUNTIME_ON=1 (both panes, the strategy broker gate's own flag, every script and run half
// admitted: the served set is what the server admits, applied downstream by the roadmap). Switched at
// module scope for the reason that file gives: our side runs at collection time.
// ⭐ With `PINE_LIBRARY_STORE` the store is loaded first and its pins are written into the output, so the
// join can refuse rows measured against another store than the census's.
//
// ⛔ OPT-IN, and IT ASSERTS NO COUNT. It asserts that it measured something, on the lane it armed, and that
// the render state it rebuilt for each capture is the one the harness built (`dropped` equal, capture for
// capture). No text, source or message is written.
//   cd app && PINE_RENDER_GAPS=1 PINE_RENDER_GAPS_OUT=<rows.json> [PINE_RENDER_GAPS_DIR=<dir;dir>] \
//     [PINE_LIBRARY_STORE=<store dir>] node node_modules/vitest/vitest.mjs run \
//     src/components/chart/engine/__tests__/vendorHarness/renderGaps.measure.test.js --maxWorkers=1

import { describe, it, expect, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { loadCapture, gradeCapture, HARNESS_DIR, REPO } from './harness'
import { renderGapRow } from './renderGaps'
import { strategyBrokerFlag } from './strategyLane.js'
import { loadPineLibraryStoreFromEnv } from '../../ast/__tests__/pineLibraryStoreLoader.js'
import { libraryStorePins } from './storeHeld.js'
import { SCRIPT_ENGINE_VERSION } from '../../scriptEngineVersion.js'
import { runtimePaneEnabled, __permitRuntimePaneForTests } from '../../runtimePaneGate'
import { __allowEveryRuntimeScriptForTests } from '../../runtimeKill'
import { __admitEveryRunHalfForTests } from '../../runHalfRailSeam'
import { __serveEveryTimeframeSettingForTests } from '../../runtime/runtimeInputs.js'

const RUN = process.env.PINE_RENDER_GAPS === '1'
const OUT = process.env.PINE_RENDER_GAPS_OUT ? path.resolve(process.cwd(), process.env.PINE_RENDER_GAPS_OUT) : null
const DIRS = process.env.PINE_RENDER_GAPS_DIR
  ? process.env.PINE_RENDER_GAPS_DIR.split(';').filter(Boolean).map((d) => path.resolve(process.cwd(), d))
  : [HARNESS_DIR]
const RENDER_GAP_ROWS_SCHEMA = 'uct.pine-render-gap-rows/v1'

/** The flag NAMES are read off their gate modules, never typed (the corpus test's rule). */
const flagOf = (rel) => (fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8')
  .match(/source\.(VITE_[A-Z0-9_]+)\s*===\s*'1'/) || [])[1]
if (RUN) {
  vi.stubEnv(flagOf('src/components/chart/engine/objectsOnlyPaneGate.js'), '1')
  vi.stubEnv(flagOf('src/components/chart/engine/runtimePaneGate.js'), '1')
  vi.stubEnv(strategyBrokerFlag(), '1')
  __permitRuntimePaneForTests()
  __allowEveryRuntimeScriptForTests()
  __admitEveryRunHalfForTests()
  __serveEveryTimeframeSettingForTests()
}
const LIBRARIES_LOADED = RUN ? loadPineLibraryStoreFromEnv() : []

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out
  if (fs.statSync(dir).isFile()) return dir.endsWith('.json') ? [...out, dir] : out
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (e.name.endsWith('.json')) out.push(p)
  }
  return out
}

/** One file's row: the capture's id and file, its VERDICT (the harness's own grade, `gradeCapture`: an invalid
 *  capture is never run, a Strategy Tester capture is run on the bars its strategy ran), and what its drawings
 *  hold that the chart does not draw. ⭐ The verdict rides along because a served script whose capture grades
 *  DIVERGE is never "fully" served, whatever its drawings (coordinator ruling, 2026-11-19). */
function rowOf(file) {
  const loaded = loadCapture(file)
  const base = { file: loaded.file, id: (loaded.capture && typeof loaded.capture.id === 'string') ? loaded.capture.id : null }
  if (!loaded.capture) return { row: { ...base, status: 'not-a-capture' }, recomputed: null, ours: null }
  let graded
  try {
    graded = gradeCapture(loaded.capture)
  } catch {
    return { row: { ...base, status: 'threw' }, recomputed: null, ours: null }
  }
  if (!graded.integrity || !graded.integrity.ok) return { row: { ...base, status: 'invalid' }, recomputed: null, ours: null }
  const verdict = graded.verdict && typeof graded.verdict.verdict === 'string' ? graded.verdict.verdict : null
  const { row, recomputed } = renderGapRow(graded.ours)
  return { row: { ...base, verdict, ...row }, recomputed, ours: graded.ours }
}

describe.skipIf(!RUN)('render gaps over the captures on disk (opt-in)', () => {
  it('measures every capture on the runtime-on lane and writes keys and counts only', () => {
    expect(OUT, 'PINE_RENDER_GAPS_OUT must name the output file').toBeTruthy()
    expect(runtimePaneEnabled(), 'the runtime pane is not on: the lane members are on was not armed').toBe(true)
    const files = [...new Set(DIRS.flatMap((d) => walk(d)))].sort()
    expect(files.length).toBeGreaterThan(0)
    const rows = []
    const selfCheck = []
    for (const f of files) {
      const { row, recomputed, ours } = rowOf(f)
      rows.push(row)
      // ⛔ the render state rebuilt here is the one the harness built for this capture, or nothing here is true
      if (recomputed && JSON.stringify(recomputed.dropped) !== JSON.stringify(ours.objects.dropped || null)) {
        selfCheck.push(row.id || row.file)
      }
    }
    expect(selfCheck, 'the render state rebuilt here differs from the harness\'s own').toEqual([])
    const measured = rows.filter((r) => r.status === 'measured')
    // ⛔ NON-VACUITY: drawings were measured, and some of them on the runtime lane
    expect(measured.filter((r) => r.held > 0).length).toBeGreaterThan(0)
    expect(measured.some((r) => r.lane === 'runtime'), 'no capture\'s drawings came from the runtime lane').toBe(true)
    const status = {}
    for (const r of rows) status[r.status] = (status[r.status] || 0) + 1
    fs.mkdirSync(path.dirname(OUT), { recursive: true })
    fs.writeFileSync(OUT, `${JSON.stringify({
      schema: RENDER_GAP_ROWS_SCHEMA,
      generatedBy: 'app/src/components/chart/engine/__tests__/vendorHarness/renderGaps.measure.test.js',
      engine: SCRIPT_ENGINE_VERSION,
      lane: 'runtime-on',
      dirs: DIRS.map((d) => path.relative(REPO, d).replace(/\\/g, '/')),
      // the versions the run linked from ([] without a store): the join refuses another store than the census's
      libraryStore: libraryStorePins(LIBRARIES_LOADED),
      status: Object.fromEntries(Object.entries(status).sort()),
      rows,
    }, null, 1)}\n`)
    // eslint-disable-next-line no-console
    console.log(`render gaps: ${rows.length} captures ${JSON.stringify(status)} -> ${OUT}`)
  }, 7_200_000)
})
