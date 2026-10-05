// app/src/components/chart/engine/__tests__/vendorHarness/o1DrawingOnly.measure.test.js
//
// ─── O1 (step 67) — WHY A DRAWING-ONLY SCRIPT DRAWS NOTHING, per script ──────
//
// The member door refuses `pine:no-output` when the host translation offers no
// plot AND its object program kept no op; `pine:object-removal-lost` when the
// program lost a removal. This instrument names, for every corpus script the
// door refuses with either guard (objects-only flag ON, as in production), what
// the HOST object pass said (`objectDiagnostics`: drop reasons, guard refusals,
// diverged collections, loop-blocked calls) and what the RUNTIME lane said for
// the same script (runtime pane ON: `runtimeDeclined`).
//
// ⛔ OPT-IN, and it asserts no count (a pinned count goes red on the progress it
// measures). It asserts the corpus was found and every listed script was read.
//   cd app && O1_TRIAGE=1 O1_TRIAGE_OUT=<file.json> npx vitest run --maxWorkers=2 \
//     src/components/chart/engine/__tests__/vendorHarness/o1DrawingOnly.measure.test.js
import { describe, it, expect, vi, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import * as registry from '../../nativeRegistry'
import { enterMemberDoor, HARNESS_DEF_ID } from './ourSide'

const RUN = process.env.O1_TRIAGE === '1'
const OUT = process.env.O1_TRIAGE_OUT
const ONLY = process.env.O1_TRIAGE_ONLY ? new Set(process.env.O1_TRIAGE_ONLY.split(',')) : null
const REPO = path.resolve(process.cwd(), '..')
const CORPUS = path.join(REPO, 'corpus', 'committed')
const GUARDS = ['pine:no-output', 'pine:object-removal-lost']

afterEach(() => { vi.unstubAllEnvs() })

function enter(source, runtimeOn) {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', runtimeOn ? '1' : '')
  try {
    return enterMemberDoor(source)
  } catch (err) {
    return { built: null, def: null, refusal: `threw: ${String((err && err.message) || err)}` }
  } finally {
    registry.uninstallUserDefinition(HARNESS_DEF_ID)
    vi.unstubAllEnvs()
  }
}

const guardOf = (refusal) => ((String(refusal || '').match(/\((pine:[a-z0-9-]+)\)/) || [])[1] || null)

function diag(t) {
  const d = (t && t.objectDiagnostics) || {}
  return {
    ops: (t && t.objects && (t.objects.ops || []).length) || 0,
    attemptedOps: d.attemptedOps ?? null,
    droppedOps: d.droppedOps ?? null,
    dropReasons: d.dropReasons || {},
    guardRefusals: d.guardRefusals || [],
    collsDivergedWhy: d.collsDivergedWhy || [],
    loopBlockedCalls: d.loopBlockedCalls || [],
    unsupported: d.unsupported || [],
    outOfScope: d.outOfScope || [],
    lostRemovals: d.lostRemovals || [],
    failed: d.failed === true ? d.error || true : false,
    runtimeRefused: d.runtimeRefused || null,
    createDropWhy: d.createDropWhy || [],
    guardRefusalWhy: d.guardRefusalWhy || [],
    refusals: ((t && t.refusals) || []).slice(0, 6).map((r) => `${r.guard}@${r.line ?? '?'}: ${String(r.message || '').slice(0, 160)}`),
  }
}

describe.skipIf(!RUN)('O1 drawing-only triage (opt-in)', () => {
  it('names the object-lane and runtime-lane reasons for every no-output / removal-lost script', () => {
    expect(OUT, 'O1_TRIAGE_OUT must name the output file').toBeTruthy()
    const files = fs.readdirSync(CORPUS).filter((f) => f.endsWith('.pine')).sort()
    expect(files.length).toBeGreaterThan(200) // non-vacuity: the corpus was found
    const rows = []
    for (const f of files) {
      const slug = f.replace(/\.pine$/, '').split('__')[0]
      if (ONLY && !ONLY.has(slug)) continue
      const src = fs.readFileSync(path.join(CORPUS, f), 'utf8')
      const host = enter(src, false)
      const g = guardOf(host.refusal)
      if (!ONLY && !GUARDS.includes(g)) continue
      const rt = enter(src, true)
      rows.push({
        slug, guard: g, attached: !!host.def, refusal: host.refusal,
        host: diag(host.built && host.built.translation),
        runtime: { attached: !!rt.def, lane: rt.built && rt.built.lane || null,
          declined: (rt.built && rt.built.runtimeDeclined) || null },
      })
    }
    expect(rows.length).toBeGreaterThan(0)
    fs.writeFileSync(OUT, JSON.stringify({ rows }, null, 1) + '\n')
    // eslint-disable-next-line no-console
    console.log(`O1 triage: ${rows.length} scripts -> ${OUT}`)
  }, 900000)
})
