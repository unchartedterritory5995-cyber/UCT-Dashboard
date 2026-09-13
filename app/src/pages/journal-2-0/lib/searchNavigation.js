// ⛔⛔ SEARCH RESULT IDENTITY MUST MATCH SEARCH RESULT DESTINATION (Wave M §4).
//
// ⚰️ THE DEFECT. Every search section — note, document page, saved excerpt —
// ended at `onOpenNote({ id: noteId })`. So Search could correctly say
// "NVDA 10-Q · p.47" and then drop the member at the top of a note, leaving
// them to find page 47 themselves. A result that names a thing and navigates
// somewhere else is only half a retrieval system.
//
// ⭐ THIS IS NOT A SECOND NAVIGATION SYSTEM (§5). It composes the two contracts
// that already exist:
//   · the note is opened by the SAME `?note=<id>` search param `NotebookTab`
//     already owns, so Search uses the app's one routing idiom;
//   · the document is targeted through the SAME `previewDoc` shape Wave J's
//     click-to-source already uses — `{ documentId, page, emphasizeExcerptId }`
//     handed to `DocumentPreviewSheet`, which drives `PdfDocumentViewer`'s
//     `scrollToPage` / `emphasizeExcerpt`.
// Anything reached from Search therefore lands exactly where the same object
// lands when reached from a citation, which is the convergence §5 asks for.
//
// ⛔ AND IT REFUSES TO INVENT AN ANCHOR IT CANNOT HONOUR. A captured web source
// has no viewer: its `attachment_url` is `web:<sha256>`, an identity string, not
// a file, and nothing in the product renders one. So a web hit navigates to the
// owning note and says so — see `navigationDepth` below, which is what lets the
// UI label the honest destination instead of implying a page it cannot reach.

import { SOURCE_WEB } from './searchResultLabel'

/** Deep-link params. Named for what they target, and read by NotebookTab. */
export const PARAM_NOTE = 'note'
export const PARAM_DOC = 'doc'
export const PARAM_PAGE = 'page'
export const PARAM_EXCERPT = 'excerpt'
/** ⭐ O6 §4. A completed review lives INSIDE its thesis note, in the review
 *  panel's history — not in a document viewer. So the deepest truthful
 *  destination for a review hit is that note with the review anchored, which is
 *  a fifth param on the SAME `?note=` routing contract, never a second router. */
export const PARAM_REVIEW = 'review'

/** How deeply we can truthfully navigate for a given hit.
 *  'page'    — a real paginated document: we can reach the page.
 *  'excerpt' — a saved excerpt inside one: we can reach and emphasise it.
 *  'review'  — a completed review: we can reach and emphasise it in the
 *              thesis's own review history.
 *  'note'    — the honest floor: the owning note, and nothing deeper exists. */
export function navigationDepth(row = {}, { kind = 'page' } = {}) {
  if (!row || !row.noteId) return null
  // ⛔ FIRST, AND WITHOUT CONSULTING sourceKind/documentId. A review has no
  // document and no page; falling through would classify it by the absence of
  // fields it was never going to have and land the member at the top of the
  // note — the exact half-retrieval this module exists to close.
  if (kind === 'review') return row.reviewId ? 'review' : 'note'
  // ⛔ A web capture is 'note' REGARDLESS of the kind of row it arrived on.
  // Its page_number is a capture ordinal and there is no viewer to scroll.
  if (row.sourceKind === SOURCE_WEB) return 'note'
  if (kind === 'excerpt' && row.excerptId) return 'excerpt'
  const page = Number(row.pageNumber)
  if (row.documentId && Number.isFinite(page) && page > 0) return 'page'
  return 'note'
}

/**
 * The navigation target for one search hit — the object the RESULT claimed.
 *
 * @returns {{noteId: string, documentId?: string, page?: number,
 *            excerptId?: string, depth: 'note'|'page'|'excerpt'}|null}
 */
export function searchResultTarget(row = {}, { kind = 'page' } = {}) {
  const depth = navigationDepth(row, { kind })
  if (!depth) return null
  const target = { noteId: row.noteId, depth }
  if (depth === 'note') return target
  if (depth === 'review') {
    target.reviewId = row.reviewId
    return target
  }
  target.documentId = row.documentId
  const page = Number(row.pageNumber)
  if (Number.isFinite(page) && page > 0) target.page = page
  if (depth === 'excerpt') target.excerptId = row.excerptId
  return target
}

/** Fold a target into the URL params `NotebookTab` already routes on.
 *  ⛔ Always CLEARS the deeper params when they do not apply, so a second
 *  search click cannot inherit the previous hit's page. */
export function applyTargetToParams(params, target) {
  const next = new URLSearchParams(params)
  for (const p of [PARAM_DOC, PARAM_PAGE, PARAM_EXCERPT, PARAM_REVIEW]) next.delete(p)
  if (!target) return next
  next.set(PARAM_NOTE, target.noteId)
  if (target.documentId) next.set(PARAM_DOC, target.documentId)
  if (target.page) next.set(PARAM_PAGE, String(target.page))
  if (target.excerptId) next.set(PARAM_EXCERPT, target.excerptId)
  if (target.reviewId) next.set(PARAM_REVIEW, target.reviewId)
  return next
}

