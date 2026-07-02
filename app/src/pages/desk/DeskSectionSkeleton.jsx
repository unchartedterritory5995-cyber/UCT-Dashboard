/**
 * Shimmer placeholder for Desk sections while their feed loads — a card grid
 * mirroring the video/article/post card geometry, instead of "Loading…" text.
 */
import { SkeletonBlock, SkeletonLine } from '../../components/Skeleton'
import styles from './DeskSectionSkeleton.module.css'

export default function DeskSectionSkeleton({ cards = 8 }) {
  return (
    <div className={styles.grid} role="status" aria-busy="true">
      <span className={styles.srOnly}>Loading…</span>
      {Array.from({ length: cards }, (_, i) => (
        <div key={i} className={styles.card} aria-hidden="true">
          <SkeletonBlock width="100%" height={150} />
          <SkeletonLine width="85%" height={13} />
          <SkeletonLine width="55%" height={11} />
        </div>
      ))}
    </div>
  )
}
