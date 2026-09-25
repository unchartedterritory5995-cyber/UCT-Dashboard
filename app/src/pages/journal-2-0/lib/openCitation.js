// ⛔⛔ ONE WAY TO OPEN AN ASK CITATION THAT NAMES A SAVED EXCERPT.
//
// ⚰️ THE DEFECT. Ask cites a saved excerpt with
// `navigation = {kind:'excerpt', excerpt_id, document_id, page_number}` -- no
// `note_id` -- and three of the four Ask hosts answered it with a dead click:
// "This research" and "My Notebook" only knew `note_id`, and the note editor's
// `jumpToCitation` fell through its `kind !== 'note'` guard. The note editor
// ALREADY knew how to open an excerpt by id (`handleOpenExcerptSource`, for a
// thesis evidence row); the first fix copied that transport into a second host,
// and the two copies disagreed within a day (one silent on failure, one not).
//
// ⭐ So there is one transport, here, and every host goes through it:
//   GET /api/j2/excerpts/{id} (the excerpt carries its document's URL and its
//   owning note) → `excerptRevisitTarget` (the ONE rule for where an excerpt
//   may truthfully land, Wave N §9) → the host's own document preview, or its
//   captured-passage sheet for a web capture -- never a PDF viewer over a
//   `web:<sha256>` identity.
//
// ⛔ THE LAST TAP WINS. Every opener takes the `signal` AskPanel hands
// `onNavigate` and aborts when the member taps again: the read is cancelled, and
// a result that lands after all is DROPPED rather than opening a sheet over the
// one the member asked for second.
//
// ⛔ AND NOTHING IS SILENT. Every path that does not open something returns the
// sentence AskPanel shows inside itself (the panel is the one surface the
// member is certain to be looking at -- on touch it is a modal Sheet). A
// deleted passage and a failed read are different facts and say different
// things: telling a member their passage is gone because the network blinked
// is a lie they would act on.

import { excerptRevisitTarget } from './searchNavigation'
import { SOURCE_WEB, SOURCE_ATTACHMENT } from './searchResultLabel'

export const PASSAGE_GONE = 'That passage is no longer available.'
export const PASSAGE_UNREADABLE = "Couldn't open that passage — try again."
export const DOCUMENT_GONE = 'That document is no longer available.'
export const DOCUMENT_UNREADABLE = "Couldn't open that document — try again."
export const SOURCE_NOWHERE = "That source can't be opened from here."
// The note editor ("This note"): a citation whose passage the LIVE doc can no
// longer verify, and one the server only ever promised at note level (a thesis
// state, a note-only block). Two different facts, so two sentences.
export const PASSAGE_NOT_PINPOINTED = "That passage can't be pinpointed any more — the note has changed since this answer."
export const NOTE_LEVEL_SOURCE = 'That source is this note as a whole, not one passage in it.'

/**
 * Where one saved excerpt may truthfully land.
 *
 * @returns {Promise<{kind:'document', target:object, excerpt:object}
 *                  |{kind:'captured_source', excerpt:object}
 *                  |{kind:'gone'}|{kind:'nowhere', excerpt:object}
 *                  |{kind:'failed', error?:unknown}>}
 */
export async function resolveExcerpt(excerptId, { signal } = {}) {
  let res
  try {
    res = await fetch(`/api/j2/excerpts/${encodeURIComponent(excerptId)}`,
                      signal ? { credentials: 'include', signal } : { credentials: 'include' })
  } catch (error) {
    return { kind: 'failed', error }
  }
  // The route 404s when the excerpt OR its document row is gone (an INNER
  // JOIN, scoped to the member), so this is the one answer that means "gone".
  if (res.status === 404) return { kind: 'gone' }
  if (!res.ok) return { kind: 'failed' }
  let excerpt
  try {
    excerpt = (await res.json())?.excerpt || null
  } catch (error) {
    return { kind: 'failed', error }
  }
  const target = excerptRevisitTarget(excerpt)
  // ⛔ A READ THAT SUCCEEDED AND NAMES NOWHERE IS NOT "TRY AGAIN". Retrying
  // returns the same excerpt with the same missing destination, so telling the
  // member to try again sends them round a loop that cannot close.
  if (!target) return { kind: 'nowhere', excerpt }
  if (target.kind === 'captured_source') return { kind: 'captured_source', excerpt }
  return { kind: 'document', target: { ...target, emphasizeExcerpt: excerpt }, excerpt }
}

/**
 * Open one saved excerpt in the host's own sheets.
 *
 * `openDocument(previewDoc)` receives the `previewDoc` shape every
 * DocumentPreviewSheet host already uses (`{href, name, documentId, page,
 * emphasizeExcerptId, emphasizeExcerpt}`); `openCapturedSource(excerpt)` the
 * excerpt a CapturedSourceSheet renders.
 *
 * @returns {Promise<string|null>} null when something opened, else the
 *          sentence to show.
 */
