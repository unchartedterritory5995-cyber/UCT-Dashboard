/**
 * The Read's strip — slim, always visible, above the visualization.
 *
 * All it does is gather inputs and render sentences. The composition is in
 * `theRead.js`, pure and framework-free, so what the paragraph says is testable
 * without rendering anything.
 *
 * ═══ WHY THIS COMPONENT CANNOT ISSUE A REQUEST ══════════════════════════════
 *
 * Two of the seven clauses quote endpoints (Analogue Deck, Score Attribution),
 * and spec §4 forbids The Read from ever triggering a fetch — it is a strip
 * that is on screen for every reader on every style, so a fetch here would be a
 * request per page view for data most readers never asked for.
 *
 * ⭐ `useSWR(key, null)` IS A CACHE READ. SWR's revalidate returns early when
 * there is no fetcher (`if (!key || !currentFetcher) return false`), so a null
 * fetcher subscribes to the cache entry and never calls anything. `data` is
 * whatever the lens that DOES fetch has already stored, or `undefined` when it
 * has not run. Measured, not assumed: `TheReadStrip.test.jsx` spies on
 * `globalThis.fetch` through a real render and asserts zero calls — with a
 * control mounting the fetching lens beside it to prove the spy can see one.
 *
 * ⛔ AND IT MOUNTS NOTHING THAT FETCHES. It imports `composeRead` and the key
 * builders, never `AnalogueDeckView` or `ScoreAttributionView`. Rendering a
 * lens to "get its data" would be the same defect wearing a different hat.
 *
 * ⛔ THE KEYS ARE NOT TYPED HERE. `breadthEndpoints.js` builds them and the two
 * fetching lenses call the same functions, because a cache read only lands on a
 * byte-identical key and a near-miss fails SILENTLY — indistinguishable from
 * "that lens has not been opened yet".
 */
import useSWR from 'swr'
import { composeRead } from './theRead'
import { analoguesKey, attributionKey } from './breadthEndpoints'
import styles from './theRead.module.css'

export default function TheReadStrip({
  rows = [], rowIdx = 0, optionsFor, ladderMetrics = [],
}) {
  const currentDate = rows[rowIdx]?.date ?? rows[0]?.date ?? null
  const analogueTopN = Number(optionsFor?.('analogues')?.matches ?? 5)

  // Cache reads. No fetcher ⇒ no request, ever. See the header.
  const { data: analogueData } = useSWR(analoguesKey(analogueTopN), null)
  const { data: attributionData } = useSWR(attributionKey(currentDate, rows.length), null)

  const read = composeRead({
    rows, rowIdx, optionsFor, ladderMetrics,
    analogueData: analogueData ?? null,
    attributionData: attributionData ?? null,
  })

  return (
    <div className={styles.strip} data-testid="the-read">
      <span className={styles.kicker}>The Read</span>
      {read.clauses.length ? (
        <p className={styles.body}>
          {read.clauses.map(c => (
            <span key={c.key} className={styles.clause} data-testid={`the-read-clause-${c.key}`}>
              {c.text}
            </span>
          ))}
        </p>
      ) : (
        /* ⛔ NOT A HEDGE, AND NOT A BLANK PANEL. Nothing composable is a fact
           about the loaded data, so it is stated as one, with the number that
           makes it checkable — the same vocabulary the lenses use when they
           refuse. It never stands in for a clause whose source was present. */
        <span className={styles.refusal} data-testid="the-read-refusal">
          Nothing readable yet from the {read.windowLength} session
          {read.windowLength === 1 ? '' : 's'} at this cursor.
        </span>
      )}
    </div>
  )
}
