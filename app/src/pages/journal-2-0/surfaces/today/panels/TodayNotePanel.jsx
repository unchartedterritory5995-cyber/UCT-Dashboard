/**
 * Today panel: today's note (P4a Task 4).
 *
 * One button. It does what the Notebook's Ctrl+Alt+D shortcut does: `openDailyNote` with the member's own
 * daily template (the `notebook_daily_template` preference), which opens today's note or makes it the first
 * time (the server keeps it to one per member per ET day), then the Notebook is opened on that note.
 *
 * The shortcut's handler (`openToday` in tabs/NotebookTab.jsx) is a closure over that tab's state and ends in
 * the tab's own `setSearchParams`, so it cannot be called from Today. The two calls it is made of are shared:
 * `openDailyNote` and `DAILY_TEMPLATE_PREF` come from lib/dailyNote.js. The way into the note is the same
 * deep link the app's other doors into a note use, `/journal?j2tab=notebook&note=<id>`.
 *
 * ⛔ One press, one request: a second press while the first is in flight does nothing (the shortcut's handler
 * holds the same guard), so a double click cannot ask for two. While it runs the button is disabled and
 * aria-busy, so the member sees that something is happening; the guard resets on success and on failure.
 * When the call says the member's chosen daily template is gone (`templateMissing`) the panel shows the
 * shortcut's sentence (DAILY_TEMPLATE_MISSING, lib/dailyNote.js, the one copy) and opens the note on a
 * second press, rather than navigating away and dropping the sentence. The shortcut's tree refresh after a
 * create is the Notebook's own and is not done from Today.
 * ⛔ The failure sentence is fixed copy. The error the call threw is logged, never shown.
 */
import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import TileCard from '../../../../../components/TileCard'
import usePreferences from '../../../../../hooks/usePreferences'
import { DAILY_TEMPLATE_MISSING, DAILY_TEMPLATE_PREF, openDailyNote } from '../../../lib/dailyNote'
import styles from './panels.module.css'

export default function TodayNotePanel() {
  const navigate = useNavigate()
  const { prefs } = usePreferences()
  const templateId = prefs?.[DAILY_TEMPLATE_PREF] || ''
  const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState(false)
  // Set when the note opened but the member's daily template is gone: Today says so first, and the note opens
  // when they ask (the shortcut says it from inside the Notebook; leaving at once would lose the sentence).
  const [blankNoteId, setBlankNoteId] = useState(null)
  const openingRef = useRef(false)

  const goTo = (id) => navigate(`/journal?j2tab=notebook&note=${encodeURIComponent(id)}`)

  const open = async () => {
    if (openingRef.current) return
    openingRef.current = true
    setBusy(true)
    setFailed(false)
    setBlankNoteId(null)
    try {
      const { note, templateMissing } = await openDailyNote({ templateId })
      if (templateMissing) setBlankNoteId(note.id)
      else goTo(note.id)
    } catch (e) {
      console.error('[today] open daily note failed', e)
      setFailed(true)
    } finally {
      openingRef.current = false
      setBusy(false)
    }
  }

  return (
    <TileCard title="Today's note" icon="edit">
      <button type="button" className={styles.noteButton} onClick={open} disabled={busy} aria-busy={busy ? 'true' : undefined}>
        Open today&apos;s note
      </button>
      {failed && (
        <p role="alert" className={styles.noteError}>Couldn&apos;t open today&apos;s note. Try again.</p>
      )}
      {blankNoteId && (
        <div role="status">
          <p className={styles.muted}>{DAILY_TEMPLATE_MISSING}</p>
          <button type="button" className={styles.retryButton} onClick={() => goTo(blankNoteId)}>Open the note</button>
        </div>
      )}
    </TileCard>
  )
}
