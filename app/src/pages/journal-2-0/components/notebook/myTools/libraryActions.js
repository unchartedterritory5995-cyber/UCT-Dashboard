// Notebook widgets phase 2, wave 11 (Task 11.19): the library actions every My tools tab shares. "Share to library"
// opens the share preview (Task 11.15); "Update from the library" takes the listed version of a copy (Task 11.8's
// `update_tool`), and when that version asks a new question it opens "Make it yours" (Task 11.17) for the copy.
//
// ⛔ LAZY. Only the My tools tabs import this file (and only openMyTools.js, a dynamic import, reaches them). The two
// sheets are reached by dynamic import here, so neither is in My tools' own chunk until a member presses the action.
import { widgetsWaveOn } from '../../../lib/notebookWidgetsFlags'
import { styleLibraryEnabled } from '../../../lib/styleLibraryFlag'
import { updateTool } from '../../../lib/templateLibrary'
import { LIBRARY_ACTIONS } from './myToolsLib'

/** The library doors show only while wave 11 AND the library switch are on (either off, every route is a 404). */
export const libraryOn = () => widgetsWaveOn(11) && styleLibraryEnabled()

/** "Share to library": the share preview for the member's own `kind` item. `onDone(sentence)` once it was sent for
 *  review. Resolves `{ok: true}`, or `{ok: false, text}` when the sheet's chunk could not load. */
export async function openShare({ kind, id, onDone }) {
  try {
    const mod = await import('../library/openSharePreview.js')
    mod.openSharePreview({ kind, id, onDone })
    return { ok: true }
  } catch {
    return { ok: false, text: LIBRARY_ACTIONS.shareFailed }
  }
}

/** Whether a library update needs the member's answers first: the server refuses with `unresolved` (Task 11.8's
 *  refusal class for an unanswered "pick yours" choice), or answers `needsAnswers: true`. */
const needsAnswers = (got) => (got.ok ? got.data?.needsAnswers === true : got.code === 'unresolved')

/**
 * "Update from the library" for copy `d` (a widget, routine or tracker the member adopted). Resolves:
 *   `{ok: true, text}`        the copy took the listed version;
 *   `{ok: true, opened: true}` the new version asks a question: "Make it yours" is open for it;
 *   `{ok: false, text, code}` the server's sentence (or the client's when there is none).
 * `onSheetDone()` runs once the opened sheet finished.
 */
export async function takeUpdate({ kind, d, onSheetDone }) {
  const got = await updateTool(kind, d.id, {})
  if (!needsAnswers(got)) {
    if (got.ok) return { ok: true, text: LIBRARY_ACTIONS.updated(d.name) }
    return { ok: false, code: got.code, text: got.message }
  }
  try {
    const mod = await import('../library/openAdoptSheet.js')
    // Mode 'update': the sheet's Use takes the version into THIS copy (`updateTool`), never a fresh adoption.
    mod.openAdoptSheet({
      galleryId: d.sourceGalleryId, kind, mode: 'update', copyId: d.id,
      onDone: () => onSheetDone?.(),
    })
    return { ok: true, opened: true }
  } catch {
    return { ok: false, text: LIBRARY_ACTIONS.updateFailed }
  }
}
