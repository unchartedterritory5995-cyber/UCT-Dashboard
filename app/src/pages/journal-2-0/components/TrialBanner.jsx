/**
 * Trial banner chip — one slim, honest notice (NOT a stacked control band).
 *
 * Two trial shapes, one banner:
 *   • Stripe card-required trial (subscription.status === 'trialing'): the
 *     user already has full paid access; keep the no-surprise-charge promise
 *     loud — "Trial — converts <date>" linking to Settings (manage/cancel).
 *   • Legacy card-free window (trial.active from /me — accounts created
 *     before the 2026-07-13 no-card cutover): "N days left" linking to
 *     /pricing. These windows all lapse by 2026-07-20.
 *
 * Paid/admin users show neither (trial.active is forced false server-side,
 * and a converted subscription is no longer 'trialing').
 */
import { Link } from 'react-router-dom'
import { useAuth } from '../../../context/AuthContext'
import UIcon from '../../../components/ui/UIcon'
import styles from './TrialBanner.module.css'

function convertDate(iso) {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export default function TrialBanner() {
  const { trial, subscription } = useAuth()

  if (subscription?.status === 'trialing') {
    const when = convertDate(subscription.current_period_end)
    return (
      <Link to="/settings?section=billing" className={styles.banner}>
        <span className={styles.mark} aria-hidden="true"><UIcon name="clock" size={14} /></span>
        <span className={styles.text}>
          <strong>Trial</strong>{when ? ` — converts ${when}` : ' — card on file'}
        </span>
        <span className={styles.cta}>Nothing charged until then · Manage in Settings</span>
      </Link>
    )
  }

  if (!trial || !trial.active) return null

  const n = trial.days_left
  const dayWord = n === 1 ? 'day' : 'days'

  return (
    <Link to="/pricing" className={styles.banner}>
      <span className={styles.mark} aria-hidden="true"><UIcon name="clock" size={14} /></span>
      <span className={styles.text}>
        <strong>Trial</strong> — {n} {dayWord} left
      </span>
      <span className={styles.cta}>Keep everything for $200/mo</span>
    </Link>
  )
}
