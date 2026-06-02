// app/src/pages/calendar/EventCard.jsx
// Renders IPO, dividend, and split event cards (non-earnings).
// Used in FeedView DayGroup when the matching event-type chip is enabled.
import CompanyLogo from '../../components/CompanyLogo'
import styles from './Calendar.module.css'

// ── Formatters ────────────────────────────────────────────────────────────────

function fmtShares(n) {
  if (n == null) return null
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B shares`
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M shares`
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}K shares`
  return `${n} shares`
}

function fmtValue(v) {
  if (v == null) return null
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`
  if (v >= 1e6) return `$${(v / 1e6).toFixed(0)}M`
  return `$${v.toFixed(0)}`
}

// ── IPO status pill color ─────────────────────────────────────────────────────

function statusClass(status) {
  if (!status) return ''
  const s = status.toLowerCase()
  if (s === 'priced')    return styles.evtStatusPriced
  if (s === 'expected')  return styles.evtStatusExpected
  if (s === 'filed')     return styles.evtStatusFiled
  return styles.evtStatusDefault
}

// ── IPO Card ──────────────────────────────────────────────────────────────────

function IpoCard({ event }) {
  const sym    = event.sym || ''
  const name   = event.name || sym || 'Unknown'
  const exch   = event.exchange || null
  const price  = event.price_range || null
  const shares = fmtShares(event.shares)
  const value  = fmtValue(event.value)
  const status = event.status || null

  return (
    <div className={`${styles.card} ${styles.evtCard} ${styles.evtCardIpo}`}>
      <div className={styles.evtTypeTag}>IPO</div>
      <div className={styles.cardTop}>
        <CompanyLogo sym={sym || '?'} size={38} />
        <div>
          <div className={styles.sym}>
            {sym || '—'}
            {status && (
              <span className={`${styles.tpill} ${statusClass(status)}`}>
                {status.toUpperCase()}
              </span>
            )}
          </div>
          <div className={styles.nm}>{name}</div>
        </div>
      </div>
      {price && (
        <div className={styles.met}>
          <span className={styles.dim}>Price range</span>
          <span className={styles.mono}>{price}</span>
        </div>
      )}
      {shares && (
        <div className={styles.met}>
          <span className={styles.dim}>Offering</span>
          <span className={styles.mono}>{shares}{value ? ` · ${value}` : ''}</span>
        </div>
      )}
      {exch && (
        <div className={styles.met}>
          <span className={styles.dim}>Exchange</span>
          <span className={styles.mono}>{exch}</span>
        </div>
      )}
    </div>
  )
}

// ── Dividend Card ──────────────────────────────────────────────────────────────

function DividendCard({ event }) {
  const sym    = event.sym || ''
  const amount = event.amount != null ? `$${event.amount.toFixed(4)}` : null
  const exDate = event.date || null

  return (
    <div className={`${styles.card} ${styles.evtCard} ${styles.evtCardDiv}`}>
      <div className={styles.evtTypeTag}>DIV</div>
      <div className={styles.cardTop}>
        <CompanyLogo sym={sym || '?'} size={38} />
        <div>
          <div className={styles.sym}>{sym || '—'}</div>
          <div className={styles.nm}>Ex-Dividend</div>
        </div>
      </div>
      {exDate && (
        <div className={styles.met}>
          <span className={styles.dim}>Ex-date</span>
          <span className={styles.mono}>{exDate}</span>
        </div>
      )}
      {amount && (
        <div className={styles.met}>
          <span className={styles.dim}>Amount</span>
          <span className={styles.mono}>{amount} / share</span>
        </div>
      )}
    </div>
  )
}

// ── Split Card ────────────────────────────────────────────────────────────────

function SplitCard({ event }) {
  const sym   = event.sym || ''
  const ratio = event.ratio || null
  const date_ = event.date || null

  return (
    <div className={`${styles.card} ${styles.evtCard} ${styles.evtCardSplit}`}>
      <div className={styles.evtTypeTag}>SPLIT</div>
      <div className={styles.cardTop}>
        <CompanyLogo sym={sym || '?'} size={38} />
        <div>
          <div className={styles.sym}>{sym || '—'}</div>
          <div className={styles.nm}>Stock Split</div>
        </div>
      </div>
      {date_ && (
        <div className={styles.met}>
          <span className={styles.dim}>Date</span>
          <span className={styles.mono}>{date_}</span>
        </div>
      )}
      {ratio && (
        <div className={styles.met}>
          <span className={styles.dim}>Ratio</span>
          <span className={styles.mono}>{ratio}</span>
        </div>
      )}
    </div>
  )
}

// ── Unified EventCard ─────────────────────────────────────────────────────────

/**
 * EventCard — renders an IPO, dividend, or split event card.
 *
 * Props:
 *   event   { sym, type: 'ipo'|'dividend'|'split', ...fields }
 *           IPO:      { sym, name, date, exchange, price_range, shares, value, status }
 *           dividend: { sym, type='dividend', date, amount }
 *           split:    { sym, type='split',    date, ratio }
 */
export default function EventCard({ event }) {
  if (!event) return null
  const type = (event.type || '').toLowerCase()
  if (type === 'ipo')      return <IpoCard event={event} />
  if (type === 'dividend') return <DividendCard event={event} />
  if (type === 'split')    return <SplitCard event={event} />
  return null
}
