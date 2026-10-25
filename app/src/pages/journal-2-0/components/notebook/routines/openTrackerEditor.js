// Notebook widgets phase 2, wave 9 (Task 9.16): the tracker editor's door.
//
// `openTrackerEditor({trackerId?, onSaved?, editor?, announce?, returnFocus?, navigate?}) -> close()`:
//   * `trackerId`: the tracker to edit (a check-in tracker, `checkin:mood` / `checkin:focus`, opens read-only); none
//     makes a new tracker.
//   * `onSaved(tracker)`, `editor`, `announce`, `navigate`: as openRoutineEditor's.
// Mounted on its own root, one editor at a time across routines and trackers (mountEditor.js).
//
// ⛔ LAZY. Only dynamic imports may reach this file (a tracker block's ⋯ menu, the tool picker, My tools).
import TrackerEditorSheet from './TrackerEditorSheet'
import { mountEditor } from './mountEditor'

export function openTrackerEditor({
  trackerId = null, onSaved, editor = null, announce = null, returnFocus = null, navigate = null,
} = {}) {
  return mountEditor({
    rootAttr: 'data-tracker-editor-root',
    Sheet: TrackerEditorSheet,
    props: {
      trackerId: typeof trackerId === 'string' && trackerId ? trackerId : null,
      onSaved: typeof onSaved === 'function' ? onSaved : undefined,
      navigate: typeof navigate === 'function' ? navigate : null,
    },
    editor,
    announce: typeof announce === 'function' ? announce : null,
    returnFocus,
  })
}
