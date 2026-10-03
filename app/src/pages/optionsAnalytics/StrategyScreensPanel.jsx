import { useState } from 'react'
import useDarkSection from './useDarkSection'
import styles from './optionsAnalytics.module.css'

// FT-072 / FT-073 — one screener per option strategy, over COV-02's end-of-day screen file
// (api/services/options_analytics/strategy_screens.py).
//
// ⛔ DARK: the catalog route answers 404 until OPTIONS_STRATEGY_SCREENS_ENABLED; nothing renders.
// ⛔ Every result names its session and says it is the end-of-day snapshot and the fill it used.
// ⛔ Read-only: rows describe positions, nothing here places one.

const num = (v, d = 2) => (v == null || Number.isNaN(Number(v)) ? '—' : Number(v).toFixed(d))
const leg = (l) => `${l.type} ${num(l.strike)}`

function Row({ kind, r }) {
  if (kind === 'covered_calls') {
    return <tr><th>{r.underlying}</th><td>{leg(r)} {r.expiration}</td><td>{num(r.bid)}</td><td>{num(r.premium_yield_pct)}%</td><td>{num(r.annualized_pct, 1)}%</td><td>{num(r.if_called_pct)}%</td></tr>
  }
  if (kind === 'cash_secured_puts') {
    return <tr><th>{r.underlying}</th><td>{leg(r)} {r.expiration}</td><td>{num(r.bid)}</td><td>{num(r.yield_on_cash_pct)}%</td><td>{num(r.annualized_pct, 1)}%</td><td>{num(r.breakeven)} ({num(r.cushion_pct)}%)</td></tr>
  }
  const credit = r.credit != null
  return (
    <tr><th>{r.underlying}</th><td>{credit ? `sell ${leg(r.short)} / buy ${leg(r.long)}` : `buy ${leg(r.long)} / sell ${leg(r.short)}`} {r.expiration}</td>
      <td>{credit ? `+${num(r.credit)}` : `-${num(r.debit)}`}</td><td>{num(r.max_profit)}</td><td>{num(r.max_loss)}</td>
      <td>{credit ? `${num(r.return_on_risk_pct, 1)}%` : `${num(r.reward_to_risk)} : 1`}</td></tr>
  )
}

const HEADS = {
  covered_calls: ['Contract', 'Bid', 'Yield', 'Annualized', 'If called'],
  cash_secured_puts: ['Contract', 'Bid', 'On cash', 'Annualized', 'Breakeven (cushion)'],
  spread: ['Legs', 'Net', 'Max profit', 'Max loss', 'Return'],
}

export default function StrategyScreensPanel() {
  const cat = useDarkSection('/api/options-screener/strategies')
  const [kind, setKind] = useState('covered_calls')
  const [syms, setSyms] = useState('')
  const q = syms.trim() ? `?underlyings=${encodeURIComponent(syms.trim().toUpperCase())}` : ''
  const res = useDarkSection(cat.data?.strategies ? `/api/options-screener/strategy/${kind}${q}` : null)
  if (cat.hidden || !Array.isArray(cat.data?.strategies)) return null
  const heads = HEADS[kind] || HEADS.spread
  return (
    <section className={styles.panel} data-testid="strategy-screens">
      <div className={styles.head}>
        <span className={styles.title}>Strategy screens</span>
        <span className={styles.badge}>end of day</span>
        <select className={styles.select} aria-label="Strategy" value={kind} onChange={(e) => setKind(e.target.value)}>
          {cat.data.strategies.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
        <input className={styles.input} aria-label="Limit to tickers" placeholder="All tickers" value={syms} onChange={(e) => setSyms(e.target.value)} />
      </div>
      {res.failed && <p className={styles.note} data-testid="strategy-unavailable">The strategy screen is unavailable right now. That is not "nothing matched".</p>}
      {res.data && Array.isArray(res.data.rows) && (
        <>
          <p className={styles.muted} data-testid="strategy-basis">
            {res.data.description} Session {res.data.session}, {res.data.data_basis}. {res.data.fill} {res.data.matches} match{res.data.matches === 1 ? '' : 'es'} from {res.data.candidates_read} candidates read.
          </p>
          {res.data.rows.length > 0 ? (
            <div className={styles.scroll}>
              <table className={styles.table}>
                <thead><tr><th>Ticker</th>{heads.map((h) => <th key={h}>{h}</th>)}</tr></thead>
                <tbody>{res.data.rows.map((r, i) => <Row key={`${r.underlying}-${i}`} kind={kind} r={r} />)}</tbody>
              </table>
            </div>
          ) : <p className={styles.note}>No contract in the {res.data.session} snapshot passed these filters.</p>}
        </>
      )}
    </section>
  )
}
