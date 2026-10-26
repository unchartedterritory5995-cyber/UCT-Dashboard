// Notebook widgets phase 2, wave 9 (Task 9.19): the ONE insert of a routine or tracker block, shared by the / menu's
// Mine rows (eager), the tool picker and the examples gallery's first step (both lazy). The block is bound to the
// note's day (`editor.storage.uctJournalWidgets.noteDay`, NoteEditorPage), and its search text names the tool and that
// day as written at insert (lib/blocks/toolDays.toolSearchText), because the registry's fixed line cannot.
// Pure over the editor: no network, no state.
// ⚠️ First-open bytes (fix round 1, m-1): Task 9.19 DELIBERATELY brings lib/blocks/toolDays onto the Notebook's first
// open. Before it, toolDays was reached only through lazy modules (RoutineBlock, TrackerBlock, RoutineEditorSheet);
// this file (imported by SlashMenu) and NoteEditorPage's eager `noteDayOf` import now carry it. The brief requires an
// eager `noteDayOf`, and the bytes gate passed with it counted.
import { editorNoteDay, toolSearchText } from './blocks/toolDays'

const KINDS = Object.freeze({
  routine: { idKey: 'routineId', display: 'items', fallback: 'Routine' },
  tracker: { idKey: 'trackerId', display: 'chart', fallback: 'Tracker' },
})

/** The block's params and its search text for `tool` on `noteDay`, or null for an unknown kind or a tool with no id. */
export function toolBlockOf(kind, tool, noteDay) {
  const k = KINDS[kind]
  if (!k || !tool || typeof tool.id !== 'string' || !tool.id) return null
  const name = typeof tool.name === 'string' && tool.name.trim() ? tool.name.trim() : k.fallback
  return {
    params: { [k.idKey]: tool.id, day: noteDay, bind: 'note-day', display: k.display },
    extra: { searchText: toolSearchText(kind, name, noteDay, 'note-day') },
  }
}

/** Fix round 1 (m-2): the sentences when a tool cannot go in because the note can no longer be changed (locked,
 *  read-only, or gone). The first is for a tool that WAS just made (it is kept in My tools); the second for a pick. */
export const TOOL_SAVED_NOT_ADDED = "Saved in My tools. This note can't be changed right now, so it wasn't added here."
export const TOOL_NOT_ADDED = "This note can't be changed right now, so nothing was added."

/** Insert `tool`'s block, and when it cannot go in, say `sentence` in the note's own toast (never silent).
 *  @returns {boolean} whether it went in */
export function placeTool(editor, kind, tool, sentence) {
  if (insertToolBlock(editor, kind, tool)) return true
  try { editor?.storage?.uctJournalWidgets?.notify?.(sentence, 'error') } catch { /* the note's toast is its own */ }
  return false
}

/** Insert `tool`'s block at the caret (replacing the typed `range` when given). A note that cannot be written (gone,
 *  read-only) gets nothing. @returns {boolean} whether it went in */
export function insertToolBlock(editor, kind, tool, range = null) {
  if (!editor || editor.isDestroyed || editor.isEditable === false || typeof editor.chain !== 'function') return false
  const block = toolBlockOf(kind, tool, editorNoteDay(editor))
  if (!block) return false
  const chain = editor.chain().focus()
  return (range ? chain.deleteRange(range) : chain).insertWidgetEmbed(kind, block.params, block.extra).run() !== false
}
