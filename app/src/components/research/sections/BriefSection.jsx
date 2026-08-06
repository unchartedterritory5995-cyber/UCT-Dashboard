// app/src/components/research/sections/BriefSection.jsx
//
// §4.3.3 — ALL prose lives here: the AI preview (pre) or analysis (post), key
// quotes, and the news list. No new LLM surface; this reuses the existing
// cost-guarded endpoint.
import { EmptyState, EyebrowLabel } from '../../research-kit'
import { SkeletonBlock } from '../../Skeleton'
import useEarningsBrief from '../../../hooks/useEarningsBrief'
import styles from './BriefSection.module.css'

// §12: visibly attribute AI prose. Review r1 I2 — this used to read
// `AI · updated {wall-clock now}`, which asserts a freshness fact the payload
// can't support: neither generator returns a generation timestamp
// (api/services/engine.py's `_generate_earnings_analysis`/`_generate_earnings_
// preview` result dicts), and a brief is cached 12h + persisted across
// redeploys, so a day-old brief would have rendered "updated" at whatever
// time the user happened to open the modal. State WHAT this is, not a WHEN
// the payload can't back up.
const PROVENANCE = 'AI · earnings brief'

// M2: a blank-but-present string ('   ') is truthy in JS, so a naive `{x &&
// <p>{x}</p>}` still renders an empty paragraph / empty link / empty bullet.
// engine.py:1037 defaults news fields to `""` on a missing Finnhub field, so
// this isn't hypothetical. Collapse blank to null so "absent" reads as
// absent everywhere, not as a real-but-empty answer.
function clean(v) {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t ? t : null
}

export default function BriefSection({ sym, row, stepping }) {
  // `stepping` is true while the settle debounce is pending on THIS symbol —
  // i.e. it was reached by arrow/chevron, not by a click. (The actual GATE
  // no longer trusts this flag alone — see useEarningsBrief's `firstSym`
  // identity check, review r1 C1 — but it's still a legitimate additional
  // signal, so it's still passed through.)
  const { data, isLoading, generate, retry } = useEarningsBrief(sym, { cachedOnly: !!stepping })

  // A bare 200px grey box held the canvas for 10-15s with nothing to read: the
  // brief is LLM-generated on a cold symbol, so this is the longest wait in the
  // modal, and an unlabeled rectangle is indistinguishable from a broken panel.
  // Every other slow surface here says what it is doing; this one didn't.
  // The skeleton stays (it is the §3.4 size contract — removing it reintroduces
  // layout shift when the prose lands); it just gains a caption. role=status +
  // aria-live announces the wait to a screen reader, which a naked div cannot.
  if (isLoading) {
    return (
      <div className={styles.wrap} role="status" aria-live="polite" data-testid="brief-loading">
        <EyebrowLabel>{PROVENANCE}</EyebrowLabel>
        <p className={styles.provenance}>
          Writing this brief — a name we haven&apos;t covered today takes a few seconds.
        </p>
        <SkeletonBlock height={200} />
      </div>
    )
  }

  // I1: a rejected fetch AND the backend's own error fallback (engine.py's
  // earnings-analysis except-branch, which returns `{..., error: str(e)}`
  // with every content field empty) must NOT render as "no source material
  // yet" — that's a confident claim about a transport/LLM failure. `fetcher`
  // resolves both a thrown fetch and a non-ok response (incl. a 429 off the
  // endpoint's 10/minute limiter) to `null`.
  const hasError = data === null || data?.error != null
  if (hasError) {
    return (
      <EmptyState
        icon="warning"
        title="Brief unavailable right now"
        hint="Something went wrong generating or fetching this brief — it isn't a comment on the name."
        onRetry={retry}
      />
    )
  }

  const isPending = (row?.verdict || '').toLowerCase() === 'pending'
  const headline = clean(data?.analysis_headline)
  const bodyText = isPending
    ? clean(data?.preview_text)
    : (clean(data?.analysis_summary) || clean(data?.analysis))
  const bullets = ((isPending ? data?.preview_bullets : data?.analysis_bullets) || [])
    .map(clean).filter(Boolean)
  const quotes = (data?.key_quotes || [])
    .map((q) => ({ topic: clean(q?.topic), quote: clean(q?.quote) }))
    .filter((q) => q.quote)
  const news = (data?.news || [])
    .map((n) => ({
      headline: clean(n?.headline), source: clean(n?.source), url: clean(n?.url), time: clean(n?.time),
    }))
    // A blank href re-opens the CURRENT page in a new tab; a blank headline
    // is a link with no visible text. Both need a real headline AND a real
    // url to be worth a card.
    .filter((n) => n.headline && n.url)
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

      <div className={styles.provenance} data-testid="brief-provenance">{PROVENANCE}</div>
    </div>
  )
}
