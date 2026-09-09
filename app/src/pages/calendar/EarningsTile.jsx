// app/src/pages/calendar/EarningsTile.jsx
// The hero tile on the Board (WeekView) view: a big rounded company logo +
// ticker + one signal (reported BEAT/MISS or options move). Company name
// reveals on hover. EarningsHub/EarningsWhispers-style — the logo IS the
// content. (Feed switched fully to CalendarDayTable's row grammar
// 2026-07-14 -- this tile is Board-only now.)
import CompanyLogo from '../../components/CompanyLogo'
import UIcon from '../../components/ui/UIcon'
import { MoveUnavailableMark } from './cardBits'
import styles from './Calendar.module.css'

export default function EarningsTile({ e, onSelect, size = 54, longPressProps }) {
  const reported = e.eps_act != null
  const surp = (reported && e.eps_est != null && e.eps_est !== 0)
    ? ((e.eps_act - e.eps_est) / Math.abs(e.eps_est)) * 100 : null
  const em = e.expected_move?.pct
  return (
    <button className={styles.etile} onClick={() => onSelect?.(e, e._timing)}
            title={e.name ? `${e.sym} · ${e.name}` : e.sym}
            /* Seam 19: whole-tile long-press/right-click -- the compact
               logo+sym+signal square is one visual unit, matching
               EarningsCard.jsx's own whole-card precedent. Tap (the
               button's own onClick) is unaffected: the hook's click-capture
               guard only swallows the synthetic click that immediately
               follows a long-press firing. */
            {...(longPressProps ? longPressProps(e.sym) : {})}>
      <span className={`${styles.etileLogo} ${e.mine ? styles.etileMine : ''}`}
            style={{ width: size, height: size }}>
        <CompanyLogo sym={e.sym} size={size} tile />
        {e.mine && <span className={styles.etileStar}><UIcon name="star-fill" size={11} /></span>}
      </span>
      <span className={styles.etileSym}>{e.sym}</span>
      {/* Third branch: a move the server REFUSED to price says so, instead of
          leaving the tile silently one line short. Renders null when there is
          no outcome — a pending tile is unchanged. */}
      {reported && surp != null
        ? <span className={surp >= 0 ? styles.etileBeat : styles.etileMiss}>{surp >= 0 ? 'BEAT' : 'MISS'}</span>
        : em != null
          ? <span className={styles.etileEm}>±{em}%</span>
          : <MoveUnavailableMark outcome={e.expected_move_outcome} className={styles.etileNa} />}
      {e.name && <span className={styles.etileName}>{e.name}</span>}
    </button>
  )
}
