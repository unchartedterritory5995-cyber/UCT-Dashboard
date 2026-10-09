import useSWR from 'swr'
import { sectionFetcher } from '../../../components/research/sections/sectionFetch'
import { fractionPct } from '../researchFormat'
import styles from './OptionsChainTab.module.css'
import OffNotice from '../../optionsAnalytics/OffNotice'
import FailedRead from '../../optionsAnalytics/FailedRead'
import { num as optNum } from '../../optionsAnalytics/optionsFormat'
import { memberText } from '../../../lib/presentation/memberCopy'
import { usePanelFreshness } from '../../../components/terminal/terminalPanel'

// RM-L01 (IV-history half) + RM-L02 (BRK-10 first slice): IV history read ONLY from our own
// options log (api/services/research/iv_history.py). Massive sells no IV history, so this is
// what the log has recorded forward since it began -- and it says exactly that.
//
// ⛔ DARK: both endpoints answer 404 until IV_HISTORY_ENABLED is set, and a 404 renders NOTHING.
// ⛔ Every point is printed with its date and the days-to-expiry it was read at.
// ⛔ No rank below 20 sessions and no calibration below 4 prints: the server's sentence is shown
//    in their place, never a number.
// ⛔ Polling: none. The log grows once a trading day; bare useSWR with no refreshInterval.

const KNOWN = new Set(['ok', 'not_in_log', 'no_log'])
const pct = (v, d = 1) => fractionPct(v, d)
const num = (v, d = 1) => optNum(v, d)

function Spark({ points }) {
  const ivs = points.map((p) => p.atm_iv)
  if (ivs.length < 2) return null
  const lo = Math.min(...ivs)
  const hi = Math.max(...ivs)
  const W = 320
  const H = 60
  const x = (i) => (i / (ivs.length - 1)) * (W - 8) + 4
  const y = (v) => (hi === lo ? H / 2 : H - 4 - ((v - lo) / (hi - lo)) * (H - 8))
  return (
    <svg className={styles.payoffChart} viewBox={`0 0 ${W} ${H}`} role="img" data-testid="iv-spark"
      aria-label={`ATM IV from ${points[0].date} to ${points[points.length - 1].date}`}>
      <polyline className={styles.payoffLine} fill="none" points={ivs.map((v, i) => `${x(i)},${y(v)}`).join(' ')} />
    </svg>
  )
}

function ImpliedVsRealized({ sym }) {
  const { data, error, mutate } = useSWR(`/api/research/iv-history/${encodeURIComponent(sym)}/implied-vs-realized`,
    sectionFetcher, { revalidateOnFocus: false })
  // Audit 2026-10-08 (IVH P2 point 8): a failed read returned null, so the earnings block silently
  // vanished. A 404 (switched off) still renders nothing; any other failure says so, with a Retry.
  if (error && error.status !== 404) {
    return <FailedRead testId="ivr-unavailable" retry={mutate}
      title="The implied-vs-realized earnings comparison is unavailable right now." />
  }
  if (error || !data || data.paywalled || !Array.isArray(data.prints)) return null
  const shown = data.prints.filter((p) => p.implied_move_pct != null || p.note)
  return (
    <div data-testid="ivr">
      <div className={styles.volHead}>Implied vs realized move at earnings (our log)</div>
      {shown.length > 0 && (
        <ul className={styles.volList} data-testid="ivr-prints">
          {shown.map((p) => (
            <li key={p.report_date}>
              {p.report_date}: implied {p.implied_move_pct == null ? '—' : `±${num(p.implied_move_pct, 2)}%`}
              {' '}(close {p.pre_print_session}), realized {p.realized_move_pct == null ? '—' : `${num(p.realized_move_pct, 2)}%`}
              {p.ratio != null ? ` · ${num(p.ratio, 2)}× implied` : ''}
              {p.note ? <span className={styles.muted}> — {p.note}</span> : null}
            </li>
          ))}
        </ul>
      )}
      {data.calibration ? (
        <p className={styles.payoffFacts} data-testid="ivr-calibration">
          Across {data.calibration.prints} prints the realized move averaged {num(data.calibration.mean_ratio, 2)}× the
          implied move, and landed inside it {num(data.calibration.inside_share, 0)}% of the time.
        </p>
      ) : (
        <p className={styles.note} data-testid="ivr-note">{data.calibration_note}</p>
      )}
      <p className={styles.muted}>{data.method}</p>
    </div>
  )
}

