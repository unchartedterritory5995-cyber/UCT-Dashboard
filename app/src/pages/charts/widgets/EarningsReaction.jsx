/**
 * PROTOTYPE — Earnings "Reaction".
 *
 * Reuses the research-kit's `ReactionBars` (hand-written SVG, no chart library)
 * and its `reactionStats`, so the Company Panel and the earnings modal draw the
 * same glyph from one implementation. Nothing about the geometry or the
 * statistics is re-derived here.
 *
 * THE DEFINITION IS NOT OURS TO INVENT. `reaction_pct` means what
 * `earnings_enrichment.get_historical_earnings_moves` already says it means:
 *   pre-market report  → (report-day open − prior close) / prior close
 *   post-market report → (next-day open − report-day close) / report-day close
 *   timing unknown     → whichever of those two is larger in magnitude
 * A quarter that cannot be computed keeps its slot as a gap, never borrows its
 * neighbour's number. `avg_abs_move_pct` is the average ABSOLUTE move — so the
 * summary line below says "avg move" of magnitudes and says so explicitly,
 * rather than leaving a reader to guess whether it is signed.
 */
import { useMemo } from 'react'
import { ReactionBars, reactionStats } from '../../../components/research-kit'
import styles from './dockPanels.module.css'

/**
 * @param reaction { events: [{quarter, reaction_pct, eps_actual, eps_estimate}], avg_abs_move_pct }
 *                 newest-LAST, so the strip reads left-to-right in time.
 */
export default function EarningsReaction({ reaction }) {
  const rows = useMemo(() => (reaction?.events || []).filter(Boolean), [reaction])
  const stats = useMemo(() => reactionStats(rows), [rows])

  // Two events is an anecdote; the strip claims a pattern, so it needs one.
  if (rows.length < 4 || !stats.total) return null

  return (
    <>
      <div className={styles.etSection}>
        <span className={styles.etSectionTitle}>Earnings reaction</span>
        <span className={styles.etSectionMeta}>
          <span className={styles.etSectionMetaK}>Up after</span>
          <span className={styles.etSectionMetaV}>{stats.upCount} of {stats.total}</span>
        </span>
      </div>
      <div className={styles.erChart}>
        {/* The kit names the prop `quarters`. Its own EyebrowLabel is passed
            EMPTY on purpose: it renders gold, and stacked under this section's
            gold head it put two gold labels in a row and spent the tab's whole
            accent budget on saying the same thing twice. The definition lives
            in the note below instead, where it reads as prose. */}
        {/* showValues prints each quarter's move where the outcome dot sits.
            The dot carried a second channel (solid = EPS beat, hollow = miss);
            in this narrow panel the move is the number a reader actually wants,
            and beat/miss is already on the rows above and in "EPS beat rate".
            The wider earnings modal keeps the dot. */}
        <ReactionBars quarters={rows} label="" showValues />
      </div>
      {stats.avgAbs != null && (
        <p className={styles.erNote}>
          {/* "Average move" is ambiguous on its own — this is the mean of the
              MAGNITUDES, so a +8% and a −8% quarter average to 8%, not 0%. */}
          Average move {stats.avgAbs.toFixed(1)}%, regardless of direction.
          Close to close on the session that first traded the result.
        </p>
      )}
    </>
  )
}
