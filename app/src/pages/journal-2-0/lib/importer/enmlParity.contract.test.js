/**
 * Cross-LANE parity rail for Evernote (connector fidelity Plan E Task 4).
 *
 * An Evernote note reaches the Notebook two ways: a member drops an `.enex` export into the file
 * importer (THIS directory: `adapters/evernote.js` -> `postParse.parseImport` ->
 * `convert.js::htmlToNote`), or the live sync pulls it through Evernote's MCP server
 * (`api/.../convert/enml.py::enml_to_tiptap`). Two hand-written implementations of one grammar.
 * `enml_parity_fixtures_gen.py` is the AUTHORITY: it runs the server lane over the committed ENML
 * fixtures (`convert/enml_fixtures_in/*.enml` + `<stem>.note.json`) and commits a SEMANTIC summary
 * under `__fixtures__/enml_parity/`. This test wraps the same ENML and the same resource bytes in
 * a synthetic `.enex` (every target note in the sidecar's `notes` as its own `<note>`), runs the
 * client production path, and asserts the summaries are equal.
 *
 * The summary normalises only the two lanes' IDENTITY encodings, nothing else (spec section 4's
 * anti-goal):
 *   - an image ref -> the bare md5 (server `evernote-res://<guid>/<md5>`, client `<md5>`); a web
 *     hotlink -> its URL (the client's `remote-<md5>` item is read back through its own media list);
 *   - a note link -> `note:<target title>` (server: GUID -> title through the sidecar's `notes`;
 *     client: the importKey it resolved by title -> that note's title); a web link -> its href;
 *   - a client image whose ref is a FAILED media item is the importNotice the commit writes in its
 *     place (`failed.reason`), as the server writes it directly.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { evernoteAdapter } from './adapters/evernote'
import { parseImport } from './postParse'
import { htmlToNote } from './convert'
import { extractPlainText } from '../tiptap'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FIXTURES_DIR = path.join(__dirname, '__fixtures__', 'enml_parity')

function loadFixtures() {
  if (!fs.existsSync(FIXTURES_DIR)) return []
  return fs
    .readdirSync(FIXTURES_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((file) => ({ file, fixture: JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, file), 'utf-8')) }))
}

const fixtures = loadFixtures()

const xmlEscape = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function noteXml({ title, created, enml, sourceUrl, resources }) {
  const attrs = sourceUrl ? `<note-attributes><source-url>${xmlEscape(sourceUrl)}</source-url></note-attributes>` : ''
  const res = (resources || [])
    .map((r) => `<resource><data encoding="base64">${r.data_b64}</data><mime>${xmlEscape(r.mime)}</mime>` +
      (r.name ? `<resource-attributes><file-name>${xmlEscape(r.name)}</file-name></resource-attributes>` : '') +
      '</resource>')
    .join('')
  return `<note><title>${xmlEscape(title)}</title><created>${created}</created>` +
    `<content><![CDATA[${enml}]]></content>${attrs}${res}</note>`
}

function enexFor(fixture) {
  const n = fixture.note
  const targets = Object.values(n.notes || {}).map((title) =>
    noteXml({ title, created: '20260101T000000Z', enml: '<?xml version="1.0" encoding="UTF-8"?><en-note><div>target</div></en-note>' }))
  return '<?xml version="1.0" encoding="UTF-8"?><en-export>' +
    noteXml({ title: n.title, created: n.created, enml: fixture.enml, sourceUrl: n.sourceUrl, resources: n.resources }) +
    targets.join('') + '</en-export>'
}

function vfile(p, text) {
  const bytes = new TextEncoder().encode(text)
  return { path: p, size: bytes.length, lastModified: null, bytes: async () => bytes }
}

// Mirrors `enml_parity_fixtures_gen.py::semantic_summary` (document order, same dispatch).
function summarize(doc, { imageRef, noticeFor, linkTarget }) {
  const out = { blocks: [], task_checked: [], images: [], chips: [], notices: [], links: [] }
  const walk = (node) => {
    if (!node || typeof node !== 'object') return
    const attrs = node.attrs || {}
    if (node.type === 'text') {
      const link = (node.marks || []).find((m) => m?.type === 'link')
      if (link) out.links.push({ text: node.text || '', target: linkTarget(link.attrs?.href || '') })
    } else if (node.type === 'taskItem') {
      out.task_checked.push(!!attrs.checked)
    } else if (node.type === 'image') {
      const reason = noticeFor(attrs.src || '')
      if (reason) out.notices.push(reason)
      else out.images.push(imageRef(attrs.src || ''))
    } else if (node.type === 'attachmentChip') {
      out.chips.push(attrs.name ?? null)
    } else if (node.type === 'importNotice') {
      out.notices.push(attrs.reason ?? null)
    }
    for (const child of node.content || []) walk(child)
  }
  for (const block of doc.content || []) {
    const isNotice = block.type === 'image' && noticeFor(block.attrs?.src || '')
    out.blocks.push({ type: isNotice ? 'importNotice' : block.type, text: extractPlainText({ type: 'doc', content: [block] }) })
    walk(block)
  }
  return out
}

const REF = 'import-ref://'
const LINK = 'import-link://'
const TITLE_KIND = 'evernote-title:'
const LIVE_KIND = 'evernote:guid:'

async function clientSummary(fixture) {
  const notebook = fixture.note.notebook
  const { docs } = await parseImport(evernoteAdapter, [vfile(`${notebook}.enex`, enexFor(fixture))], {})
  const doc = docs.find((d) => d.title === fixture.note.title)
  const { bodyJson } = htmlToNote(doc.html)
  const media = new Map((doc.media || []).map((m) => [m.ref, m]))
  const titleByKey = new Map(docs.map((d) => [d.importKey, d.title]))
  return summarize(bodyJson, {
    imageRef: (src) => {
      const ref = src.startsWith(REF) ? src.slice(REF.length) : src
      // An uploaded data image is `data-<md5 of its bytes>`: the summary's `data:<md5>`.
      if (ref.startsWith('data-') && media.get(ref)?.vfile) return `data:${ref.slice('data-'.length)}`
      return media.get(ref)?.remoteUrl ?? ref
    },
    noticeFor: (src) => {
      const ref = src.startsWith(REF) ? src.slice(REF.length) : src
      return media.get(ref)?.failed?.reason ?? null
    },
    linkTarget: (href) => {
      if (!href.startsWith(LINK)) return href
      const key = href.slice(LINK.length)
      if (key.startsWith(TITLE_KIND)) return `note:${key.slice(TITLE_KIND.length)}`
      // A GUID key (an image-only note link, Task 9 fix round 1): through the sidecar's `notes`,
      // as the server summary maps it (`_link_target`).
      const guid = key.startsWith(LIVE_KIND) ? key.slice(LIVE_KIND.length) : null
      if (guid && fixture.note.notes?.[guid]) return `note:${fixture.note.notes[guid]}`
      return titleByKey.has(key) ? `note:${titleByKey.get(key)}` : key
    },
  })
}

// Differences the client lane is KNOWN to have against the server lane, named one by one so the
// rail stays strict for everything else (the obsidianParity convention). Each entry spells out
// what the client reads TODAY; it must really differ from the server (a fix turns the entry red
// and forces its removal), and every field not named still compares.
// ⚰️ `10-foreign-images` held two named gaps here, both closed by controller rulings: a `data:`
// image (now uploaded by both lanes, "content wins") and a relative `<img>` with no clip source
// (now `unresolvable_src` on both, Task 5 review concern 2).
const knownClientGap = {}

describe('Evernote client .enex <-> server ENML parity', () => {
  it('found at least one committed fixture', () => expect(fixtures.length).toBeGreaterThan(0))

  it.each(fixtures)('$file: the client .enex path means the same as the server ENML path', async ({ file, fixture }) => {
    const client = await clientSummary(fixture)
    const gap = knownClientGap[file]
    let expected = fixture.server
    for (const [field, value] of Object.entries(gap?.clientReads || {})) {
      expect(value, `${file}: ${field} is not a gap any more`).not.toEqual(fixture.server[field])
      expected = { ...expected, [field]: value }
    }
    expect(client).toEqual(expected)
  })
})
