// Notebook widgets phase 2, wave 9 (Task 9.19): what the builder's door knows that the sheet does not hand down to the
// examples gallery: the note's editor it was opened from (or null) and the door's own close. openWidgetBuilder provides
// it around the sheet; the gallery's first step ("Set up your pre-market routine") reads it, so the routine is put at
// the caret when the builder was opened from a note, and the builder gives way to the routine editor (one sheet at a
// time). Absent (a sheet rendered without the door), the step opens the editor and inserts nothing.
import { createContext } from 'react'

export const BuilderDoor = createContext(null)
