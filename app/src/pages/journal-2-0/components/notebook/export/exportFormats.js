// The Notebook's export formats, as a member chooses them (wave 8, lane 8C, C4).
//
// ONE list, read by both doors: the whole-notebook Export dialog (a radio group) and each
// note's Export menu. The server's list is `notes_export_formats.FORMATS`; the `id`s here are
// the `format=` values the routes take (`api/routers/notebook_export.py`).
//
// ⛔ Every sentence here reaches a member as it stands, and says what the format KEEPS — not
// how it works. The per-node detail is `docs/notebook/export-formats.md` (measured).

export const EXPORT_FORMATS = Object.freeze([
  Object.freeze({
    id: 'md',
    label: 'Markdown',
    menuLabel: 'Markdown',
    keeps: 'Plain-text files with your folders, tags and attachments. Opens in Obsidian and any Markdown app, and imports back into UCT.',
  }),
  Object.freeze({
    id: 'html',
    label: 'Web page (HTML)',
    menuLabel: 'Web page (HTML)',
    keeps: 'Each note as a page that opens in any browser, offline, with its images, tables and formatting.',
  }),
  Object.freeze({
    id: 'json',
    label: 'JSON',
    menuLabel: 'JSON',
    keeps: 'Every note exactly as stored, with nothing left out. The format to bring your notes back into UCT with no loss.',
  }),
  Object.freeze({
    id: 'docx',
    label: 'Word (.docx)',
    menuLabel: 'Word (.docx)',
    keeps: 'Each note as a Word document with its headings, lists, tables and images. Blocks Word has no match for become plain text.',
  }),
])

export const DEFAULT_EXPORT_FORMAT = 'md'

/** The whole notebook in `format`. Markdown keeps its original door (the same archive,
 *  byte for byte); the other formats use the format route. */
export function notebookExportUrl(format) {
  return format === 'md' ? '/api/j2/notes/export' : `/api/j2/export/notebook?format=${encodeURIComponent(format)}`
}

/** One note in `format`, through the format route for every format — its file name is
 *  sent RFC 5987-encoded, so a title outside Latin-1 downloads with its real name. */
export function noteExportUrl(noteId, format) {
  return `/api/j2/export/notes/${encodeURIComponent(noteId)}?format=${encodeURIComponent(format)}`
}

/** The file name the server chose: `filename*` (UTF-8) first, then `filename`. */
export function filenameFromDisposition(header, fallback) {
  const value = header || ''
  const star = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(value)
  if (star) {
    try {
      return decodeURIComponent(star[1].trim())
    } catch {
      // a malformed escape — fall through to the plain name
    }
  }
  const plain = /filename="([^"]+)"/.exec(value)
  return plain ? plain[1] : fallback
}

/** Hand a fetched file to the browser's download manager. */
export async function saveResponse(res, fallbackName) {
  const blob = await res.blob()
  const filename = filenameFromDisposition(res.headers.get('content-disposition'), fallbackName)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Give the click a tick to reach the download manager before the object URL goes.
  setTimeout(() => URL.revokeObjectURL(url), 0)
  return filename
}
