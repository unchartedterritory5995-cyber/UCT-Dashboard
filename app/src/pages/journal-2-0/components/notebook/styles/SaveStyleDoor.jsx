// Notebook P1 (spec P1.4): the note menu's "keep live blocks" template save -- its naming form, in the lazy
// styles chunk. Notebook simplify, Task 4: the menu has ONE "Save as template" entry now, and choosing "Keep live
// blocks" inside it mounts this door; the menu (NoteMenuActions) owns the entry, the choice and the sentence left
// behind, so this is the form alone. The save itself is SaveAsStyleForm's, unchanged.
import SaveAsStyleForm from './SaveAsStyleForm'

/** @param onDone `(sentence | null, { failed? }) => void`: the menu says the sentence and closes the form. */
export default function SaveStyleDoor({ note, onBeforeSave, onDone }) {
  return <SaveAsStyleForm note={note} onBeforeSave={onBeforeSave} onDone={onDone} />
}
