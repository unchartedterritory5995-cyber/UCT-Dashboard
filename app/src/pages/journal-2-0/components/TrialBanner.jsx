/**
 * Trial banner chip — shown to users inside their 14-day full-access trial.
 *
 * A single slim, honest notice (NOT a stacked control band): "Trial — N days
 * left · Keep everything for $19/mo" linking to /pricing. It reuses the same
 * upgrade-affordance surface free users already see in the journal shell; when
 * the user is paid/admin or the trial is over, `trial.active` is false and this
 * renders nothing.
 */
import { Link } from 'react-router-dom'
import { useAuth } from '../../../context/AuthContext'
import UIcon from '../../../components/ui/UIcon'
import styles from './TrialBanner.module.css'

export default function TrialBanner() {
  const { trial } = useAuth()
  if (!trial || !trial.active) return null

  const n = trial.days_left
  const dayWord = n === 1 ? 'day' : 'days'

  return (
    <Link to="/pricing" className={styles.banner}>
      <span className={styles.mark} aria-hidden="true"><UIcon name="clock" size={14} /></span>
      <span className={styles.text}>
        <strong>Trial</strong> — {n} {dayWord} left
      </span>
      <span className={styles.cta}>Keep everything for $19/mo</span>
    </Link>
  )
}