/** ⭐ O6: read a review anchor back out of the URL.
 *  ⛔ A SEPARATE READER FROM `targetFromParams`, on purpose. That one answers
 *  "which document page should the viewer open", returns null without a
 *  documentId, and is consumed by the preview sheet. A review is not a document
 *  and must not be routed through a viewer that would then have nothing to
 *  show — the same refusal `excerptRevisitTarget` makes for a web capture. */
export function reviewTargetFromParams(params) {
  const get = (k) => (params && typeof params.get === 'function' ? params.get(k) : null)
  const reviewId = get(PARAM_REVIEW)
  return reviewId ? { reviewId } : null
}

/** Read a target back out of the URL — what the editor acts on. */
export function targetFromParams(params) {
  const get = (k) => (params && typeof params.get === 'function' ? params.get(k) : null)
  const documentId = get(PARAM_DOC)
  if (!documentId) return null
  const page = Number(get(PARAM_PAGE))
  return {
    documentId,
    page: Number.isFinite(page) && page > 0 ? page : null,
    excerptId: get(PARAM_EXCERPT) || null,
  }
}

/**
 * ⛔⛔ WAVE N §9 — WHERE "REVISIT THIS EVIDENCE" MAY TRUTHFULLY LAND.
 *
 * ⚰️ The thesis evidence click path gated on `attachmentUrl` alone and handed
 * whatever it found to the PDF viewer. A captured web source HAS one —
 * `web:<sha256>`, an identity string, not a file — so a captured Reuters
 * paragraph opened a fullscreen document viewer over a non-URL, offering
 * "Open in new tab" and "Download" of a thing that is not a document.
 *
 * ⭐ The depth rule above already had the answer and Search already obeyed it.
 * This is the same decision expressed for one excerpt, so the two surfaces
 * cannot disagree about one object — and it is a PURE function so the rule can
 * be railed without mounting the editor.
 *
 * @returns {{kind:'captured_source', noteId:string}
 *          |{kind:'document', href:string, name:?string, documentId:string,
 *            page:?number, emphasizeExcerptId:string}
 *          |null}
 */
export function excerptRevisitTarget(excerpt) {
  if (!excerpt || !excerpt.attachmentUrl) return null
  const depth = navigationDepth({
    noteId: excerpt.noteId,
    documentId: excerpt.documentId,
    pageNumber: excerpt.pageNumber,
    excerptId: excerpt.id,
    sourceKind: excerpt.sourceKind,
  }, { kind: 'excerpt' })
  if (!depth) return null
  if (depth === 'note') return { kind: 'captured_source', noteId: excerpt.noteId }
  return {
    kind: 'document',
    href: excerpt.attachmentUrl,
    name: excerpt.documentName || null,
    documentId: excerpt.documentId,
    page: excerpt.pageNumber,
    emphasizeExcerptId: excerpt.id,
  }
}

/** Where an ASK CITATION should land, in the same `?note=&doc=&page=` shape
 *  Search already uses.
 *
 *  ⚰️ WAVE P3 §12 — THIS EXISTS BECAUSE A CITED DOCUMENT PAGE WENT NOWHERE.
 *  The note editor's citation handler knew about reviews and about the note
 *  body and returned silently for `kind: 'document'`, so Ask could say
 *  "q3-filing.pdf · p.1", the member could click it, and nothing happened.
 *  Search reached the page in Wave M; the Ask citation never learned the same
 *  contract. Found by driving the real UI — every unit rail asserts a target,
 *  and none of them clicks the row.
 *
 *  ⛔ ONE CONTRACT, NOT AN OCR-SPECIFIC ONE. A scanned page opens exactly the
 *  way a native page does; that is what keeps the ORIGINAL page authoritative
 *  rather than the text we derived from it.
 *
 *  @param source  a public source from the Ask `sources` event
 *  @param fallbackNoteId  the note the host is already showing, used only when
 *         the evidence cannot name its own (a scope that spans notes always can)
 *  @returns a target for `applyTargetToParams`, or null when it cannot say
 *           where to go — in which case navigate NOWHERE rather than guessing.
 */
export function citationTarget(source, { fallbackNoteId = null } = {}) {
  const nav = source && source.navigation
  if (!nav) return null
  if (nav.kind === 'review') {
    return nav.note_id && nav.review_id
      ? { noteId: nav.note_id, reviewId: nav.review_id, depth: 'review' }
      : null
  }
  if (nav.kind !== 'document') return null
  const noteId = nav.note_id || fallbackNoteId
  if (!noteId || !nav.document_id) return null
  const page = Number(nav.page_number)
  return {
    noteId,
    documentId: nav.document_id,
    ...(Number.isFinite(page) && page > 0 ? { page } : {}),
    depth: 'page',
  }
}
