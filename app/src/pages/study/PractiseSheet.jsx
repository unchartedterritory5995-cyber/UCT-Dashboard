/**
 * PractiseSheet — the "Practise" door (spec §13.7 D13): a bottom Sheet with
 * three rows, "Review my misses (N)" · "Refresh a stale skill (N need it)" ·
 * "Keep going on the trail". Each row asks POST /api/study/sessions for a set
 * and hands the payload to `onStart`, which opens the DrillPlayer with it.
 *
 *   <PractiseSheet open onClose={fn} misses={14} stale={3} staleSkillId="setup.vcp"
 *                  trailSkillId="..." onStart={(payload) => ...} />
 *
 * Kinds sent: misses → refresher (the composer weights past misses and due
 * slots), stale → refresher narrowed to `staleSkillId`, trail → skill narrowed
 * to `trailSkillId` (or free when there is none). A reviewer (an admin) also
 * gets the "Feedback on this screen" door, inside the sheet.
 */
import { useState } from 'react'
import Sheet from '../../components/mobile/Sheet'
import UIcon from '../../components/ui/UIcon'
import { loadFailedSentence } from '../journal-2-0/components/LoadFailed'
import { SESSIONS_URL, studyFetch } from './useStudySession'
import ScreenFeedback from './ScreenFeedback'
import styles from './PractiseSheet.module.css'

export function rowsFor({ misses = 0, stale = 0 }) {
  return [
    { key: 'misses', icon: 'refresh', label: `Review my misses (${misses})`, body: { kind: 'refresher', focus: 'misses' }, disabled: misses === 0 },
    { key: 'stale', icon: 'clock', label: `Refresh a stale skill (${stale} need it)`, body: { kind: 'refresher', focus: 'stale' }, disabled: stale === 0 },
    { key: 'trail', icon: 'compass', label: 'Keep going on the trail', body: { kind: 'free' }, disabled: false },
  ]
}

export default function PractiseSheet({ open, onClose, misses = 0, stale = 0, staleSkillId = null, trailSkillId = null, onStart, fetcher = studyFetch, reviewer = false }) {
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState(null)

  const start = async (row) => {
    setBusy(row.key)
    setError(null)
    const body = { ...row.body }
    if (row.key === 'stale' && staleSkillId) body.skill_id = staleSkillId
    if (row.key === 'trail' && trailSkillId) { body.kind = 'skill'; body.skill_id = trailSkillId }
    try {
      const payload = await fetcher(SESSIONS_URL, { method: 'POST', body })
      onStart?.(payload, row.key)
    } catch (e) {
      setError(e)
    } finally {
      setBusy(null)
    }
  }

  return (
    <Sheet open={open} onClose={onClose} variant="auto" title="Practise" ariaLabel="Practise">
      <ul className={styles.rows}>
        {rowsFor({ misses, stale }).map((row) => (
          <li key={row.key}>
            <button
              type="button"
              className={styles.row}
              disabled={row.disabled || busy != null}
              onClick={() => start(row)}
              data-testid={`practise-${row.key}`}
            >
              <span className={styles.rowIcon} aria-hidden="true"><UIcon name={row.icon} size={18} /></span>
              <span className={styles.rowLabel}>{busy === row.key ? 'Setting up' : row.label}</span>
            </button>
          </li>
        ))}
      </ul>
      {error && (
        <p className={styles.failed} role="status">
          {loadFailedSentence([{ what: 'a practice set', error }])}
        </p>
      )}
      {reviewer && (
        <div className={styles.screenFb}>
          <ScreenFeedback screen="practise" align="start" up context={{ misses, stale }} />
        </div>
      )}
    </Sheet>
  )
}
