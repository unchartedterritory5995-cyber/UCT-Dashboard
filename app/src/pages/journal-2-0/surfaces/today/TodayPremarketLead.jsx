/**
 * Today — pre-market lead ("Am I ready?").
 *
 * The readiness card the trader lands on before the open: the discipline lock
 * banner (if the account is locked from yesterday's rules), how many positions
 * they're carrying into today, the date, and this week's focus / an unresolved-
 * reflection hint pulled from the coach overview. Read-only surfaces — the
 * DisciplineLockBanner's override affordance is only meaningful inside the add
 * flow, so here it renders informationally (no override arm).
 *
 * Props:
 *   account   the selected account (concrete, non-null)
 *   overview  coach overview payload (this_weeks_focus / today.has_eod_recap)
 */
import { useMemo } from 'react'
import useJ2DisciplineState from '../../hooks/useJ2DisciplineState'
import useJ2Positions from '../../hooks/useJ2Positions'
import DisciplineLockBanner from '../../components/DisciplineLockBanner'
import UIcon from '../../../../components/ui/UIcon'
import styles from '../TodaySurface.module.css'

export default function TodayPremarketLead({ account, overview }) {
  const { state: disciplineState } = useJ2DisciplineState(account?.id)
  const { positions } = useJ2Positions()

  const todayLabel = useMemo(
    () => new Date().toLocaleDateString('en-US', {
      timeZone: 'America/New_York', weekday: 'long', month: 'long', day: 'numeric',
    }),
    [],
  )

  const owned = positions.length
  const focus = overview?.this_weeks_focus

  return (
    <section className={styles.card} data-testid="today-premarket" aria-label="Pre-market readiness">
      <div className={styles.cardEyebrow}>{todayLabel}</div>
      <h2 className={styles.cardTitle}>Am I ready?</h2>

      {/* Informational lock banner — the actual override lives in the add flow. */}
      <DisciplineLockBanner state={disciplineState} overrideArmed={false} onArmOverride={() => {}} />

      <ul className={styles.readyList}>
        <li className={styles.readyRow}>
          <span className={styles.checkIcon}><UIcon name="equity" size={16} /></span>
          <span>
            {owned === 0
              ? 'No open positions into today — a clean slate.'
              : `Carrying ${owned} open position${owned === 1 ? '' : 's'} into today — check your stops.`}
          </span>
        </li>
        {focus && (
          <li className={styles.readyRow}>
            <span className={styles.checkIcon}><UIcon name="compass" size={16} /></span>
            <span>This week’s focus: <strong>{focus}</strong></span>
          </li>
        )}
        {overview?.today?.has_eod_recap === false && (
          <li className={styles.readyRow}>
            <span className={styles.checkIcon}><UIcon name="journal" size={16} /></span>
            <span className={styles.cardSub}>
              Set your intention for the day — jot a plan before the bell.
            </span>
          </li>
        )}
      </ul>
    </section>
  )
}
