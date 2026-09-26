/**
 * Wave 8 lane 8C (ruling D-C3) — reading our OWN JSON export back: the lossless round trip.
 *
 * The exporter (`api/services/journal_two/notes_export_formats.py::note_json`) writes one
 * `<folder>/<title>.json` per note:
 *
 *   { format: "uct-notebook-note", version: 1,
 *     note: { id, title, subtitle, folderPath, tags, ticker, properties, createdAt,
 *             updatedAt, schemaLevel, heroImage, bodyJson, extras? } }
 *
 * `bodyJson` is the stored TipTap document VERBATIM, except that an attachment's in-app
 * address was rewritten to its path inside the archive. So importing it is: take the body
 * as it is, and put the importer's own placeholder (`import-ref://<path>`) where a bundled
 * file is, so the EXISTING attachment path (`commit.js` — upload, then `rewriteBody`)
 * relinks it exactly as it relinks a Markdown import's images. Nothing is converted, so
 * nothing is lost: the rail is `exportFormats.roundtrip.test.js`, one fixture per registered
 * node type, deep-equal.
 *
 * ⛔ A note link inside the archive points at the note's ORIGINAL id. Each note's import key
 * is that id (`uct:<id>`), so after the confirm `rewriteBody` swaps a link whose target came
 * in with the same import for the target's NEW id (`idByKey`). A link to a note that did not
 * come in keeps its id: in the account it came from it still opens that note, and anywhere
 * else it reads as an unresolved "linked note" — never a wrong one.
 *
 * ⛔ Deliberately NOT imported: `heroImage` (the confirm route has no hero field, and folding
 * it into the body would break the round trip) and `properties` / `extras` (the confirm
 * route takes none of them). `docs/notebook/export-formats.md` says so.
 *
 * This module imports nothing heavy (no editor, no DOM): the adapter registry loads it.
 */

export const UCT_JSON_FORMAT = 'uct-notebook-note'
export const UCT_JSON_VERSION = 1
/** The import key of a note from our JSON export: its original id, prefixed. */
export const UCT_NOTE_KEY_PREFIX = 'uct:'
export const noteKeyFor = (id) => `${UCT_NOTE_KEY_PREFIX}${id}`

const REF_PREFIX = 'import-ref://'

function isRelativePath(value) {
  return typeof value === 'string' && value !== '' && !/^[a-z][a-z0-9+.-]*:/i.test(value)
    && !value.startsWith('/') && !value.startsWith('#')
}

/** A path relative to `dir` (the note file's own folder), resolved and percent-decoded —
 *  the same rule `generic.js` reads a Markdown archive's links with. */
export function resolveArchivePath(dir, rel) {
  let clean = String(rel).split('#')[0].split('?')[0]
  try {
    clean = decodeURIComponent(clean)
  } catch {
    // a malformed escape — keep the raw string
  }
  const stack = dir ? dir.split('/') : []
  for (const part of clean.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      stack.pop()
      continue
    }
    stack.push(part)
  }
  return stack.join('/')
}

const basename = (p) => String(p).split('/').pop()

/**
 * One exported note, read. Returns the importer's doc shape, or throws a sentence a member
 * can act on (the adapter turns it into a warning and keeps going).
 *
 * @param {string} text     the .json file's text
 * @param {string} path     its path inside the archive
 * @param {Map<string, object>} byPath  every file in the drop, by path (for attachments)
 */
