// Notebook widgets phase 2, wave 9: the routine editor's door.
//
// ⛔ A PLACEHOLDER (ruling W9-R28). Task 9.16 builds the routine editor and REPLACES this file, keeping its path and
// its signature. Until then the door opens nothing: it announces `TOOL_COPY.flagOff` ("Not available right now.")
// through the caller's `announce`, and answers `{ ok: false, message }`.
//
// `openRoutineEditor({ editor, routineId, announce })`:
//   * `editor`: the note's editor when opened from a placed routine block (its ⋯ menu, "Edit routine").
//   * `routineId`: the routine to edit.
//   * `announce(sentence)`: the caller's live region (the block's feedback line, which outlives the menu).
//
// ⛔ LAZY. Only dynamic imports reach this file (RoutineBlock's ⋯ menu): a static import from anything on the
// Notebook's first open would put the editor on that first open (the bytes gate).
import { TOOL_COPY } from '../../../lib/blocks/toolsApi'

export function openRoutineEditor({ announce } = {}) {
  const message = TOOL_COPY.flagOff
  if (typeof announce === 'function') {
    try { announce(message) } catch { /* the caller's live region is its own */ }
  }
  return { ok: false, message }
}
