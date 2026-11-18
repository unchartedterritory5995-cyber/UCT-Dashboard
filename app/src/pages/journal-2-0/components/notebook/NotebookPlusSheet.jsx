// S12 (audit 2026-11-05, M9): the phone Notebook's "+" sheet -- Quick note · Voice note · Photo / chart screenshot ·
// Ask your Notebook · Help & feedback. Fetched on its FIRST open (NotebookTab's `lazyDialog`), so the Notebook's first
// open pays only for the button (NotebookPlusFab.jsx). ⛔ Each row runs a door that already exists; a door whose gate
// is off is absent, never a row that opens nothing.
// Simplify pass 2 (A8): the Ask row was "Ask AI" and went to Compass (the voice coach page). It is the Notebook's own
// Ask now: `onAskNotebook` is the SAME handler as the list ⋯ row "Ask your Notebook" (NotebookTab passes it only for a
// paid member, the row's old gate), so there is one way to open that section, not two.
import Sheet from '../../../../components/mobile/Sheet'
import UIcon from '../../../../components/ui/UIcon'
import { openFeedback } from '../../../../components/feedbackDoor'
import { trackMenuRow } from '../../lib/notebookTelemetry'
import styles from './NotebookPlusFab.module.css'

export default function NotebookPlusSheet({ open, onClose, returnFocusTo, onQuickNote, onVoiceNote = null, onPhoto = null,
  onAskNotebook = null, busy = false }) {
  const setOpen = (v) => { if (!v) onClose() }
  const rows = [
    { key: 'note', label: 'Quick note', icon: 'edit', run: onQuickNote, disabled: busy, row: 'quick_note' },
    onVoiceNote && { key: 'voice', label: 'Voice note', icon: 'mic', run: onVoiceNote, row: 'voice' },
    onPhoto && { key: 'photo', label: 'Photo / chart screenshot', icon: 'camera', row: 'photo' },
    onAskNotebook && { key: 'ask', label: 'Ask your Notebook', icon: 'sparkle', run: onAskNotebook, row: 'ask_notebook' },
    // Review Minor 8: the Help "?" is not drawn on the phone Notebook, so this row opens ITS menu (Send Feedback,
    // Submit a ticket) through the widget's own door -- not a second form.
    { key: 'help', label: 'Help & feedback', icon: 'info', run: () => openFeedback('menu', returnFocusTo?.current || null), row: 'help' },
  ].filter(Boolean)
  // Follow-up A: each row counts once as `menu_row_used` ('plus_sheet') by the id written on it above.
  const choose = (r) => () => { trackMenuRow('plus_sheet', r.row); setOpen(false); r.run?.() }

  return (
      <Sheet open={open} onClose={onClose} title="Add" labelledByTitle variant="bottom-sheet"
        returnFocusTo={returnFocusTo}>
        <div className={styles.rows}>
          {rows.map((r) => (r.key === 'photo' ? (
            // The picker must open INSIDE the tap (iOS refuses a later one), so this row is the file input's own
            // label. The chosen image goes to a new note's editor, placed by its own image door (pendingImageInsert).
            <label key={r.key} className={styles.row} data-disabled={busy ? '' : undefined}>
              <input type="file" accept="image/*" className="sr-only" disabled={busy} data-row={r.row}
                onClick={() => trackMenuRow('plus_sheet', r.row)}
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  e.target.value = ''
                  if (!file) return
                  setOpen(false)
                  onPhoto(file)
                }} />
              <UIcon name={r.icon} size={18} gold={false} /> {r.label}
            </label>
          ) : (
            <button key={r.key} type="button" className={styles.row} onClick={choose(r)} disabled={r.disabled} data-row={r.row}>
              <UIcon name={r.icon} size={18} gold={false} /> {r.label}
            </button>
          )))}
        </div>
      </Sheet>
  )
}
