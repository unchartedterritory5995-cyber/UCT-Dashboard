// app/src/components/chart/engine/__tests__/vendorHarness/memberDoorCensus.measure.test.js
//
// ─── WHICH CORPUS SCRIPTS THE MEMBER DOOR CAN BUILD — the vendor batch's census ─
//
// The unattended vendor batch (`tools/vendor_harness/batch_capture.py`) should
// only spend a TradingView add on a script the harness can then GRADE. The
// grader's own door is `enterMemberDoor` in `ourSide.js` (builder + install
// door); this census runs every committed corpus script through that SAME
// function and writes one row per script. `tools/vendor_harness/batch_manifest.py`
// reads the rows and derives the manifest — the target list is never typed.
//
// ⛔ OPT-IN. It builds 266 scripts twice (the objects-only door flag off and on);
// an ordinary run skips it.
//   cd app && VENDOR_BATCH_CENSUS=1 VENDOR_BATCH_CENSUS_OUT=<file.json> \
//     node node_modules/vitest/vitest.mjs run \
//     src/components/chart/engine/__tests__/vendorHarness/memberDoorCensus.measure.test.js
//
// ⛔ IT ASSERTS NO COUNT. Pinning "N scripts attach" would go red on exactly the
// progress it measures. What it asserts is that the corpus was found and every
// script was accounted for — attached, or refused with the door's sentence.

