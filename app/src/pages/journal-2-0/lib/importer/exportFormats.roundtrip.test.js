// Wave 8 lane 8C (C4) — the export formats, fed back into our OWN importer.
//
// Every document here crosses both runtimes: the REAL exporter (tools/format_export_bridge.py
// -> notes_export_formats.py, one spawn for the whole file, in a budgeted beforeAll) and the
// REAL importer (detectAdapter + the uct adapter for JSON; htmlToNote for HTML; the generic
// adapter's mammoth path for Word; mdToHtml + htmlToNote for Markdown). Neither half is a
// hand-typed stand-in for the other.
//
//  · JSON is the lossless format (ruling D-C3): ONE FIXTURE PER REGISTERED NODE AND MARK TYPE,
//    exported as a JSON archive, re-imported through `detectAdapter` -> `uctAdapter.parse`,
//    and the body is DEEP-EQUAL. The type list is DERIVED by parsing lib/notebookSchema.js —
//    never typed — so a type registered tomorrow without a fixture fails by name.
//  · HTML keeps at least what Markdown keeps (D-C2: the web page IS the Markdown writer).
//  · Word: headings, lists and bold come back through mammoth (D-C4).
//
// ⭐ THE FIDELITY TABLE IN docs/notebook/export-formats.md IS THIS FILE'S OUTPUT. Each
// (type, format) cell is measured here — kept / flattened / dropped, after the re-import —
// and the doc's generated block must equal it. Regenerate with
//   UPDATE_EXPORT_FORMATS_DOC=1 npx vitest run src/pages/journal-2-0/lib/importer/exportFormats.roundtrip.test.js
import fs from 'node:fs'
import path from 'node:path'
import { unzipSync } from 'fflate'
import { Parser } from 'acorn'
import { describe, it, expect, beforeAll, vi } from 'vitest'
import { exportFormatsMany, importMarkdown, pythonAvailable, REPO_ROOT } from '../testing/exportBridge'
import { NOTEBOOK_TYPE_SCHEMA } from '../notebookSchema'
import { detectAdapter } from './registry'
import { uctAdapter } from './adapters/uct'
import { genericAdapter } from './adapters/generic'
import { htmlToNote } from './convert'
import { rewriteBody } from './commit'
import { heldBody } from './uctJson'

// ⛔ THE REAL mammoth, with ONE shim. The browser bundle resolves mammoth's `browser` field
// (browser/unzip.js), which takes `{ arrayBuffer }` — the shape `generic.js` passes. Vitest
// resolves the Node entry, whose unzip accepts `{ buffer }` and rejects `{ arrayBuffer }`
// ("Could not find file in options"). The shim changes the input's SHAPE only; the conversion
// is mammoth's own. (generic.test.js mocks mammoth wholesale — this rail must not.)
vi.mock('mammoth', async (importOriginal) => {
  const real = await importOriginal()
  const m = real.default || real
  const convertToHtml = (input, options) => m.convertToHtml(
    input && input.arrayBuffer ? { buffer: Buffer.from(input.arrayBuffer) } : input, options)
  return { ...m, default: { ...m, convertToHtml }, convertToHtml }
})

const PY = pythonAvailable()
const SCHEMA_FILE = path.join(REPO_ROOT, 'app', 'src', 'pages', 'journal-2-0', 'lib', 'notebookSchema.js')
const DOC_FILE = path.join(REPO_ROOT, 'docs', 'notebook', 'export-formats.md')

// ── the type list, DERIVED ───────────────────────────────────────────────────

/** Every key of `NOTEBOOK_TYPE_SCHEMA`, read from the SOURCE by acorn — not from the import. */
function parsedSchemaTypes() {
  const src = fs.readFileSync(SCHEMA_FILE, 'utf8')
  const tree = Parser.parse(src, { ecmaVersion: 'latest', sourceType: 'module' })
  for (const node of tree.body) {
    const decl = node.type === 'ExportNamedDeclaration' ? node.declaration : null
    for (const d of decl?.declarations || []) {
      if (d.id.name !== 'NOTEBOOK_TYPE_SCHEMA') continue
      const obj = d.init.type === 'CallExpression' ? d.init.arguments[0] : d.init
      return obj.properties.map((p) => p.key.name ?? p.key.value)
    }
  }
  return []
}

