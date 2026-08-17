// app/src/pages/research/DeskCoverage.jsx
// "What has the desk actually said about this name?"
//
// The Sunday Scans archive holds 265,000 words across 364 distinct symbols, and
// until this card it was reachable from exactly one place: the Articles tab.
// Ticker chips ran article -> research; nothing ran research -> article, which
// is the more valuable direction — this is the question a trader brings TO a
// research page.
//
// Renders null when there is no coverage, so it never adds an empty box to a
// symbol the letter has never mentioned.
import { Link } from 'react-router-dom'
import useSWR from 'swr'
import styles from './ResearchPage.module.css'

const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => (r.ok ? r.json() : null))

function fmtDate(unixSec) {
  if (!unixSec) return ''
  try {
    return new Date(unixSec * 1000).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
    })
  } catch {
    return ''
  }
}

export default function DeskCoverage({ sym }) {
  const { data } = useSWR(
    sym ? `/api/desk/articles/for-ticker/${encodeURIComponent(sym)}` : null,
    fetcher,
    { revalidateOnFocus: false },
  )

  const articles = data?.articles || []
  // No coverage, or the reader isn't entitled to the archive (fetcher yields
  // null on a 401/402) — either way, show nothing rather than an empty shell.
  if (!articles.length) return null

  const total = data.total || articles.length
  const shown = articles.length

  return (
    <section className={styles.card}>
      <div className={styles.deskCovHead}>
        <h3 className={styles.deskCovTitle}>
          {sym} in Sunday Scans
        </h3>
        <span className={styles.deskCovCount}>
          {total} {total === 1 ? 'issue' : 'issues'}
        </span>
      </div>

      <ul className={styles.deskCovList}>
        {articles.map((a) => (
          <li key={a.id}>
            <Link className={styles.deskCovRow} to={`/desk/article/${a.slug}`}>
              <span className={styles.deskCovDate}>{fmtDate(a.published_at)}</span>
              <span className={styles.deskCovName}>{a.display_title || a.title}</span>
              {a.reading_minutes ? (
                <span className={styles.deskCovMeta}>{a.reading_minutes} min</span>
              ) : null}
            </Link>
          </li>
        ))}
      </ul>

      {total > shown && (
        // The list is capped; the count is not. Send the rest through search
        // rather than pretending the newest few are all there is.
        <Link className={styles.deskCovMore} to={`/desk?section=articles&q=${encodeURIComponent(sym)}`}>
          See all {total} issues mentioning {sym} →
        </Link>
      )}
    </section>
  )
}
