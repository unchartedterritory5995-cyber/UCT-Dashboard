// TRACK F — reproducible corpus parameter-count benchmark.
//
// `TRACK_F_V1_IMPLEMENTATION_COMPLETION_REPORT.md` reported "14/14 translating
// Pine scripts in the 21-script corpus gained at least one adjustable
// parameter, 29 total adjustable parameters added" as a one-time manual
// comparison, with no committed script or test reproducing it
// (`PROJECT_EVIDENCE_ASSUMPTION_AUDIT_01.md` §4). This file is that missing
// artifact: it runs the SAME 21-file corpus `pine.corpus.test.js` already
// pins through `translatePine(src, { paramManifest: true })` +
// `buildParamManifest`, and asserts the result rather than reporting it once
// by hand.
//
// ⛔ "29 total adjustable parameters" is ambiguous between two different
// countable things and the original report never says which: the count of
// DISTINCT parameter ids (`Object.keys(manifest).length`), or the count of
// AST LOCATOR occurrences those ids expand to across every kept output tree
// (`sum of manifest[id].locators.length` — one Pine input can feed multiple
// output trees and mint multiple locators for one id, per
// `pine.paramManifest.test.js`'s own "ONE id, TWO locators" case). Both are
// computed and asserted here, named separately, rather than picking one and
// calling it "the" number.
//
// ⛔ THIS DOES NOT RECOMPUTE "14/14" FROM SCRATCH AS A SEPARATE CLAIM — it
// reuses whichever scripts `pine.corpus.test.js` already proves translate
// (`out.ok`), so a future change to translation coverage moves both files
// together instead of drifting apart into two authorities over one fact.

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { translatePine } from './pine.js'
import { buildParamManifest } from '../../builder/pineParamManifest.js'

const DIR = path.resolve(process.cwd(), '../tests/fixtures/pine')
const FILES = fs.readdirSync(DIR).filter((f) => f.endsWith('.pine')).sort()
const read = (f) => fs.readFileSync(path.join(DIR, f), 'utf8')

function paramCountsFor(src) {
  const out = translatePine(src, { paramManifest: true })
  if (!out.ok) return null
  // Every kept output tree, not just the one the corpus gate happens to
  // pick as `selected` — a Pine input feeding a second plot still counts as
  // an adjustable parameter on this script, per pine.paramManifest.test.js's
  // own multi-tree case.
  const trees = out.outputs.map((o, i) => ({ treeIndex: i, ast: o.ast }))
  const manifest = buildParamManifest(out.inputParams, trees)
  const distinctParams = Object.keys(manifest).length
  const locatorOccurrences = Object.values(manifest)
    .reduce((sum, p) => sum + p.locators.length, 0)
  return { distinctParams, locatorOccurrences }
}

describe('Track F parameter-corpus count — reproducible, not a one-time manual tally', () => {
  const perScript = FILES.map((f) => ({ f, counts: paramCountsFor(read(f)) }))
  const translating = perScript.filter((r) => r.counts !== null)
  const withAtLeastOneParam = translating.filter((r) => r.counts.distinctParams >= 1)
  const totalDistinctParams = translating.reduce((s, r) => s + r.counts.distinctParams, 0)
  const totalLocatorOccurrences = translating.reduce((s, r) => s + r.counts.locatorOccurrences, 0)

  it('the corpus is still the same 21 files pine.corpus.test.js pins', () => {
    expect(FILES.length).toBe(21)
  })

  it('reproduces the current, real translating-scripts-with-a-parameter count', () => {
    // ⭐ Pinned to what this run ACTUALLY measured, not to the old "14/14"
    // report — if this number ever needs to change, change it here with a
    // fresh reproduction, never to silently restore a prior claim.
    expect(translating.length, 'scripts that translate at all').toBe(14)
    expect(withAtLeastOneParam.length, 'of those, scripts with >=1 adjustable parameter').toBe(14)
  })

  it('reproduces the "29 total adjustable parameters" claim under the distinct-id counting', () => {
    // ⭐ REPRODUCED EXACTLY: the original "29" claim was correct all along
    // under this counting (distinct parameter ids) -- it was unverifiable,
    // not wrong. This is the number that should be quoted as "29".
    expect(totalDistinctParams, 'sum of distinct parameter ids across all 14 scripts').toBe(29)
  })

  it('pins the OTHER candidate counting as a separate, much larger, non-"29" metric', () => {
    // ⛔ DO NOT read this as a second form of "29" -- it measures something
    // different (how many AST locations a parameter expands to, not how many
    // distinct parameters exist) and one script alone
    // (20-smc-toolkit-udt.pine) contributes 380 of these from a single
    // parameter feeding many places in the script. Pinned so a future
    // translator change that silently multiplies locators is still caught,
    // without ever being confused for "the 29 claim".
    expect(totalLocatorOccurrences, 'sum of AST locator occurrences across all 14 scripts').toBe(1204)
  })

  it('prints the per-script breakdown for anyone auditing this claim by hand', () => {
    // Not an assertion — a deliberate, always-visible receipt. Run with
    // `--reporter=verbose` or read the failure output above to see it even
    // when everything passes, since `console.log` in a passing vitest run is
    // otherwise easy to miss.
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({
      translating: translating.length,
      withAtLeastOneParam: withAtLeastOneParam.length,
      totalDistinctParams,
      totalLocatorOccurrences,
      perScript: perScript.map((r) => ({
        file: r.f,
        translates: r.counts !== null,
        distinctParams: r.counts?.distinctParams ?? null,
        locatorOccurrences: r.counts?.locatorOccurrences ?? null,
      })),
    }, null, 2))
    expect(true).toBe(true)
  })
})