// ── one fixture per type ─────────────────────────────────────────────────────

const t = (text, ...marks) => ({ type: 'text', text, ...(marks.length ? { marks } : {}) })
const p = (...inline) => ({ type: 'paragraph', content: inline.map((i) => (typeof i === 'string' ? t(i) : i)) })
const doc = (...content) => ({ type: 'doc', content })
const withMark = (word, mark) => doc(p('plain ', t(word, mark), ' tail'))
const table = doc({ type: 'table', content: [
  { type: 'tableRow', content: [
    { type: 'tableHeader', content: [p('headcellword')] }, { type: 'tableHeader', content: [p('Hb')] }] },
  { type: 'tableRow', content: [
    { type: 'tableCell', content: [p('bodycellword')] }, { type: 'tableCell', content: [p('Cb')] }] },
] })
const toggle = doc({ type: 'toggle', content: [
  { type: 'toggleSummary', content: [t('summaryword')] },
  { type: 'toggleContent', content: [p('toggleword')] },
] })
const taskList = doc({ type: 'taskList', content: [
  { type: 'taskItem', attrs: { checked: true }, content: [p('taskword')] }] })
const columns = doc({ type: 'columns', content: [
  { type: 'column', content: [p('leftcolword')] }, { type: 'column', content: [p('rightcolword')] }] })
const figure = doc({ type: 'imageFigure', content: [
  { type: 'image', attrs: { src: 'https://example.com/fig.png', alt: 'figalt' } },
  { type: 'imageCaption', content: [t('captionword')] }] })
const askInsert = doc({ type: 'askInsert', attrs: { question: 'askquestionword', insertedAt: '2026-09-02T10:00:00Z' },
  content: [p('askanswerword ', { type: 'askCitation', attrs: { n: 1, label: 'citelabelword' } })] })

