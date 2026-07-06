import useSWR from 'swr'
import styles from './RsBadge.module.css'

const fetcher = (u) => fetch(u).then((r) => (r.ok ? r.json() : null)).catch(() => null)

function tierClass(r) {
  if (r >= 80) return styles.lead     // leadership
  if (r >= 60) return styles.strong
  if (r >= 40) return styles.neutral
  return styles.lag                   // laggard
}

/**
 * IBD-style 1–99 relative-strength rank chip. Self-fetches the ticker's RS from
 * the live, boot-warmed `/api/rs-rankings/{sym}` endpoint (a pure cache lookup —
 * never rebuilds the universe). Renders nothing when RS is unavailable.
 */
export default function RsBadge({ sym, size }) {
  const key = sym ? `/api/rs-rankings/${encodeURIComponent(sym)}` : null
  const { data } = useSWR(key, fetcher, {
    refreshInterval: 3_600_000, revalidateOnFocus: false, shouldRetryOnError: false,
  })
  const raw = data?.rs_rank
  if (raw == null || !Number.isFinite(Number(raw))) return null
  const r = Math.round(Number(raw))
  return (
    <span
      className={`${styles.badge} ${tierClass(r)} ${size === 'sm' ? styles.sm : ''}`}
      title={`Relative Strength ${r}/99 — IBD-style 1-year weighted rank vs the market`}
    >
      <span className={styles.lab}>RS</span>{r}
    </span>
  )
}
