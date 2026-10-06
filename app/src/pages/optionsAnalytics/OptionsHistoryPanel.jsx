import useDarkSection from './useDarkSection'
import OffNotice from './OffNotice'
import styles from './optionsAnalytics.module.css'

// FT-009 straddle history, FT-007 daily implied vs actual move, FT-010 IV crush — read ONLY from
// our own options log (api/services/options_analytics/log_history.py). The log began 2026-09-30.
//
// ⛔ Each block is its own dark surface (404 renders nothing).
// ⛔ Every block states n and logging_began; a summary below its minimum is the server's
//    sentence, never a number.

const enc = encodeURIComponent
const num = (v, d = 2) => (v == null || Number.isNaN(Number(v)) ? '—' : Number(v).toFixed(d))
const W = 520
const H = 120
const PAD = 16

function Coverage({ data }) {
  return (
    <p className={styles.muted}>
      {data.logging_began ? `Our options log began ${data.logging_began}` : 'The options log holds no sessions yet'}
      {` · n = ${data.n ?? data.complete_prints ?? 0}`}
      {(data.missing_sessions || []).length ? ` · not logged: ${data.missing_sessions.slice(-5).join(', ')}` : ''}.
    </p>
  )
}

function Straddle({ sym }) {
  const { data, hidden, failed } = useDarkSection(`/api/research/options-history/${enc(sym)}/straddle`)
  if (hidden || (!data && !failed) || (data && !Array.isArray(data.points))) return null
  const pts = data?.points || []
  const ys = pts.map((p) => p.straddle_pct)
  const lo = Math.min(...ys)
  const hi = Math.max(...ys)
  const x = (i) => PAD + (pts.length > 1 ? (i / (pts.length - 1)) * (W - 2 * PAD) : 0)
  const y = (v) => (hi === lo ? H / 2 : H - PAD - ((v - lo) / (hi - lo)) * (H - 2 * PAD))
  return (
    <section className={styles.panel} data-testid="straddle-history">
      <div className={styles.head}><span className={styles.title}>ATM straddle history</span><span className={styles.badge}>our log</span></div>
      {failed ? <p className={styles.note}>The straddle history is unavailable right now.</p> : (
        <>
          {pts.length > 1 && (
            <svg className={styles.chart} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Front straddle as a percent of the underlying, by session">
              <polyline className={styles.lineGold} points={pts.map((p, i) => `${x(i)},${y(p.straddle_pct)}`).join(' ')} />
            </svg>
          )}
          <ul className={styles.list}>
            {pts.slice(-10).reverse().map((p) => (
              <li key={p.date}>{p.date}: ${num(p.straddle)} = {num(p.straddle_pct)}% of {num(p.underlying_price)} · expires {p.front_expiration} ({p.front_dte}d)</li>
            ))}
          </ul>
          {pts.length === 0 && <p className={styles.note}>No logged session has a two-sided front straddle for {sym}.</p>}
          <Coverage data={data} />
          <p className={styles.muted}>{data.method}</p>
        </>
      )}
    </section>
  )
}

function DailyMove({ sym }) {
  const { data, hidden, failed } = useDarkSection(`/api/research/options-history/${enc(sym)}/daily-move`)
  if (hidden || (!data && !failed) || (data && !Array.isArray(data.pairs))) return null
  return (
    <section className={styles.panel} data-testid="daily-move">
      <div className={styles.head}><span className={styles.title}>Implied 1-day move vs actual</span><span className={styles.badge}>computed</span></div>
      {failed ? <p className={styles.note}>The daily move history is unavailable right now.</p> : (
        <>
          <ul className={styles.list}>
            {data.pairs.slice(-20).reverse().map((p) => (
              <li key={p.date}>{p.date} → {p.next}: implied ±{num(p.implied_move_pct)}%, actual{' '}
                <b className={p.inside ? styles.gain : styles.loss}>{p.actual_move_pct > 0 ? '+' : ''}{num(p.actual_move_pct)}%</b>
                <span className={styles.muted}> ({num(p.ratio)}× implied)</span></li>
            ))}
          </ul>
          <p className={styles.facts} data-testid="daily-move-summary">
            {data.summary
              ? `Across ${data.summary.pairs} sessions the next day's move stayed inside the implied move ${num(data.summary.inside_share, 0)}% of the time (mean ${num(data.summary.mean_ratio)}× implied).`
              : data.summary_note}
          </p>
          <Coverage data={data} />
          <p className={styles.muted}>{data.method}</p>
        </>
      )}
    </section>
  )
}

function IvCrush({ sym }) {
  const { data, hidden, failed } = useDarkSection(`/api/research/options-history/${enc(sym)}/iv-crush`)
  if (hidden || (!data && !failed) || (data && !Array.isArray(data.prints))) return null
  const offs = data?.offsets || []
  const cell = (v) => (v == null ? '' : `${(v * 100).toFixed(1)}%`)
  return (
    <section className={styles.panel} data-testid="iv-crush">
      <div className={styles.head}><span className={styles.title}>IV around earnings</span><span className={styles.badge}>our log</span></div>
      {failed ? <p className={styles.note}>The IV-crush table is unavailable right now.</p> : (
        <>
          {data.prints.length > 0 && (
            <div className={styles.scroll}>
              <table className={styles.table}>
                <thead><tr><th>Print</th>{offs.map((k) => <th key={k}>{k > 0 ? `+${k}` : k}</th>)}<th>Crush</th></tr></thead>
                <tbody>
                  {data.prints.map((p) => (
                    <tr key={p.report_date}><th>{p.report_date}</th>{offs.map((k) => <td key={k}>{cell(p.iv[String(k)])}</td>)}
                      <td>{p.crush_pct == null ? '' : `${num(p.crush_pct, 1)}%`}</td></tr>
                  ))}
                  {data.summary && ['average', 'max', 'min'].map((s) => (
                    <tr key={s}><th>{s}</th>{offs.map((k) => <td key={k}>{cell(data.summary[s][String(k)])}</td>)}<td /></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {!data.summary && <p className={styles.note} data-testid="iv-crush-note">{data.summary_note}</p>}
          <p className={styles.muted}>{data.method}</p>
        </>
      )}
    </section>
  )
}

// The three routes this panel reads (OffNotice asks the same keys; SWR shares the request).
export const optionsHistoryUrls = (s) => ['straddle', 'daily-move', 'iv-crush']
  .map((k) => `/api/research/options-history/${enc(s)}/${k}`)

// `offNotice`: set by the terminal's OHIS, which opens this panel on its own.
export default function OptionsHistoryPanel({ sym, offNotice = false }) {
  const s = (sym || '').toUpperCase().trim()
  if (!s) return null
  return (
    <div data-testid="options-history">
      {offNotice && <OffNotice urls={optionsHistoryUrls(s)} feature="Options history" />}
      <Straddle sym={s} /><DailyMove sym={s} /><IvCrush sym={s} />
    </div>
  )
}