// `probe`: the words that are the node's content — present in the re-imported text when the
// content survived at all (flattened), absent when it was dropped.
export const FIXTURES = {
  doc: { doc: doc(p('docword')), probe: 'docword' },
  paragraph: { doc: doc(p('paragraphword')), probe: 'paragraphword' },
  text: { doc: doc(p('textword')), probe: 'textword' },
  heading: { doc: doc({ type: 'heading', attrs: { level: 2 }, content: [t('headingword')] }), probe: 'headingword' },
  blockquote: { doc: doc({ type: 'blockquote', content: [p('quoteword')] }), probe: 'quoteword' },
  bulletList: { doc: doc({ type: 'bulletList', content: [{ type: 'listItem', content: [p('bulletword')] }] }), probe: 'bulletword' },
  orderedList: { doc: doc({ type: 'orderedList', attrs: { start: 1 }, content: [{ type: 'listItem', content: [p('orderedword')] }] }), probe: 'orderedword' },
  listItem: { doc: doc({ type: 'bulletList', content: [{ type: 'listItem', content: [p('itemword')] }] }), probe: 'itemword' },
  taskList: { doc: taskList, probe: 'taskword' },
  taskItem: { doc: taskList, probe: 'taskword' },
  codeBlock: { doc: doc({ type: 'codeBlock', attrs: { language: 'js' }, content: [t('const codeword = 1')] }), probe: 'codeword' },
  horizontalRule: { doc: doc(p('beforerule'), { type: 'horizontalRule' }, p('afterrule')), probe: null },
  hardBreak: { doc: doc(p('linea', { type: 'hardBreak' }, 'lineb')), probe: 'lineb' },
  image: { doc: doc({ type: 'image', attrs: { src: 'https://example.com/i.png', alt: 'imagealtword' } }), probe: 'imagealtword' },
  table: { doc: table, probe: 'bodycellword' },
  tableRow: { doc: table, probe: 'bodycellword' },
  tableCell: { doc: table, probe: 'bodycellword' },
  tableHeader: { doc: table, probe: 'headcellword' },
  callout: { doc: doc({ type: 'callout', attrs: { variant: 'note' }, content: [p('calloutword')] }), probe: 'calloutword' },
  toggle: { doc: toggle, probe: 'toggleword' },
  toggleSummary: { doc: toggle, probe: 'summaryword' },
  toggleContent: { doc: toggle, probe: 'toggleword' },
  attachmentChip: { doc: doc(p('see ', { type: 'attachmentChip', attrs: { href: 'https://example.com/r.pdf', name: 'chipfile.pdf' } })), probe: 'chipfile' },
  noteLink: { doc: doc(p('see ', { type: 'noteLink', attrs: { noteId: 'someothernote' } })), probe: null },
  videoTimestamp: { doc: doc(p('at ', { type: 'videoTimestamp', attrs: { seconds: 75 } })), probe: '1:15' },
  widgetEmbed: { doc: doc({ type: 'widgetEmbed', attrs: { widgetId: 'chart', searchText: 'widgetcaptionword' } }), probe: 'widgetcaptionword' },
  financialFact: { doc: doc({ type: 'financialFact', attrs: { factId: 'fact-1' } }), probe: null },
  documentExcerpt: { doc: doc({ type: 'documentExcerpt', attrs: { excerptId: 'excerpt-1' } }), probe: null },
  bold: { doc: withMark('boldword', { type: 'bold' }), probe: 'boldword' },
  italic: { doc: withMark('italicword', { type: 'italic' }), probe: 'italicword' },
  strike: { doc: withMark('strikeword', { type: 'strike' }), probe: 'strikeword' },
  code: { doc: withMark('codemarkword', { type: 'code' }), probe: 'codemarkword' },
  underline: { doc: withMark('underlineword', { type: 'underline' }), probe: 'underlineword' },
  link: { doc: withMark('linkword', { type: 'link', attrs: { href: 'https://example.com/l' } }), probe: 'linkword' },
  textStyle: { doc: withMark('stylesword', { type: 'textStyle', attrs: { color: null } }), probe: 'stylesword' },
  highlight: { doc: withMark('highlightword', { type: 'highlight', attrs: { color: null } }), probe: 'highlightword' },
  textColor: { doc: withMark('colourword', { type: 'textColor', attrs: { color: 'red' } }), probe: 'colourword' },
  askInsert: { doc: askInsert, probe: 'askanswerword' },
  askCitation: { doc: askInsert, probe: 'citelabelword' },
  inlineMath: { doc: doc(p('sum ', { type: 'inlineMath', attrs: { latex: 'x^2+y' } }, ' here')), probe: 'x^2+y' },
  blockMath: { doc: doc({ type: 'blockMath', attrs: { latex: '\\frac{a}{b}' } }), probe: '\\frac{a}{b}' },
  columns: { doc: columns, probe: 'leftcolword' },
  column: { doc: columns, probe: 'rightcolword' },
  dateMention: { doc: doc(p('due ', { type: 'dateMention', attrs: { date: '2026-10-01' } })), probe: '2026-10-01' },
  imageFigure: { doc: figure, probe: 'captionword' },
  imageCaption: { doc: figure, probe: 'captionword' },
  linkPreview: { doc: doc({ type: 'linkPreview', attrs: { url: 'https://example.com/p', title: 'previewtitleword', description: 'previewdescword' } }), probe: 'previewtitleword' },
  tableOfContents: { doc: doc({ type: 'heading', attrs: { level: 1 }, content: [t('tocheadword')] }, { type: 'tableOfContents' }), probe: null },
  webEmbed: { doc: doc({ type: 'webEmbed', attrs: { url: 'https://www.youtube.com/watch?v=abc', provider: 'youtube' } }), probe: 'YouTube video' },
}

// ── measuring what came back ─────────────────────────────────────────────────