export function openExcerptCitation(excerptId, { signal, openDocument, openCapturedSource }) {
  if (!excerptId) return Promise.resolve(SOURCE_NOWHERE)
  return settle(resolveExcerpt(excerptId, { signal }), signal, (r) => {
    if (r.kind === 'document') { openDocument(r.target); return null }
    if (r.kind === 'captured_source') { openCapturedSource(r.excerpt); return null }
    if (r.kind === 'gone') return PASSAGE_GONE
    if (r.kind === 'nowhere') return SOURCE_NOWHERE
    if (r.error) console.error('[notebook] opening a saved excerpt failed', r.error)
    return PASSAGE_UNREADABLE
  })
}

// ⛔ ONE GUARD, HERE, AFTER EVERY READ -- whatever the read returned, an
// aborted AbortError included: a later tap owns the panel now, so open nothing
// and say nothing. Both reads (an excerpt, a cited document) settle through
// this one copy, so one mutation proves it for both; a copy per opener would
// not be provable at all.
async function settle(read, signal, land) {
  const r = await read
  if (signal?.aborted) return null
  return land(r)
}

/**
 * Where one cited PDF page may land: the owning note's own document list
 * carries the file's URL (`DocumentPreviewSheet` takes `href` from its host;
 * the navigation deliberately does not carry it).
 *
 * @returns {Promise<{kind:'document', target:object, doc:object, page:number|null}
 *                  |{kind:'web', doc:object, page:number|null}|{kind:'gone'}
 *                  |{kind:'missing'}|{kind:'failed', error?:unknown}>}
 *          `gone`: the note itself is gone (404). `missing`: the note answered
 *          and no longer holds this document, or holds no file for it -- two
 *          different facts. `web`: the row is a captured web page.
 *
 * ⛔ A CAPTURED WEB PAGE IS NEVER A VIEWER TARGET. It is a row of the same
 * list, and its `attachmentUrl` is an identity (`web:<sha256>`), not a file:
 * handing it to DocumentPreviewSheet is Wave N §9's fake viewer. The list's
 * `sourceKind` is the ONE server rule (`document_source_kind`), so the row is
 * returned as `web`, never as a `target`, and the host decides where it lands.
 */
export async function resolveDocumentPage(nav, { signal } = {}) {
  let res
  try {
    res = await fetch(`/api/j2/notes/${encodeURIComponent(nav.note_id)}/documents`,
                      signal ? { credentials: 'include', signal } : { credentials: 'include' })
  } catch (error) {
    return { kind: 'failed', error }
  }
  // The note is gone (or not the member's): so is its document.
  if (res.status === 404) return { kind: 'gone' }
  if (!res.ok) return { kind: 'failed' }
  let documents
  try {
    documents = (await res.json())?.documents || []
  } catch (error) {
    return { kind: 'failed', error }
  }
  const doc = documents.find((d) => d.id === nav.document_id)
  if (!doc || !doc.attachmentUrl) return { kind: 'missing' }
  const n = Number(nav.page_number)
  const page = Number.isFinite(n) && n > 0 ? n : null
  if (doc.sourceKind === SOURCE_WEB) return { kind: 'web', doc, page }
  return {
    kind: 'document',
    doc,
    page,
    target: {
      href: doc.attachmentUrl, name: doc.name || null, documentId: doc.id,
      ...(page ? { page } : {}),
    },
  }
}

/**
 * Open a cited PDF page in the host's own DocumentPreviewSheet.
 *
 * A note that answered but no longer holds the document (`missing`) opens the
 * owning NOTE when the host can (`openNote`) and that note is not the one
 * already open (`hereNoteId`) -- the member lands somewhere useful, as they did
 * before pages were reachable (owner ruling). Otherwise, and when the note
 * itself is gone, it says the document is no longer available. "Try again" is
 * kept for a read that FAILED, and only for that.
 *
 * ⛔ A host with its own door for a row (`openRow(doc, {page})` -- the note
 * editor's `openNoteDocument`) is handed the FRESH row, whatever its kind: that
 * door sends a captured page to its passage and a PDF to its page, so a row the
 * host's cached list had not caught up with is routed exactly like one it had.
 * A host with no such door never gets a captured row as a viewer target: it
 * opens the row's note, or says it cannot open it from here.
 */