import { describe, it, expect, vi, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'

import * as registry from '../../nativeRegistry'
import { maxLookback } from '../../ast/interpret'
import { objectsOnlyPaneEnabled } from '../../objectsOnlyPaneGate'
import { enterMemberDoor, HARNESS_DEF_ID } from './ourSide'

import { loadPineLibraryStoreFromEnv } from '../../ast/__tests__/pineLibraryStoreLoader.js'
import { parseShard, inShard, readOnlyList, CENSUS_SHARD_ENV } from '../../../../../../../tools/vendor_harness/shard.mjs'
import { censusDocument, censusLine } from '../../../../../../../tools/vendor_harness/census_output.mjs'
import { CENSUS_SHARD_KIND } from '../../../../../../../tools/vendor_harness/harness_output.mjs'

// ⭐ L1 — opt-in: `PINE_LIBRARY_STORE=<scratch dir>` measures WITH the imported libraries
// (never committed). Unset, the registry is empty, as in every production process.
const LIBRARIES_LOADED = loadPineLibraryStoreFromEnv()
const RUN = process.env.VENDOR_BATCH_CENSUS === '1'
const OUT = process.env.VENDOR_BATCH_CENSUS_OUT
/** ⭐ PARALLEL (`tools/vendor_harness/parallel_run.mjs census`). `CENSUS_SHARD=i/N`
 *  builds only the scripts shard i owns (a stable hash of the id) and writes a SHARD
 *  file at VENDOR_BATCH_CENSUS_OUT, which the merge turns back into the census
 *  document byte for byte. `VENDOR_BATCH_CENSUS_ONLY=<list file>` restricts the run
 *  to named scripts (the rail's subset). Both unset: the census it always was. */
const SHARD = parseShard(process.env[CENSUS_SHARD_ENV], CENSUS_SHARD_ENV)
const ONLY = readOnlyList(process.env.VENDOR_BATCH_CENSUS_ONLY, fs)
const REPO = path.resolve(process.cwd(), '..')
const CORPUS = path.join(REPO, 'corpus', 'committed')

/** ⭐ THE ONE DOOR FLAG THAT CHANGES WHAT ATTACHES, read off its gate module
 *  rather than typed: `objectsOnlyPaneGate.js` is its single reader. The census
 *  measures BOTH states, because production and the grader's default vitest
 *  env can disagree (production armed it 2026-09-27; `import.meta.env` under
 *  vitest has it unset), and the manifest must pick the state the GRADE step
 *  will run with, never assume it. */
const GATE_SRC = fs.readFileSync(path.join(REPO, 'app/src/components/chart/engine/objectsOnlyPaneGate.js'), 'utf8')
const OBJECTS_ONLY_FLAG = (GATE_SRC.match(/source\.(VITE_[A-Z0-9_]+)\s*===\s*'1'/) || [])[1]

/** ⭐ RT1 — THE RUNTIME FALLBACK'S FLAG, read off ITS gate module the same way.
 *  Opt-in (`VENDOR_BATCH_CENSUS_RUNTIME=1`): a third state, objects-only ON and
 *  the runtime pane ON — what the door attaches once the runtime lane is the
 *  member door's fallback. Off, the census writes exactly what it always wrote. */
const RUNTIME_GATE_SRC = fs.readFileSync(path.join(REPO, 'app/src/components/chart/engine/runtimePaneGate.js'), 'utf8')
const RUNTIME_FLAG = (RUNTIME_GATE_SRC.match(/source\.(VITE_[A-Z0-9_]+)\s*===\s*'1'/) || [])[1]
const WITH_RUNTIME = process.env.VENDOR_BATCH_CENSUS_RUNTIME === '1'

afterEach(() => { vi.unstubAllEnvs() })

function largestWindow(built) {
  let best = null
  for (const o of (built && built.translation && built.translation.outputs) || []) {
    if (!o || !o.ast || o.kind === 'alertcondition') continue
    try {
      const n = maxLookback(o.ast)
      if (Number.isInteger(n) && (best === null || n > best)) best = n
    } catch { /* an unmeasurable reach is reported as null, never as 0 */ }
  }
  return best
}

function row(file, flagOn, runtimeOn = false) {
  vi.stubEnv(OBJECTS_ONLY_FLAG, flagOn ? '1' : '')
  if (runtimeOn) vi.stubEnv(RUNTIME_FLAG, '1')
  const bytes = fs.readFileSync(path.join(CORPUS, file))
  const source = bytes.toString('utf8')
  const base = {
    file: `corpus/committed/${file}`,
    slug: file.replace(/\.pine$/, '').split('__')[0],
    sha256: createHash('sha256').update(bytes).digest('hex'),
    bytes: bytes.length,
  }
  let door
  try {
    door = enterMemberDoor(source)
  } catch (err) {
    // ⛔ A THROW IS A RESULT, NOT A GAP — silently dropping it would shrink the
    // denominator and make the door look better than it is.
    registry.uninstallUserDefinition(HARNESS_DEF_ID)
    return { ...base, attached: false, stage: 'threw', refusal: String((err && err.message) || err).slice(0, 300) }
  }
  try {
    const outputs = ((door.built && door.built.translation && door.built.translation.outputs) || [])
      .filter((o) => o && o.kind !== 'alertcondition')
    return {
      ...base,
      attached: !!door.def,
      stage: door.stage,
      refusal: door.refusal,
      plots: door.def ? (door.built.rows || []).length : 0,
      outputs: outputs.length,
      drawsObjects: !!(door.def && door.def.objects && (door.def.objects.ops || []).length),
      largestWindow: door.def ? largestWindow(door.built) : null,
      // ⭐ RT1 — which lane drew it, and why the runtime lane declined (only
      // present when the runtime state is measured).
      ...(runtimeOn ? {
        lane: door.built && door.built.lane ? door.built.lane : (door.def ? 'host' : null),
        runtimeDeclined: (door.built && door.built.runtimeDeclined) || null,
        withheld: (door.built && door.built.withheld) || [],
      } : {}),
    }
  } finally {
    registry.uninstallUserDefinition(HARNESS_DEF_ID)
  }
}

describe.skipIf(!RUN)('member-door census for the vendor batch (opt-in)', () => {
  it('runs every committed corpus script through enterMemberDoor', () => {
    expect(OUT, 'VENDOR_BATCH_CENSUS_OUT must name the output file').toBeTruthy()
    expect(OBJECTS_ONLY_FLAG, 'the objects-only flag name could not be read off its gate').toMatch(/^VITE_/)
    // ⭐ WHAT THE GRADER WOULD SEE IN THIS PROCESS, read before any stub: the
    // gate's own answer off the ambient env. `batch_manifest.py` runs this census
    // with the env the grade step will use, and refuses a manifest whose ambient
    // state disagrees with the state it selected on.
    const ambientFlagOn = objectsOnlyPaneEnabled()
    const listed = fs.readdirSync(CORPUS).filter((f) => f.endsWith('.pine')).sort()
      .filter((f) => !ONLY || ONLY.has(`corpus/committed/${f}`))
    if (ONLY) expect(listed.length, 'every name in VENDOR_BATCH_CENSUS_ONLY is a committed corpus script').toBe(ONLY.size)
    else expect(listed.length).toBeGreaterThan(200) // non-vacuity: the corpus was found
    // ⭐ PARALLEL — a shard builds only the scripts it owns (stable hash of the id)
    const files = listed.filter((f) => inShard(`corpus/committed/${f}`, SHARD))
    const off = files.map((f) => row(f, false))
    const on = files.map((f) => row(f, true))
    vi.unstubAllEnvs()
    const runtime = WITH_RUNTIME ? files.map((f) => { const r = row(f, true, true); vi.unstubAllEnvs(); return r }) : null
    vi.unstubAllEnvs()
    // every script is accounted for, and every refusal carries its sentence
    expect(off.length).toBe(files.length)
    expect(on.length).toBe(files.length)
    for (const r of [...off, ...on, ...(runtime || [])]) if (!r.attached) expect(r.refusal, r.file).toBeTruthy()
    if (runtime) expect(RUNTIME_FLAG, 'the runtime flag name could not be read off its gate').toMatch(/^VITE_/)
    fs.mkdirSync(path.dirname(path.resolve(OUT)), { recursive: true })
    if (SHARD) {
      // the merge (`parallel_run.mjs`) writes the census document from every shard's rows
      fs.writeFileSync(OUT, JSON.stringify({
        kind: CENSUS_SHARD_KIND, shard: SHARD, flag: OBJECTS_ONLY_FLAG, runtimeFlag: RUNTIME_FLAG, ambientFlagOn,
        librariesLoaded: LIBRARIES_LOADED, allFiles: listed.map((f) => `corpus/committed/${f}`), off, on, runtime,
      }) + '\n')
      return
    }
    const doc = { flag: OBJECTS_ONLY_FLAG, ambientFlagOn, librariesLoaded: LIBRARIES_LOADED, files: files.length,
      off, on, runtime, runtimeFlag: RUNTIME_FLAG }
    fs.writeFileSync(OUT, censusDocument(doc))
    // eslint-disable-next-line no-console
    console.log(censusLine({ ...doc, files: files.length, out: OUT }))
  }, 900000)
})