function typesIn(node, out = new Set()) {
  if (Array.isArray(node)) { node.forEach((n) => typesIn(n, out)); return out }
  if (!node || typeof node !== 'object') return out
  if (typeof node.type === 'string') out.add(node.type)
  for (const m of node.marks || []) if (m?.type) out.add(m.type)
  typesIn(node.content, out)
  return out
}

function plainText(node) {
  if (Array.isArray(node)) return node.map(plainText).join(' ')
  if (!node || typeof node !== 'object') return ''
  const own = typeof node.text === 'string' ? node.text : ''
  const attrs = node.attrs && typeof node.attrs === 'object' ? node.attrs : {}
  // atoms whose words live in attributes (the importer's own node views read them there)
  const fromAttrs = ['latex', 'alt', 'name', 'date', 'title', 'label', 'question'].map((k) => (typeof attrs[k] === 'string' ? attrs[k] : '')).join(' ')
  return `${own} ${fromAttrs} ${plainText(node.content)}`
}

/** kept: the type is in the re-imported document; flattened: its words are, the type is
 *  not; dropped: neither. */
function classify(type, fixture, reimported) {
  const types = typesIn(reimported)
  if (types.has(type)) return 'kept'
  if (fixture.probe && plainText(reimported).includes(fixture.probe)) return 'flattened'
  return 'dropped'
}

const ALL_TYPES = parsedSchemaTypes()
const TYPES = [...ALL_TYPES].sort((a, b) => (NOTEBOOK_TYPE_SCHEMA[a] - NOTEBOOK_TYPE_SCHEMA[b]) || a.localeCompare(b))

function b64ToBytes(b64) {
  return new Uint8Array(Buffer.from(b64, 'base64'))
}

function vfilesOf(files) {
  return Object.entries(files).map(([p, b64]) => {
    const bytes = b64ToBytes(b64)
    return { path: p, size: bytes.length, lastModified: null, bytes: async () => bytes }
  })
}

async function docxToNote(b64) {
  const bytes = b64ToBytes(b64)
  const vfile = { path: 'note.docx', size: bytes.length, lastModified: null, bytes: async () => bytes }
  const { docs } = await genericAdapter.parse([vfile])
  return htmlToNote(docs[0].html).bodyJson
}

// ── the one spawn ────────────────────────────────────────────────────────────

let RESULT = null
const ATTACH_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAIAAADwyuo0AAAAFElEQVR4nGM8ISfHAANMcBYDAwMAGVgBCNdbWuMAAAAASUVORK5CYII='
const REAL_ATTACHMENT = (id) => `/api/j2/notes/attachments/u1/${id}/inline/att.png`

