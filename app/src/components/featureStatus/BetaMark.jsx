/**
 * TERM-039 — the Beta mark, placed where a capability lives.
 *
 * It renders ONLY when the server says this capability is an early preview for THIS
 * member (`state: 'preview'` in the auth payload's `feature_status`) — today, a Data
 * Charts increment whose flag reads `admin`. The state is derived from the rollout
 * scope, so the mark disappears by itself the moment the flag reaches everyone; nobody
 * has to remember to take it off.
 *
 * ⛔ ABSENCE IS NOT A CLAIM. When the server did not measure feature status (an older
 * server, a failed ledger read) the mark renders nothing rather than guessing — the
 * Support strip it links to is where "not available" is said out loud.
 *
 * ⛔ READ THROUGH `useContext`, NOT `useAuth()`: the Data Charts surface is rendered bare
 * in its own tests, and `useAuth` throws outside a provider (`breadth/v2/flag.js` gives
 * the same reason).
 */
import { useContext } from 'react'
import { Link } from 'react-router-dom'
import { AuthContext } from '../../context/AuthContext'
import UIcon from '../ui/UIcon'
import { FEATURE_STATUS_HREF, isPreview } from './featureStatus'
import styles from './FeatureStatus.module.css'

export default function BetaMark({ ids }) {
  const ctx = useContext(AuthContext)
  if (!isPreview(ctx?.featureStatus, ids)) return null
  return (
    <Link to={FEATURE_STATUS_HREF} className={styles.betaMark} data-testid="beta-mark">
      <UIcon name="sparkle" size={11} gold={false} />
      <span>Beta</span>
      <span className={styles.srOnly}>: turned on early for your account. See what is here today.</span>
    </Link>
  )
}
