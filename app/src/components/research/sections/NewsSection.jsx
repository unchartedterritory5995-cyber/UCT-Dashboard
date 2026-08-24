// app/src/components/research/sections/NewsSection.jsx
//
// Company news and the company's own press releases, interleaved by time. The
// modal covered the print, the call and the numbers but had no answer to "what
// else happened", which is often the reason a name moved.
//
// Wire coverage and official announcements arrive from two endpoints but are
// one feed to a reader — they keep a `kind` badge so a company statement is
// never mistaken for independent reporting.
import useSWR from 'swr'
import { SkeletonBlock } from '../../Skeleton'
import { EmptyState } from '../../research-kit'
import { FETCH_FAILED, sectionFetcher } from './sectionFetch'
import styles from './NewsSection.module.css'

/** "2026-08-09 18:00:00" → "2h ago" / "Aug 9". Never throws on junk. */
export function whenLabel(iso, now = Date.now()) {
  if (!iso) return ''
  // FMP sends "YYYY-MM-DD HH:MM:SS" with no zone; Safari refuses that form, so
  // it is normalised to ISO rather than handed straight to Date.
  const t = Date.parse(String(iso).replace(' ', 'T'))
  if (!Number.isFinite(t)) return ''
  const mins = Math.floor((now - t) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 7) return `${days}d ago`
  const d = new Date(t)
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export default function NewsSection({ sym }) {
  const { data, error, isLoading, mutate } = useSWR(
    sym ? `/api/research/news/${encodeURIComponent(sym)}?limit=25` : null, sectionFetcher,
    { revalidateOnFocus: false },
  )
  if (!sym) return null

  // A FAILED request is not an empty feed. Checked FIRST and before the
  // skeleton, because `data` is undefined in both cases and the old code read
  // that ambiguity as "no news" — a factual claim about the company made out
  // of a network error (see sectionFetch.js).
  if (error) {
    return <EmptyState {...FETCH_FAILED} onRetry={() => mutate()} />
  }

  const items = data?.items || []
  if (!items.length) {
    if (isLoading || data === undefined) {
      return (
        <ul className={styles.list} aria-hidden="true">
          {[0, 1, 2, 3, 4].map(i => (
            <li key={i} className={styles.item}><SkeletonBlock height={46} /></li>
          ))}
        </ul>
      )
    }
    return <p className={styles.note}>No recent news for this ticker.</p>
  }

  return (
    <ul className={styles.list} data-testid="news-list">
      {items.map((it, i) => (
        <li key={`${it.url || it.title}-${i}`} className={styles.item}>
          <div className={styles.meta}>
            <span className={it.kind === 'release' ? styles.release : styles.wire}>
              {it.kind === 'release' ? 'PR' : 'NEWS'}
            </span>
            <span className={styles.pub}>{it.publisher}</span>
            <span className={styles.when}>{whenLabel(it.published)}</span>
          </div>
          {/* rel=noopener: these are third-party links and must not get a
              handle on this window. */}
          <a className={styles.title} href={it.url} target="_blank"
             rel="noopener noreferrer">{it.title}</a>
          {it.summary ? <p className={styles.summary}>{it.summary}</p> : null}
        </li>
      ))}
    </ul>
  )
}
