// app/src/pages/journal-2-0/lib/reminderItem.js
// Tier 2 part B, item 12 (R-T2B-12): "/remind". An unticked task whose own line is "Follow up " and
// then the date, chosen in the EXISTING @ list (lib/dateSuggest.js). No new node: a taskItem whose
// own paragraph holds a dateMention is what the Tasks view and the daily task bell already read
// (note_tasks._own_text_and_due). This types "@"; runDateCommand stays the one inserter of the date.
export const REMINDER_LEAD = 'Follow up '

// ⛔ "In a task" means the caret's line IS a task's own paragraph: the block right above it is the taskItem.
// Never `editor.isActive('taskItem')`: that is true anywhere UNDER a task, including a bullet or numbered item
// nested in one, where splitListItem('taskItem') fails while the chain still dispatches, so "Follow up @" landed
// as plain text in that item and its date was no task's due date (final fix C, M6). A nested list item takes the
// not-in-a-task path: the editor's own task-list toggle makes it a task item.
export function caretInTaskLine(state) {
  const $from = state.selection.$from
  return $from.depth >= 1 && $from.node(-1).type.name === 'taskItem'
}

export function insertReminder(editor, range) {
  if (!editor || editor.isDestroyed) return false
  const $from = editor.state.selection.$from
  const inTask = caretInTaskLine(editor.state)
  const left = $from.parent.textContent.length - (range ? range.to - range.from : 0)
  let chain = editor.chain().focus()
  if (range) chain = chain.deleteRange(range)
  if (inTask) {
    if (left > 0) chain = chain.splitListItem('taskItem')
  } else {
    if (left > 0) chain = chain.splitBlock()
    chain = chain.toggleTaskList()
  }
  return chain.insertContent(`${REMINDER_LEAD}@`).run()
}
