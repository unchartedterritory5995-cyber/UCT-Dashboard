// app/src/components/chart/engine/ast/manifestFormatting.test.js
//
// ─── ⛔⛔ A MANIFEST IS EDITED AS TEXT, NEVER RE-SERIALISED ──────────────────
//
// ⚰️ MEASURED 2026-09-14. A script added ONE entry to `closedTable.json` by
// `json.loads` → mutate → `json.dumps(indent=1)` and produced **3,272 insertions
// and 3,265 deletions** for an eight-line addition. Every line of a 3,277-line
// manifest moved. Nothing was lost — but the diff was unreviewable, `git blame`
// would have attributed the whole file to that commit, and the next concurrent
// edit would have been a whole-file conflict. It also turned `manifestProse`
// red, which is the only reason it was caught at all.
//
// ⭐ THE RULE: add or change a manifest entry by INSERTING TEXT at the right
// place, preserving the file's own formatting. Never round-trip the document
// through a serialiser to change part of it.
//
// ⭐⭐ AND THIS IS THE RAIL THAT MAKES THE RULE MECHANICAL. Every manifest under
// `ast/` is, today, exactly `JSON.stringify(obj, null, 2)` once blank lines are
// ignored — blank lines being the one hand-made thing the files carry, as visual
// separators between sections. So a re-serialisation with ANY other indent, or
// with ASCII escaping, or with reordered keys, fails here immediately instead of
// arriving as a 3,000-line diff nobody can review.
//
// ⚠️ IT IS NOT A STYLE TEST. It exists because the failure it catches is
// invisible in review: the content is correct, the JSON parses, every other rail
// passes, and the damage is entirely in the artifact's reviewability.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const DIR = __dirname
const MANIFESTS = fs.readdirSync(DIR).filter((f) => f.endsWith('.json')).sort()

/** The file's own shape, with the hand-made blank separators taken out. */
const noBlanks = (s) => s.replace(/\r\n/g, '\n').split('\n')
  .filter((l) => l.trim() !== '').join('\n')

describe('every ast manifest keeps its own formatting', () => {
  it('⛔ the set under test is derived from the directory, never typed', () => {
    // A hand-typed list is the artifact that goes stale first — a manifest added
    // next week would otherwise be silently unguarded.
    expect(MANIFESTS.length).toBeGreaterThanOrEqual(4)
    expect(MANIFESTS).toContain('closedTable.json')
  })

  for (const name of MANIFESTS) {
    it(`⭐ ${name} is byte-identical to a 2-space render of itself`, () => {
      const raw = fs.readFileSync(path.join(DIR, name), 'utf8')
      const obj = JSON.parse(raw)
      const canonical = JSON.stringify(obj, null, 2)
      expect(noBlanks(raw)).toBe(noBlanks(canonical))
    })
  }

  it('⛔⛔ CONTROL — the check SEES a re-serialisation, so it cannot pass blind', () => {
    // The exact defect, reproduced: the same content at a different indent.
    const raw = fs.readFileSync(path.join(DIR, 'closedTable.json'), 'utf8')
    const obj = JSON.parse(raw)
    const reserialised = JSON.stringify(obj, null, 1)
    expect(noBlanks(reserialised)).not.toBe(noBlanks(raw))

    // …and so does ASCII escaping, which would replace every ⛔ with ⛔.
    const escaped = JSON.stringify(obj, null, 2)
      .replace(/[-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`)
    expect(noBlanks(escaped)).not.toBe(noBlanks(raw))
  })

  it('⚠️ the blank lines it forgives are FEW, and that is what keeps it honest', () => {
    // If a file ever carried many blank lines, "ignore blank lines" would start
    // forgiving real structure. Measured 2026-09-14: closedTable 2, the rest 1.
    for (const name of MANIFESTS) {
      const raw = fs.readFileSync(path.join(DIR, name), 'utf8')
      const blanks = raw.replace(/\r\n/g, '\n').split('\n').filter((l) => l.trim() === '').length
      expect(blanks, `${name} carries ${blanks} blank lines`).toBeLessThanOrEqual(4)
    }
  })
})
