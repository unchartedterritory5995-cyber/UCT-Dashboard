// app/src/components/research/sections/BriefSection.jsx
//
// §4.3.3 — ALL prose lives here: the AI preview (pre) or analysis (post), key
// quotes, and the news list. No new LLM surface; this reuses the existing
// cost-guarded endpoint.
import { EmptyState, EyebrowLabel } from '../../research-kit'
import { SkeletonBlock } from '../../Skeleton'
import useEarningsBrief from '../../../hooks/useEarningsBrief'
import styles from './BriefSection.module.css'

// §12: visibly attribute AI prose, but never fabricate a fact this endpoint
// doesn't actually give us — there is no per-brief generation timestamp in
// the payload, only a wall-clock "as of" reading.
function provenance() {
  const t = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  return `AI · updated ${t}`
}

export default function BriefSection({ sym, row, stepping }) {
  // `stepping` is true while the settle debounce is pending on THIS symbol —
  // i.e. it was reached by arrow/chevron, not by a click.
  const { data, isLoading, generate } = useEarningsBrief(sym, { cachedOnly: !!stepping })

  if (isLoading) return <SkeletonBlock height={200} />

  const isPending = (row?.verdict || '').toLowerCase() === 'pending'
  const headline = data?.analysis_headline
  const bodyText = isPending ? data?.preview_text : (data?.analysis_summary || data?.analysis)
  const bullets = (isPending ? data?.preview_bullets : data?.analysis_bullets) || []
  const quotes = data?.key_quotes || []
  const news = data?.news || []
  const hasContent = !!(headline || bodyText || bullets.length || quotes.length || news.length)

  if (!hasContent) {
    return (
      <EmptyState
        icon="document"
        title={data?.cached === false ? 'No brief generated yet' : 'No brief available yet'}
        hint={data?.cached === false
          ? 'Stepping through reporters never generates one automatically — generate it when you want it.'
          : 'A brief is written once there is enough source material on this name.'}
        action={data?.cached === false
          ? <button type="button" className={styles.generate} onClick={generate}>Generate brief</button>
          : undefined}
      />
    )
  }

  return (
    <div className={styles.wrap}>
      {headline && <p className={styles.headline}>{headline}</p>}
      {bodyText && <p className={styles.body}>{bodyText}</p>}

      {bullets.length > 0 && (
        <>
          <EyebrowLabel>{isPending ? 'Things to watch' : 'Key takeaways'}</EyebrowLabel>
          <ul className={styles.list}>{bullets.map((b, i) => <li key={i}>{b}</li>)}</ul>
        </>
      )}

      {quotes.length > 0 && (
        <>
          <EyebrowLabel>Last call — key quotes</EyebrowLabel>
          <ul className={styles.quotes}>
            {quotes.map((q, i) => (
              <li key={i}>
                {q.topic && <span className={styles.quoteTopic}>{q.topic}: </span>}
                <span className={styles.quoteText}>“{q.quote}”</span>
              </li>
            ))}
          </ul>
        </>
      )}

      {news.length > 0 && (
        <>
          <EyebrowLabel>Related news</EyebrowLabel>
          <div className={styles.news}>
            {news.map((n, i) => (
              <a key={i} className={styles.newsItem} href={n.url}
                 target="_blank" rel="noopener noreferrer">
                <span className={styles.newsSource}>{n.source}{n.time ? ` · ${n.time}` : ''}</span>
                <span className={styles.newsHeadline}>{n.headline}</span>
              </a>
            ))}
          </div>
        </>
      )}

      <div className={styles.provenance} data-testid="brief-provenance">{provenance()}</div>
    </div>
  )
}
