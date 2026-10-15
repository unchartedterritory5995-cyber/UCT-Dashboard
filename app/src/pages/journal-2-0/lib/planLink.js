// app/src/pages/journal-2-0/lib/planLink.js
/**
 * Tier 2 part A, item 9 -- what "/plan NVDA" does once the press is allowed: make the Trade plan through the one
 * create door (lib/planCreate.js, landed with settleNoteWrite) and link it at the caret as an editor transaction.
 * LAZY: the editor page imports this only at the press (`await import`), so opening a note pays for none of it (I5).
 *
 * The editor and the lock are read AFTER the create returns (`liveEditor()` / `isLocked()`), because the member may
 * have locked the note or left it while the create was in flight; the link then is not inserted, and the sentence
 * says the plan exists. Returns `{ message, tone }` for the page's toast, or null when there is nothing to say. A
 * failed create throws (the page says nothing was saved).
 */
import { mutate as globalMutate } from 'swr'
import { createPlanNote } from './planCreate'

export async function createAndLinkPlan({ symbol, folderId, liveEditor, isLocked }) {
  const created = await createPlanNote({ symbol, folderId })
  const live = liveEditor()
  if (created?.id && live && !live.isDestroyed && live.isEditable && !isLocked()) {
    live.chain().focus().insertContent([
      { type: 'noteLink', attrs: { noteId: created.id } }, { type: 'text', text: ' ' },
    ]).run()
    globalMutate((key) => typeof key === 'string' && key.startsWith('/api/j2/notes'))
    return { message: `Trade plan for ${symbol} created and linked. Open it from the link.`, tone: 'success' }
  }
  if (created?.id) return { message: `Trade plan for ${symbol} created. This note could not take the link.`, tone: 'error' }
  return null
}
