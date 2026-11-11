// Wave 6 lane D, fix round 1 — I2: a selection export, fed back into OUR OWN
// importer, still links its notes to each other.
//
// ⚰️ The export wrote `[Cup and handle](../Trading/Setups/Cup and handle.md)`.
// A CommonMark link destination cannot hold a space, so every reader — GitHub,
// Obsidian and our importer's markdown-it — showed that as literal text, and
// most note titles have a space. The Python rail (tests/test_notes_export_wave6.py)
// parses the export with markdown-it-py; this one crosses the runtime boundary:
// the REAL writer (tools/selection_export_bridge.py) builds the archive, and the
// REAL importer (detectAdapter + the uct-export adapter's parse) reads it back.
import { describe, it, expect, beforeAll } from 'vitest'
import { detectAdapter } from './importer/registry'
import { mdToHtml } from './importer/adapters/generic'
import { finishDoc, parseImport } from './importer/postParse'
import { htmlToNote } from './importer/convert'
import { rewriteBody } from './importer/commit'
import { exportSelection, pythonAvailable } from './testing/exportBridge'

const hasPython = pythonAvailable()
if (!hasPython) {
  // ⛔ A silent skip deletes the only cross-runtime proof while the suite reads
  // green (exportRoundtrip.test.js measured that the default reporter hides a
  // skipped file's name) — so the skip says what it costs where it is printed.
  console.warn('\n⛔ selection-export round trip NOT VERIFIED in this run: `python` is not on PATH, so the '
    + 'archive was never built. Whether our importer can follow a link between exported notes is UNPROVEN here.\n')
}

const P = (text) => ({ type: 'paragraph', content: [{ type: 'text', text }] })
const link = (noteId) => ({ type: 'paragraph', content: [{ type: 'noteLink', attrs: { noteId } }] })
const doc = (...content) => ({ type: 'doc', content })

/** A member's real titles and folders: spaces, a hash, a percent, parentheses, an accent, an ampersand. */
const LIBRARY = {
  folders: [
    { id: 'f1', name: 'Trading Ideas' },
    { id: 'f2', name: 'Setups (2026)', parent: 'f1' },
    { id: 'f3', name: 'Café & Research' },
  ],
  notes: [
    { id: 'a', title: 'Cup and handle #3', folder: 'f2', doc: doc(P('A.'), link('b')) },
    { id: 'b', title: 'NVDA up 50% (Q3)', folder: 'f3', doc: doc(P('B.'), link('a')) },
  ],
  ids: ['a', 'b'],
}
const A_PATH = 'Trading Ideas/Setups (2026)/Cup and handle #3.md'
const B_PATH = 'Café & Research/NVDA up 50% (Q3).md'

/** The importer's own reading of a relative href (generic.js resolvePath): decode, then resolve against the doc's folder. */
function resolveFrom(folderPath, href) {
  let clean = href.split('#')[0].split('?')[0]
  try { clean = decodeURIComponent(clean) } catch { /* keep it raw, as the importer does */ }
  const stack = [...folderPath]
  for (const part of clean.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') stack.pop()
    else stack.push(part)
  }
  return stack.join('/')
}

const hrefsIn = (html) => {
  const d = new DOMParser().parseFromString(html, 'text/html')
  return [...d.querySelectorAll('a[href]')].map((a) => ({ href: a.getAttribute('href'), text: a.textContent }))
}

const d = hasPython ? describe : describe.skip

d('a selection export round-trips through our own importer, links included', () => {
  let docs
  let byPath

  beforeAll(async () => {
    const { files, exported, skipped } = exportSelection(LIBRARY)
    expect([exported, skipped]).toEqual([2, []])
    const vfiles = Object.entries(files).map(([name, text]) => {
      const bytes = new TextEncoder().encode(text)
      return { path: name, size: bytes.length, lastModified: null, bytes: async () => bytes }
    })
    const { adapter } = await detectAdapter(vfiles)
    expect(adapter.id).toBe('uct-export')
    // The wizard's own call: adapter.parse + the post-parse pass (Plan B Task 3 fix round 1).
    ;({ docs } = await parseImport(adapter, vfiles, {}))
    byPath = new Map(docs.map((x) => [x.importKey.replace(/^file:/, ''), x]))
  }, 60_000)

  it('keeps each note in its folder', () => {
    expect([...byPath.keys()].sort()).toEqual([A_PATH, B_PATH].sort())
    expect(byPath.get(A_PATH).folderPath).toEqual(['Trading Ideas', 'Setups (2026)'])
    expect(byPath.get(B_PATH).folderPath).toEqual(['Café & Research'])
  })

  it('each link is a real link in the imported note, and it resolves to the other exported note', () => {
    const fromA = hrefsIn(byPath.get(A_PATH).html)
    const fromB = hrefsIn(byPath.get(B_PATH).html)
    expect(fromA.map((l) => l.text)).toEqual(['NVDA up 50% (Q3)'])
    expect(fromB.map((l) => l.text)).toEqual(['Cup and handle #3'])
    // Since Plan B Task 3 fix round 1 a link between two notes of the same import is the
    // other note's link key (the post-parse pass would render a raw relative href as text).
    expect(fromA[0].href).toBe(`import-link://file:${B_PATH}`)
    expect(fromB[0].href).toBe(`import-link://file:${A_PATH}`)
    expect(byPath.get(A_PATH).links.map((l) => l.targetKey)).toEqual([`file:${B_PATH}`])
    expect(byPath.get(B_PATH).links.map((l) => l.targetKey)).toEqual([`file:${A_PATH}`])
    // ...and the key is the one the export wrote: the placeholder resolves to the other note's path.
    expect(resolveFrom(byPath.get(A_PATH).folderPath, byPath.get(A_PATH).links[0].placeholder)).toBe(B_PATH)
    expect(resolveFrom(byPath.get(B_PATH).folderPath, byPath.get(B_PATH).links[0].placeholder)).toBe(A_PATH)
  })

  it('after the confirm, each link points at the other imported note', () => {
    const idByKey = { [`file:${A_PATH}`]: 'id-a', [`file:${B_PATH}`]: 'id-b' }
    const linkHrefs = (path) => {
      const { body, keptLinks } = rewriteBody(htmlToNote(byPath.get(path).html).bodyJson, { idByKey })
      expect(keptLinks).toEqual([])
      return JSON.stringify(body).match(/"href":"[^"]*"/g)
    }
    expect(linkHrefs(A_PATH)).toEqual(['"href":"/journal?j2tab=notebook&note=id-b"'])
    expect(linkHrefs(B_PATH)).toEqual(['"href":"/journal?j2tab=notebook&note=id-a"'])
  })

  it('⛔ CONTROL — the unencoded form the export used to write is NOT a link to our importer', () => {
    // What makes the rail above able to fail: the same link, unencoded, is not a
    // link to the note. ⚰️ It used to be worse than plain text: markdown-it's own
    // linkify read the tail "3.md" as a web address (".md" is a country domain) and
    // linked http://3.md. Since Plan B Task 3 the markdown lane runs `linkify: false`
    // and the one link policy (postParse -> linkPolicy) drops a fuzzy bare domain,
    // so the unencoded form is now plain text and nothing else.
    const html = finishDoc({ html: mdToHtml('[Cup and handle #3](../../Trading Ideas/Setups (2026)/Cup and handle #3.md)'), media: [] }).html
    expect(hrefsIn(html).filter((l) => l.text === 'Cup and handle #3')).toEqual([])
    expect(hrefsIn(html).map((l) => l.href)).toEqual([])
  })
})
