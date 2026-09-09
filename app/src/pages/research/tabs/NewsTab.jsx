import useCompanyNews from '../hooks/useCompanyNews'
import Provenance from '../../../components/provenance/Provenance'
import FreshnessBadge from '../../../components/provenance/FreshnessBadge'
import { mapAvailability, AVAILABLE } from '../../../components/provenance/availabilityContract'
import { epochSecondsToIso } from '../../../components/provenance/presentationFormat'
import { computeSessionStale } from '../../../components/provenance/sessionStale'
import { sessionModel } from '../../../components/dashboard/sessionModel'
import useMarketOpen from '../../../hooks/useMarketOpen'
import styles from '../ResearchPage.module.css'

// A8 News/Intelligence Slice 1 (owner-authorized narrow slice,
// 2026-09-04, CURATED / SECURITY-SCOPED FIRST). Same per-list TrustStrip
// idiom as AnalystRatingsTab.jsx's own copy -- one envelope for the whole
// merged feed, not per-article, matching S8's established "one envelope
// per LEG/list" precedent (analyst_grades.py's `_recent_actions`, the A5
// calendar precedent it itself cites). Copied locally rather than shared,
// per this codebase's "until a third caller justifies promoting it"
// convention.
function TrustStrip({ meta, sessionContext }) {
  if (!meta) return null
  const availability = mapAvailability({ value: true, degraded: meta.degraded })
  const asOfIso = epochSecondsToIso(meta.sourceObservedAt)
  const sessionStale = computeSessionStale(asOfIso)
  return (
    <div className={styles.muted} style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
      <Provenance
        value="FMP"
        availability={availability}
        provenance={availability === AVAILABLE ? {
          sourceActivity: meta.sourceActivity,
          timestamp: asOfIso,
          tieBreak: meta.tieBreak,
        } : null}
      />
      {availability === AVAILABLE && (
        <FreshnessBadge
          freshnessClass={meta.freshnessClass}
          asOf={asOfIso}
          sessionState={sessionContext}
          sessionStale={sessionStale}
        />
      )}
    </div>
  )
}

// "2026-08-09 18:00:00" (FMP's ET wall-clock string, no zone -- see
// research/news.py's `_published_at` docstring) -> "2h ago" / "Aug 9".
// Honestly reports unknown rather than the legacy NewsSection.jsx
// component's silent blank (owner instruction, 2026-09-04: "mark the
// date/time honestly as unknown/unavailable", not touched there since
// that component is a preserved compatibility bridge).
export function whenLabel(iso, now = Date.now()) {
  if (!iso) return 'Date unknown'
  const t = Date.parse(String(iso).replace(' ', 'T'))
  if (!Number.isFinite(t)) return 'Date unknown'
  const mins = Math.floor((now - t) / 60000)
  if (mins < 0) return 'just now'
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 7) return `${days}d ago`
  const d = new Date(t)
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function hideBrokenImage(e) {
  e.currentTarget.style.display = 'none'
}

export default function NewsTab({ sym }) {
  const { data, isLoading } = useCompanyNews(sym)
  const session = useMarketOpen()

  if (isLoading) {
    return <div className={styles.soon}><div className={styles.soonInner}><div className={styles.soonSub}>Loading news…</div></div></div>
  }

  const e = data || {}
  const items = e.items || []
  const sessionContext = sessionModel(session)

  return (
    <div className={styles.finWrap}>
      {e.entity && e.entity.status !== 'resolved' && (
        <div className={styles.muted} style={{ fontSize: 11 }} data-testid="entity-unresolved-note">
          Symbol not yet linked to a canonical identity ({e.entity.status}).
        </div>
      )}

      {!!items.length && (
        <section className={styles.card}>
          <div className={styles.ct}>Company news</div>
          <ul className={styles.newsList} data-testid="news-list">
            {items.map((it, i) => (
              <li key={`${it.id}-${i}`} className={styles.newsItem}>
                {it.image && (
                  <img className={styles.newsThumb} src={it.image} alt="" onError={hideBrokenImage} />
                )}
                <div className={styles.newsBody}>
                  <div className={styles.newsMeta}>
                    <span className={it.kind === 'release' ? styles.newsKindRelease : styles.newsKindWire}>
                      {it.kind === 'release' ? 'PR' : 'NEWS'}
                    </span>
                    <span className={styles.newsPub}>{it.publisher || 'Unknown source'}</span>
                    <span className={styles.newsWhen}>{whenLabel(it.published_at)}</span>
                  </div>
                  {/* rel=noopener: these are third-party links and must not
                      get a handle on this window. */}
                  <a className={styles.newsTitle} href={it.url} target="_blank" rel="noopener noreferrer">
                    {it.headline}
                  </a>
                  {it.summary ? <p className={styles.newsSummary}>{it.summary}</p> : null}
                </div>
              </li>
            ))}
          </ul>
          <TrustStrip meta={e._meta} sessionContext={sessionContext} />
        </section>
      )}

      {!items.length && <div className={styles.fnote}>No recent news for this ticker.</div>}
    </div>
  )
}
