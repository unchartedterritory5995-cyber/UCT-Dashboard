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
 * holds the same guard), so a double click cannot ask for two.
 * ⛔ The failure sentence is fixed copy. The error the call threw is logged, never shown.
 */
import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import TileCard from '../../../../../components/TileCard'
import usePreferences from '../../../../../hooks/usePreferences'
import { DAILY_TEMPLATE_PREF, openDailyNote } from '../../../lib/dailyNote'
import styles from './panels.module.css'

export default function TodayNotePanel() {
  const navigate = useNavigate()
  const { prefs } = usePreferences()
  const templateId = prefs?.[DAILY_TEMPLATE_PREF] || ''
  const [failed, setFailed] = useState(false)
  const openingRef = useRef(false)

  const open = async () => {
    if (openingRef.current) return
    openingRef.current = true
    setFailed(false)
    try {
      const { note } = await openDailyNote({ templateId })
      navigate(`/journal?j2tab=notebook&note=${encodeURIComponent(note.id)}`)
    } catch (e) {
      console.error('[today] open daily note failed', e)
      setFailed(true)
    } finally {
      openingRef.current = false
    }
  }

  return (
    <TileCard title="Today's note" icon="edit">
      <button type="button" className={styles.noteButton} onClick={open}>
        Open today&apos;s note
      </button>
      {failed && (
        <p role="alert" className={styles.noteError}>Couldn&apos;t open today&apos;s note. Try again.</p>
      )}
    </TileCard>
  )
}
