import styles from './Skeleton.module.css'

export function SkeletonLine({ width = '100%', height = 14 }) {
  return <div className={styles.line} style={{ width, height }} />
}

export function SkeletonBlock({ width = '100%', height = 80 }) {
  return <div className={styles.block} style={{ width, height }} />
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
