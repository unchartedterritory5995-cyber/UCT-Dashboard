// Wave 9 lane 9D (D1) — "Export selected" as JSON, fed back into OUR OWN importer.
//
// 8C's round-trip rail shape (lib/importer/exportFormats.roundtrip.test.js, ruling D-C3),
// applied to the SELECTION: the REAL builder the bulk bar's route calls
// (tools/selection_export_bridge.py -> notes_export.build_selection_export_to_tempfile,
// with the `fmt` the route passes) writes the archive, and the REAL importer
// (detectAdapter -> the uct adapter) reads it back. Neither half is a hand-typed stand-in.
//
// What a JSON selection must keep: each selected note's body VERBATIM (deep-equal), its
// title and folder path, a link between two selected notes re-pointed at the note that
// came in with it — and nothing it was not asked for. A trashed or missing id is skipped
// and listed in EXPORT_ISSUES.txt exactly as for Markdown, and that file is never read as
// a note.
import { describe, it, expect, beforeAll } from 'vitest'
import { detectAdapter } from './importer/registry'
import { uctAdapter } from './importer/adapters/uct'
import { exportSelection, pythonAvailable } from './testing/exportBridge'

const PY = pythonAvailable()
if (!PY) {
  // ⛔ A silent skip deletes the only cross-runtime proof while the suite reads green.
  console.warn('\n⛔ JSON selection round trip NOT VERIFIED in this run: `python` is not on PATH, so the '
    + 'archive was never built. Whether a JSON "Export selected" re-imports losslessly is UNPROVEN here.\n')
}

const t = (text, ...marks) => ({ type: 'text', text, ...(marks.length ? { marks } : {}) })
const p = (...inline) => ({ type: 'paragraph', content: inline.map((i) => (typeof i === 'string' ? t(i) : i)) })
const doc = (...content) => ({ type: 'doc', content })

/** Blocks and marks a Markdown export flattens or rewrites; JSON must keep every one. */
const A_DOC = doc(
  { type: 'heading', attrs: { level: 2 }, content: [t('The setup')] },
  p('Watch ', t('the gap', { type: 'bold' }), ' and ', t('the fill', { type: 'highlight', attrs: { color: null } }), '.'),
  p('Linked: ', { type: 'noteLink', attrs: { noteId: 'b' } }),
  { type: 'callout', attrs: { variant: 'warning' }, content: [p('Stop under the low.')] },
  { type: 'taskList', content: [
    { type: 'taskItem', attrs: { checked: true }, content: [p('Size the starter')] },
    { type: 'taskItem', attrs: { checked: false }, content: [p('Add on the reclaim')] },
  ] },
  { type: 'table', content: [
    { type: 'tableRow', content: [
      { type: 'tableHeader', content: [p('Sym')] }, { type: 'tableHeader', content: [p('R')] }] },
    { type: 'tableRow', content: [
      { type: 'tableCell', content: [p('NVDA')] }, { type: 'tableCell', content: [p('2.1')] }] },
  ] },
)
const B_DOC = doc(p('B body, and a link back: ', { type: 'noteLink', attrs: { noteId: 'a' } }))

const LIBRARY = {
  fmt: 'json',
  folders: [
    { id: 'f1', name: 'Trading Ideas' },
    { id: 'f2', name: 'Setups (2026)', parent: 'f1' },
  ],
  notes: [
    { id: 'a', title: 'Cup and handle #3', folder: 'f2', doc: A_DOC },
    { id: 'b', title: 'NVDA up 50% (Q3)', folder: null, doc: B_DOC },
    { id: 'c', title: 'Not selected', folder: 'f1', doc: doc(p('should not travel')) },
  ],
  ids: ['a', 'b', 'no-such-note'],
}

const vfilesOf = (files) => Object.entries(files).map(([path, text]) => {
  const bytes = new TextEncoder().encode(text)
  return { path, size: bytes.length, lastModified: null, bytes: async () => bytes }
})

let OUT = null
beforeAll(() => {
  if (PY) OUT = exportSelection(LIBRARY)
}, 60_000)

const describePy = PY ? describe : describe.skip

describePy('a JSON selection export round-trips through the REAL uct adapter', () => {
  it('the builder got the format: a JSON archive of exactly the selected notes, the missing id skipped and listed', () => {
    expect([OUT.exported, OUT.skipped]).toEqual([2, ['no-such-note']])
    const names = Object.keys(OUT.files)
    expect(names.filter((n) => n.endsWith('.json') && !n.endsWith('UCT_NOTEBOOK_EXPORT.json')).sort())
      .toEqual(['NVDA up 50% (Q3).json', 'Trading Ideas/Setups (2026)/Cup and handle #3.json'])
    expect(names.some((n) => n.endsWith('.md'))).toBe(false)
    expect(names.join('\n')).not.toMatch(/Not selected/)
    const manifest = JSON.parse(OUT.files['UCT_NOTEBOOK_EXPORT.json'])
    expect(manifest).toMatchObject({ selection: true, format: 'json', note_count: 2 })
    expect(OUT.files['EXPORT_ISSUES.txt']).toContain('no-such-note')
  })

  it('detects our archive, and brings each selected note back DEEP-EQUAL with its title and folder', async () => {
    const vfiles = vfilesOf(OUT.files)
    const { adapter, confidence } = await detectAdapter(vfiles)
    expect(adapter).toBe(uctAdapter)
    expect(confidence).toBe(0.97)
    const { docs, warnings } = await adapter.parse(vfiles)
    expect(warnings).toEqual([])
    // EXPORT_ISSUES.txt and the manifest are ours, never a member's note
    expect(docs.map((d) => d.importKey).sort()).toEqual(['uct:a', 'uct:b'])
    const byKey = Object.fromEntries(docs.map((d) => [d.importKey, d]))
    expect(byKey['uct:a'].bodyJson).toEqual(A_DOC)
    expect(byKey['uct:b'].bodyJson).toEqual(B_DOC)
    expect(byKey['uct:a'].title).toBe('Cup and handle #3')
    expect(byKey['uct:a'].folderPath).toEqual(['Trading Ideas', 'Setups (2026)'])
    expect(byKey['uct:b'].folderPath).toEqual([])
  })

  it('a link between two selected notes is re-pointed at the note that came in with it', async () => {
    const { docs } = await uctAdapter.parse(vfilesOf(OUT.files))
    const byKey = Object.fromEntries(docs.map((d) => [d.importKey, d]))
    expect(byKey['uct:a'].links).toEqual(['uct:b'])
    expect(byKey['uct:b'].links).toEqual(['uct:a'])
  })
})
