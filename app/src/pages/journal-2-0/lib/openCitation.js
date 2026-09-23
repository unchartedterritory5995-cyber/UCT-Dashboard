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

export const PASSAGE_GONE = 'That passage is no longer available.'
export const PASSAGE_UNREADABLE = "Couldn't open that passage — try again."
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
export async function openExcerptCitation(excerptId, { signal, openDocument, openCapturedSource }) {
  if (!excerptId) return SOURCE_NOWHERE
  const r = await resolveExcerpt(excerptId, { signal })
  // ⛔ ONE GUARD, HERE, AFTER THE READ -- whatever it returned, an aborted
  // AbortError included: a later tap owns the panel now, so open nothing and
  // say nothing. (One copy, so a mutation can prove it; three would not.)
  if (signal?.aborted) return null
  if (r.kind === 'document') { openDocument(r.target); return null }
  if (r.kind === 'captured_source') { openCapturedSource(r.excerpt); return null }
  if (r.kind === 'gone') return PASSAGE_GONE
  if (r.kind === 'nowhere') return SOURCE_NOWHERE
  if (r.error) console.error('[notebook] opening a saved excerpt failed', r.error)
  return PASSAGE_UNREADABLE
}

/**
 * The citation router for a scope that SPANS notes ("My Notebook", "This
 * research"): an excerpt opens in place, anything that names its note opens
 * that note, and a source with neither says so.
 *
 * @returns {Promise<string|null>|string|null} what AskPanel's `onNavigate`
 *          returns -- a sentence when nothing could be opened.
 */
export function openSpanningCitation(source, { signal, openNote, openDocument, openCapturedSource }) {
  const nav = source?.navigation || {}
  if (nav.kind === 'excerpt') {
    return openExcerptCitation(nav.excerpt_id, { signal, openDocument, openCapturedSource })
  }
  if (nav.note_id) {
    openNote({ id: nav.note_id })
    return null
  }
  return SOURCE_NOWHERE
}
