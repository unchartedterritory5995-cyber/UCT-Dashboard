import useDarkSection from './useDarkSection'
import OffNotice from './OffNotice'
import FailedRead from './FailedRead'
import { num, fracPct, pctNum, signedPct } from './optionsFormat'
import { formatCurrency } from '../../lib/presentation/presentationPrimitives'
import styles from './optionsAnalytics.module.css'
import { usePanelFreshness, panelAsOf } from '../../components/terminal/terminalPanel'

// FT-009 straddle history, FT-007 daily implied vs actual move, FT-010 IV crush — read ONLY from
// our own options log (api/services/options_analytics/log_history.py). The log began 2026-09-30.
//
// ⛔ Each block is its own dark surface (404 renders nothing).
// ⛔ Every block states n and logging_began; a summary below its minimum is the server's
//    sentence, never a number.

const enc = encodeURIComponent
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
  const { data, hidden, failed, retry } = useDarkSection(`/api/research/options-history/${enc(sym)}/straddle`)
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
      {failed ? <FailedRead retry={retry} title="The straddle history is unavailable right now." /> : (
        <>
          {pts.length > 1 && (
            <svg className={styles.chart} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Front straddle as a percent of the underlying, by session">
              <polyline className={styles.lineGold} points={pts.map((p, i) => `${x(i)},${y(p.straddle_pct)}`).join(' ')} />
            </svg>
          )}
          <ul className={styles.list}>
            {pts.slice(-10).reverse().map((p) => (
              <li key={p.date}>{p.date}: {formatCurrency(p.straddle == null ? NaN : Number(p.straddle))} = {pctNum(p.straddle_pct)} of {num(p.underlying_price)} · expires {p.front_expiration} ({p.front_dte}d)</li>
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
  const { data, hidden, failed, retry } = useDarkSection(`/api/research/options-history/${enc(sym)}/daily-move`)
  if (hidden || (!data && !failed) || (data && !Array.isArray(data.pairs))) return null
  return (
    <section className={styles.panel} data-testid="daily-move">
      <div className={styles.head}><span className={styles.title}>Implied 1-day move vs actual</span><span className={styles.badge}>computed</span></div>
      {failed ? <FailedRead retry={retry} title="The daily move history is unavailable right now." /> : (
        <>
          <ul className={styles.list}>
            {data.pairs.slice(-20).reverse().map((p) => (
              // Audit 2026-10-08 (OHIS, point 27): inside / outside the implied move was told by
              // colour alone. The words carry it now; the colour only repeats them.
              <li key={p.date}>{p.date} → {p.next}: implied ±{pctNum(p.implied_move_pct)}, actual{' '}
                <b className={p.inside === true ? styles.gain : p.inside === false ? styles.loss : undefined}>{signedPct(p.actual_move_pct)}</b>
                {p.inside === true || p.inside === false
                  ? <span data-testid="daily-move-verdict">{p.inside ? ' inside' : ' outside'} the implied move</span>
                  : null}
                <span className={styles.muted}> ({num(p.ratio)}× implied)</span></li>
            ))}
          </ul>
          <p className={styles.facts} data-testid="daily-move-summary">
            {data.summary
              ? `Across ${data.summary.pairs} sessions the next day's move stayed inside the implied move ${pctNum(data.summary.inside_share, 0)} of the time (mean ${num(data.summary.mean_ratio)}× implied).`
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
  const { data, hidden, failed, retry } = useDarkSection(`/api/research/options-history/${enc(sym)}/iv-crush`)
  if (hidden || (!data && !failed) || (data && !Array.isArray(data.prints))) return null
  const offs = data?.offsets || []
  const cell = (v) => (v == null ? '' : fracPct(v))
  return (
    <section className={styles.panel} data-testid="iv-crush">
      <div className={styles.head}><span className={styles.title}>IV around earnings</span><span className={styles.badge}>our log</span></div>
      {failed ? <FailedRead retry={retry} title="The IV-crush table is unavailable right now." /> : (
        <>
          {data.prints.length > 0 && (
            <div className={styles.scroll}>
              <table className={styles.table} aria-label="IV around earnings">
                <thead><tr><th scope="col">Print</th>{offs.map((k) => <th scope="col" key={k}>{k > 0 ? `+${k}` : k}</th>)}<th scope="col">Crush</th></tr></thead>
                <tbody>
                  {data.prints.map((p) => (
                    <tr key={p.report_date}><th scope="row">{p.report_date}</th>{offs.map((k) => <td key={k}>{cell(p.iv[String(k)])}</td>)}
                      <td>{p.crush_pct == null ? '' : pctNum(p.crush_pct, 1)}</td></tr>
                  ))}
                  {data.summary && [['average', 'Average'], ['max', 'Max'], ['min', 'Min']].map(([s, label]) => (
                    <tr key={s}><th scope="row">{label}</th>{offs.map((k) => <td key={k}>{cell(data.summary[s]?.[String(k)])}</td>)}<td /></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {data.prints.length > 0 && (
            <p className={styles.muted} data-testid="iv-crush-key">
              Each column is a session counted from the earnings print: 0 is the last session that closed
              before the print, +1 the first session after it, -1 the session before 0. Crush is the change in
              IV from session 0 to +1.
            </p>
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
  // TERM-019: every section below is computed by UCT from Massive's options history; each dates itself.
  // The header carries the newest logged session (`as_of`, logged 16:30 ET) from the straddle
  // read -- the same SWR key <Straddle> uses, so no extra request.
  const straddle = useDarkSection(s ? optionsHistoryUrls(s)[0] : null)
  usePanelFreshness(s ? panelAsOf('UCT, computed from Massive options data', straddle.data?.as_of, { dataClass: 'end_of_day' }) : null)
  if (!s) return null
  return (
    <div data-testid="options-history">
      {offNotice && <OffNotice urls={optionsHistoryUrls(s)} feature="Options history" />}
      <Straddle sym={s} /><DailyMove sym={s} /><IvCrush sym={s} />
    </div>
  )
}
