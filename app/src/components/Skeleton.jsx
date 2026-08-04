import styles from './Skeleton.module.css'

export function SkeletonLine({ width = '100%', height = 14 }) {
  return <div className={styles.line} style={{ width, height }} />
}

/**
 * Loading box. THE size-contract primitive (spec §3.4): chart components export
 * their rendered dimensions and hand them here as `size`, so the skeleton
 * reserves exactly that box and there is zero layout shift on load, e.g.
 *
 *   // LollipopChart.jsx
 *   export const SIZE = { width: '100%', height: 220 }
 *   // consumer
 *   {isLoading ? <SkeletonBlock size={LollipopChart.SIZE} /> : <LollipopChart … />}
 *
 * `width`/`height` are unchanged and still the primary API for the five
 * existing call sites (Desk, Journal 2.0, SkeletonChart); `size` simply wins
 * per-axis when it supplies that axis. Do NOT create a second SkeletonBlock in
 * research-kit — §3.4 promotes THIS one.
 */
export function SkeletonBlock({ width, height, size }) {
  const w = size?.width ?? width ?? '100%'
  const h = size?.height ?? height ?? 80
  return <div className={styles.block} style={{ width: w, height: h }} />
}

export function SkeletonCircle({ size = 28 }) {
  return <div className={styles.circle} style={{ width: size, height: size }} />
}

export function SkeletonPill({ width = 78, height = 26 }) {
  return <div className={styles.pill} style={{ width, height }} />
}

export function SkeletonTileContent({ lines = 4 }) {
  return (
    <div className={styles.tileContent}>
      {Array.from({ length: lines }, (_, i) => (
        <SkeletonLine
          key={i}
          width={`${75 + Math.random() * 25}%`}
          height={12}
        />
      ))}
    </div>
  )
}

export function SkeletonTable({ rows = 5, cols = 3 }) {
  return (
    <div className={styles.table}>
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className={styles.tableRow}>
          {Array.from({ length: cols }, (_, c) => (
            <SkeletonLine key={c} width={c === 0 ? '60px' : '80px'} height={10} />
          ))}
        </div>
      ))}
    </div>
  )
}

export function SkeletonChart({ height = 200 }) {
  return <SkeletonBlock width="100%" height={height} />
}
