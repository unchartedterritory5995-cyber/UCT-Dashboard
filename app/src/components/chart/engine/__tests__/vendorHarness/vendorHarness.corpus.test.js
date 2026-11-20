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
// `VENDOR_HARNESS_DIR` may hold several directories (or single capture files) separated by `;`.
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
//                                 server's starter allowlist is not applied), and
//                                 the strategy broker gate ON as production builds
//                                 it (2026-11-17): a strategy's trades and report are
//                                 graded on the run the door made (`strategyLane.js`)
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
  HARNESS_RUNTIME_ENV, LANE_PRODUCTION, LANE_RUNTIME_ON, requestedLane, laneShown, assertLaneMeasured,
  runtimeDeclineCodeIn, runtimeDeclinedTag, isGateDecline,
} from '../../../../../../../tools/pine_coverage/runtime_lane.mjs'
import { runHarness, loadCapture, VENDOR_DIR, REPO } from './harness'
import { loadPineLibraryStoreFromEnv } from '../../ast/__tests__/pineLibraryStoreLoader.js'
import { storeHeldOf, libraryStorePins, supplyHeldOf, supplyHeldStorePins } from './storeHeld.js'
import { fixturePath } from '../../ast/__tests__/licenceHeld'
import { strategyBrokerFlag, strategyEvidenceOf, assertStrategyLaneMeasured } from './strategyLane.js'
import { runtimePaneEnabled, __permitRuntimePaneForTests } from '../../runtimePaneGate'
import { __allowEveryRuntimeScriptForTests } from '../../runtimeKill'
import { memberDoorsAtCollection } from '../../../../../testing/runtimeGate'
import { __admitEveryRunHalfForTests } from '../../runHalfRailSeam'
import { __serveEveryTimeframeSettingForTests } from '../../runtime/runtimeInputs.js'
// ⭐ (2026-11-18) the engine that graded a snapshot is written INTO it: an admission rail can then hold new
// capability evidence to the CURRENT engine (tests/test_pine_capability_admission.py, C1-C6). No commit SHA:
// a file cannot name the commit that contains it, and a SHA would break the byte-identical before/after
// evidence every regeneration is compared by (`git log -1 -- <snapshot>` names the commit).
import { SCRIPT_ENGINE_VERSION } from '../../scriptEngineVersion.js'
import { objectsOnlyPaneEnabled } from '../../objectsOnlyPaneGate'
import { strategyBrokerEnabled } from '../../strategyBrokerGate'
import { memberPaneDefinition } from '../../../builder/memberPane/memberPaneDefinition'

/** The flag NAMES are read off their gate modules, never typed (the broker gate's by `strategyLane.js`). */
const flagOf = (rel) => (fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8')
  .match(/source\.(VITE_[A-Z0-9_]+)\s*===\s*'1'/) || [])[1]
const STRATEGY_BROKER_FLAG = strategyBrokerFlag()

