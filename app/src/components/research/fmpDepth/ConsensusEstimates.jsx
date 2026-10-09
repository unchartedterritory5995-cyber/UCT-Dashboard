// app/src/components/research/fmpDepth/ConsensusEstimates.jsx
//
// EE on FMP (terminal gap audit, gap 4). The terminal's EE panel, and the
// /research Estimates tab when RESEARCH_FMP_DEPTH_ENABLED is on.
//
// One request: /api/research/estimates/{sym}?consensus=1 — the yfinance
// forward/revisions blocks the tab always had, plus FMP's multi-year consensus.
//
//   consensus  FMP: annual (up to 5 fiscal years) and quarterly (up to 8),
//              EPS + revenue mean / low / high / # analysts / y/y, EBITDA and
//              net income. When FMP is empty or failed, the yfinance forward
//              table stands in, labelled as the FALLBACK with the reason.
//   revisions  yfinance's 30/90-day EPS trend — FMP does not publish revision
//              history on this plan — labelled as yfinance.
//   history    EEH (our own daily FMP snapshots) when that flag is on: pointed
//              to, not duplicated.
import { useContext, useState } from 'react'
import useSWR from 'swr'
import { EmptyState, SeriesChart } from '../../research-kit'
import { AuthContext } from '../../../context/AuthContext'
import { FETCH_FAILED, sectionFetcher } from '../sections/sectionFetch'
import { WARMING_UP, useWarming } from '../../../utils/warmRetry'
import SourceLine from './SourceLine'
import { EarningsTradeCardForSym } from '../EarningsTradeCard'
import { UNKNOWN_CCY, fmtCount, fmtEps, fmtGrowth, fmtMoney } from './depthFormat'
import { formatNumber, isForeignCurrency, reportingCurrencyNote } from '../../../lib/presentation/presentationPrimitives'
import styles from './FmpDepth.module.css'
import { PanelSkeleton, useInTerminalPanel } from '../../terminal'

export const estimatesKey = (sym) => `/api/research/estimates/${sym}?consensus=1`

const range = (lo, hi, fmt) => (lo == null && hi == null ? fmt(null) : `${fmt(lo)} – ${fmt(hi)}`)

