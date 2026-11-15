// app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.corpus.test.js
//
// ─── THE HARNESS OVER EVERY CAPTURE ON DISK — and its CLI entry ───────────────
//
// Default: walks `tests/fixtures/vendor/` (native captures under `harness/`
// plus every legacy format the adapters understand) and prints the verdict
// table. As a CLI (docs/pine/VENDOR-HARNESS.md):
//
//   cd app
//   VENDOR_HARNESS_DIR=../tests/fixtures/vendor/harness \
//   VENDOR_HARNESS_OUT=../docs/pine/vendor-harness \
//     npx vitest run src/components/chart/engine/__tests__/vendorHarness/vendorHarness.corpus.test.js
//
//   (PowerShell: `$env:VENDOR_HARNESS_DIR='…'; $env:VENDOR_HARNESS_OUT='…'; npx vitest run …`)
//
// `VENDOR_HARNESS_DIR` may hold several directories separated by `;`.
// `VENDOR_HARNESS_OUT` receives `verdicts.json` (machine-readable) and
// `summary.md` (the human table + the inventory of files that could not be
// compared, with why).
//
// ⛔ IT ASSERTS NO VERDICT. A table pinned to MATCH/DIVERGE goes red on exactly
// the progress it exists to measure (PARITY-PROGRAMME.md, "IT REPORTS, IT DOES
// NOT GATE"). What it asserts is that the harness told the truth about what it
// did: every file was accounted for, every verdict is one of three, every
// DIVERGE names its bar and both readings, every MATCH compared something —
// AND WHICH LANE IT MEASURED.
//
// ─── ⭐⭐ THE LANES (Phase 3, WS-0; `tools/pine_coverage/runtime_lane.mjs`) ─────
//
//   VENDOR_HARNESS_RUNTIME_ON=0   production: objects-only pane armed, runtime DARK
//   VENDOR_HARNESS_RUNTIME_ON=1   runtime-on: both panes on, as a PERMITTED member
//                                 with EVERY script graded (an upper bound: the
//                                 server's starter allowlist is not applied)
//   unset                         the suite's default, unchanged; the lane it
//                                 happened to measure is printed, not asserted
//
// ⛔⛔ WHY THE MODE SWITCHES AT MODULE SCOPE. `runHarness` grades every capture at
// COLLECTION time, inside `describe`. `src/test-setup.js` grants the runtime
// pane's per-member permission and its allow-every-script override in a
// `beforeEach`, which has not run yet then. So `VITE_PINE_RUNTIME_PANE_ENABLED=1`
// in the environment, or `vi.stubEnv` alone, measured the DARK pane (92 / 98 /
// 146 both ways, capture for capture: PHASE3-RUNTIME-PLAN.md 2.4). The mode
// therefore stubs both flags AND grants both overrides here, before
// `runHarness`, and only when asked: never by default.
// ⛔ And it PROVES the lane: a runtime-on run in which the runtime lane neither
// drew nor declined anything fails, and writes nothing.

