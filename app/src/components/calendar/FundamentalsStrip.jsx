// app/src/components/calendar/FundamentalsStrip.jsx
// Compact fundamentals strip for EarningsModal.
// Shows: mkt cap · Fwd P/E · beta · 52w range · avg vol · div yield
// Null-safe: hides entire strip when data is null; hides individual fields when null.
import useFundamentals from '../../hooks/useFundamentals'
import styles from './FundamentalsStrip.module.css'

function fmtCap(v) {
  if (v == null) return null
  if (v >= 1e12) return `$${(v / 1e12).toFixed(2)}T`
  if (v >= 1e9)  return `$${(v / 1e9).toFixed(2)}B`
  if (v >= 1e6)  return `$${(v / 1e6).toFixed(0)}M`
  return `$${v}`
}

function fmtVol(v) {
  if (v == null) return null
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`
  if (v >= 1e3) return `${(v / 1e3).toFixed(0)}K`
  return `${v}`
}

function fmtPct(v) {
  if (v == null) return null
  return `${v.toFixed(2)}%`
}

function FundamentalsItem({ label, value }) {
  if (value == null) return null
  return (
    <div className={styles.item}>
      <span className={styles.lbl}>{label}</span>
      <span className={styles.val}>{value}</span>
    </div>
  )
}

export default function FundamentalsStrip({ ticker }) {
  const { data } = useFundamentals(ticker)
  if (!data) return null

  const rangeStr = (data.week52_low != null && data.week52_high != null)
    ? `$${data.week52_low.toFixed(2)} – $${data.week52_high.toFixed(2)}`
    : null

  return (
    <div className={styles.strip}>
      <FundamentalsItem label="Mkt Cap"    value={fmtCap(data.market_cap)} />
      <FundamentalsItem label="Fwd P/E"    value={data.forward_pe != null ? data.forward_pe.toFixed(1) : null} />
      <FundamentalsItem label="Beta"       value={data.beta != null ? data.beta.toFixed(2) : null} />
      <FundamentalsItem label="52W Range"  value={rangeStr} />
      <FundamentalsItem label="Avg Vol"    value={fmtVol(data.avg_vol)} />
      <FundamentalsItem label="Div Yield"  value={fmtPct(data.div_yield)} />
    </div>
  )
}

/**
 * Compact Fwd P/E chip for EarningsCard — lazy-loads via useFundamentals.
 * Hidden when data null or forward_pe null.
 */
export function FwdPeChip({ ticker }) {
  const { data } = useFundamentals(ticker)
  const pe = data?.forward_pe
  if (pe == null) return null
  return (
    <span className={styles.peChip}>
      P/E {pe.toFixed(1)}x
    </span>
  )
}