beforeAll(async () => {
  if (!PY) return
  const typed = TYPES.filter((type) => FIXTURES[type])
  const jobs = []
  for (const type of typed) {
    jobs.push({ kind: 'md', doc: FIXTURES[type].doc })
    jobs.push({ kind: 'html', doc: FIXTURES[type].doc })
    jobs.push({ kind: 'docx', doc: FIXTURES[type].doc, title: `Fixture ${type}` })
  }
  // one JSON archive holding every fixture, in a folder tree
  jobs.push({
    kind: 'archive', fmt: 'json',
    folders: [{ id: 'f1', name: 'Research: 2026' }, { id: 'f2', name: 'Deep', parent: 'f1' }],
    notes: typed.map((type, i) => ({ id: `fx-${type}`, title: `Fixture ${type}`, folder: i % 2 ? 'f2' : 'f1',
      doc: FIXTURES[type].doc, tags: ['roundtrip', `t/${type}`], ticker: i === 0 ? 'NVDA' : null,
      subtitle: i === 0 ? 'the first' : null })),
  })
  // attachments + a link between two notes of the same archive
  jobs.push({
    kind: 'archive', fmt: 'json',
    notes: [
      { id: 'la', title: 'Links to B', doc: doc(p('see ', { type: 'noteLink', attrs: { noteId: 'lb' } }),
        { type: 'image', attrs: { src: REAL_ATTACHMENT('la'), alt: 'bundled' } },
        { type: 'widgetEmbed', attrs: { widgetId: 'chart', searchText: 'w', fallback: { url: REAL_ATTACHMENT('la'), w: 4, h: 2 } } }) },
      { id: 'lb', title: 'B', doc: doc(p('B body')) },
    ],
    attachments: [{ note: 'la', sub: 'inline', name: 'att.png', b64: ATTACH_PNG }],
  })
  // one web-page archive, for the adapter's page-header handling
  jobs.push({ kind: 'archive', fmt: 'html', notes: [{ id: 'h1', title: 'Web page note', subtitle: 'its subtitle', doc: doc(p('pagebodyword')) }] })
  // Word's (b): headings, lists and bold through mammoth
  jobs.push({ kind: 'docx', title: 'Structure', doc: doc(
    { type: 'heading', attrs: { level: 1 }, content: [t('Top heading')] },
    { type: 'heading', attrs: { level: 3 }, content: [t('Third heading')] },
    p('a ', t('bold', { type: 'bold' }), ' word'),
    { type: 'bulletList', content: [{ type: 'listItem', content: [p('bullet one')] }, { type: 'listItem', content: [p('bullet two')] }] },
    { type: 'orderedList', attrs: { start: 1 }, content: [{ type: 'listItem', content: [p('first')] }] },
  ) })
  const answers = exportFormatsMany(jobs)
  const perType = {}
  let k = 0
  for (const type of typed) {
    perType[type] = { md: answers[k].markdown, html: answers[k + 1].html, docx: answers[k + 2].docx }
    k += 3
  }
  const [jsonArchive, linkArchive, htmlArchive, structure] = answers.slice(k)
  const reimported = {}
  for (const type of typed) {
    reimported[type] = {
      md: importMarkdown(perType[type].md),
      html: htmlToNote(perType[type].html).bodyJson,
      docx: await docxToNote(perType[type].docx),
    }
  }
  RESULT = { typed, perType, reimported, jsonArchive, linkArchive, htmlArchive, structure }
}, 240_000)

const describePy = PY ? describe : describe.skip

describe('the node-type list is derived from lib/notebookSchema.js', () => {
  it('parses the table from the source, and it matches the module (non-vacuity: paragraph, askInsert)', () => {
    expect(ALL_TYPES).toContain('paragraph')
    expect(ALL_TYPES).toContain('askInsert')
    expect([...ALL_TYPES].sort()).toEqual(Object.keys(NOTEBOOK_TYPE_SCHEMA).sort())
  })

  it('every registered type has a fixture — a new type without one fails BY NAME', () => {
    const missing = ALL_TYPES.filter((type) => !FIXTURES[type])
    expect(missing, `no round-trip fixture for: ${missing.join(', ')}`).toEqual([])
    // and every fixture really contains its own type
    for (const type of ALL_TYPES) expect(typesIn(FIXTURES[type].doc).has(type), type).toBe(true)
  })
})

