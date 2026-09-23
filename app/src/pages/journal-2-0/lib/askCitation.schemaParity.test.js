import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getSchema } from '@tiptap/core'
import { buildExtensions } from './tiptap'
import { citationLeafText, citationText } from './askCitation'

// ─────────────────────────────────────────────────────────────────────────
// THE CITATION TEXT'S NODE TABLES, PINNED TO THE SCHEMA THE EDITOR RUNS.
//
// Citation text is described three times: the editor's real schema, the hand
// copy in tools/gen_pm_citation_fixtures.cjs that produces the ground truth,
// and the Python walker's node-type tables in
// api/services/journal_two/note_citation_text.py. The hand copy was wrong
// once — it declared attachmentChip INLINE while the app declares it a BLOCK
// atom, and no case used it, so nothing noticed. This rail re-reads every
// fixture under the app's REAL schema (getSchema(buildExtensions())) and
// requires the same size and text, and checks the Python tables against the
// real schema, so neither copy can drift from the editor again.
// ─────────────────────────────────────────────────────────────────────────

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '../../../../..')
const PY_SRC = fs.readFileSync(
  path.join(REPO, 'api/services/journal_two/note_citation_text.py'), 'utf8')
const FIXTURES = JSON.parse(fs.readFileSync(
  path.join(REPO, 'tests/fixtures_pm_citation_text.json'), 'utf8'))

const schema = getSchema(buildExtensions())

/** A frozenset({...}) / dict {...} literal's string names, read from the Python source. */
function pyNames(name) {
  const m = PY_SRC.match(new RegExp(`^${name}\\s*=\\s*(?:frozenset\\()?\\{([\\s\\S]*?)\\}\\)?\\s*$`, 'm'))
  if (!m) return null
  // A dict's KEYS (a key opens its line); a set's every quoted name.
  const re = name === '_ATOM_TEXT' ? /^\s*"([A-Za-z]+)"\s*:/gm : /"([A-Za-z]+)"/g
  return new Set([...m[1].matchAll(re)].map((x) => x[1]))
}

const real = Object.values(schema.nodes).filter((t) => t.name !== 'text')
const sorted = (s) => [...s].sort()

describe('the Python walker describes the SAME schema the editor runs', () => {
  it('reads the tables (non-vacuity: a regex that matched nothing would pass every set test)', () => {
    for (const n of ['_LEAF_TYPES', '_INLINE_LEAF_TYPES', '_TEXTBLOCK_TYPES', '_ATOM_TEXT']) {
      expect(pyNames(n), n).not.toBeNull()
      expect(pyNames(n).size, n).toBeGreaterThan(0)
    }
    expect(pyNames('_LEAF_TYPES')).toContain('attachmentChip')
    expect(pyNames('_ATOM_TEXT')).toContain('attachmentChip')
    expect(real.length).toBeGreaterThan(20)
  })

  it('every leaf in the app schema is a leaf to the Python walker, and nothing else is', () => {
    // A leaf the walker does not know is walked as a CONTAINER: two positions
    // instead of one, shifting every later citation (the askCitation incident).
    expect(sorted(pyNames('_LEAF_TYPES'))).toEqual(sorted(real.filter((t) => t.isLeaf).map((t) => t.name)))
  })

  it('the inline leaves match (an inline leaf never emits a separator)', () => {
    expect(sorted(pyNames('_INLINE_LEAF_TYPES')))
      .toEqual(sorted(real.filter((t) => t.isLeaf && t.isInline).map((t) => t.name)))
  })

  it('the textblocks match (an EMPTY one still emits a separator)', () => {
    expect(sorted(pyNames('_TEXTBLOCK_TYPES'))).toEqual(sorted(real.filter((t) => t.isTextblock).map((t) => t.name)))
  })

  it('the leaves that read as text are exactly the Python placeholders, and all are BLOCK atoms', () => {
    const reading = real.filter((t) => t.isLeaf && citationLeafText(t.create()) !== '').map((t) => t.name)
    expect(sorted(pyNames('_ATOM_TEXT'))).toEqual(sorted(reading))
    for (const n of reading) expect(schema.nodes[n].isBlock, n).toBe(true)
  })
})

describe('every fixture reads the same under the app schema as under the generator schema', () => {
  const names = Object.keys(FIXTURES)
  it('non-vacuity', () => { expect(names.length).toBeGreaterThanOrEqual(30) })
  it.each(names)('%s', (name) => {
    const doc = schema.nodeFromJSON(FIXTURES[name].json)
    doc.check()
    expect(doc.content.size).toBe(FIXTURES[name].contentSize)
    expect(citationText(doc, 0, doc.content.size)).toBe(FIXTURES[name].text)
  })
})
