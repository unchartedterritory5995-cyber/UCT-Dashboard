import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getSchema } from '@tiptap/core'
import { buildExtensions } from './tiptap'
import { citationAtomIdentity, citationLeafText, citationText } from './askCitation'

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

/**
 * A frozenset({...}) / dict {...} literal's string names, read from Python
 * source. `#` comments are stripped FIRST, so a commented-out entry is absent
 * here exactly as it is absent at runtime (review-parity M2: without the strip,
 * a commented-out `_LEAF_TYPES` line still read as present). No table value
 * contains a `#`, so stripping to end of line is exact for what this reads.
 */
function pyNamesFrom(src, name) {
  const code = src.replace(/#[^\n]*/g, '')
  const m = code.match(new RegExp(`^${name}\\s*=\\s*(?:frozenset\\()?\\{([\\s\\S]*?)\\}\\)?\\s*$`, 'm'))
  if (!m) return null
  // A dict's KEYS (a key opens its line); a set's every quoted name.
  const re = DICTS.has(name) ? /^\s*"([A-Za-z]+)"\s*:/gm : /"([A-Za-z]+)"/g
  return new Set([...m[1].matchAll(re)].map((x) => x[1]))
}
const DICTS = new Set(['_ATOM_TEXT', '_ATOM_IDENTITY'])
const pyNames = (name) => pyNamesFrom(PY_SRC, name)
const TABLES = ['_LEAF_TYPES', '_INLINE_LEAF_TYPES', '_TEXTBLOCK_TYPES', '_BLOCK_CONTAINER_TYPES', '_ATOM_TEXT',
  '_ATOM_IDENTITY']

const real = Object.values(schema.nodes).filter((t) => t.name !== 'text')
const sorted = (s) => [...s].sort()

describe('the Python walker describes the SAME schema the editor runs', () => {
  it('reads the tables (non-vacuity: a regex that matched nothing would pass every set test)', () => {
    for (const n of TABLES) {
      expect(pyNames(n), n).not.toBeNull()
      expect(pyNames(n).size, n).toBeGreaterThan(0)
    }
    expect(pyNames('_LEAF_TYPES')).toContain('attachmentChip')
    expect(pyNames('_ATOM_TEXT')).toContain('attachmentChip')
    expect(real.length).toBeGreaterThan(20)
  })

  it('a commented-out entry is NOT read as present (the parser sees what Python runs)', () => {
    const commented = PY_SRC.replace(/^(\s*)"askCitation",/m, '$1# "askCitation",')
    expect(commented).not.toBe(PY_SRC) // the mutation applied
    expect(pyNamesFrom(PY_SRC, '_LEAF_TYPES')).toContain('askCitation')
    expect(pyNamesFrom(commented, '_LEAF_TYPES')).not.toContain('askCitation')
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

  it('every other type with content is a known BLOCK container, never inferred (M1)', () => {
    // The walker infers "textblock" from content only for an UNKNOWN type, so
    // every real non-leaf non-textblock type must be named here. And each must
    // be a block: an INLINE container would be walked as a block, so one
    // appearing fails by name rather than being silently misread.
    const containers = real.filter((t) => !t.isLeaf && !t.isTextblock)
    expect(sorted(pyNames('_BLOCK_CONTAINER_TYPES'))).toEqual(sorted(containers.map((t) => t.name)))
    for (const t of containers) expect(t.isBlock, `${t.name} is an inline container`).toBe(true)
  })

  it('the leaves that read as text are exactly the Python placeholders; each is a BLOCK atom or an inline leaf Python knows', () => {
    // A leaf whose text IS an attribute (Wave 5: a formula reads as its LaTeX)
    // reads as nothing at its defaults, so it is sampled with that attribute
    // set. Every other leaf is read at its defaults, as before. The empty case
    // is pinned on both sides by the `mathEmpty` fixture.
    const SAMPLE_ATTRS = { inlineMath: { latex: 'x^2' }, blockMath: { latex: 'x^2' } }
    for (const n of Object.keys(SAMPLE_ATTRS)) expect(schema.nodes[n], `${n} is in the app schema`).toBeTruthy()
    const reading = real.filter((t) => t.isLeaf && citationLeafText(t.create(SAMPLE_ATTRS[t.name])) !== '')
      .map((t) => t.name)
    expect(sorted(pyNames('_ATOM_TEXT'))).toEqual(sorted(reading))
    // A BLOCK leaf that reads as text is its own line; an INLINE one (hardBreak
    // reads as one space, Wave 4) must emit NO separator, which the walker
    // knows only through _INLINE_LEAF_TYPES.
    const inline = reading.filter((n) => schema.nodes[n].isInline)
    expect(inline).toContain('hardBreak') // non-vacuity: the inline branch is exercised
    for (const n of inline) expect(pyNames('_INLINE_LEAF_TYPES'), n).toContain(n)
    for (const n of reading.filter((m) => !inline.includes(m))) expect(schema.nodes[n].isBlock, n).toBe(true)
  })

  it('hardBreak reads as ONE space under the app schema, and is one position', () => {
    const br = schema.nodes.hardBreak.create()
    expect(citationLeafText(br)).toBe(' ')
    expect(br.nodeSize).toBe(1)
  })

  it('every atom identity kind reads as text, and every one is pinned by the ground truth (fix round 2)', () => {
    // An identity on an atom that reads no text is never issued (no span); an
    // identity kind no fixture carries is compared across runtimes by nothing.
    const kinds = pyNames('_ATOM_IDENTITY')
    for (const n of kinds) expect(pyNames('_ATOM_TEXT'), n).toContain(n)
    const pinned = new Set(Object.values(FIXTURES).flatMap((f) => f.leafSpans.map((s) => s.atom?.type).filter(Boolean)))
    expect(sorted(pinned)).toEqual(sorted(kinds))
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
    // The identity attrs survive the app's own schema (an undeclared attr is
    // dropped or refused on load, and every atom citation would degrade).
    for (const s of FIXTURES[name].leafSpans) {
      expect(citationAtomIdentity(doc.nodeAt(s.pm_start)), `${name}@${s.pm_start}`).toBe(s.atom?.id ?? null)
    }
  })
})
