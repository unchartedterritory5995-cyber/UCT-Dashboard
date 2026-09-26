/**
 * Wave 7 lane H (H1) — dictated words go into the note at the caret, as ONE
 * undoable step.
 *
 * The toolbar mic and the slash menu's "Dictate" item both end here: the mic is
 * `components/VoiceInputButton.jsx` (Whisper + cleanup, Web Speech fallback),
 * and its `onTranscript` hands the words to `insertDictation`.
 *
 * ⛔ ONE STEP, EXACTLY. Ctrl+Z after a dictation must remove the dictated words
 * and nothing else. ProseMirror's history groups transactions that land within
 * `newGroupDelay` of each other into one undo event, so a dictation that
 * arrives right after typing would be undone together with the typing, and
 * typing right after it would be undone with the dictation. `closeHistory` on
 * the insert's own transaction starts a fresh event; a second, empty
 * `closeHistory` transaction afterwards seals it. Two dictations are two steps.
 *
 * ⛔ A TEXT NODE, NEVER A STRING. `insertContent('a < b')` parses its argument
 * as HTML; a transcript is plain words and must land as plain words.
 *
 * ⛔ A SELECTED NODE IS NEVER REPLACED. `insertContent` replaces the selection,
 * and a NodeSelection (a chart the member clicked) would be deleted by the words
 * — the defect `CaptureInboxTray.place()` and `handleSaveExcerpt` both record in
 * NoteEditorPage.jsx. Over a node, the words land just after it.
 */
import { closeHistory } from '@tiptap/pm/history'

/** Dispatched by SlashMenu's "Dictate" item on ITS editor's own DOM root
 *  (`editor.view.dom`), never `window` — the wave 6 I5 rule: with split view
 *  open, only the editor the slash command ran in may answer. */
export const DICTATE_EVENT = 'uct:notebook-dictate'

/** A transcript as it goes into a note: whitespace collapsed, '' for nothing. */
export function dictationText(raw) {
  return String(raw ?? '').replace(/\s+/g, ' ').trim()
}

/**
 * Insert `raw` at the caret. → true when the words are in the note.
 * false (and nothing changed) when there is nothing to insert or the editor
 * cannot take changes (destroyed, locked, unreadable).
 */
export function insertDictation(editor, raw) {
  if (!editor || editor.isDestroyed || !editor.isEditable) return false
  let text = dictationText(raw)
  if (!text) return false
  const { selection, doc } = editor.state
  const overNode = Boolean(selection.node)
  const at = overNode ? selection.to : selection.from
  // A leading space when the caret sits right after a word, so "was" + "strong"
  // never lands as "wasstrong".
  const $at = doc.resolve(at)
  const before = $at.parent.isTextblock
    ? $at.parent.textBetween(Math.max(0, $at.parentOffset - 1), $at.parentOffset)
    : ''
  if (before && !/\s/.test(before)) text = ` ${text}`
  const node = { type: 'text', text }
  const chain = editor.chain().focus().command(({ tr }) => { closeHistory(tr); return true })
  const ok = (overNode ? chain.insertContentAt(at, node) : chain.insertContent(node)).run()
  if (ok && !editor.isDestroyed) {
    // Seal the step: typing that follows starts its own undo event.
    editor.view.dispatch(closeHistory(editor.state.tr))
  }
  return Boolean(ok)
}
