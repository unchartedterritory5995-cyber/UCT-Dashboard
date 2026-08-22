/**
 * Today — post-close lead (end-of-day recap).
 *
 * After the close the day's story is the lead: if Compass has already written
 * today's EOD recap, render it (reused EODRecap card); otherwise a single
 * "Generate today's recap" CTA. Plus a one-tap "Reflect on today" action that
 * deep-links to today's Journal day page. Lifts the CompassTab "Daily Recaps"
 * pattern (generate-when-missing, else the recap) into the Today surface.
 *
 * Props:
 *   account   the selected account (concrete, non-null)
 *   overview  coach overview payload (today.date / has_eod_recap)
 */
import { useState } from 'react'
import { NavLink } from 'react-router-dom'
import useJ2EODRecaps from '../../hooks/useJ2EODRecaps'
import EODRecap from '../../components/EODRecap'
import UIcon from '../../../../components/ui/UIcon'
import styles from '../TodaySurface.module.css'

export default function TodayPostCloseLead({ account, overview }) {
  const accountId = account?.id
  const { recaps, isLoading, generate, regenerate, feedback, forget } = useJ2EODRecaps(accountId)
  const [generating, setGenerating] = useState(false)
  const [errorMsg, setErrorMsg] = useState(null)

  const today = overview?.today?.date
  const todaysRecap = recaps.find((r) => (r.day || r.metadata?.day) === today)

  const onGenerate = async () => {
    setErrorMsg(null)
    setGenerating(true)
    try {
      const out = await generate()
      if (out?.skipped) setErrorMsg('No activity today — Compass took the day off.')
    } catch (e) {
      setErrorMsg(String(e.message || e))
    } finally {
      setGenerating(false)
    }
  }

  return (
    <section className={styles.card} data-testid="today-postclose" aria-label="End-of-day recap">
      <div className={styles.postHead}>
        <h2 className={styles.cardTitle}>Today’s recap</h2>
        <NavLink to="/journal/calendar" className={styles.checkBtn}>
          <UIcon name="edit" size={13} style={{ verticalAlign: '-2px', marginRight: 5 }} />
          Reflect on today
        </NavLink>
      </div>

      {todaysRecap ? (
        <EODRecap
          recap={todaysRecap}
          onFeedback={(v) => feedback(todaysRecap.id, v)}
          onRegenerate={async () => {
            try { await regenerate(todaysRecap.id) } catch (e) { setErrorMsg(String(e.message || e)) }
          }}
          onForget={() => forget(todaysRecap.id)}
        />
      ) : (
        <div className={styles.recapCta}>
          <span className={styles.cardSub}>
            {isLoading ? 'Loading today’s recap…' : 'No recap yet for today.'}
          </span>
          <button
            type="button"
            className={styles.checkBtnPrimary}
            onClick={onGenerate}
            disabled={generating}
          >
            {generating ? 'Working…' : 'Generate today’s recap'}
          </button>
        </div>
      )}

      {errorMsg && (
        <p role="alert" className={styles.recapError}>{errorMsg}</p>
      )}
    </section>
  )
}
