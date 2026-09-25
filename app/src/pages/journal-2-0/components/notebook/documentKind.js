// Wave 7 lane G (G4) — which viewer a document opens in, decided from its URL.
//
// ⛔ WHY THE URL, AND WHY THAT IS NOT A SECOND AUTHORITY. `DocumentPreviewSheet`'s
// three mounts (NoteEditorPage, ResearchHome, TickerResearchWorkspace) hand it an
// attachment URL and a document id — never a kind — and the wave-7 ruling keeps
// those mounts unchanged. The server makes the URL say what the row is:
// `document_extraction.on_attachment_saved` creates an image row only for an
// `/inline/<hash>.<png|jpg|gif|webp>` URL (the extension is derived from the
// validated content type) and a docx row only for a URL that really ends in
// `.docx`. So for every row this wave can create, the URL and `source_kind`
// agree by construction; this file reads that projection, it does not guess.
//
// ⛔ THE DEFAULT IS THE PDF VIEWER. Anything this cannot identify — every PDF,
// every row written before wave 7 — opens exactly as it did before.

export const DOCUMENT_KIND_PDF = 'pdf'
export const DOCUMENT_KIND_IMAGE = 'image'
export const DOCUMENT_KIND_DOCX = 'docx'

// Byte-identical in shape to the server's `notes_export._ATTACHMENT_URL_RE`.
const ATTACHMENT_HREF_RE = /^\/api\/j2\/notes\/attachments\/([^/]+)\/([^/]+)\/(hero|inline|file)\/([^/?#]+)$/
const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp)$/i
const DOCX_EXT_RE = /\.docx$/i

/** `{userId, noteId, sub, filename}` for an authenticated attachment URL, or null. */
export function parseAttachmentHref(href) {
  if (typeof href !== 'string') return null
  const m = ATTACHMENT_HREF_RE.exec(href)
  if (!m) return null
  return { userId: m[1], noteId: m[2], sub: m[3], filename: m[4] }
}

/** The viewer this document opens in. */
export function documentKindFromHref(href) {
  const p = parseAttachmentHref(href)
  if (!p) return DOCUMENT_KIND_PDF
  if (p.sub === 'inline' && IMAGE_EXT_RE.test(p.filename)) return DOCUMENT_KIND_IMAGE
  if (p.sub === 'file' && DOCX_EXT_RE.test(p.filename)) return DOCUMENT_KIND_DOCX
  return DOCUMENT_KIND_PDF
}

/**
 * The note's document row for this preview — by id when the mount knows it,
 * else by the attachment URL (the row's natural key). Reads the SAME list the
 * editor already reads (`GET /api/j2/notes/{noteId}/documents`), so status and
 * page counts come from the server's page truth, never from a guess here.
 */
export async function fetchDocumentRow({ href, documentId, signal } = {}) {
  const p = parseAttachmentHref(href)
  if (!p) return null
  const r = await fetch(`/api/j2/notes/${encodeURIComponent(p.noteId)}/documents`, {
    credentials: 'include', signal,
  })
  if (!r.ok) throw new Error(`documents ${r.status}`)
  const d = await r.json()
  const rows = Array.isArray(d?.documents) ? d.documents : []
  return rows.find((row) => (documentId ? row.id === documentId : row.attachmentUrl === href))
    || rows.find((row) => row.attachmentUrl === href)
    || null
}

/** One page's text, as the server holds it, or null when the page does not exist. */
export async function fetchPageText(documentId, pageNumber, { signal } = {}) {
  const r = await fetch(
    `/api/j2/notes/documents/${encodeURIComponent(documentId)}/pages/${pageNumber}/text`,
    { credentials: 'include', signal },
  )
  if (r.status === 404) return null
  if (!r.ok) throw new Error(`page text ${r.status}`)
  return r.json()
}
