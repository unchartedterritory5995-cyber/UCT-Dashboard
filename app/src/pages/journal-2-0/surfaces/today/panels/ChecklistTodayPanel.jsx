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
 * ⛔ A tick, an add or a remove sends ONLY `rules`. Today is the page a member keeps open all session, and its
 * copy of the day is read once and never refreshed, so the prep, mid-day and recap it holds can be hours old.
 * DayRulesChecklist builds its save from every field it is handed, and fills a field it was not handed with
 * its own '' / [] defaults; forwarding that whole body would send this tab's old narrative (or blanks) and the
 * server would write it, because a key that is present is the member's word. The save hook sends only the keys
 * it is given, and the server keeps every key a PUT leaves out (calendar.upsert_day_notes), so the narrative
 * and the attachments written anywhere else stand.
 *
 * ⛔ The checklist is NOT shown when the day could not be read: its rules would read as an empty list, and the
 * next tick or add would write that list over the day's real rules.
 *
 * Day notes belong to the member, not to an account (j2_day_notes is keyed on user and date), so the checklist
 * is shown on All Accounts too, as the day page shows it. The account only picks the basis the day is read on.
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

export default function ChecklistTodayPanel({ account, accountId }) {
  const { prefs } = usePreferences()
  const date = todayET()
  const { notes, isLoading, error, refresh } = useJ2DayDetail(date, accountId, effectiveDayBasis(account, prefs))
  const { save, saving } = useJ2DayNotesMutation(date)
  // Only the field a checklist change is about. See the header: the rest of the body is this tab's old copy.
  const saveRules = (body) => save({ rules: body.rules })

  let body
  if (isLoading) {
    body = <p className={styles.muted}>Loading today&apos;s checklist…</p>
  } else if (error && !notes) {
    // useJ2DayDetail does not retry a failed read on its own (and does not re-read on focus), so the way
    // out is the member's: ask again.
    body = (
      <div>
        <p className={styles.muted}>Today&apos;s checklist isn&apos;t available right now.</p>
        <button type="button" className={styles.retryButton} onClick={refresh}>Try again</button>
      </div>
    )
  } else {
    body = <DayRulesChecklist rules={notes?.rules ?? []} onSave={saveRules} saving={saving} />
  }

  return (
    <TileCard title="Checklist for today" icon="check">
      {body}
    </TileCard>
  )
}
