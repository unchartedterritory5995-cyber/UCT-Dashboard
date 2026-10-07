// UCT Terminal — THE loading treatment for anything inside a terminal panel.
//
// One look, from the moment a panel's code starts downloading to the moment its data lands:
// the shell shows this while a panel's chunk loads (TerminalShell's <Suspense fallback>), and a
// panel that then waits on its own fetch shows the same thing, so a member sees one skeleton
// settle into content instead of "Loading CAL…" followed by a second, different loader.
//
//   import { PanelSkeleton } from '../../components/terminal'
//   if (isLoading) return <PanelSkeleton label="Loading news" />
//
// `shape` picks the silhouette: 'rows' (a table or list, the default), 'cards' (a grid of
// cards), 'chart' (one tall block). The label is the screen-reader announcement; it is also
// visible text inside a visually hidden span, so tests and assistive tech read the same words.
// Colours come from `components/Skeleton` (app tokens only), so every app theme is covered.
import { SkeletonBlock, SkeletonLine } from '../Skeleton'
import styles from './PanelSkeleton.module.css'

const ROW_WIDTHS = ['92%', '78%', '86%', '64%', '81%', '70%', '88%', '74%']

export default function PanelSkeleton({ label = 'Loading', shape = 'rows', rows = 6, testId = 'panel-skeleton' }) {
  return (
    <div className={styles.wrap} role="status" aria-live="polite" data-testid={testId} data-shape={shape}>
      <span className={styles.srOnly}>{label}…</span>
      <div aria-hidden="true" className={styles.body}>
        {shape === 'chart' && <SkeletonBlock height={240} />}
        {shape === 'cards' && (
          <div className={styles.cards}>
            {Array.from({ length: Math.max(2, Math.min(rows, 6)) }, (_, i) => (
              <div key={i} className={styles.card}>
                <SkeletonLine width="40%" height={10} />
                <SkeletonLine width="85%" height={12} />
                <SkeletonLine width="70%" height={12} />
              </div>
            ))}
          </div>
        )}
        {shape === 'rows' && (
          <>
            <SkeletonLine width="34%" height={10} />
            {Array.from({ length: rows }, (_, i) => (
              <SkeletonLine key={i} width={ROW_WIDTHS[i % ROW_WIDTHS.length]} height={12} />
            ))}
          </>
        )}
      </div>
    </div>
  )
}
