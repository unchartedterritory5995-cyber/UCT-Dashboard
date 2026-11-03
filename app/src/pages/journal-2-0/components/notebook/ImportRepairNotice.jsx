// Plan F Task 10: the one-time notice for members whose imports lost pictures or files.
//
// Presentational only. NotebookTab reads `GET /api/j2/notes/import/repair-notice` once per page
// load and lazy-loads this file only when `show` is true, so a member with nothing to recover
// never fetches this chunk. Both buttons hand back to NotebookTab, which posts the dismiss: either
// way the notice never shows again.
import UIcon from '../../../../components/ui/UIcon'
import styles from './ImportRepairNotice.module.css'

export const REPAIR_NOTICE_HEADING = 'Some imported notes are missing pictures'

// Plan F final review M-2: the count covers every FILE import (Evernote, Notion and Obsidian
// exports, the generic Files importer for Markdown, Word and HTML, Keep, Logseq), so the copy names
// no single app: it must be true for every member it is shown to.
export function repairNoticeBody(lossNotes) {
  if (lossNotes === 1) {
    return 'When you imported notes from another app or from files, 1 note lost a picture or file on the way in. '
      + "Where we could, we've marked the spot in the note. "
      + 'Import the same files again with Re-import to recover turned on to bring it back. '
      + "Notes you've changed since importing are never touched."
  }
  return `When you imported notes from another app or from files, ${lossNotes} notes lost a picture or file on the way in. `
    + "Where we could, we've marked the spot in each note. "
    + 'Import the same files again with Re-import to recover turned on to bring them back. '
    + "Notes you've changed since importing are never touched."
}

export default function ImportRepairNotice({ lossNotes, onRecover, onDismiss }) {
  return (
    <section className={styles.notice} aria-labelledby="import-repair-notice-heading" data-testid="import-repair-notice">
      <UIcon name="info" size={18} gold={false} className={styles.icon} />
      <div className={styles.text}>
        <h2 id="import-repair-notice-heading" className={styles.heading}>{REPAIR_NOTICE_HEADING}</h2>
        <p className={styles.body}>{repairNoticeBody(lossNotes)}</p>
        <div className={styles.actions}>
          <button type="button" className="btn btn-primary btn-sm" onClick={onRecover}>
            Re-import to recover
          </button>
          <button type="button" className="btn btn-sm" onClick={onDismiss}>
            Dismiss
          </button>
        </div>
      </div>
    </section>
  )
}