const REQUESTED = requestedLane(process.env[HARNESS_RUNTIME_ENV], HARNESS_RUNTIME_ENV)
if (REQUESTED) {
  vi.stubEnv(flagOf('src/components/chart/engine/objectsOnlyPaneGate.js'), '1')
  vi.stubEnv(flagOf('src/components/chart/engine/runtimePaneGate.js'), REQUESTED === LANE_RUNTIME_ON ? '1' : '')
  // ⭐⭐ (2026-11-17) — THE STRATEGY BROKER, ARMED AS PRODUCTION ARMS IT. Production's build bakes the gate ON
  // (`Dockerfile.web` ARG default, #1664) and members are on the runtime lane, so the runtime-on lane runs with
  // the gate's own flag on: a strategy reaches the member door's broker document, its run publishes its record,
  // and `strategyLane.js` grades its trades and report. ⛔ The gate's FLAG, never the `strategyBroker: true`
  // build option or a widened pin ledger: one code path, the member's. The production lane (runtime dark)
  // keeps it off: no broker runs where the runtime lane is dark.
  vi.stubEnv(STRATEGY_BROKER_FLAG, REQUESTED === LANE_RUNTIME_ON ? '1' : '')
  if (REQUESTED === LANE_RUNTIME_ON) {
    __permitRuntimePaneForTests()
    __allowEveryRuntimeScriptForTests()
    // ⭐ RS RATING L8 — and every run half, for the same reason: its evidence is this lane's
    // grade of the run's drawings (`runHalfRailSeam.js`)
    __admitEveryRunHalfForTests()
    // ⭐ SETTINGS PARITY (timeframe, Engine 77, #1831) — and a capture taken at a MOVED timeframe setting is
    // graded at it: the lane's grade is the evidence that would admit one (`runtimeInputs.js::movedTimeframeServed`)
    __serveEveryTimeframeSettingForTests()
    // ⭐⭐ THE MEMBER'S HOST-KNOWN-DIVERGENCE LIST, APPLIED (coordinator ruling 2026-11-19, GATE-BLIND follow-up (a)):
    // a member's door refuses a listed script on the host lane, so the runtime lane draws it (or the door refuses it
    // by name), and this lane's grade must be of THAT. ⚰️ With the list ignored (the test grant), the 67 rows of the
    // 28 listed scripts were graded on the HOST lane here, and the reach run and capability evidence read those
    // host grades as runtime-on evidence. ⛔ The PRODUCTION lane keeps the list ignored: it grades what the host lane
    // WOULD draw, which is what the list is derived from (`tools/vendor_harness/host_divergence.py`).
    memberDoorsAtCollection({ hkd: true })
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
  return {
    gateOpen, declined, gated, runtimeDrawn, hostRefused, reachedRuntime: declined + runtimeDrawn,
    declines: Object.fromEntries(Object.entries(declines).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))),
  }
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
// ⭐ LIBRARIES (libraries chain L1, 2026-11-19), OPT-IN AND MEASURE-ONLY: `PINE_LIBRARY_STORE=<store dir>` loads
// that store into the registry BEFORE the captures are graded (collection time), so a capture of a script that
// imports a promoted version is graded on what production draws (the roadmap's section 9 runs it with the promoted
// store). Unset, nothing is loaded and nothing changes; `verdicts.json` names the versions only when a store was
// loaded, so every run without one writes the file it always did. ⛔ The store is a scratch directory outside the
// repository (library code is never committed).
const LIBRARIES_LOADED = loadPineLibraryStoreFromEnv()
// ⭐ STORE-HELD ROWS (coordinator ruling 2026-11-19): with a store loaded, every row whose script reaches a loaded
// version records which (`storeHeld`: `path@sha256`, `./storeHeld.js`), so a run without the store skips exactly
// those rows by name (`tools/vendor_harness/store_held.py`). Only a file that holds `import ` at all is re-read.
// ⭐⭐ and SUPPLY-HELD ROWS (2026-11-19, the same rule): a row graded with a HELD supply record (a local record never
// committed, `ourSide.recordedSupplyFileOf`) records it (`supplyHeld`: `supply/<id>@sha256`), and the run names the
// held records it could read (`supplyHeldStore`), so a run without them names that row "supply-held" by name.
const SUPPLY_HELD_LOADED = supplyHeldStorePins()
function markStoreHeld(results) {
  const supplied = results.map((r) => {
    const pins = supplyHeldOf(r.id)
    return pins.length ? { ...r, supplyHeld: pins } : r
  })
  return markLibraryHeld(supplied)
}
function markLibraryHeld(results) {
  if (!LIBRARIES_LOADED.length) return results
  return results.map((r) => {
    // a licence-held capture is read where it lives now (the local capture store), as the harness read it
    const at = fixturePath(r.file) || path.join(REPO, r.file)
    let raw
    try { raw = fs.readFileSync(at, 'utf8') } catch { return r }
    if (!raw.includes('import ')) return r
    const loaded = loadCapture(at)
    const pins = storeHeldOf(loaded.capture && loaded.capture.source ? loaded.capture.source.text : '')
    return pins.length ? { ...r, storeHeld: pins } : r
  })
}