import { describe, it, expect, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { VERDICTS } from '../../../../../../../tools/vendor_harness/compare.mjs'
import {
  HARNESS_RUNTIME_ENV, LANE_PRODUCTION, LANE_RUNTIME_ON, requestedLane, assertLaneMeasured,
  runtimeDeclineCodeIn, runtimeDeclinedTag, isGateDecline,
} from '../../../../../../../tools/pine_coverage/runtime_lane.mjs'
import { runHarness, loadCapture, VENDOR_DIR, REPO } from './harness'
import { runtimePaneEnabled, __permitRuntimePaneForTests } from '../../runtimePaneGate'
import { __allowEveryRuntimeScriptForTests } from '../../runtimeKill'
import { __admitEveryRunHalfForTests } from '../../runHalfRailSeam'
import { objectsOnlyPaneEnabled } from '../../objectsOnlyPaneGate'
import { memberPaneDefinition } from '../../../builder/memberPane/memberPaneDefinition'
import {
  laneEvidence, laneReport, consoleBlock, writeHarnessOutputs, HARNESS_SHARD_FILE,
} from '../../../../../../../tools/vendor_harness/harness_output.mjs'
import { parseShard, readOnlyList, HARNESS_SHARD_ENV } from '../../../../../../../tools/vendor_harness/shard.mjs'

/** The flag NAMES are read off their gate modules, never typed. */
const flagOf = (rel) => (fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8')
  .match(/source\.(VITE_[A-Z0-9_]+)\s*===\s*'1'/) || [])[1]

const REQUESTED = requestedLane(process.env[HARNESS_RUNTIME_ENV], HARNESS_RUNTIME_ENV)
if (REQUESTED) {
  vi.stubEnv(flagOf('src/components/chart/engine/objectsOnlyPaneGate.js'), '1')
  vi.stubEnv(flagOf('src/components/chart/engine/runtimePaneGate.js'), REQUESTED === LANE_RUNTIME_ON ? '1' : '')
  if (REQUESTED === LANE_RUNTIME_ON) {
    __permitRuntimePaneForTests()
    __allowEveryRuntimeScriptForTests()
    // ⭐ RS RATING L8 — and every run half, for the same reason: its evidence is this lane's
    // grade of the run's drawings (`runHalfRailSeam.js`)
    __admitEveryRunHalfForTests()
  }
}

/**
 * What the door actually did over one run. Declines are counted off the refusal
 * the verdict carries (`ourSide.js::enterMemberDoor` tags them); a capture drawn
 * BY the runtime lane carries no refusal, so while the gate is open each graded
 * capture's source is asked of the builder door again for its lane.
 * @param {{results: object[]}} run
 * @param {{gateOpen: boolean, laneOf?: (file: string) => string|null}} at
 */
export function laneEvidenceOf(run, { gateOpen, laneOf = null }) {
  const declines = {}
  let declined = 0
  let gated = 0
  let runtimeDrawn = 0
  let hostRefused = 0
  for (const r of run.results) {
    const code = runtimeDeclineCodeIn(r.reason)
    const refused = /refused on our side: member door refused/.test(r.reason || '')
    if (code) {
      declines[code] = (declines[code] || 0) + 1
      // a decline by the allowlist / kill list is the gate answering, not the lane
      if (isGateDecline(code)) gated += 1
      else declined += 1
    }
    if (refused) hostRefused += 1
    else if (gateOpen && laneOf && laneOf(r.file) === 'runtime') {
      runtimeDrawn += 1
      hostRefused += 1      // the host refused it too: that is why the runtime lane drew it
    }
  }
  return laneEvidence({ gateOpen, declined, gated, runtimeDrawn, hostRefused, declines })
}

function builderLaneOf(file) {
  const loaded = loadCapture(path.join(REPO, file))
  const source = loaded.capture && loaded.capture.source && loaded.capture.source.text
  if (!source) return null
  try {
    const d = memberPaneDefinition({ source, id: 'u_harness-lane-probe', name: 'lane probe' })
    return d.ok ? (d.lane || 'host') : null
  } catch {
    return null
  }
}

const dirs = process.env.VENDOR_HARNESS_DIR
  ? process.env.VENDOR_HARNESS_DIR.split(';').filter(Boolean).map((d) => path.resolve(process.cwd(), d))
  : [VENDOR_DIR]
const OUT = process.env.VENDOR_HARNESS_OUT ? path.resolve(process.cwd(), process.env.VENDOR_HARNESS_OUT) : null
/** ⭐ PARALLEL — `HARNESS_SHARD=i/N` grades only the captures shard i owns (a stable
 *  hash of the file id, `tools/vendor_harness/shard.mjs`) and writes ONE shard file
 *  into VENDOR_HARNESS_OUT instead of `verdicts.json` / `summary.md`; the lane is
 *  asserted by the merge, over every shard's evidence (`parallel_run.mjs`).
 *  `VENDOR_HARNESS_ONLY=<list file>` restricts a run to named files (the rail's subset).
 *  Both unset: exactly the single run it always was. */
const SHARD = parseShard(process.env[HARNESS_SHARD_ENV], HARNESS_SHARD_ENV)
const ONLY = readOnlyList(process.env.VENDOR_HARNESS_ONLY, fs)

describe('the vendor harness over the captures on disk', () => {
  // ⛔ read at COLLECTION, in the same module state that grades the captures
  const gateOpen = runtimePaneEnabled()
  const objectsOnly = objectsOnlyPaneEnabled()
  const run = runHarness(dirs, { shard: SHARD, only: ONLY })
  const evidence = laneEvidenceOf(run, { gateOpen, laneOf: gateOpen ? builderLaneOf : null })
  const { lane, laneLine, laneError } = laneReport({ requested: REQUESTED, evidence, objectsOnly })
  const dirsRel = dirs.map((d) => path.relative(REPO, d).replace(/\\/g, '/'))

  it('⛔ the lane measured is the lane requested', () => {
    // a shard's evidence is a fraction of the run's: the MERGE asserts the lane, over all of it
    if (SHARD) return
    if (laneError) throw laneError
    expect(laneLine).toMatch(/^LANE MEASURED: /)
  })

  it('prints the table, and writes it when asked', () => {
    if (SHARD) {
      expect(OUT, 'a shard run needs VENDOR_HARNESS_OUT').toBeTruthy()
      fs.mkdirSync(OUT, { recursive: true })
      fs.writeFileSync(path.join(OUT, HARNESS_SHARD_FILE), JSON.stringify({
        shard: SHARD, dirsRel, requested: REQUESTED, objectsOnly, allFiles: run.allFiles, files: run.files,
        evidence, results: run.results, inventory: run.inventory,
      }) + '\n')
      return
    }
    // eslint-disable-next-line no-console
    console.log(consoleBlock({ laneLine, results: run.results, inventory: run.inventory }))
    // ⛔ a run that measured the wrong lane writes nothing a later diff could trust
    if (laneError) throw laneError
    if (OUT) {
      writeHarnessOutputs(OUT, {
        dirsRel, lane, laneLine, requested: REQUESTED, objectsOnly, evidence, results: run.results, inventory: run.inventory,
      })
    }
  })

  it('⛔ every file is accounted for — graded or listed with a reason', () => {
    expect(run.results.length + run.inventory.length).toBe(run.files)
    for (const i of run.inventory) expect(i.reason, i.file).toBeTruthy()
  })

  it('⛔ every verdict is exactly one of the three, with its reason', () => {
    for (const r of run.results) {
      expect(VERDICTS, r.file).toContain(r.verdict)
      expect(r.reason, r.file).toBeTruthy()
      for (const p of r.plots || []) {
        expect(VERDICTS, `${r.file} ${p.title}`).toContain(p.verdict)
        expect(p.reason, `${r.file} ${p.title}`).toBeTruthy()
      }
    }
  })

  it('⛔ a DIVERGE names its bar and both readings; a MATCH compared something', () => {
    for (const r of run.results) {
      for (const p of r.plots || []) {
        if (p.verdict === 'DIVERGE') {
          const f = p.stats.steady.first
          expect(f, `${r.file} ${p.title}`).toBeTruthy()
          expect(f).toHaveProperty('bar')
          expect(f).toHaveProperty('time')
          expect(f).toHaveProperty('vendor')
          expect(f).toHaveProperty('ours')
        }
        if (p.verdict === 'MATCH') expect(p.stats.steady.compared, `${r.file} ${p.title}`).toBeGreaterThan(0)
      }
    }
  })

  it('⛔ NON-VACUITY — the default corpus is not empty and was really graded', () => {
    if (process.env.VENDOR_HARNESS_DIR) return            // a CLI run over a new directory may legitimately be small
    if (SHARD || ONLY) return                             // a shard or a subset is a fraction; the merge holds the whole
    expect(run.results.length).toBeGreaterThan(5)
    // both measured outcomes occur on real data — a harness that could only say
    // one of them would pass the structural checks above
    expect(run.results.some((r) => r.verdict === 'MATCH')).toBe(true)
    expect(run.results.some((r) => r.verdict === 'DIVERGE')).toBe(true)
  })
})

// ─── ⛔ SELF-CHECK: THE HARNESS LANE RAIL CAN FAIL ────────────────────────────
// Over a synthetic run (no captures graded), so it is cheap and runs in every
// suite. The real-door half of the proof is in coverageMapDoorCensus.measure.test.js
// (same rail, same module) and in the WS-0 mutation record.
describe('⛔ vendor harness lane rail: it can fail', () => {
  const refusedDark = { reason: 'refused on our side: member door refused (pine:block): a block', file: 'a.json' }
  const refusedLit = { reason: `refused on our side: member door refused (pine:block) ${runtimeDeclinedTag('runtime:loop')}: a block`, file: 'b.json' }
  const matched = { reason: 'every plot matched', file: 'c.json' }

  it('RED: runtime-on requested, the pane dark (no permission at collection) -> refused', () => {
    const ev = laneEvidenceOf({ results: [refusedDark, matched] }, { gateOpen: false })
    expect(ev.reachedRuntime).toBe(0)
    expect(() => assertLaneMeasured({ requested: LANE_RUNTIME_ON, ...ev })).toThrow(/RUNTIME PANE IS DARK/)
  })

  it('RED: runtime-on requested, gate open, but nothing reached the lane -> refused', () => {
    const ev = laneEvidenceOf({ results: [refusedDark, matched] }, { gateOpen: true, laneOf: () => 'host' })
    expect(() => assertLaneMeasured({ requested: LANE_RUNTIME_ON, ...ev })).toThrow(/NEVER EXERCISED/)
  })

  it('GREEN: a tagged decline, or a capture the runtime lane drew, is the runtime lane measured', () => {
    const ev1 = laneEvidenceOf({ results: [refusedLit, matched] }, { gateOpen: true, laneOf: () => 'host' })
    expect(ev1.declines).toEqual({ 'runtime:loop': 1 })
    expect(assertLaneMeasured({ requested: LANE_RUNTIME_ON, ...ev1 })).toMatch(/^LANE MEASURED: runtime-on/)
    const ev2 = laneEvidenceOf({ results: [refusedDark, matched] }, { gateOpen: true, laneOf: (f) => (f === 'c.json' ? 'runtime' : 'host') })
    expect(ev2.runtimeDrawn).toBe(1)
    expect(assertLaneMeasured({ requested: LANE_RUNTIME_ON, ...ev2 })).toMatch(/^LANE MEASURED: runtime-on/)
  })

  it('RED: runtime-on requested, but the allowlist answered (override missing) -> refused', () => {
    const notGraded = { reason: `refused on our side: member door refused (pine:block) ${runtimeDeclinedTag('runtime:not-yet-graded')}: x`, file: 'd.json' }
    const ev = laneEvidenceOf({ results: [notGraded, refusedLit] }, { gateOpen: true, laneOf: () => 'host' })
    expect(ev.gated).toBe(1)
    expect(ev.reachedRuntime).toBe(1)
    expect(() => assertLaneMeasured({ requested: LANE_RUNTIME_ON, ...ev })).toThrow(/ALLOWLIST OR KILL LIST/)
  })

  it('RED: production requested but the runtime lane answered -> refused', () => {
    const ev = laneEvidenceOf({ results: [refusedLit] }, { gateOpen: false })
    expect(() => assertLaneMeasured({ requested: LANE_PRODUCTION, ...ev })).toThrow(/PRODUCTION LANE WAS REQUESTED/)
  })
})
