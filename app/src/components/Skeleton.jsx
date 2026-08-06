import styles from './Skeleton.module.css'

export function SkeletonLine({ width = '100%', height = 14 }) {
  return <div className={styles.line} style={{ width, height }} />
}

/**
 * Loading box. THE size-contract primitive (spec §3.4): chart components export
 * their rendered dimensions and hand them here as `size`, so the skeleton
 * reserves exactly that box and there is zero layout shift on load, e.g.
 *
 *   // research-kit/index.js barrel
 *   export { default as LollipopChart, SIZE as LOLLIPOP_SIZE } from './charts/LollipopChart'
 *   // consumer — SIZE is a NAMED export of the chart module (I3: it is never
 *   // a static on the component, so `LollipopChart.SIZE` is undefined), so
 *   // import the barrel's renamed constant instead:
 *   import { LollipopChart, LOLLIPOP_SIZE, EyebrowLabel } from '.../research-kit'
 *   {isLoading ? <SkeletonBlock size={LOLLIPOP_SIZE} /> : <LollipopChart … />}
 *
 * NOTE: a research-kit chart's exported `SIZE` is the CHART BOX only (the
 * canvas/SVG itself) — it does not include that component's own `EyebrowLabel`
 * or caption row. To reserve a kit chart's FULL rendered height, compose
 * `EyebrowLabel` + `SkeletonBlock` together rather than passing `size` alone.
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
