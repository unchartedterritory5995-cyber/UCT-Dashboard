/**
 * Today panel: the rules checklist for today (P4a Task 4).
 *
 * The SAME checklist the day page shows (DayRulesChecklist), over the SAME day detail and the SAME day-notes
 * write, for today's ET date. A tick is a day-notes write carrying the rules; it is never a Notebook note write.
 *
 * ⛔ The day is read on the basis the day page reads it on (`effectiveDayBasis`, lib/dayBasis.js, the one
 * derivation). The basis is part of the day detail's cache key, so a different basis here would read a second
 * copy of the day that a tick on the day page never updates.
 *
 * ⛔ The checklist is handed the day's notes, prep, mid-day, recap, attachments and rules exactly as
 * DayDetailPage hands them. The save hook sends every field it is given, so a field left out here would be
 * sent as '' and blank the member's narrative. For that reason the checklist is NOT shown when the day could
 * not be read: with nothing read, every one of those fields would go out empty.
 *
 * Lazy-only: this file is reached through the Today route's lazy chunk and must not be imported by an eager file.
 */
import TileCard from '../../../../../components/TileCard'
import usePreferences from '../../../../../hooks/usePreferences'
import useJ2DayDetail from '../../../hooks/useJ2DayDetail'
import useJ2DayNotesMutation from '../../../hooks/useJ2DayNotesMutation'
import DayRulesChecklist from '../../../components/calendar/DayRulesChecklist'
import { todayET } from '../../../lib/calendar'
import { effectiveDayBasis } from '../../../lib/dayBasis'
import styles from './panels.module.css'

// R-P4-9: shown while All Accounts is selected. MyRulesPanel says the same sentence; panels.test.jsx pins both to it.
const PICK_AN_ACCOUNT = 'Pick an account to see its rules.'

export default function ChecklistTodayPanel({ account, accountId }) {
  const { prefs } = usePreferences()
  // With no account there is no day to read or write: both hooks get a null date and stay idle.
  const date = accountId ? todayET() : null
  const { notes, isLoading, error } = useJ2DayDetail(date, accountId, effectiveDayBasis(account, prefs))
  const { save, saving } = useJ2DayNotesMutation(date)

  let body
  if (!accountId) {
    body = <p className={styles.muted}>{PICK_AN_ACCOUNT}</p>
  } else if (isLoading) {
    body = <p className={styles.muted}>Loading today&apos;s checklist…</p>
  } else if (error && !notes) {
    body = <p className={styles.muted}>Today&apos;s checklist isn&apos;t available right now.</p>
  } else {
    body = (
      <DayRulesChecklist
        notes={notes?.notes ?? ''}
        prepNotes={notes?.prepNotes ?? ''}
        midDayNotes={notes?.midDayNotes ?? ''}
        recapNotes={notes?.recapNotes ?? ''}
        attachments={notes?.attachments ?? []}
        rules={notes?.rules ?? []}
        onSave={save}
        saving={saving}
      />
    )
  }

  return (
    <TileCard title="Checklist for today" icon="check">
      {body}
    </TileCard>
  )
}
