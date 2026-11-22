// Audit 2026-11-05, spec S9 (M8): the Template library's one-press Use and its "Customize first", shared by a library
// card (TemplateLibrarySection.jsx) and a template's detail (TemplateDetailSheet.jsx) -- ONE door, never two.
//
// `useLibraryTemplate(item, {startEveryWeekday, landNote, navigate})` makes the note at once (oneStepUse.js), then
// lands it through the host (`landNote`: the New note sheet closes and every note view is told, invalidateNoteViews
// via landCreatedNote) or, with no host, tells every note view itself and opens the note. A choice that needs the
// member opens Customize first instead. It answers the sentence to show, or '' when there is none.
// ⛔ LAZY. Imported only by the two lazy library surfaces above.
import { invalidateNoteViews } from '../../../lib/offline/invalidateNoteViews'
import { openNoteInPlace, noteHref } from '../../../lib/noteHref'
import { doorLostSentence } from '../../../lib/notebookWidgetsFlags'
import { CUSTOMIZE_FIRST, START_EVERY_WEEKDAY, useTemplateNow } from './oneStepUse'

// S7 (one vocabulary): one word for making a note from a template.
export const USE_LABEL = 'Use'
export const CUSTOMIZE_LABEL = CUSTOMIZE_FIRST
export const START_LABEL = START_EVERY_WEEKDAY
export const MAKING_SENTENCE = 'Making your note…'
export const USE_FAILED = "That didn't go through. Try again."

const isRecord = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const text = (v) => (typeof v === 'string' ? v : '')

/** "Customize first": the adoption sheet, with every choice, for this template. Answers '' or the lost-door line. */
export async function openCustomize(item, { landNote = null, navigate = null } = {}) {
  try {
    const mod = await import('./openAdoptSheet')
    mod.openAdoptSheet({ galleryId: item.id, kind: 'template', name: text(item.title),
      ...(typeof navigate === 'function' ? { navigate } : {}), ...(typeof landNote === 'function' ? { landNote } : {}) })
    return ''
  } catch {
    return doorLostSentence()
  }
}

export async function useLibraryTemplate(item, { startEveryWeekday = false, landNote = null, navigate = null } = {}) {
  const out = await useTemplateNow(item.id, { name: text(item.title), startEveryWeekday })
  if (out.ok) {
    const note = isRecord(out.data?.note) ? out.data.note : null
    if (!note || note.id == null || note.id === '') return ''
    if (typeof landNote === 'function') { landNote(note); return '' }
    // No host to land it: every list and count is told here (spec S6's one helper), then the note opens.
    invalidateNoteViews({ tags: true })
    if (typeof navigate === 'function') navigate(noteHref(note.id))
    else openNoteInPlace({ button: 0, preventDefault() {} }, note.id)
    return ''
  }
  if (out.customize) return openCustomize(item, { landNote, navigate })
  return text(out.message) || USE_FAILED
}
