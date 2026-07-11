/**
 * Compass surface — renders the existing Compass tab. Paid-gated: free users
 * see a designed teaser (never a blank / broken surface, per spec §61) instead
 * of the AI-cost Compass tab. The primary-nav item is also gated in
 * JournalLayout; this is the route-level guard for a direct deep-link.
 */

import { useIsPaid } from '../../../context/AuthContext'
import CompassTab from '../tabs/CompassTab'
import styles from '../JournalLayout.module.css'

export default function CompassSurface() {
  const isPaid = useIsPaid()

  if (!isPaid) {
    return (
      <div className={styles.placeholder}>
        <p className={styles.placeholderTitle}>Compass — your AI trading coach</p>
        <p className={styles.placeholderHint}>
          Pre-trade verdicts, daily recaps, and a coach that learns your edge.
          Upgrade to unlock Compass.
        </p>
      </div>
    )
  }

  return <CompassTab />
}
