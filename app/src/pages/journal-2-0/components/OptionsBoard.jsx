/**
 * RH-style Options section (Phase 4): contract cards — label · contracts ·
 * expiry/DTE · mark · total return — plus a net-options-performance mini
 * chart (cumulative realized options P&L + live open point; J2 keeps no
 * per-option mark history). Broker mark only; no greeks (spec-locked).
 */
import { useMemo } from 'react'
import Sparkline from '../../../components/Sparkline'
import useJ2OptionStrategies from '../hooks/useJ2OptionStrategies'
import { buildOptionCards, netOptionsPerformance } from '../lib/optionsBoard'
import { money, moneySigned, percent } from '../../../lib/journal-2-0'
import styles from './OptionsBoard.module.css'

function fmtExpiry(iso) {
  if (!iso) return null
  const d = new Date(`${iso}T00:00:00`)
  if (Number.isNaN(d.getTime())) return null
  return `${d.toLocaleString('en-US', { month: 'short' })} ${d.getDate()}`
}

export default function OptionsBoard({ strategies = [] }) {
  const cards = useMemo(() => buildOptionCards(strategies), [strategies])
  // Closed strategies feed the realized leg of the performance curve.
  // Parents render this board only when there ARE open strategies, so this
  // fetch never fires for options-free books.
  const { strategies: closed } = useJ2OptionStrategies({ status: 'closed' })
  const perf = useMemo(
    () => netOptionsPerformance(closed, cards),
    [closed, cards],
  )

  if (!cards.length) return null

  return (
    <section aria-label="Options">
      <div className={styles.sectionHead}>
        <h3 className={styles.sectionTitle}>Options</h3>
        {perf && (
          <div className={styles.perfWrap} title="Cumulative options P&L (realized + open)">
            <span className={styles.perfLabel}>Net options P&L</span>
            <Sparkline values={perf} width={110} height={26} />
          </div>
        )}
      </div>
      <div className={styles.grid}>
        {cards.map((c) => <OptionCard key={c.key} card={c} />)}
      </div>
    </section>
  )
}

function OptionCard({ card }) {
  const tone = card.totalReturnDollar == null
    ? ''
    : card.totalReturnDollar >= 0 ? styles.pos : styles.neg
  const expiry = fmtExpiry(card.expiration)
  return (
    <div className={styles.card}>
      <div className={styles.cardLeft}>
        <div className={styles.label}>{card.label}</div>
        <div className={styles.meta}>
          {card.contracts != null && (
            <>{card.contracts} {card.contracts === 1 ? 'contract' : 'contracts'}</>
          )}
          {expiry && <> · {expiry}</>}
          {Number.isFinite(card.dte) && (
            <> · <span className={card.dte <= 5 ? styles.dteSoon : ''}>{card.dte}d</span></>
          )}
        </div>
      </div>
      <div className={styles.cardRight}>
        <div className={styles.mark}>{card.mark == null ? '—' : money(card.mark)}</div>
        <div className={`${styles.ret} ${tone}`}>
          {card.totalReturnDollar == null ? 'broker mark pending' : (
            <>
              {moneySigned(card.totalReturnDollar)}
              {card.totalReturnPct != null && (
                <> ({percent(card.totalReturnPct, { dp: 1, signed: true })})</>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
