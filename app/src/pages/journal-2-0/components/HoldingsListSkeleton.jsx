/**
 * Shimmer placeholder for the holdings list while positions load —
 * 5 ghost rows mirroring the real row geometry (logo · ident · sparkline ·
 * price pill) so content lands without a layout jump.
 */
import { SkeletonCircle, SkeletonLine, SkeletonPill, SkeletonBlock } from '../../../components/Skeleton'
import styles from './HoldingsListSkeleton.module.css'

const ROWS = 5

export default function HoldingsListSkeleton() {
  return (
    <div className={styles.wrap} role="status" aria-busy="true">
      <span className={styles.srOnly}>Loading positions…</span>
      {Array.from({ length: ROWS }, (_, i) => (
        <div key={i} className={styles.row} aria-hidden="true">
          <SkeletonCircle size={28} />
          <div className={styles.ident}>
            <SkeletonLine width="56px" height={13} />
            <SkeletonLine width="72px" height={10} />
          </div>
          <div className={styles.spark}>
            <SkeletonBlock width="96px" height={26} />
          </div>
          <div className={styles.right}>
            <SkeletonPill width={78} height={26} />
            <SkeletonLine width="48px" height={10} />
          </div>
        </div>
      ))}
    </div>
  )
}
