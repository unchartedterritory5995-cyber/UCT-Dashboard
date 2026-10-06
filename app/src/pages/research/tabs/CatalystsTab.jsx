import useCatalystHistory from '../hooks/useCatalystHistory'
import Provenance from '../../../components/provenance/Provenance'
import AbsenceReceipt from '../../../components/provenance/AbsenceReceipt'
import { mapAvailability, AVAILABLE } from '../../../components/provenance/availabilityContract'
import { epochSecondsToIso } from '../../../components/provenance/presentationFormat'
import ResearchLoading from '../ResearchLoading'
import styles from '../ResearchPage.module.css'
import HighlightThesis, { FAILED_SYNTHESIS_NOTE, hasNoWriteup } from '../../../utils/highlightThesis'
import { CATALYST_TAG, CATALYST_TAGS, keyedBy } from '../../../lib/taxonomy/a8Taxonomy'

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

// Keyed by A8's tag vocabulary (TERM-075) and checked against it at load.
const TAG_CLASS = keyedBy(CATALYST_TAGS, { Earnings: styles.gold, Catalyst: styles.up, Gapper: styles.up, News: styles.muted })

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
  const { data, isLoading, error, paywalled, mutate } = useCatalystHistory(sym)

  if (isLoading) {
    return <ResearchLoading label="Loading catalyst history" />
  }

  if (paywalled) {
    return <div className={styles.fnote} data-testid="catalysts-paywalled">Catalyst history requires a paid plan.</div>
  }

  // TERM-088 -- a failed read is not a genuinely empty catalyst history.
  // Render the error distinctly so a backend hiccup never reads as "no
  // catalysts recorded for this ticker yet".
  if (error) {
    return (
      <div className={styles.fnote} data-testid="catalysts-error">
        Couldn't load catalyst history for this ticker.
        {' '}
        <button type="button" className={styles.basisBtn} onClick={() => mutate()}>Retry</button>
      </div>
    )
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
                <div className={styles.rowBody}>
                  <div className={styles.rowHead}>
                    <span className={TAG_CLASS[e.tag] || styles.muted}>{e.tag || CATALYST_TAG.CATALYST}</span>
                    <span className={styles.muted}>{whenLabel(e.market_date)}</span>
                  </div>
                  {hasNoWriteup(e)
                    ? <p className={styles.rowNote} data-testid="catalyst-no-writeup">{FAILED_SYNTHESIS_NOTE}</p>
                    : e.thesis_text ? <p className={styles.rowNote}><HighlightThesis text={e.thesis_text} /></p> : null}
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

      {/* TERM-057: the same "why isn't X here" receipt the Catalyst tile mounts,
          fixed to this ticker. The explain route answers exactly one question --
          this ticker against TODAY's curated list -- which is the question this
          page is asked when the history above has no entry for today. */}
      {sym ? (
        <section className={styles.card} data-testid="catalyst-absence">
          <div className={styles.ct}>Today&apos;s catalyst list</div>
          <AbsenceReceipt ticker={sym} />
        </section>
      ) : null}
    </div>
  )
}

export { whenLabel }