export function parseUctJsonNote(text, path, byPath) {
  let data
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error('it is not valid JSON')
  }
  if (!data || data.format !== UCT_JSON_FORMAT) throw new Error('it is not a UCT Notebook note')
  if (data.version !== UCT_JSON_VERSION) {
    throw new Error(`it was written by a newer version of UCT (format version ${data.version})`)
  }
  const note = data.note
  if (!note || typeof note !== 'object' || !note.bodyJson || note.bodyJson.type !== 'doc') {
    throw new Error('it has no note body')
  }
  const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
  const media = []
  const seen = new Set()
  const noteLinks = []

  const relink = (value, kind) => {
    if (!isRelativePath(value)) return value
    const resolved = resolveArchivePath(dir, value)
    const vfile = byPath.get(resolved)
    if (!vfile) return value
    if (!seen.has(resolved)) {
      seen.add(resolved)
      media.push({ ref: resolved, vfile, kind, name: basename(resolved) })
    }
    return `${REF_PREFIX}${resolved}`
  }

  // A structural copy: the body is walked and every node is rebuilt, never mutated in place.
  const walk = (node) => {
    if (Array.isArray(node)) return node.map(walk)
    if (!node || typeof node !== 'object') return node
    const next = { ...node }
    const attrs = node.attrs && typeof node.attrs === 'object' && !Array.isArray(node.attrs) ? { ...node.attrs } : null
    if (attrs) {
      if (node.type === 'image' || node.type === 'resizableImage') attrs.src = relink(attrs.src, 'image')
      if (node.type === 'attachmentChip') attrs.href = relink(attrs.href, 'file')
      if (node.type === 'widgetEmbed' && attrs.fallback && typeof attrs.fallback === 'object') {
        attrs.fallback = { ...attrs.fallback, url: relink(attrs.fallback.url, 'image') }
      }
      if (node.type === 'noteLink' && typeof attrs.noteId === 'string' && attrs.noteId) noteLinks.push(attrs.noteId)
      next.attrs = attrs
    }
    if (Array.isArray(node.content)) next.content = node.content.map(walk)
    if (Array.isArray(node.marks)) next.marks = node.marks.map((m) => (m && typeof m === 'object' ? { ...m } : m))
    return next
  }

  const tags = Array.isArray(note.tags) ? note.tags.filter((t) => typeof t === 'string') : []
  const folderPath = Array.isArray(note.folderPath) ? note.folderPath.filter((s) => typeof s === 'string' && s) : []
  return {
    importKey: noteKeyFor(note.id),
    title: typeof note.title === 'string' && note.title ? note.title : basename(path).replace(/\.json$/i, ''),
    subtitle: typeof note.subtitle === 'string' && note.subtitle ? note.subtitle : undefined,
    ticker: typeof note.ticker === 'string' && note.ticker ? note.ticker : undefined,
    tags,
    folderPath,
    ...(typeof note.createdAt === 'string' ? { createdAt: note.createdAt } : {}),
    ...(typeof note.updatedAt === 'string' ? { updatedAt: note.updatedAt } : {}),
    bodyJson: walk(note.bodyJson),
    // The wizard reads `html` for its size hint and re-derives a body from it for a note it
    // is comparing against an existing one; a HELD body answers that with THIS body, not a
    // re-conversion (holdBodyForImport below).
    html: holdBodyForImport(note.bodyJson),
    media,
    // filled in by the adapter once every note in the drop is known: the note-link targets
    // that came in with this same import
    noteLinkIds: noteLinks,
    links: [],
  }
}

// ── A body the importer already holds ────────────────────────────────────────
//
// ⛔⛔ THE DATA-LOSS PATH THIS CLOSES. The import wizard, for a note whose import key
// already exists (a member importing the same export twice), re-derives the body from
// `doc.html` with `htmlToNote` to compare fingerprints — and assigns the result as the
// body. A JSON note has no HTML: re-deriving from an empty string would hand the confirm
// an EMPTY body and overwrite the member's note with nothing. So the adapter hands the
// wizard a marker in place of HTML, and `convert.js::htmlToNote` answers a marker with the
// body it stands for (a fresh copy each time). Anything that renders the marker renders an
// HTML comment: nothing. (Lane 8A was asked to make the wizard skip a note that already
// carries a body; this stays as the guard whether or not that lands.)
const HELD_PREFIX = '<!--uct-held-body:'
const HELD_SUFFIX = '-->'
const held = new Map()
let heldSeq = 0
const HELD_CAP = 50_000

export function holdBodyForImport(bodyJson) {
  heldSeq += 1
  const key = `${Date.now().toString(36)}-${heldSeq}`
  held.set(key, JSON.stringify(bodyJson))
  if (held.size > HELD_CAP) held.delete(held.keys().next().value)
  return `${HELD_PREFIX}${key}${HELD_SUFFIX}`
}

/** The body a marker stands for (a fresh copy), or null when `html` is not a marker. */
export function heldBody(html) {
  if (typeof html !== 'string' || !html.startsWith(HELD_PREFIX) || !html.endsWith(HELD_SUFFIX)) return null
  const stored = held.get(html.slice(HELD_PREFIX.length, -HELD_SUFFIX.length))
  return stored ? JSON.parse(stored) : null
}