describePy('JSON — the lossless round trip through the REAL uct adapter', () => {
  it('detects our archive and brings every fixture back deep-equal, with its title, tags, folders and dates', async () => {
    const vfiles = vfilesOf(RESULT.jsonArchive.files)
    const { adapter, confidence } = await detectAdapter(vfiles)
    expect(adapter).toBe(uctAdapter)
    expect(confidence).toBe(0.97)
    const { docs, warnings } = await adapter.parse(vfiles)
    expect(warnings).toEqual([])
    const byKey = Object.fromEntries(docs.map((d) => [d.importKey, d]))
    for (const type of RESULT.typed) {
      const got = byKey[`uct:fx-${type}`]
      expect(got, type).toBeTruthy()
      expect(got.bodyJson, `${type}: the body did not come back verbatim`).toEqual(FIXTURES[type].doc)
      expect(got.title).toBe(`Fixture ${type}`)
      expect(got.tags).toEqual(['roundtrip', `t/${type}`])
      expect(got.createdAt).toBe('2026-09-01T00:00:00Z')
    }
    const first = byKey[`uct:fx-${RESULT.typed[0]}`]
    expect([first.ticker, first.subtitle]).toEqual(['NVDA', 'the first'])
    expect(first.folderPath).toEqual(['Research: 2026'])            // the REAL name, colon and all
    expect(byKey[`uct:fx-${RESULT.typed[1]}`].folderPath).toEqual(['Research: 2026', 'Deep'])
  })

  it('relinks a bundled attachment through the importer\'s own attachment path, and re-points a link to a note that came in too', async () => {
    const { docs } = await uctAdapter.parse(vfilesOf(RESULT.linkArchive.files))
    const a = docs.find((d) => d.importKey === 'uct:la')
    const ref = 'attachments/u1/la/inline/att.png'
    expect(a.bodyJson.content[1].attrs.src).toBe(`import-ref://${ref}`)
    expect(a.bodyJson.content[2].attrs.fallback.url).toBe(`import-ref://${ref}`)
    expect(a.media).toHaveLength(1)
    expect(a.media[0]).toMatchObject({ ref, kind: 'image', name: 'att.png' })
    expect(Buffer.from(await a.media[0].vfile.bytes()).toString('base64')).toBe(ATTACH_PNG)
    expect(a.links).toEqual(['uct:lb'])
    const { body, droppedMedia } = rewriteBody(a.bodyJson, {
      mediaUrls: { [ref]: '/api/j2/notes/attachments/u9/new/inline/att.png' }, idByKey: { 'uct:lb': 'NEWID' },
    })
    expect(droppedMedia).toEqual([])
    expect(body.content[0].content[1].attrs.noteId).toBe('NEWID')
    expect(body.content[1].attrs.src).toBe('/api/j2/notes/attachments/u9/new/inline/att.png')
    expect(body.content[2].attrs.fallback).toEqual({ url: '/api/j2/notes/attachments/u9/new/inline/att.png', w: 4, h: 2 })
    // a link whose target did NOT come in is left exactly as stored
    const alone = rewriteBody(a.bodyJson, { mediaUrls: {}, idByKey: {} })
    expect(alone.body.content[0].content[1].attrs.noteId).toBe('lb')
    // an unresolved IMAGE is dropped (the importer's rule for every image); an unresolved
    // WIDGET picture lets only the picture go — the widget is still the widget
    expect(alone.body.content.map((n) => n.type)).toEqual(['paragraph', 'widgetEmbed'])
    expect(alone.body.content[1].attrs.fallback).toBeNull()
    expect(alone.droppedMedia).toEqual([ref, ref])
  })

  it('never re-derives a JSON note\'s body from HTML it does not have (the wizard\'s fingerprint path)', async () => {
    const { docs } = await uctAdapter.parse(vfilesOf(RESULT.jsonArchive.files))
    const d = docs.find((x) => x.importKey === 'uct:fx-table')
    expect(heldBody(d.html)).toEqual(FIXTURES.table.doc)
    expect(htmlToNote(d.html).bodyJson).toEqual(FIXTURES.table.doc)   // what ImportWizard assigns
    expect(heldBody('<p>not a marker</p>')).toBeNull()
  })
})

describePy('HTML — the web page keeps at least what Markdown keeps', () => {
  it('headings, lists, tables, links and marks survive the web page', () => {
    const kept = (type) => classify(type, FIXTURES[type], RESULT.reimported[type].html)
    for (const type of ['heading', 'bulletList', 'orderedList', 'taskList', 'table', 'tableHeader', 'link',
      'bold', 'italic', 'strike', 'code', 'highlight', 'inlineMath', 'blockMath', 'callout', 'toggle']) {
      expect(kept(type), type).toBe('kept')
    }
  })

  it('for every registered type, what Markdown keeps the web page keeps too', () => {
    const rank = { kept: 2, flattened: 1, dropped: 0 }
    const worse = RESULT.typed.filter((type) => {
      const md = classify(type, FIXTURES[type], RESULT.reimported[type].md)
      const html = classify(type, FIXTURES[type], RESULT.reimported[type].html)
      return rank[html] < rank[md]
    })
    expect(worse, `the web page keeps less than Markdown for: ${worse.join(', ')}`).toEqual([])
  })

  it('an exported web page imports without its page header, and keeps its subtitle', async () => {
    const { docs } = await uctAdapter.parse(vfilesOf(RESULT.htmlArchive.files))
    expect(docs).toHaveLength(1)
    expect(docs[0].title).toBe('Web page note')
    expect(docs[0].subtitle).toBe('its subtitle')
    const body = htmlToNote(docs[0].html).bodyJson
    expect(plainText(body)).toContain('pagebodyword')
    expect(plainText(body)).not.toContain('Web page note')          // the header is not content
  })
})

