// One result row on an RS screen (unit U5): the row a starter's `row` describes. ResultList
// renders it INSTEAD of its own row only for such a starter; every other screen keeps today's.
//
//   [place]  TICKER                     RS 97   ~spark~   price
//            Setup words · group          [tag]           change
//
// The same memo contract as ResultRow: primitives (the place, the caption, the tag, the live
// price and change) plus stable references (the row object, `onSelect`, the hub cursor's
// constant prop objects), so a price tick re-renders one row. No button inside: the row is a
// listbox option.
//
// Screen-reader order is the DOM order: place, ticker, "RS Rating 97", caption, tag. The grid
// (RsScreens.module.css) only decides where each sits.
import { memo } from 'react'
import Sparkline from '../../../components/Sparkline'
import { leadOf, NEW_TAG } from './rsRows'
import { fmtPrice, fmtChg } from './rowNumbers'
import focus from './FocusScreener.module.css'
import styles from './RsScreens.module.css'

const RsResultRow = memo(function RsResultRow({ r, i, sel, price, chg, onRadar, onSelect, hubProps, showCompany, spark, hasPlace, place, caption, tag }) {
  const lead = leadOf(r)
  return (
    <div id={`focus-opt-${r.ticker}`} role="option" aria-selected={sel}
      data-index={i} data-testid={`focus-row-${r.ticker}`} data-rs-row=""
      className={`${focus.row} ${styles.row} ${hasPlace ? styles.rowPlaced : ''} ${sel ? focus.rowSel : ''}`}
      onClick={() => onSelect(i)} {...(hubProps || {})}>
      <span className={`${onRadar ? focus.dotOn : focus.dotOff} ${styles.radar}`}
        {...(onRadar ? { 'aria-label': 'On your radar', role: 'img' } : { 'aria-hidden': true })} />
      {/* The place column is kept (empty) for a row with no place, so the tickers stay in line. */}
      {hasPlace && (
        <span className={styles.place} data-testid="rs-place">
          {place != null && <><span className="sr-only">Place </span>{place.toLocaleString('en-US')}<span className="sr-only">, </span></>}
        </span>
      )}
      <span className={`${focus.ticker} ${styles.ticker}`}>{r.ticker}</span>
      {/* The one lead number on every RS screen. Gold from 90 up ("look here"), else the bright ink. */}
      <span className={`${styles.lead} ${lead?.top ? styles.leadTop : ''}`} data-testid="rs-lead" data-top={lead?.top ? '' : undefined}>
        {lead && <><span className="sr-only">, RS Rating {lead.value}, </span><span aria-hidden="true">RS {lead.value}</span></>}
      </span>
      <span className={styles.below}>
        {showCompany && r.company && <span className={focus.rowCompany}>{r.company}</span>}
        <span className={styles.capLine}>
          <span className={`${focus.setup} ${styles.caption}`} title={caption || undefined} data-testid="rs-caption">{caption}</span>
          {/* ONE tag. "New" is the list's existing pill; the others are plain outlined words. */}
          {tag && <span className={tag === NEW_TAG ? `${focus.newPill} ${styles.newTag}` : styles.tag} data-testid="rs-tag"><span className="sr-only">, </span>{tag}</span>}
        </span>
      </span>
      <span className={`${focus.rowSpark} ${styles.spark}`} title="Last 3 months, daily closes">
        {spark && spark.length > 1 && <Sparkline values={spark} width={56} height={20} fill={false} />}
      </span>
      <span className={`${focus.rowNums} ${styles.nums}`}>
        <span>{fmtPrice(price)}</span>
        <span className={chg > 0 ? focus.up : chg < 0 ? focus.down : focus.flat}>{fmtChg(chg)}</span>
      </span>
    </div>
  )
})
export default RsResultRow