// The currency label (TWD for TSM) travels with every money cell. FMP's figures
// are in the company's reporting currency; "$" on them was the 2026-10-06 defect.
function ConsensusTable({ rows, basis, ccy }) {
  const eps = (v) => fmtEps(v, ccy)
  const money = (v) => fmtMoney(v, ccy)
  return (
    <div className={styles.scroll}>
      <table className={styles.table} aria-label={`Analyst consensus, ${basis === 'annual' ? 'annual' : 'quarterly'}`}>
        <thead>
          <tr>
            <th scope="col">{basis === 'annual' ? 'Fiscal year' : 'Fiscal quarter'}</th>
            <th scope="col">EPS</th><th scope="col">EPS low – high</th><th scope="col"># EPS</th><th scope="col">EPS y/y</th>
            <th scope="col">Revenue</th><th scope="col">Rev low – high</th><th scope="col"># Rev</th><th scope="col">Rev y/y</th>
            <th scope="col">EBITDA</th><th scope="col">Net income</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.period_end} data-period={r.label}>
              <th scope="row" className={styles.rowHead}>{r.label}</th>
              <td>{eps(r.eps?.avg)}</td>
              <td className={styles.muted}>{range(r.eps?.low, r.eps?.high, eps)}</td>
              <td>{fmtCount(r.eps?.n)}</td>
              <td>{fmtGrowth(r.eps_growth)}</td>
              <td>{money(r.revenue?.avg)}</td>
              <td className={styles.muted}>{range(r.revenue?.low, r.revenue?.high, money)}</td>
              <td>{fmtCount(r.revenue?.n)}</td>
              <td>{fmtGrowth(r.revenue_growth)}</td>
              <td>{money(r.ebitda_avg)}</td>
              <td>{money(r.net_income_avg)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// Yahoo's tables for a foreign filer: revenue is in the reporting currency, but
// the CURRENCY OF ITS EPS IS NOT STATED and is not consistent (measured
// 2026-10-06: TSM/TM per-ADR US dollars, BABA yuan, NVO kroner). So EPS is shown
// as a bare number, never "$", and revenue carries the reporting currency. With the
// reporting currency itself unknown, fmtEps is bare too (UNKNOWN_CCY).
const yahooEps = (rc) => (isForeignCurrency(rc) ? (v) => formatNumber(v, { decimals: 2 }) : (v) => fmtEps(v, rc))

function YahooForward({ rows, rc }) {
  const eps = yahooEps(rc)
  return (
    <div className={styles.scroll}>
      <table className={styles.table} aria-label="Forward estimates, Yahoo Finance">
        <thead>
          <tr><th scope="col">Period</th><th scope="col">EPS</th><th scope="col">EPS low – high</th>
            <th scope="col">Analysts</th><th scope="col">EPS growth</th><th scope="col">Revenue</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.period}>
              <th scope="row" className={styles.rowHead}>{r.period}</th>
              <td>{eps(r.eps_avg)}</td>
              <td className={styles.muted}>{range(r.eps_low, r.eps_high, eps)}</td>
              <td>{fmtCount(r.num_analysts)}</td>
              <td>{fmtGrowth(r.eps_growth)}</td>
              <td>{fmtMoney(r.rev_avg, rc)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Revisions({ rows, rc }) {
  const eps = yahooEps(rc)
  return (
    <div className={styles.scroll}>
      <table className={styles.table} aria-label="EPS estimate revisions, Yahoo Finance">
        <thead>
          <tr><th scope="col">Period</th><th scope="col">Current</th><th scope="col">30d ago</th>
            <th scope="col">90d ago</th><th scope="col">Up (30d)</th><th scope="col">Down (30d)</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.period}>
              <th scope="row" className={styles.rowHead}>{r.period}</th>
              <td>{eps(r.current)}</td>
              <td className={styles.muted}>{eps(r.ago30)}</td>
              <td className={styles.muted}>{eps(r.ago90)}</td>
              <td>{fmtCount(r.up30)}</td>
              <td>{fmtCount(r.down30)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const FALLBACK_REASON = {
  empty: 'FMP holds no forward consensus for this ticker; showing Yahoo Finance.',
  error: 'FMP did not answer; showing Yahoo Finance until it does.',
  unknown: "FMP's consensus answer could not be read; showing Yahoo Finance.",
}
const CONSENSUS_LEGS = ['annual', 'quarterly']

/** Why the Yahoo fallback is shown, worded per case (completeness audit 2026-10-07): "did not
 *  answer" only when FMP truly did not. An answer with no forward periods is FMP answering empty;
 *  one leg failing while the other answered empty is said as exactly that. */
export function fallbackReason(c) {
  const state = c?.state
  const rows = (c?.annual || []).length + (c?.quarterly || []).length
  if (state === 'empty' || (state === 'ok' && rows === 0)) return FALLBACK_REASON.empty
  if (state === 'error') {
    const failed = CONSENSUS_LEGS.filter((k) => Object.prototype.hasOwnProperty.call(c?.errors || {}, k))
    const answered = CONSENSUS_LEGS.filter((k) => !failed.includes(k))
    if (failed.length && answered.length) {
      return `FMP's ${failed.join(' and ')} read failed and its ${answered.join(' and ')} answer holds no forward periods; showing Yahoo Finance until FMP answers in full.`
    }
    return FALLBACK_REASON.error
  }
  return FALLBACK_REASON.unknown
}

export default function ConsensusEstimates({ sym }) {
  const s = (sym || '').toUpperCase().trim()
  const [basis, setBasis] = useState('annual')
  const estimateHistoryOn = useContext(AuthContext)?.estimateHistoryEnabled === true
  const { data, error, mutate } = useSWR(s ? estimatesKey(s) : null, sectionFetcher,
    { revalidateOnFocus: false })
  // The first read after a deploy can hit a cold pod; sectionFetcher asks again once, and the
  // panel says so instead of flashing "Could not load this section" (2026-10-06).
  const warming = useWarming(s ? estimatesKey(s) : null)
  const inPanel = useInTerminalPanel()

  if (!s) return null
  if (error) {
    return <div className={styles.wrap} data-testid="ee-deep"><EmptyState {...FETCH_FAILED} compact onRetry={() => mutate()} /></div>
  }
  if (data === undefined) {
    return (
      <div className={styles.wrap} data-testid="ee-deep">
        {warming
          ? <p className={styles.note} data-testid="ee-warming">{WARMING_UP}</p>
          : inPanel
            ? <PanelSkeleton label="Loading estimates" testId="ee-loading" />
            : <p className={styles.note} data-testid="ee-loading">Loading estimates…</p>}
      </div>
    )
  }
  if (data.paywalled) {
    return <div className={styles.wrap} data-testid="ee-deep"><p className={styles.note}>Estimates require a paid plan.</p></div>
  }

  const c = data.consensus || { state: 'error', annual: [], quarterly: [] }
  const fmpOk = c.state === 'ok' && ((c.annual || []).length || (c.quarterly || []).length)
  const fwd = data.forward || []
  const revs = data.revisions || []
  // Offer only a basis that HAS rows, so the toggle can never switch to nothing.
  const bases = [['annual', 'Annual'], ['quarterly', 'Quarterly']].filter(([k]) => (c[k] || []).length)
  const shown = bases.some(([k]) => k === basis) ? basis : bases[0]?.[0]
  const rows = shown ? c[shown] : []
  const ccy = c.currency ?? null
  const rc = data.reporting_currency ?? ccy
  const yahooNote = isForeignCurrency(rc)
    ? `Revenue in ${rc}, the company's reporting currency. Yahoo Finance does not state the currency of these EPS figures, so they carry no symbol.`
    : reportingCurrencyNote(rc, UNKNOWN_CCY)
  // Unknown reporting currency: the consensus cells carry no symbol, and the card says why.
  const consensusNote = reportingCurrencyNote(ccy, UNKNOWN_CCY)
  // tq-panels: the route marks a fund (`not_applicable` + `reason`, e910f8ff6). With
  // nothing usable from either vendor, say that -- not "Neither FMP nor Yahoo holds...".
  if (data.not_applicable && !fmpOk && !fwd.length && !revs.length) {
    return <div className={styles.wrap} data-testid="ee-deep"><p className={styles.note} data-testid="ee-na">Not applicable to funds — {data.reason || `${s} is a fund`}.</p></div>
  }

  return (
    <div className={styles.wrap} data-testid="ee-deep" data-source={fmpOk ? 'fmp' : 'yfinance'}>
      <EarningsTradeCardForSym sym={s} />
      {fmpOk ? (
        <section className={styles.card} data-testid="ee-consensus">
          <div className={styles.head}>
            <span className={styles.title}>Analyst consensus</span>
            {bases.length > 1 && (
              <div className={styles.seg} role="group" aria-label="Estimate period">
                {bases.map(([k, text]) => (
                  <button key={k} type="button" className={styles.segBtn} aria-pressed={shown === k}
                          onClick={() => setBasis(k)}>{text}</button>
                ))}
              </div>
            )}
          </div>
          <SourceLine vendor="FMP" activity={c.source || 'FMP /stable/analyst-estimates'} fetchedAt={c.fetched_at}
                      detail="Consensus mean, range and analyst count per fiscal period" />
          {consensusNote && (
            <p className={styles.note} data-testid="ee-currency" data-currency={ccy ?? 'unknown'}>{consensusNote}</p>
          )}
          <ConsensusTable rows={rows} basis={shown} ccy={ccy} />
          {rows.length >= 2 && (
            <SeriesChart
              periods={rows.map((r) => r.label)}
              mode="band"
              label={`EPS consensus range, ${shown === 'annual' ? 'by fiscal year' : 'by fiscal quarter'}`}
              valueFormatter={(v) => fmtEps(v, ccy)}
              ariaLabel={`EPS consensus low, mean and high, ${shown}`}
              series={[
                { name: 'Low', color: 'var(--text-muted)', values: rows.map((r) => r.eps?.low ?? null) },
                { name: 'Consensus', color: 'var(--ut-gold, #c9a84c)', values: rows.map((r) => r.eps?.avg ?? null) },
                { name: 'High', color: 'var(--text-muted)', values: rows.map((r) => r.eps?.high ?? null) },
              ]}
            />
          )}
        </section>
      ) : (
        <section className={styles.card} data-testid="ee-fallback">
          <div className={styles.head}><span className={styles.title}>Forward estimates</span></div>
          <SourceLine vendor="Yahoo Finance" fallback activity="yfinance earnings_estimate / revenue_estimate"
                      reason={fallbackReason(c)} />
          {fwd.length > 0 && yahooNote && <p className={styles.note} data-testid="ee-yahoo-currency">{yahooNote}</p>}
          {fwd.length
            ? <YahooForward rows={fwd} rc={rc} />
            : (fallbackReason(c) === FALLBACK_REASON.empty && !data.yf_unavailable)
              ? <p className={styles.note}>Neither FMP nor Yahoo Finance holds forward estimates for this ticker.</p>
              : <p className={styles.note} data-testid="ee-unread">Forward estimates could not be read right now. That is a gap in what we could read, not a finding about {s}.</p>}
        </section>
      )}

      {!!revs.length && (
        <section className={styles.card} data-testid="ee-revisions">
          <div className={styles.head}><span className={styles.title}>EPS estimate revisions</span></div>
          <SourceLine vendor="Yahoo Finance" activity="yfinance eps_trend / eps_revisions"
                      detail="FMP does not publish estimate revisions" />
          {isForeignCurrency(rc) && <p className={styles.note} data-testid="ee-revisions-currency">EPS revisions from Yahoo Finance carry no currency symbol: Yahoo does not state it for this company.</p>}
          {!isForeignCurrency(rc) && yahooNote && <p className={styles.note} data-testid="ee-revisions-currency">{yahooNote}</p>}
          <Revisions rows={revs} rc={rc} />
        </section>
      )}

      {estimateHistoryOn && (
        <p className={styles.note} data-testid="ee-history-pointer">
          Daily consensus history for each upcoming quarter is in Estimate history (EEH).
        </p>
      )}
    </div>
  )
}
