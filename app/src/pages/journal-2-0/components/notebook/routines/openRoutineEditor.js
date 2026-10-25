// Notebook widgets phase 2, wave 9 (Task 9.16): the routine editor's door. It replaces the W9-R28 placeholder, keeping
// its path and the call the routine block's ⋯ menu makes (`{editor, routineId, announce}`).
//
// `openRoutineEditor({routineId?, starter?, onSaved?, editor?, announce?, returnFocus?, navigate?}) -> close()`:
//   * `routineId`: the routine to edit; none makes a new routine, from `starter` (a ready-made routine's key, e.g.
//     'premarket') when given.
//   * `onSaved(routine)`: hears the saved routine (the tool picker inserts a new one at the caret, Task 9.19).
//   * `editor`: the note's editor when opened from a note: the editor closes when the note does. It writes nothing
//     into a note.
//   * `announce(sentence)`: the opener's live line (a placed block's feedback line, which outlives the menu).
//   * `navigate`: the app router's navigate, for the "Used in" note links.
// Mounted on its own root, one editor at a time (mountEditor.js).
//
// ⛔ LAZY. Only dynamic imports reach this file (RoutineBlock's ⋯ menu, later the tool picker and My tools): a static
// import from anything on the Notebook's first open would put the editor on that first open (the bytes gate,
// lib/toolsCrud.lazy.test.js).
import RoutineEditorSheet from './RoutineEditorSheet'
import { mountEditor } from './mountEditor'

export function openRoutineEditor({
  routineId = null, starter = null, onSaved, editor = null, announce = null, returnFocus = null, navigate = null, zone,
} = {}) {
  return mountEditor({
    rootAttr: 'data-routine-editor-root',
    Sheet: RoutineEditorSheet,
    props: {
      routineId: typeof routineId === 'string' && routineId ? routineId : null,
      starter: typeof starter === 'string' && starter ? starter : null,
      onSaved: typeof onSaved === 'function' ? onSaved : undefined,
      navigate: typeof navigate === 'function' ? navigate : null,
      zone,
    },
    editor,
    announce: typeof announce === 'function' ? announce : null,
    returnFocus,
  })
}
