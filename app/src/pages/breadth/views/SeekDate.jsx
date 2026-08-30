/**
 * A date on screen, rendered as an affordance on the tab's cursor.
 *
 * ⛔ THIS COMPONENT EXISTS BECAUSE OF THE DATES IT CANNOT REACH.
 *
 * The Analogue Deck names sessions from 2025 that a 90-day window does not
 * hold; the Event Ledger can name a last-fired date older than the loaded
 * window. Rendering those as ordinary links would ship the exact dishonesty the
 * lenses' "could not evaluate" vocabulary was built to avoid — an affordance
 * that looks live and does nothing. So the button is genuinely `disabled` and
 * carries the reason, in the one sentence `breadthViewShared` owns.
 *
 * It asks `canSeek` BEFORE paint, and `canSeek` resolves through the same
 * function `onSeek` does (`views/seek.js`), so "shown as a link" and "actually
 * moves" cannot come apart.
 */
import { SEEK_OUT_OF_WINDOW } from './breadthViewShared'
import styles from './SeekDate.module.css'

export default function SeekDate({ date, onSeek, canSeek, styleKey, label, title }) {
  const reachable = date != null && (canSeek ? !!canSeek(date) : false)
  return (
    <button type="button"
            className={styles.seek}
            data-testid={`${styleKey}-seek-${date}`}
            // The one attribute every seek affordance on this tab carries,
            // whichever shape it takes — so a rail can find them all without a
            // hand-typed roster of views.
            data-seek-date={date}
            disabled={!reachable}
            aria-disabled={!reachable}
            title={reachable ? (title ?? `Move the date cursor to ${date}`) : SEEK_OUT_OF_WINDOW}
            aria-label={reachable ? `Go to ${date}` : `${date} — ${SEEK_OUT_OF_WINDOW}`}
            onClick={(e) => {
              // These sit inside cards that drill or expand; the click is about
              // the date, not the card.
              e.stopPropagation()
              onSeek?.(date)
            }}>
      {label ?? date}
    </button>
  )
}
