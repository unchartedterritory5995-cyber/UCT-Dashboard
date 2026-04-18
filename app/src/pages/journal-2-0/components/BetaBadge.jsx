/** Small "beta" chip next to the Journal 2.0 tab label (spec §6). */

import styles from './BetaBadge.module.css'

export default function BetaBadge() {
  return <span className={styles.badge} aria-label="beta">beta</span>
}