export function openDocumentPage(nav, {
  signal, openDocument, openNote = null, hereNoteId = null, openRow = null,
}) {
  if (!nav?.note_id || !nav?.document_id) return Promise.resolve(SOURCE_NOWHERE)
  // ONE copy of "may this host open the owning note": never the note that is
  // already open (`hereNoteId`) -- "opening" it would change nothing on screen,
  // which is a silent click.
  const openedOwningNote = () => {
    if (!openNote || nav.note_id === hereNoteId) return false
    openNote({ id: nav.note_id })
    return true
  }
  return settle(resolveDocumentPage(nav, { signal }), signal, (r) => {
    if (openRow && (r.kind === 'document' || r.kind === 'web')) return openRow(r.doc, { page: r.page })
    if (r.kind === 'document') { openDocument(r.target); return null }
    if (r.kind === 'web') return openedOwningNote() ? null : SOURCE_NOWHERE
    if (r.kind === 'missing' && openedOwningNote()) return null
    if (r.kind === 'gone' || r.kind === 'missing') return DOCUMENT_GONE
    if (r.error) console.error('[notebook] opening a cited document failed', r.error)
    return DOCUMENT_UNREADABLE
  })
}

function openOwningNote(nav, openNote) {
  if (!nav?.note_id || !openNote) return SOURCE_NOWHERE
  openNote({ id: nav.note_id })
  return null
}

/**
 * ⛔⛔ A CITED DOCUMENT PAGE OPENS WHERE ITS KIND SAYS -- AND ONLY THE SERVER
 * SAYS WHAT KIND IT IS.
 *
 * ⚰️ Every Ask host opened a cited document page's owning note at the top, so
 * "Q3 10-Q · p.47" dropped the member at a note and left them to find page 47.
 * The navigation named the page but not whether a PDF viewer could show it: a
 * captured web passage is ALSO a document page, and a PDF viewer over its
 * `web:<sha256>` identity is Wave N §9's defect.
 *
 * ⭐ The server now sends `source_kind`, decided by `ask_evidence.is_web_capture`
 * (through `document_source_kind`) -- the ONE server rule for "is this a
 * captured web page", which the note's document list, the excerpt read
 * (`sourceKind`) and both Search sections also project, so no two surfaces can
 * disagree about one row:
 *   - `attachment` -> the host's DocumentPreviewSheet, at `page_number`
 *     (`openPage` when the host already has its own page route);
 *   - `web` -> the captured passage, through the excerpt `capture_web_source`
 *     wrote beside it (`excerpt_id`) -- the excerpt path's CapturedSourceSheet,
 *     never the PDF viewer; with no excerpt left, the owning note (and when
 *     that note is the one already open, `hereNoteId`, it says so instead);
 *   - anything else, absent included (a packet from before the server sent
 *     it) -> the host's behaviour from before (`legacy`, else the owning note).
 *     Never a guess: calling an unknown page a PDF is how a captured passage
 *     reached the PDF viewer. So this never routes an unknown kind to the
 *     viewer itself, and a `legacy` route that reads the note's list gets a
 *     captured row back as `web`, never as a viewer target
 *     (`resolveDocumentPage`).
 *
 * @returns {Promise<string|null>|string|null} what AskPanel's `onNavigate`
 *          returns -- a sentence when nothing could be opened.
 */
export function openDocumentCitation(nav, {
  signal, openNote, openDocument, openCapturedSource, openPage, legacy, hereNoteId = null,
}) {
  const kind = nav?.source_kind
  if (kind === SOURCE_WEB) {
    if (nav.excerpt_id) return openExcerptCitation(nav.excerpt_id, { signal, openDocument, openCapturedSource })
    if (hereNoteId && nav.note_id === hereNoteId) return PASSAGE_GONE
    return openOwningNote(nav, openNote)
  }
  if (kind === SOURCE_ATTACHMENT) {
    return openPage ? openPage(nav) : openDocumentPage(nav, { signal, openDocument, openNote, hereNoteId })
  }
  return legacy ? legacy(nav) : openOwningNote(nav, openNote)
}

/**
 * The citation router for a scope that SPANS notes ("My Notebook", "This
 * research"): an excerpt opens in place, a document page opens by its kind,
 * anything else that names its note opens that note, and a source with none of
 * those says so.
 *
 * @returns {Promise<string|null>|string|null} what AskPanel's `onNavigate`
 *          returns -- a sentence when nothing could be opened.
 */
export function openSpanningCitation(source, { signal, openNote, openDocument, openCapturedSource }) {
  const nav = source?.navigation || {}
  if (nav.kind === 'excerpt') {
    return openExcerptCitation(nav.excerpt_id, { signal, openDocument, openCapturedSource })
  }
  if (nav.kind === 'document') {
    return openDocumentCitation(nav, { signal, openNote, openDocument, openCapturedSource })
  }
  return openOwningNote(nav, openNote)
}
