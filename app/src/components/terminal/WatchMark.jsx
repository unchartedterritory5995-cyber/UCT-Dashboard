// UCT Terminal — the ONE watchlist mark (owner request 2026-11-17): a small filled star after a
// name that is on the member's watchlists or their Flagged list. The same glyph the calendar and
// the catalyst table already use for "one of yours", in the text colour.
//
// ⛔ NEVER GOLD. A list can carry many of these, and gold is kept for what is current or chosen
// (docs/uct-signature-style.md §2b: "a long list never turns gold").
// ⛔ NEVER COLOUR ALONE. It is a shape, and it has words: the row's button says "on your
// watchlist" in its accessible name, and a mark that stands alone is a named image.
//
//   <PanelSymbol sym="NVDA" />        the kit's symbol cell draws it; most lists need nothing else
//   <WatchMark sym={r.sym} overlay /> a panel with its own row button places it after the name
//
// `overlay` gives the mark NO width: it hangs in the cell's own padding, so marking a name never
// moves a column. Use it only where nothing follows the name; without it the mark sits in the
// line like a letter.
import UIcon from '../ui/UIcon'
import { useWatchMark, watchMarkWords } from './watchMarks'
import styles from './WatchMark.module.css'

/** The glyph for a mark the caller already looked up. `decorative` hides it from assistive tech
 *  (the caller's own accessible name carries the words). */
export function WatchMarkGlyph({ mark, decorative = false, overlay = false, className = '' }) {
  const words = watchMarkWords(mark)
  if (!words) return null
  return (
    <span className={`${styles.mark}${overlay ? ` ${styles.overlay}` : ''}${className ? ` ${className}` : ''}`}
      data-testid="watch-mark" data-watch-mark={mark.lists?.length ? 'watchlist' : 'flagged'}>
      <UIcon name="star-fill" size={10} gold={false} title={decorative ? undefined : words.title} />
    </span>
  )
}

export default function WatchMark({ sym, overlay = false, className = '' }) {
  const mark = useWatchMark(sym)
  return mark ? <WatchMarkGlyph mark={mark} overlay={overlay} className={className} /> : null
}