describe('the vendor harness over the captures on disk', () => {
  // ⛔ read at COLLECTION, in the same module state that grades the captures
  const gateOpen = runtimePaneEnabled()
  const objectsOnly = objectsOnlyPaneEnabled()
  const brokerGate = strategyBrokerEnabled()
  const run = runHarness(dirs)
  const evidence = laneEvidenceOf(run, { gateOpen, laneOf: gateOpen ? builderLaneOf : null })
  const strategyEvidence = strategyEvidenceOf(run, { brokerGate })
  const lane = REQUESTED || laneShown(evidence)
  let laneLine
  let laneError = null
  let strategyLine
  try {
    laneLine = REQUESTED
      ? assertLaneMeasured({ requested: REQUESTED, ...evidence, what: 'vendor harness' })
      : `LANE MEASURED: ${lane} (suite default, not asserted; gate ${gateOpen ? 'OPEN' : 'CLOSED'}, `
        + `runtime lane reached ${evidence.reachedRuntime}, host refusals ${evidence.hostRefused})`
  } catch (err) {
    laneError = err
    laneLine = String(err.message)
  }
  try {
    strategyLine = assertStrategyLaneMeasured({ requested: REQUESTED, ...strategyEvidence })
  } catch (err) {
    laneError = laneError || err
    strategyLine = String(err.message)
  }
  laneLine += ` · objects-only pane ${objectsOnly ? 'ARMED' : 'off'} · runtime drew ${evidence.runtimeDrawn}, declined ${evidence.declined} · ${strategyLine}`

  it('⛔ the lane measured is the lane requested', () => {
    if (laneError) throw laneError
    expect(laneLine).toMatch(/^LANE MEASURED: /)
  })

  it('prints the table, and writes it when asked', () => {
    // eslint-disable-next-line no-console
    console.log(`\n${laneLine}\n${run.table}\n\nNOT COMPARABLE (${run.inventory.length}):\n${run.inventory.map((i) => `  - ${i.file}: ${i.reason}`).join('\n')}\n`)
    // ⛔ a run that measured the wrong lane writes nothing a later diff could trust
    if (laneError) throw laneError
    if (OUT) {
      fs.mkdirSync(OUT, { recursive: true })
      fs.writeFileSync(path.join(OUT, 'verdicts.json'), JSON.stringify({
        generatedBy: 'app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.corpus.test.js',
        scriptEngineVersion: SCRIPT_ENGINE_VERSION,
        dirs: dirs.map((d) => path.relative(REPO, d).replace(/\\/g, '/')),
        lane,
        laneEvidence: { requested: REQUESTED, objectsOnlyPane: objectsOnly, ...evidence, strategy: strategyEvidence },
        ...(LIBRARIES_LOADED.length ? { libraryStore: libraryStorePins(LIBRARIES_LOADED) } : {}),
        ...(SUPPLY_HELD_LOADED.length ? { supplyHeldStore: SUPPLY_HELD_LOADED } : {}),
        results: markStoreHeld(run.results),
        inventory: run.inventory,
      }, null, 1) + '\n')
      fs.writeFileSync(path.join(OUT, 'summary.md'), [
        '# Vendor harness — verdicts',
        '',
        `Directories: ${dirs.map((d) => `\`${path.relative(REPO, d).replace(/\\/g, '/')}\``).join(', ')}`,
        '',
        `Lane: **${lane}**${REQUESTED ? '' : ' (suite default, not requested)'}. ${laneLine}`,
        '',
        `Graded at script engine **${SCRIPT_ENGINE_VERSION}**.`,
        '',
        '```', run.table, '```', '',
        ...(evidence.declined ? [`## Runtime declines by code (${evidence.declined})`, '',
          ...Object.entries(evidence.declines).map(([c, n]) => `- \`${c}\` ${n}`), ''] : []),
        `## Not comparable (${run.inventory.length})`, '',
        ...run.inventory.map((i) => `- \`${i.file}\` — ${i.reason}`), '',
      ].join('\n'))
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
