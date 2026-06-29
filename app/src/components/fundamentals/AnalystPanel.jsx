import useAnalystIntel from '../../hooks/useAnalystIntel'
import styles from './AnalystPanel.module.css'

const fmtPct = v => (v == null ? '' : `${v > 0 ? '+' : ''}${v}%`)
const fmt$ = v => (v == null ? '—' : `$${Number(v).toFixed(2)}`)
const pctClass = v => (v == null ? '' : v >= 0 ? styles.pos : styles.neg)

function ConsensusBar({ c }) {
  if (!c) return null
  const buy = (c.buy || 0) + (c.strong_buy || 0)
  const sell = (c.sell || 0) + (c.strong_sell || 0)
  const total = buy + (c.hold || 0) + sell || 1
  return (
    <div className={styles.block}>
      <div className={styles.row}>
        <span className={styles.rating}>{c.rating || '—'}</span>
        <span className={styles.counts}>
          <span className={styles.pos}>{buy} Buy</span>
          <span className={styles.muted}>{c.hold || 0} Hold</span>
          <span className={styles.neg}>{sell} Sell</span>
        </span>
      </div>
      <div className={styles.bar}>
        <span className={styles.barBuy} style={{ width: `${buy / total * 100}%` }} />
        <span className={styles.barHold} style={{ width: `${(c.hold || 0) / total * 100}%` }} />
        <span className={styles.barSell} style={{ width: `${sell / total * 100}%` }} />
      </div>
    </div>
  )
}

function TargetRange({ p }) {
  if (!p || p.avg == null) return null
  return (
    <div className={styles.block}>
      <div className={styles.row}>
        <span className={styles.muted}>Price Target</span>
        {p.upside_pct != null && <span className={pctClass(p.upside_pct)}>{fmtPct(p.upside_pct)} upside</span>}
      </div>
      <div className={styles.row}>
        <span className={styles.muted}>{fmt$(p.low)}</span>
        <span className={styles.ptAvg}>{fmt$(p.avg)}</span>
        <span className={styles.muted}>{fmt$(p.high)}</span>
      </div>
    </div>
  )
}

function ActionRow({ a }) {
  const up = a.action === 'upgrade' || (a.action || '').includes('up')
  const down = a.action === 'downgrade' || (a.action || '').includes('down')
  return (
    <div className={styles.action}>
      <span className={`${styles.glyph} ${up ? styles.pos : down ? styles.neg : styles.muted}`}>{up ? '▲' : down ? '▼' : '•'}</span>
      <span className={styles.firm}>{a.firm || '—'}</span>
      <span className={styles.grades}>{a.from_grade ? `${a.from_grade} → ` : ''}{a.to_grade || ''}</span>
      {a.price_target != null && <span className={styles.muted}>{fmt$(a.price_target)}</span>}
      <span className={styles.date}>{a.date}</span>
    </div>
  )
}

export default function AnalystPanel({ sym }) {
  const { data } = useAnalystIntel(sym)
  if (!sym) return <div className={styles.hint}>Pick a ticker.</div>
  if (!data) return <div className={styles.hint}>Loading {sym}…</div>
  const has = data.consensus || data.price_target || (data.recent_actions || []).length
  if (!has) return <div className={styles.hint}>No analyst coverage for {sym}.</div>
  return (
    <div className={styles.root}>
      <ConsensusBar c={data.consensus} />
      <TargetRange p={data.price_target} />
      {(data.recent_actions || []).length > 0 && (
        <div className={styles.block}>
          <div className={styles.sectionLabel}>Recent rating changes</div>
          {data.recent_actions.map((a, i) => <ActionRow key={i} a={a} />)}
        </div>
      )}
    </div>
  )
}