describePy('Word — through mammoth, the real importer yields headings, lists and bold', () => {
  it('reads back the structure', async () => {
    const body = await docxToNote(RESULT.structure.docx)
    const types = typesIn(body)
    for (const type of ['heading', 'bulletList', 'orderedList', 'listItem', 'bold']) expect(types.has(type), type).toBe(true)
    const headings = body.content.filter((n) => n.type === 'heading').map((n) => [n.attrs.level, plainText(n).trim()])
    expect(headings).toEqual([[1, 'Top heading'], [3, 'Third heading']])
  })
})

// ── the fidelity table: generated, never typed ───────────────────────────────

const BEGIN = '<!-- BEGIN GENERATED: export fidelity table (lib/importer/exportFormats.roundtrip.test.js) -->'
const END = '<!-- END GENERATED -->'

function fidelityTable(jsonByKey) {
  const rows = RESULT.typed.map((type) => {
    const r = RESULT.reimported[type]
    const back = jsonByKey[`uct:fx-${type}`]?.bodyJson
    // JSON: 'kept' only when the body came back DEEP-EQUAL; otherwise measured like the rest
    const json = back && JSON.stringify(back) === JSON.stringify(FIXTURES[type].doc)
      ? 'kept' : classify(type, FIXTURES[type], back || doc())
    const cells = [
      classify(type, FIXTURES[type], r.md), classify(type, FIXTURES[type], r.html), json,
      classify(type, FIXTURES[type], r.docx),
    ]
    return `| \`${type}\` | ${NOTEBOOK_TYPE_SCHEMA[type]} | ${cells.join(' | ')} |`
  })
  return [
    '| Type | Schema | Markdown | Web page (HTML) | JSON | Word |',
    '|---|---|---|---|---|---|',
    ...rows,
  ].join('\n')
}

describePy('docs/notebook/export-formats.md carries the measured table', () => {
  it('the generated block equals what this run measured', async () => {
    const { docs } = await uctAdapter.parse(vfilesOf(RESULT.jsonArchive.files))
    const table = fidelityTable(Object.fromEntries(docs.map((d) => [d.importKey, d])))
    // ⚰️ Read as LF. The blob is LF, but a Windows checkout with core.autocrlf=true puts CRLF on
    // disk, and every row then compared as "row\r" against the measured "row" -- red on each fresh
    // checkout (the wave-8 landing gate), green only in a worktree whose copy was written LF.
    let text = fs.readFileSync(DOC_FILE, 'utf8').replace(/\r\n/g, '\n')
    if (process.env.UPDATE_EXPORT_FORMATS_DOC === '1') {
      const [head, rest] = text.split(BEGIN)
      const tail = rest.split(END)[1]
      text = `${head}${BEGIN}\n${table}\n${END}${tail}`
      fs.writeFileSync(DOC_FILE, text)
    }
    const block = text.split(BEGIN)[1]?.split(END)[0]
    expect(block, 'the doc has no generated block').toBeTruthy()
    expect(block.trim()).toBe(table)
    // non-vacuity: every type is a row, and JSON keeps them all
    expect(block.split('\n').filter((l) => l.startsWith('| `'))).toHaveLength(ALL_TYPES.length)
  })
})
