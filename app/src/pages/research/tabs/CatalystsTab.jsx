import useCatalystHistory from '../hooks/useCatalystHistory'
import Provenance from '../../../components/provenance/Provenance'
import { mapAvailability, AVAILABLE } from '../../../components/provenance/availabilityContract'
import { epochSecondsToIso } from '../../../components/provenance/presentationFormat'
import styles from '../ResearchPage.module.css'

// Packet G CP1 -- the "what has UCT's own catalyst engine ever flagged about
// this ticker" tab. Signed by the owner 2026-09-22 (fingerprint 5331c90c2).
//
// ⛔ Provenance is PER ENTRY, not once for the whole list (unlike NewsTab's
// TrustStrip). NewsTab's `_meta` is one object describing one API call's
// fetch; a catalyst history spans many dates, each synthesized by whichever
// model was configured at the time (`thesis_model`) at its own moment
// (`thesis_at`) -- there is no single timestamp that honestly describes the
// whole list. Citing the newest entry's data for every row would overstate
// how fresh the older ones are; citing nothing (Provenance's own
// "provenance-degraded" state) would throw away real per-entry data this
// engine already records. So each entry gets its own real citation.
//
// ⛔ Never `FreshnessBadge` here. It renders LIVE/delayed/stale off a vendor
// freshness class for a value read RIGHT NOW; every row is a historical
// record whose only honest "as of" is its own `market_date` -- not
// staleness, and rendering it as one would be a misuse of that component's
// actual contract (see FreshnessBadge.jsx's own header).
function whenLabel(marketDate) {
  if (!marketDate) return 'Date unknown'
  const t = Date.parse(`${marketDate}T12:00:00`)
  if (!Number.isFinite(t)) return marketDate
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

const TAG_CLASS = { Earnings: styles.gold, Catalyst: styles.up, Gapper: styles.up, News: styles.muted }

function EntryProvenance({ entry }) {
  const availability = mapAvailability({ value: true, degraded: false })
  const provenance = availability === AVAILABLE ? {
    sourceActivity: entry.thesis_model || null,
    timestamp: epochSecondsToIso(entry.thesis_at),
    tieBreak: null,
  } : null
  return (
    <Provenance value="UCT Catalyst Engine" availability={availability} provenance={provenance} density="ondemand" />
  )
}

export default function CatalystsTab({ sym }) {
  const { data, isLoading } = useCatalystHistory(sym)

  if (isLoading) {
    return <div className={styles.soon}><div className={styles.soonInner}><div className={styles.soonSub}>Loading catalyst history…</div></div></div>
  }

  const entries = (data && data.entries) || []

  return (
    <div className={styles.finWrap}>
      {!!entries.length && (
        <section className={styles.card}>
          <div className={styles.ct}>Catalyst history</div>
          <ul className={styles.newsList} data-testid="catalyst-history-list">
            {entries.map((e, i) => (
              <li key={`${e.market_date}-${i}`} className={styles.newsItem}>
                <div style={{ width: '100%' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className={TAG_CLASS[e.tag] || styles.muted}>{e.tag || 'Catalyst'}</span>
                    <span className={styles.muted}>{whenLabel(e.market_date)}</span>
                  </div>
                  {e.thesis_text ? <p className={styles.fnote} style={{ padding: '4px 0 0' }}>{e.thesis_text}</p> : null}
                  <EntryProvenance entry={e} />
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {!entries.length && (
        <div className={styles.fnote} data-testid="catalyst-history-empty">
          No catalysts recorded for this ticker yet.
        </div>
      )}
    </div>
  )
}

export { whenLabel }
