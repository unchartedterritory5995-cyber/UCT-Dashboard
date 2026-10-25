// Notebook widgets phase 2, wave 9 (Task 9.19): the ONE insert of a routine or tracker block, shared by the / menu's
// Mine rows (eager), the tool picker and the examples gallery's first step (both lazy). The block is bound to the
// note's day (`editor.storage.uctJournalWidgets.noteDay`, NoteEditorPage), and its search text names the tool and that
// day as written at insert (lib/blocks/toolDays.toolSearchText), because the registry's fixed line cannot.
// Pure over the editor: no network, no state. lib/blocks/toolDays is already on the Notebook's first open
// (widgetEmbedCore imports it), so this file adds no new module to it.
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

/** Insert `tool`'s block at the caret (replacing the typed `range` when given). A note that cannot be written (gone,
 *  read-only) gets nothing. @returns {boolean} whether it went in */
export function insertToolBlock(editor, kind, tool, range = null) {
  if (!editor || editor.isDestroyed || editor.isEditable === false || typeof editor.chain !== 'function') return false
  const block = toolBlockOf(kind, tool, editorNoteDay(editor))
  if (!block) return false
  const chain = editor.chain().focus()
  return (range ? chain.deleteRange(range) : chain).insertWidgetEmbed(kind, block.params, block.extra).run() !== false
}