// `offNotice`: the terminal's IVH opens this panel on its own, where a 404 must say "not switched
// on" rather than open blank (OffNotice). Under the chain it stays absent.
export default function IvHistoryPanel({ sym, offNotice = false }) {
  const s = (sym || '').toUpperCase().trim()
  const key = s ? `/api/research/iv-history/${encodeURIComponent(s)}` : null
  const { data, error, mutate } = useSWR(key, sectionFetcher, { revalidateOnFocus: false })
  // TERM-019: name this panel's source (and its as-of) in the terminal panel header; a no-op elsewhere.
  usePanelFreshness(data && !data.paywalled && !error
    ? { source: memberText(data.source) || null, age: { dataClass: 'end_of_day', asOfDate: data.covers_to || null } }
    : null)

  if (key && error?.status === 404 && offNotice) return <OffNotice urls={[key]} feature="IV history" />
  if (offNotice && data?.paywalled) return <div className={styles.note} data-testid="feature-paywalled">IV history requires a paid plan.</div>
  if (offNotice && key && !data && !error) return <div className={styles.note} data-testid="feature-loading">Loading IV history for {s}…</div>
  if (!key || error?.status === 404 || data?.paywalled) return null
  if (error) {
    return <FailedRead testId="iv-history-unavailable" retry={mutate}
      title={`The IV history is unavailable right now. That does not mean ${s} has none.`} />
  }
  // Audit 2026-10-08 (IVH P1): an answer with a status this build doesn't know rendered nothing, so
  // the standalone IVH panel was a titled box with an empty body. On its own it now says so.
  if (data && !KNOWN.has(data.status) && offNotice) {
    return <FailedRead testId="iv-history-unrecognised" retry={mutate}
      title={`The IV history for ${s} came back in a form this panel can't read, so nothing is shown. That does not mean ${s} has none.`} />
  }
  if (!data || !KNOWN.has(data.status)) return null

  const withIv = (data.points || []).filter((p) => p.atm_iv != null)
  // `no_log` already says the log is empty above; its partial reason repeated it word for word.
  const NO_LOG_NOTE = 'The options log holds no sessions yet.'
  const partialText = data.partial
    ? (data.partial_reasons || []).filter((r) => !(data.status === 'no_log' && String(r).trim() === NO_LOG_NOTE)).join(' ')
    : ''
  const last = withIv[withIv.length - 1]
  return (
    <section className={styles.payoff} data-testid="iv-history">
      <div className={styles.volHead}>IV history (our own options log)</div>
      {data.status === 'no_log' && <p className={styles.note}>{NO_LOG_NOTE}</p>}
      {withIv.length > 0 && (
        <>
          <p className={styles.payoffFacts} data-testid="iv-latest">
            ATM IV {pct(last.atm_iv)} on {last.date} ({last.atm_dte} days to expiry)
          </p>
          <Spark points={withIv} />
          <ul className={styles.volList} data-testid="iv-points">
            {withIv.slice(-10).reverse().map((p) => (
              <li key={p.date}>{p.date}: {pct(p.atm_iv)} at {p.atm_dte} DTE{p.rule !== 'closest-30' ? ' (first-run rule)' : ''}</li>
            ))}
          </ul>
        </>
      )}
      <p className={styles.payoffFacts} data-testid="iv-rank">
        {data.rank
          ? `IV rank ${num(data.rank.iv_rank, 0)} · IV percentile ${num(data.rank.iv_percentile, 0)} over ${data.rank.window_sessions} sessions`
            + (data.rank.low != null && data.rank.high != null ? ` (window low ${pct(data.rank.low)}, high ${pct(data.rank.high)})` : '')
          : `IV rank: ${data.rank_note}`}
      </p>
      <p className={styles.muted} data-testid="iv-coverage">
        {data.logging_began ? `Logging began ${data.logging_began}` : 'Logging has not begun'}
        {data.covers_from ? `; ${s} covered from ${data.covers_from}` : ''}
        {data.covers_to ? ` to ${data.covers_to}` : ''}.
        {partialText ? ` Partial: ${partialText}` : ''}
      </p>
      {data.status !== 'no_log' && <ImpliedVsRealized sym={s} />}
      <p className={styles.muted}>{data.method} Source: {memberText(data.source)}.</p>
    </section>
  )
}
