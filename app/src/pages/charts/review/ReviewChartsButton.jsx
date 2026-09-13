import { useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import UIcon from '../../../components/ui/UIcon'
import { enter, publish, normaliseSymbols } from './reviewSession'
import { chartsLinkPath } from '../../../lib/chartDeepLink'
import styles from './ReviewChartsButton.module.css'

/* ─── REVIEW CHARTS — the door from an ORDERED RESULT SET into the chart ─────
 *
 * ⛔ THE HOLE THIS FILLS, and why it is a BUTTON rather than a behaviour change.
 * A scan or a screener answers with an ORDER — the sweep's order, or the
 * member's sort — and until now that order died on the results page. Every
 * symbol had a "Chart" button that opened ONE symbol, so working a 40-name scan
 * meant forty round trips through a list. The ordered set was already on
 * screen; nothing carried it to the chart.
 *
 * ⛔ IT DOES NOT CHANGE WHAT THE ROW BUTTONS DO. Tapping one result still opens
 * that one result, exactly as before — an explicit action for an explicit
 * symbol. This is a SECOND, named door for a different intent ("work through
 * these"), which is why it is a header action and not a new meaning quietly
 * attached to the existing one.
 *
 * ⛔ AND IT PUBLISHES THE ORDER THAT IS ON SCREEN, never a re-derivation. The
 * caller passes the symbols in the order the member is looking at — after their
 * sort, after the page cut — because the whole promise of "next" is that it
 * matches the list they just read. Re-sorting here would make the chart's
 * "3 / 20" describe a list nobody has seen.
 *
 * ⭐ ONE COMPONENT FOR EVERY RESULTS SURFACE. Scan results and screener results
 * are different pages with different payloads and the same intent; giving each
 * its own copy is how two surfaces start disagreeing about what a review IS
 * (which symbols, in what order, entering which shell). The disagreement would
 * be invisible — both would look correct in isolation.
 *
 * ⛔ ZERO SYMBOLS DISABLES IT, IT DOES NOT HIDE IT. A screen that ran and
 * matched nothing is a RESULT; removing the control would read as "this surface
 * doesn't support review", and the member would go looking for a feature that
 * is there. Disabled-with-a-reason says which of the two is true.
 */

/** The bars-store timeframe a review opens on. `D` matches the nightly sweep's
 *  own timeframe — a review of a daily scan that opened on 5-minute charts
 *  would be showing a different question than the one that produced the list. */
export const REVIEW_TF = 'D'

/**
 * @param {string[]} props.symbols  the ordered set, IN THE ORDER SHOWN.
 * @param {string}   props.source   which kind of surface (see `SOURCES`).
 * @param {string?}  props.sourceId the owning record's id (a def hash, a screen id).
 * @param {string}   props.label    what to call this list on the chart.
 * @param {string?}  props.sort     the ordering identity, when the surface has one.
 * @param {string}   props.tf       the timeframe the review opens on.
 */
export default function ReviewChartsButton({
  symbols,
  source = 'other',
  sourceId = null,
  label = '',
  sort = null,
  tf = REVIEW_TF,
  className = '',
  testId = 'review-charts',
}) {
  const navigate = useNavigate()

  // ⛔ NORMALISED HERE TOO, and deliberately not "just to be safe": this decides
  // whether the control is enabled, and `enter()` normalises before it counts.
  // Two different notions of "how many symbols are there" is how a button ends
  // up enabled for a set the session then refuses to build.
  const ordered = useMemo(() => normaliseSymbols(symbols), [symbols])
  const first = ordered.length ? ordered[0] : null

  const go = useCallback(() => {
    if (!first) return
    const session = enter({
      source,
      sourceId,
      label,
      symbols: ordered,
      // ⭐ THE HEAD OF THE LIST. A header-level review starts at the top because
      // that is where a member's eye is; a row-level entry (the per-row Chart
      // button) is the one that starts in the middle, and it is a different
      // gesture with a different answer.
      symbol: first,
      sort,
      // ⛔ PENDING — this entry is made on a DIFFERENT PAGE from the chart that
      // will show it. See `reviewSession.adopt()`: without the handoff the
      // chart shell's own hydrated symbol arrives first and reads as an exit.
      pending: true,
    })
    if (!session) return
    publish(session)
    // ⛔ THROUGH THE EXISTING DEEP LINK, which is the ONE door that already
    // knows how to point the charts shell at a symbol — and it applies through
    // `setGroupSym`, the workspace's own authority, then strips itself. Setting
    // the symbol some new way here would make the review a second writer of the
    // one value the chart is most sensitive about.
    navigate(chartsLinkPath({ symbol: first, tf }))
  }, [first, ordered, source, sourceId, label, sort, tf, navigate])

  const empty = ordered.length === 0
  return (
    <button
      type="button"
      className={`${styles.btn} ${className}`.trim()}
      data-testid={testId}
      disabled={empty}
      // ⚠️ THE COUNT IS IN THE ACCESSIBLE NAME. "Review charts" alone tells a
      // screen-reader member nothing about what they are about to commit to,
      // and this button navigates away from the page they are reading.
      aria-label={empty ? 'Review charts — no symbols to review' : `Review charts (${ordered.length})`}
      title={empty ? 'Nothing matched, so there are no charts to review.' : ''}
      onClick={go}
    >
      <UIcon name="chart" size={13} />
      <span className={styles.label}>Review charts</span>
      {!empty && <span className={styles.count}>{ordered.length}</span>}
    </button>
  )
}
