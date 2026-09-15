// app/src/components/chart/engine/ast/contractVersions.test.js
//
// ─── ⭐⭐ a7.1 / R12 — ONE VERSION FIELD ACROSS THE JS↔PYTHON CONTRACT ──────
//
// ⚠️⚠️ THE CONTRACT IS FOUR FILES, NOT THE DOZEN AN EARLIER SCOPING CLAIMED.
// a7's own scoping note said the contract was "committed ast/*.json +
// lookback_agreement.json". Measured at a7.1, most of those names —
// `bind_fold_parity.json`, `clock_parity.json`, `conformance_log.json`,
// `multi_tree_parity.json`, `scalars.json`, `must_repaint.json` — **do not exist in
// the repo at all**. They are generated into temp directories at test time and
// consumed inside the same run. A transient file is not a contract: nothing can drift
// against it, because nothing outlives the run that made it.
//
// ⭐ THE REAL CONTRACT, measured by full-path reads from `tests/*.py` and `tools/*.py`:
//
//   app/src/components/chart/engine/ast/closedTable.json   hand-authored manifest
//                                                          -> 4 tests + 2 tools
//   tools/lookback_agreement.json                          WRITTEN BY JS
//                                                          -> test_ast_lookback_agreement.py,
//                                                             vendor_window.py
//   tools/chart_parity_cases.json                          -> 5 tools
//   tools/wave_p_ocr_reference_5_4_0.json                  another programme's
//
// ⛔ AND NO PYTHON READER READS ANY VERSION FIELD TODAY — zero programmatic reads
// across the 23 rails; `tableVersion` appears only in prose. So the field is written
// BEFORE it is read, which is the only safe order, and no existing spelling is removed
// until a reader is measured reading the new one (R12, additive).
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const REPO = path.resolve(__dirname, '../../../../../..')

/** The JS-WRITTEN contract artifacts, and the version each must carry.
 *
 *  ⛔ Only files the JS writes appear here. `closedTable.json` is a hand-authored
 *  manifest — it carries `tableVersion` and is edited by people, so a rail demanding
 *  the JS keep it current would be asserting against the wrong author. */
const JS_WRITTEN = [
  { file: 'tools/lookback_agreement.json', version: 1 },
]

/** Every spelling currently in the contract, so a new one cannot appear unnoticed. */
const KNOWN_SPELLINGS = ['version', 'tableVersion']

describe('a7.1 / R12 — the contract carries one version field, and its VALUE is known', () => {
  for (const { file, version } of JS_WRITTEN) {
    it(`⭐⭐ ${file} carries version ${version}`, () => {
      // ⛔ THE VALUE, NOT THE PRESENCE. "has a version field" is the adjacent property
      // — a file could carry `version: undefined`, or a version no reader knows, and
      // pass a presence check while telling a reader nothing it can act on. The class
      // has four instances on record; this rail does not add a fifth.
      const raw = fs.readFileSync(path.join(REPO, file), 'utf8')
      const d = JSON.parse(raw)
      expect(Object.hasOwn(d, 'version'), `${file} has no version field`).toBe(true)
      expect(d.version, `${file}'s version is not the one this rail knows`).toBe(version)
    })

    it(`⛔ ${file} is written by JS, so the WRITER carries the field`, () => {
      // A hand-edit into the artifact would vanish on the next run of the writer, so
      // the field has to come from the writer's payload. Asserted against the source
      // rather than against the artifact, which is the half a regeneration can undo.
      const writer = fs.readFileSync(path.join(
        REPO, 'app/src/components/chart/engine/ast/lookbackAgreement.test.js'), 'utf8')
      expect(writer).toMatch(/version:\s*1,/)
    })
  }

  it('⛔⛔ CONTROL — no UNKNOWN version spelling has appeared in the contract', () => {
    // The drift this catches is a fifth spelling joining the four measured ones. It
    // reads the committed files rather than a typed list, so a file added next week is
    // covered the day it lands.
    const files = [
      'app/src/components/chart/engine/ast/closedTable.json',
      'app/src/components/chart/engine/ast/conceptVocabulary.json',
      'app/src/components/chart/engine/ast/starterScans.json',
      'app/src/components/chart/engine/ast/symbolScope.json',
      'tools/lookback_agreement.json',
    ]
    const found = new Set()
    for (const f of files) {
      const p = path.join(REPO, f)
      if (!fs.existsSync(p)) continue
      const d = JSON.parse(fs.readFileSync(p, 'utf8'))
      for (const k of Object.keys(d)) if (/version/i.test(k)) found.add(k)
    }
    // ⭐ The control has to be able to SEE a spelling, or "none unknown" is vacuous.
    expect(found.size, 'the sweep found no version field at all — it is not looking')
      .toBeGreaterThan(0)
    expect([...found].filter((k) => !KNOWN_SPELLINGS.includes(k)),
      'a version spelling appeared that CONTRACT.md does not document').toEqual([])
  })

  it('⛔ CONTROL — the transient names are still NOT committed files', () => {
    // If one of these ever becomes committed it joins the contract and needs a version
    // and a CONTRACT.md row. Until then, asserting their absence keeps the scoping
    // note honest — an earlier one claimed they were the contract.
    for (const name of ['bind_fold_parity.json', 'clock_parity.json',
      'conformance_log.json', 'multi_tree_parity.json', 'scalars.json']) {
      const here = path.join(REPO, 'app/src/components/chart/engine/ast', name)
      const there = path.join(REPO, 'tools', name)
      expect(fs.existsSync(here) || fs.existsSync(there),
        `${name} is committed now — add it to CONTRACT.md and give it a version`)
        .toBe(false)
    }
  })
})
