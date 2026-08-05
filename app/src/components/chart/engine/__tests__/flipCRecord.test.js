// app/src/components/chart/engine/__tests__/flipCRecord.test.js
//
// ─── THE FLIP-C DECISION RECORD, READ BY A TEST ─────────────────────────────
//
// B5 Task 11 measures the cutover and puts it to the owner. Its deliverable is a
// DOCUMENT, and a document is the one artefact on this branch that nothing has
// ever checked — which is how the MACD record came to name two of the three test
// blocks its own flip would turn red (`docs/decisions/2026-08-02-macd-head-mask.md`
// §6: "a decision record that names the tests it will break must name ALL of
// them").
//
// So the record is held to the same rule as the code: it must carry a number for
// every live parity case, both build identities for every number, and no `TBD`.
// The non-vacuity assertions matter more than the assertions:
//
//   * `liveCaseNames()` really returned the whole list — a helper that returns
//     `[]` makes every `toMatch` below vacuous and the count is what stops it;
//   * the count is read from `chart_parity_cases.json`, so ADDING a case makes
//     this file go red until the record prices it, which is the point.
//
// ⛔ IT DOES NOT ASSERT THE NUMBERS. Task 11 is a measurement, and a test that
// pinned the pixel counts would have to be edited by the same hand that changed
// them. What it asserts is that the record cannot be SILENT: every case named,
// every build identity present, no placeholder left behind.

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

/** The repo root, found by walking up from wherever vitest was invoked — the
 *  same helper `enumerationSites.test.js` uses, and for the same reason
 *  (`import.meta.url` is an http: URL under this environment's vite transform). */
const ROOT = (() => {
  let dir = process.cwd()
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(dir, 'app', 'src', 'components', 'StockChart.jsx'))) return dir
    const up = path.dirname(dir)
    if (up === dir) break
    dir = up
  }
  throw new Error(`Flip-C record: could not find the repo root from ${process.cwd()}`)
})()

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

const RECORD = 'docs/decisions/2026-08-04-flip-c-pane-geometry.md'
const CASES = 'tools/chart_parity_cases.json'

/** Every case the parity gate actually RUNS — placeholders excluded, exactly as
 *  `chart_parity.load_cases` excludes them. Read from the case file so the list
 *  cannot drift from the gate's. */
function liveCaseNames() {
  const doc = JSON.parse(read(CASES))
  return doc.cases.filter((c) => !c.status || c.status !== 'placeholder').map((c) => c.name)
}

describe('the Flip-C decision record', () => {
  it('names a number for every live parity case, or says why not', () => {
    const rec = read(RECORD)
    const missing = liveCaseNames().filter((n) => !new RegExp(`\\b${n}\\b`).test(rec))
    expect(missing, 'cases the record never mentions').toEqual([])
  })

  it('leaves no TBD behind', () => {
    // A record with a TBD in it is a record that was written before the
    // measurement finished, and it reads exactly like one that was not.
    expect(read(RECORD)).not.toMatch(/\bTBD\b/)
  })

  it('names BOTH build identities for every number it quotes', () => {
    // Every parity number on this branch names the two builds it came from.
    // A 12-hex-digit build id is the harness's own identity format
    // (`read_build_identity`), and a record quoting fewer than two of them is
    // quoting a number nobody can reproduce.
    const rec = read(RECORD)
    const ids = new Set((rec.match(/\b[0-9a-f]{12}\b/g) || []))
    expect(ids.size, `build identities named in the record: ${[...ids].join(', ')}`)
      .toBeGreaterThanOrEqual(2)
  })

  it('is still OPEN, and says so in its Status line', () => {
    // ⛔ Task 11 measures and prices; it does not apply. A record that has
    // resolved itself is a decision nobody took.
    expect(read(RECORD)).toMatch(/\*\*Status:\*\*[^\n]*OPEN/)
  })

  it('prices the three sub-choices SEPARATELY', () => {
    // "Looks great" is not an answer to three questions — the record's own §2.
    // Each row must carry a pixel number of its own, not a shared verdict.
    const rec = read(RECORD)
    for (const heading of ['2.1', '2.2', '2.3']) {
      expect(rec, `sub-choice ${heading} is not priced`).toMatch(
        new RegExp(`${heading.replace('.', '\\.')}[\\s\\S]{0,4000}?\\d[\\d,]{2,}\\s*(px|changed)`, 'i'),
      )
    }
  })

  // ── NON-VACUITY ────────────────────────────────────────────────────────────
  it('read the whole live case list, so the assertions above are not vacuous', () => {
    const live = liveCaseNames()
    expect(live).toHaveLength(46)
    // And the placeholder really is excluded — otherwise "live" means "all" and
    // the filter above is decoration.
    expect(JSON.parse(read(CASES)).cases).toHaveLength(47)
  })
})
