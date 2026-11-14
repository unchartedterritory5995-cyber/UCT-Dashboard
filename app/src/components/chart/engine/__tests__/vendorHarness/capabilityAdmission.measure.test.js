// app/src/components/chart/engine/__tests__/vendorHarness/capabilityAdmission.measure.test.js
//
// ─── WS-I PART 2 (2026-11-13) — WHICH LANE THE MEMBER DOOR TAKES, PER SCRIPT ────
//
// The measurement behind `docs/pine/evidence/2026-11-13-capability-admission/`.
// It asks the member door (`memberPaneDefinition`, the runtime pane on as a
// PERMITTED member: the admins stage) for each script in a list the Python side
// writes (`tools/pine_coverage/capability_admission.py`), and records the lane,
// the guard and any runtime decline. Two modes:
//
//   CAPADMIT_MODE=lanes      every script graded (the harness's runtime-on upper
//                            bound): which captures does the RUNTIME lane draw?
//                            That is what a capability's evidence must come from.
//   CAPADMIT_MODE=admission  the allowlist EMPTY, capability admission latched ON,
//                            and a verdict latched for each script per the
//                            server's own answer (`admitted` in the input): which
//                            scripts reach a runtime-lane picture by capability.
//
//   CAPADMIT_IN=<input.json> CAPADMIT_OUT=<output.json> CAPADMIT_MODE=... \
//     node node_modules/vitest/vitest.mjs run <this file> --maxWorkers=1
//
// ⛔ Skipped unless CAPADMIT_IN is set: it reads sources from outside the repo (the
// coverage census cache) and is a measurement, not a rail.

import { describe, it, expect, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { loadCapture } from './harness'
import { __permitRuntimePaneForTests, runtimePaneEnabled } from '../../runtimePaneGate'
import {
  __allowEveryRuntimeScriptForTests, __resetRuntimeAllowList, __resetRuntimeAdmission,
  setRuntimeCapabilityAdmission, latchRuntimeAdmission, runtimeSourceHash, runtimeNotGradedOf,
} from '../../runtimeKill'
import { memberPaneDefinition } from '../../../builder/memberPane/memberPaneDefinition'

const IN = process.env.CAPADMIT_IN
const OUT = process.env.CAPADMIT_OUT
const MODE = process.env.CAPADMIT_MODE || 'admission'

/** The flag NAMES are read off their gate modules, never typed (the corpus test's rule). */
const flagOf = (rel) => (fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8')
  .match(/source\.(VITE_[A-Z0-9_]+)\s*===\s*'1'/) || [])[1]

if (IN) {
  vi.stubEnv(flagOf('src/components/chart/engine/objectsOnlyPaneGate.js'), '1')
  vi.stubEnv(flagOf('src/components/chart/engine/runtimePaneGate.js'), '1')
}

function sourceOf(file) {
  if (file.endsWith('.json')) {
    const loaded = loadCapture(file)
    return loaded.capture && loaded.capture.source && loaded.capture.source.text
  }
  return fs.readFileSync(file, 'utf8')
}

describe.skipIf(!IN)('WS-I Part 2 — the member door per script', () => {
  it(`records the lane (${MODE})`, () => {
    expect(['lanes', 'admission']).toContain(MODE)
    const input = JSON.parse(fs.readFileSync(IN, 'utf8'))
    __permitRuntimePaneForTests()
    __resetRuntimeAdmission()
    if (MODE === 'lanes') {
      __allowEveryRuntimeScriptForTests()
    } else {
      __resetRuntimeAllowList()
      setRuntimeCapabilityAdmission(true)
    }
    expect(runtimePaneEnabled()).toBe(true)
    const rows = []
    for (const s of input.scripts) {
      const source = sourceOf(s.path)
      if (typeof source !== 'string' || !source) {
        rows.push({ key: s.key, error: 'no source' })
        continue
      }
      const hash = runtimeSourceHash(source)
      if (MODE === 'admission') latchRuntimeAdmission(hash, { admitted: s.admitted === true })
      const t0 = performance.now()
      let d
      try {
        d = memberPaneDefinition({ source, id: 'u_capadmitprobe', name: 'capability admission probe' })
      } catch (err) {
        rows.push({ key: s.key, hash, error: String(err && err.message).slice(0, 200) })
        continue
      }
      rows.push({
        key: s.key,
        hash,
        ok: !!d.ok,
        lane: d.ok ? (d.lane || 'host') : null,
        guard: d.ok ? null : (d.guard || null),
        declined: d.runtimeDeclined ? d.runtimeDeclined.code : null,
        notGraded: MODE === 'admission' ? !!runtimeNotGradedOf({ hash }) : null,
        // the member-visible disclosures (names, and whether one says something is not drawn)
        notes: d.ok ? (d.notes || []).map((x) => (x && x.name) || String(x)) : [],
        notDrawn: d.ok ? (d.notes || []).filter((x) => x && /not drawn|does not draw/i.test(x.note || '')).map((x) => x.note) : [],
        ms: Math.round(performance.now() - t0),
      })
    }
    const out = { mode: MODE, generatedBy: 'capabilityAdmission.measure.test.js', rows }
    if (OUT) fs.writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n')
    // ⛔ the control the measurement rests on: in admission mode, a script the server did
    // NOT admit never reaches a runtime-lane picture
    if (MODE === 'admission') {
      const leaked = rows.filter((r) => r.lane === 'runtime'
        && !input.scripts.find((s) => s.key === r.key).admitted)
      expect(leaked.map((r) => r.key)).toEqual([])
    }
    expect(rows.length).toBe(input.scripts.length)
  }, 1800000)
})
