import styles from './FrozenList.module.css'

// Journal Widgets — the shared FROZEN LIST renderer for list-shaped captures
// (scanner results, watchlists). Deliberately NOT the live Watchlists page:
// that is a page-grade component (global keydown, TickerActions writes,
// prefetch warms, live price plumbing) — the same renderer-disqualification
// the P2 audit gave periodsort. A capture is a ranked list of symbols with
// the numbers as they stood; this renders exactly that, read-only, from the
// frozen payload. Same idiom as ChartEmbed being chart-specific: an
// embedComponent is a first-class registry concept, not a fork.

const fmtPrice = (v) => (Number.isFinite(Number(v)) ? Number(v).toFixed(Number(v) >= 1000 ? 0 : 2) : null)
const fmtChg = (v) => {
  const n = Number(v)
  if (!Number.isFinite(n)) return null
  return `${n > 0 ? '+' : ''}${n.toFixed(Math.abs(n) < 10 ? 2 : 1)}%`
}

export default function FrozenList({ title, subtitle, asOf, rows, extraLabel }) {
  const list = Array.isArray(rows) ? rows : []
  return (
    <div className={styles.root}>
      <div className={styles.head}>
        <span className={styles.title}>{title}</span>
        {subtitle ? <span className={styles.subtitle}>{subtitle}</span> : null}
        {asOf ? <span className={styles.asOf}>{asOf}</span> : null}
      </div>
      {list.length === 0 ? (
        <div className={styles.empty}>Empty at capture.</div>
      ) : (
        <div className={styles.list}>
          {list.map((r, i) => {
            const chg = fmtChg(r.chgPct)
            const price = fmtPrice(r.price)
            return (
              <div key={`${r.sym || r.label || i}`} className={styles.row}>
                <span className={styles.sym}>{r.sym || r.label}</span>
                {r.note ? <span className={styles.note} title={r.note}>{r.note}</span> : <span className={styles.note} />}
                {r.extraValue != null && (
                  <span className={styles.extra}>{extraLabel ? `${extraLabel} ` : ''}{r.extraValue}</span>
                )}
                {price && <span className={styles.price}>${price}</span>}
                {chg && (
                  <span className={`${styles.chg} ${Number(r.chgPct) > 0 ? styles.up : Number(r.chgPct) < 0 ? styles.down : ''}`}>
                    {chg}
                  </span>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
