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

// ⭐ L1 — opt-in: `PINE_LIBRARY_STORE=<scratch dir>` measures WITH the imported libraries
// (never committed). Unset, the registry is empty, as in every production process.
const LIBRARIES_LOADED = loadPineLibraryStoreFromEnv()
const RUN = process.env.VENDOR_BATCH_CENSUS === '1'
const OUT = process.env.VENDOR_BATCH_CENSUS_OUT
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

function row(file, flagOn) {
  vi.stubEnv(OBJECTS_ONLY_FLAG, flagOn ? '1' : '')
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
    const files = fs.readdirSync(CORPUS).filter((f) => f.endsWith('.pine')).sort()
    expect(files.length).toBeGreaterThan(200) // non-vacuity: the corpus was found
    const off = files.map((f) => row(f, false))
    const on = files.map((f) => row(f, true))
    vi.unstubAllEnvs()
    // every script is accounted for, and every refusal carries its sentence
    expect(off.length).toBe(files.length)
    expect(on.length).toBe(files.length)
    for (const r of [...off, ...on]) if (!r.attached) expect(r.refusal, r.file).toBeTruthy()
    const states = { off, on }
    fs.mkdirSync(path.dirname(path.resolve(OUT)), { recursive: true })
    fs.writeFileSync(OUT, JSON.stringify({
      generatedBy: 'app/src/components/chart/engine/__tests__/vendorHarness/memberDoorCensus.measure.test.js',
      door: 'enterMemberDoor (ourSide.js): memberPaneDefinition -> installUserDefinitions',
      corpus: 'corpus/committed',
      flag: OBJECTS_ONLY_FLAG,
      ambientFlagOn,
      librariesLoaded: LIBRARIES_LOADED,
      files: files.length,
      attached: { off: off.filter((r) => r.attached).length, on: on.filter((r) => r.attached).length },
      states,
    }, null, 1) + '\n')
    // eslint-disable-next-line no-console
    console.log(`member-door census: ${OBJECTS_ONLY_FLAG} off ${off.filter((r) => r.attached).length}/${files.length}, `
      + `on ${on.filter((r) => r.attached).length}/${files.length} attach -> ${OUT}`)
  }, 900000)
})
