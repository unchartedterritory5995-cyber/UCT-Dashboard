/**
 * ⛔⛔ WHILE Q1-F5 IS OPEN, THE APPEND CALL SITES ARE FROZEN.
 *
 * Four of the seven door families are proved in a live browser on production.
 * The three APPEND families are not: `append_widget_embed`,
 * `append_financial_fact` and `append_document_excerpt` are proved at unit level
 * and in the editor's own conflict rails, but no driver has yet opened them on
 * the real site during a queued save.
 *
 * ⭐ SO THE RULE IS NARROW AND MECHANICAL: until F5's table is green, a branch
 * may not change the client call sites of those three doors, nor the drain's
 * classification, nor the settle. Everything else in these files is open —
 * R-4a's paste/drop handlers and Q2-A's cached-read render both live in
 * `NoteEditorPage.jsx` alongside the excerpt door, and they are welcome there.
 *
 * ⛔ WHY A FREEZE RATHER THAN CARE. "R-1a extends Send-to-Journal; building on a
 * door whose append-only merge isn't proven live is building on sand." The same
 * argument applies to *editing* the door: if the append-only classification is
 * ever found wrong on production, the investigation has to start from the code
 * that was measured, not from code that moved underneath it.
 *
 * ⛔ THIS RAIL EXPIRES BY CONSTRUCTION. `F5_OPEN` flips to false the day the
 * seven-family × six-ordering table has zero INCONCLUSIVE rows, and this file
 * then asserts only that the frozen set is still correctly enumerated — an
 * arming condition that names a state, not a date
 * (`lesson_an_arming_condition_that_names_a_test_expires`).
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

/** ⛔ Flip to false only when F5's table has zero INCONCLUSIVE rows. */
const F5_OPEN = true

const REPO = join(__dirname, '..', '..', '..', '..', '..', '..')
const rel = (p) => relative(REPO, p).split(sep).join('/')
const read = (p) => readFileSync(join(REPO, p), 'utf8')

/**
 * The frozen set, as (file, the exact line that opens the door).
 *
 * ⛔ THE LINE, NOT THE FILE. Freezing whole files would stop R-4a and Q2-A,
 * which have legitimate work in `NoteEditorPage.jsx` more than a hundred lines
 * from the excerpt door. The unit of the freeze is the CALL, matched by its own
 * text so a moved line is still found.
 */
const FROZEN_CALLS = [
  ['append_document_excerpt', 'app/src/pages/journal-2-0/components/notebook/NoteEditorPage.jsx',
    '`/api/j2/notes/${noteId}/excerpts`'],
  ['append_financial_fact', 'app/src/pages/journal-2-0/lib/captureFinancialFact.js',
    '`/api/j2/notes/${noteId}/facts/${fact.id}/insert`'],
  ['append_widget_embed', 'app/src/pages/journal-2-0/lib/captureTargets.js',
    '`/api/j2/notes/${noteId}/embeds`'],
  ['append_widget_embed', 'app/src/pages/journal-2-0/components/AddPositionModal.jsx',
    '`/api/j2/notes/${noteId}/embeds`'],
  ['append_widget_embed', 'app/src/pages/journal-2-0/lib/importer/enrichment.js',
    '`/api/j2/notes/${noteId}/embeds`'],
]

/** The decision code the production measurement will be read against. */
const FROZEN_FILES = [
  'app/src/pages/journal-2-0/lib/offline/serverChange.js',
  'app/src/pages/journal-2-0/lib/offline/settleNoteWrite.js',
]

describe('⛔⛔ Q1-F5 FREEZE — the append doors do not move until they are proved live', () => {
  it('every frozen call site is still exactly where the freeze says it is', () => {
    // ⭐ NON-VACUITY FIRST. A freeze over a set that no longer matches anything
    // is a freeze over nothing, and it would read as protection.
    const missing = []
    for (const [family, file, call] of FROZEN_CALLS) {
      if (!read(file).includes(call)) missing.push(`${family} — ${file} no longer contains ${call}`)
    }
    expect(missing, '⛔ a frozen call site moved or changed shape — re-derive the freeze before merging').toEqual([])
  })

  it('every frozen call site still LANDS its revision', () => {
    // The freeze is about not disturbing proven code; this is the property that
    // code exists for, asserted here too so the freeze cannot be satisfied by a
    // call site that survives in name while losing its settle.
    const unsettled = []
    for (const [family, file, call] of FROZEN_CALLS) {
      const src = read(file)
      const at = src.indexOf(call)
      const window = src.slice(at, at + 4000).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ')
      if (!/settleNoteWrite\s*\(/.test(window)) unsettled.push(`${family} — ${file}`)
    }
    expect(unsettled, '⛔ a frozen append door lost its settle').toEqual([])
  })

  it('the classification and the settle are named, and they exist', () => {
    for (const f of FROZEN_FILES) {
      expect(read(f).length, `${f} is frozen and must exist`).toBeGreaterThan(0)
    }
    // The three shapes are the thing production has not yet confirmed for the
    // append families, so their names are pinned here too.
    const sc = read('app/src/pages/journal-2-0/lib/offline/serverChange.js')
    for (const shape of ['metadata-only', 'append-only', 'body-rewrite']) {
      expect(sc, `the ${shape} shape is part of what F5 must prove`).toContain(shape)
    }
  })

  it('⭐ the freeze declares WHEN it lifts, and it has not lifted', () => {
    // ⛔ An arming condition that names a DATE expires quietly. This one names a
    // STATE: zero INCONCLUSIVE rows in the seven-family × six-ordering table.
    expect(F5_OPEN, 'F5_OPEN is false — then this file should assert the enumeration only').toBe(true)
  })

  it('⭐ CONTROL — the matcher can tell a settled door from an unsettled one', () => {
    const settled = 'const r = await fetch(`/x/embeds`, {method:"POST"})\nawait settleNoteWrite(id, r)'
    const bare = 'const r = await fetch(`/x/embeds`, {method:"POST"})\nreturn true'
    const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ')
    expect(/settleNoteWrite\s*\(/.test(strip(settled))).toBe(true)
    expect(/settleNoteWrite\s*\(/.test(strip(bare))).toBe(false)
    // …and a COMMENT about the settle must not count as one.
    expect(/settleNoteWrite\s*\(/.test(strip('// settleNoteWrite(id, r) goes here'))).toBe(false)
  })
})
