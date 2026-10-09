import useSWR from 'swr'
import { sectionFetcher } from '../../../components/research/sections/sectionFetch'
import { signedPct } from '../researchFormat'
import styles from './ResearchCov.module.css'
import {
  ABSENT, formatCompactTerminal, formatCurrencyIn, formatNumber, isForeignCurrency,
  normalizeCurrencyCode, relabelDollarText, reportingCurrencyNote,
} from '../../../lib/presentation/presentationPrimitives'
import { memberText, memberSentence } from '../../../lib/presentation/memberCopy'
import { usePanelFreshness } from '../../../components/terminal/terminalPanel'
import ResearchLoading from '../ResearchLoading'
import SwitchedOff, { isSwitchedOff } from '../SwitchedOff'

// COV-07 (roadmap RM-L19) — how the consensus EPS and revenue estimate for each
// upcoming quarter has moved, from UCT's own daily snapshots of FMP's consensus
// (FMP's historical-estimates endpoint is not on this plan). DARK behind
// ESTIMATE_HISTORY_ENABLED.
//
// ⛔ History starts on the first snapshot and the tab says which day that was.
// ⛔ A revision is shown only once a quarter has two snapshots; with one it says
//    "collecting", never a flat line that reads as "no revisions".
// ⛔ Days whose read failed are listed as gaps, not skipped.

// A missing figure in a numeric cell is the shared em dash (ABSENT); the revision
// line below still says "unavailable" in words.
const eps = (v) => formatNumber(v, { decimals: 2 })
const rev = (v) => (v == null ? ABSENT
  : formatCompactTerminal(Number(v)))
// The consensus is in the company's REPORTING currency (TSM: Taiwan dollars), and
// the route says which when it already knows (`currency`, read cache-only). A
// non-USD figure carries its ISO code ("TWD 18.50", "TWD 1.10T"); USD and unknown
// render exactly as before -- no symbol, never a guessed "$". Nothing is converted.
const epsIn = (v, ccy) => (isForeignCurrency(ccy) && v != null ? formatCurrencyIn(Number(v), ccy) : eps(v))
const revIn = (v, ccy) => (isForeignCurrency(ccy) && v != null
  ? relabelDollarText(formatCompactTerminal(Number(v), { money: true }), ccy) : rev(v))
const headIn = (label, ccy) => (isForeignCurrency(ccy) ? `${label}, ${normalizeCurrencyCode(ccy)}` : label)
const chg = (c) => {
  if (!c || c.pct == null) return { text: 'unavailable', cls: '' }
  return { text: signedPct(c.pct, 2), cls: c.pct > 0 ? styles.up : c.pct < 0 ? styles.down : '' }
}

function Period({ p, ccy }) {
  const e = chg(p.eps_change)
  const r = chg(p.rev_change)
  return (
    <div className={styles.card} data-testid={`period-${p.period_end}`}>
      <h3 className={styles.title}>Fiscal period ending {p.period_end}</h3>
      {p.state === 'revisions'
        ? <div className={styles.muted} data-testid={`revision-${p.period_end}`}>
            Since {p.first_snapshot} ({p.n} snapshots): EPS <span className={e.cls}>{e.text}</span>, revenue <span className={r.cls}>{r.text}</span>.
          </div>
        : <div className={styles.gap} data-testid={`collecting-${p.period_end}`}>Collecting: {memberText(p.reason)}.</div>}
      <div className={styles.scroll}>
        <table className={styles.grid} aria-label={`Estimate history, fiscal period ending ${p.period_end}`}>
          <thead><tr>
            <th scope="col">Snapshot</th><th scope="col" className={styles.num}>{headIn('EPS', ccy)} (low–high)</th>
            <th scope="col" className={styles.num}># EPS</th><th scope="col" className={styles.num}>{headIn('Revenue', ccy)}</th>
            <th scope="col" className={styles.num}># Rev</th>
          </tr></thead>
          <tbody>
            {p.points.map((pt) => (
              <tr key={pt.snap_date}>
                <td>{pt.snap_date}</td>
                <td className={styles.num}>{epsIn(pt.eps_avg, ccy)} ({eps(pt.eps_low)}–{eps(pt.eps_high)})</td>
                <td className={styles.num}>{pt.n_eps ?? ABSENT}</td>
                <td className={styles.num}>{revIn(pt.rev_avg, ccy)}</td>
                <td className={styles.num}>{pt.n_rev ?? ABSENT}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default function EstimateHistoryTab({ sym }) {
  const s = (sym || '').toUpperCase().trim()
  const { data, error, mutate } = useSWR(s ? `/api/research/estimate-history/${encodeURIComponent(s)}` : null,
    sectionFetcher, { revalidateOnFocus: false })
  // TERM-019: name this panel's source (and its as-of) in the terminal panel header; a no-op elsewhere.
  usePanelFreshness(data && !data.paywalled && !error
    ? { source: memberText(data.source) || null, age: { dataClass: 'end_of_day', asOfDate: data.last_snapshot || null } }
    : null)

  if (isSwitchedOff(error)) return <SwitchedOff what="Estimate history" className={styles.note} testId="esthist-off" />
  if (error) {
    return <div className={styles.note} data-testid="esthist-unavailable">
      Estimate history is unavailable right now. That is a gap in what we could read, not a finding about {s}.{' '}<button type="button" className={styles.retry} onClick={() => mutate()}>Retry</button>
    </div>
  }
  if (!data) return <div data-testid="esthist-loading"><ResearchLoading label="Loading estimate history" /></div>
  if (data.paywalled) return <div className={styles.note}>Estimate history requires a paid plan.</div>

  const failed = data.failed_days || []
  const ccy = data.currency ?? null
  const ccyNote = reportingCurrencyNote(ccy)
  return (
    <section className={styles.section} data-testid="esthist">
      <p className={styles.muted} data-testid="esthist-window">
        {data.covers_from
          ? `${s}: daily snapshots since ${data.covers_from} (${data.snapshot_days} days, last ${data.last_snapshot}). History before ${data.covers_from} was not recorded.`
          : `${s}: ${memberText(data.reason)}.`}
      </p>
      {ccyNote && (data.periods || []).length > 0 && (
        <p className={styles.muted} data-testid="esthist-currency" data-currency={normalizeCurrencyCode(ccy)}>{ccyNote}</p>
      )}
      {data.state === 'no_upcoming_periods' && <div className={styles.gap}>{memberSentence(data.reason)}</div>}
      {(data.periods || []).map((p) => <Period key={p.period_end} p={p} ccy={ccy} />)}
      {failed.length > 0 && (
        <div className={styles.gap} data-testid="esthist-failed">
          Days with no snapshot (the read failed): {failed.map((f) => f.snap_date).join(', ')}.
        </div>
      )}
      <p className={styles.muted} data-testid="esthist-source">Source: {memberText(data.source)}.</p>
    </section>
  )
}
