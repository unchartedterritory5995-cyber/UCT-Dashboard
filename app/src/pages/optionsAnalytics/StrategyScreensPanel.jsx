import { useState } from 'react'
import useDarkSection from './useDarkSection'
import CoverageLine from '../../components/provenance/CoverageLine'
import styles from './optionsAnalytics.module.css'

// FT-072 / FT-073 — one screener per option strategy, over COV-02's end-of-day screen file
// (api/services/options_analytics/strategy_screens.py).
//
// ⛔ DARK: the catalog route answers 404 until OPTIONS_STRATEGY_SCREENS_ENABLED; nothing renders.
// ⛔ Every result names its session and says it is the end-of-day snapshot and the fill it used.
// ⛔ Read-only: rows describe positions, nothing here places one.
//
// lane/o-options-remainders adds two siblings, each its OWN dark surface (never gated on the first
// set's switch): FT-073 MoreStrategyScreens (OPTIONS_MORE_STRATEGY_SCREENS_ENABLED: call butterflies,
// options by expiration, block trades; multi-leg trades stated as not built) and FT-075 Sizzle
// (OPTIONS_SIZZLE_ENABLED: COV-03's unusual volume on a 5-session window).

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

function FirstScreens() {
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

// ── FT-073 remainder ───────────────────────────────────────────────────────────

function MoreRow({ kind, r }) {
  if (kind === 'call_butterflies') {
    return <tr><th>{r.underlying}</th><td>{num(r.lower.strike)} / {num(r.center.strike)} x2 / {num(r.upper.strike)} {r.expiration}</td>
      <td>-{num(r.debit)}</td><td>{num(r.max_profit)}</td><td>{num(r.reward_to_risk)} : 1</td><td>{r.breakevens.map((b) => num(b)).join(' / ')}</td></tr>
  }
  if (kind === 'by_expiration') {
    return <tr><th>{r.underlying}</th><td>{r.expiration} ({r.dte}d)</td><td>{Number(r.volume).toLocaleString()}</td>
      <td>{Number(r.open_interest).toLocaleString()}</td><td>{r.call_share_pct == null ? '—' : `${num(r.call_share_pct, 1)}%`}</td>
      <td>{r.atm_iv == null ? '—' : `${(r.atm_iv * 100).toFixed(1)}%`}</td></tr>
  }
  return <tr><th>{r.symbol}</th><td>{r.type} {num(r.strike)} {r.expiration}</td><td>{r.side}</td>
    <td>${Math.round(r.premium).toLocaleString()}</td><td>{r.contracts}</td><td>{r.time}</td></tr>
}

const MORE_HEADS = {
  call_butterflies: ['Strikes', 'Debit', 'Max profit', 'Reward', 'Breakevens'],
  by_expiration: ['Expiration', 'Volume', 'Open interest', 'Call share', 'ATM IV'],
  block_trades: ['Contract', 'Side', 'Premium', 'Contracts', 'Time'],
}

export function MoreStrategyScreens() {
  const cat = useDarkSection('/api/options-screener/more-strategies')
  const [kind, setKind] = useState('call_butterflies')
  const [syms, setSyms] = useState('')
  const q = syms.trim() ? `?underlyings=${encodeURIComponent(syms.trim().toUpperCase())}` : ''
  const res = useDarkSection(cat.data?.strategies ? `/api/options-screener/more/${kind}${q}` : null)
  if (cat.hidden || !Array.isArray(cat.data?.strategies)) return null
  const d = res.data
  return (
    <section className={styles.panel} data-testid="more-strategy-screens">
      <div className={styles.head}>
        <span className={styles.title}>More strategy screens</span>
        <span className={styles.badge}>{cat.data.strategies.find((x) => x.id === kind)?.source === 'tape' ? "today's tape" : 'end of day'}</span>
        <select className={styles.select} aria-label="More strategies" value={kind} onChange={(e) => setKind(e.target.value)}>
          {cat.data.strategies.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
        </select>
        <input className={styles.input} aria-label="Limit more screens to tickers" placeholder="All tickers" value={syms} onChange={(e) => setSyms(e.target.value)} />
      </div>
      {res.failed && <p className={styles.note} data-testid="more-unavailable">This screen is unavailable right now. That is not "nothing matched".</p>}
      {d && Array.isArray(d.rows) && (
        <>
          <p className={styles.muted} data-testid="more-basis">
            {d.description} Session {d.session || '—'}, {d.data_basis}.{d.fill ? ` ${d.fill}` : ''} {d.matches} match{d.matches === 1 ? '' : 'es'} from {d.candidates_read} read.
            {d.filters ? ` ${d.filters}` : ''}
          </p>
          {d.rows.length > 0 ? (
            <div className={styles.scroll}>
              <table className={styles.table} data-testid="more-rows">
                <thead><tr><th>Ticker</th>{MORE_HEADS[kind].map((h) => <th key={h}>{h}</th>)}</tr></thead>
                <tbody>{d.rows.map((r, i) => <MoreRow key={`${r.underlying || r.symbol}-${i}`} kind={kind} r={r} />)}</tbody>
              </table>
            </div>
          ) : <p className={styles.note}>Nothing in the {d.session || 'latest'} {d.data_basis} passed this screen.</p>}
        </>
      )}
      {Object.values(cat.data.not_built || {}).map((t) => <p key={t} className={styles.muted} data-testid="more-not-built">{t}</p>)}
    </section>
  )
}

// ── FT-075 Sizzle ──────────────────────────────────────────────────────────────

export function SizzlePanel() {
  const { data, hidden, failed } = useDarkSection('/api/options-screener/sizzle')
  if (hidden || (!data && !failed) || (data && !('method' in data))) return null
  return (
    <section className={styles.panel} data-testid="sizzle">
      <div className={styles.head}>
        <span className={styles.title}>Sizzle, 5-day</span>
        <span className={styles.badge}>computed</span>
      </div>
      {failed ? <p className={styles.note}>Sizzle is unavailable right now. That is not "no unusual volume".</p> : (
        <>
          <p className={styles.facts} data-testid="sizzle-history">
            {data.session ? `Session ${data.session}` : 'No session logged yet'} · {data.prior_sessions ?? 0} prior session{data.prior_sessions === 1 ? '' : 's'} held
            {data.available_on ? ` · the first ratio can exist on ${data.available_on}` : ''}
          </p>
          {data.note && <p className={styles.note} data-testid="sizzle-note">{data.note}</p>}
          {(data.ranked || []).length > 0 && (
            <div className={styles.scroll}>
              <table className={styles.table} data-testid="sizzle-ranked">
                <thead><tr><th>Ticker</th><th>Sizzle</th><th>Volume</th><th>5-session mean</th></tr></thead>
                <tbody>
                  {data.ranked.map((r) => (
                    <tr key={r.underlying}><th>{r.underlying}</th><td>{num(r.ratio)}x</td><td>{Number(r.volume).toLocaleString()}</td><td>{Number(r.average).toLocaleString()}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {(data.not_ranked || []).length > 0 && (
            <p className={styles.muted} data-testid="sizzle-not-ranked">
              Not ranked: {data.not_ranked.slice(0, 12).map((r) => `${r.underlying} (${r.note})`).join(', ')}
              {data.not_ranked_total > 12 ? ` and ${data.not_ranked_total - 12} more` : ''}.
            </p>
          )}
          {data.coverage && <CoverageLine coverage={data.coverage} />}
          <p className={styles.muted}>{data.method} Volume: {data.volume_rule}. {data.fallback_note || ''} {data.data_basis}.</p>
        </>
      )}
    </section>
  )
}

export default function StrategyScreensPanel() {
  return <><FirstScreens /><MoreStrategyScreens /><SizzlePanel /></>
}
