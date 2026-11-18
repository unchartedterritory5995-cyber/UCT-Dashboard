import useSWR from 'swr'
import styles from './RsBadge.module.css'
import { sectionFetcher } from './research/sections/sectionFetch'

// TERM-033: a failed read THROWS, so SWR keeps the last good rank through a failed
// hourly refresh instead of replacing it with null. With no rank to stand on, the chip
// renders nothing: an absent chip claims no rank, so it states nothing false. A 402 is
// an absent rank too.
const fetcher = (u) => sectionFetcher(u).then((d) => (d?.paywalled ? null : d))

function tierClass(r) {
  if (r >= 80) return styles.lead     // leadership
  if (r >= 60) return styles.strong
  if (r >= 40) return styles.neutral
  return styles.lag                   // laggard
}

/**
 * 1–99 RS Rating chip. Self-fetches the ticker's RS from the boot-warmed
 * `/api/rs-rankings/{sym}` endpoint (a pure cache lookup — never rebuilds the
 * universe). Renders nothing when RS is unavailable.
 *
 * One RS rating everywhere (RS split unit U5a, 2026-11-09): the server serves the
 * nightly IBD-style RS Rating as `rs_rank`, the same number the chart's UCT RS
 * prints, falling back to the hourly rank only for a name without a stored rating
 * (`rs_rank_source` says which; `rs_rank_asof` is the rating's session). The
 * hourly refresh below stays: it is how a badge picks up the night's write
 * without a reload. The NUMBER now changes once a night, not every hour.
 */
export default function RsBadge({ sym, size }) {
  const key = sym ? `/api/rs-rankings/${encodeURIComponent(sym)}` : null
  const { data } = useSWR(key, fetcher, {
    refreshInterval: 3_600_000, revalidateOnFocus: false, shouldRetryOnError: false,
  })
  const raw = data?.rs_rank
  if (raw == null || !Number.isFinite(Number(raw))) return null
  const r = Math.round(Number(raw))
  // The session the rating was written for, when the server says (U5a); absent, no claim.
  const asof = typeof data?.rs_rank_asof === 'string' && data.rs_rank_asof ? ` — as of ${data.rs_rank_asof}` : ''
  return (
    <span
      className={`${styles.badge} ${tierClass(r)} ${size === 'sm' ? styles.sm : ''}`}
      title={`RS Rating ${r}/99 — price-performance rank against every name we rate${asof}`}
    >
      <span className={styles.lab}>RS</span>{r}
    </span>
  )
}
