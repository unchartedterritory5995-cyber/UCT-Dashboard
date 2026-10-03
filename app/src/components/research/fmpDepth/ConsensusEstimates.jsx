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
import SourceLine from './SourceLine'
import { fmtCount, fmtEps, fmtGrowth, fmtMoney } from './depthFormat'
import styles from './FmpDepth.module.css'

export const estimatesKey = (sym) => `/api/research/estimates/${sym}?consensus=1`

const range = (lo, hi, fmt) => (lo == null && hi == null ? fmt(null) : `${fmt(lo)} – ${fmt(hi)}`)

function ConsensusTable({ rows, basis }) {
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
              <td>{fmtEps(r.eps?.avg)}</td>
              <td className={styles.muted}>{range(r.eps?.low, r.eps?.high, fmtEps)}</td>
              <td>{fmtCount(r.eps?.n)}</td>
              <td>{fmtGrowth(r.eps_growth)}</td>
              <td>{fmtMoney(r.revenue?.avg)}</td>
              <td className={styles.muted}>{range(r.revenue?.low, r.revenue?.high, fmtMoney)}</td>
              <td>{fmtCount(r.revenue?.n)}</td>
              <td>{fmtGrowth(r.revenue_growth)}</td>
              <td>{fmtMoney(r.ebitda_avg)}</td>
              <td>{fmtMoney(r.net_income_avg)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function YahooForward({ rows }) {
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
              <td>{fmtEps(r.eps_avg)}</td>
              <td className={styles.muted}>{range(r.eps_low, r.eps_high, fmtEps)}</td>
              <td>{fmtCount(r.num_analysts)}</td>
              <td>{fmtGrowth(r.eps_growth)}</td>
              <td>{fmtMoney(r.rev_avg)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Revisions({ rows }) {
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
              <td>{fmtEps(r.current)}</td>
              <td className={styles.muted}>{fmtEps(r.ago30)}</td>
              <td className={styles.muted}>{fmtEps(r.ago90)}</td>
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
}

export default function ConsensusEstimates({ sym }) {
  const s = (sym || '').toUpperCase().trim()
  const [basis, setBasis] = useState('annual')
  const estimateHistoryOn = useContext(AuthContext)?.estimateHistoryEnabled === true
  const { data, error, mutate } = useSWR(s ? estimatesKey(s) : null, sectionFetcher,
    { revalidateOnFocus: false })

  if (!s) return null
  if (error) {
    return <div className={styles.wrap} data-testid="ee-deep"><EmptyState {...FETCH_FAILED} compact onRetry={() => mutate()} /></div>
  }
  if (data === undefined) {
    return <div className={styles.wrap} data-testid="ee-deep"><p className={styles.note}>Loading estimates…</p></div>
  }

  const c = data.consensus || { state: 'error', annual: [], quarterly: [] }
  const fmpOk = c.state === 'ok' && ((c.annual || []).length || (c.quarterly || []).length)
  const fwd = data.forward || []
  const revs = data.revisions || []
  // Offer only a basis that HAS rows, so the toggle can never switch to nothing.
  const bases = [['annual', 'Annual'], ['quarterly', 'Quarterly']].filter(([k]) => (c[k] || []).length)
  const shown = bases.some(([k]) => k === basis) ? basis : bases[0]?.[0]
  const rows = shown ? c[shown] : []

  return (
    <div className={styles.wrap} data-testid="ee-deep" data-source={fmpOk ? 'fmp' : 'yfinance'}>
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
          <ConsensusTable rows={rows} basis={shown} />
          {rows.length >= 2 && (
            <SeriesChart
              periods={rows.map((r) => r.label)}
              mode="band"
              label={`EPS consensus range, ${shown === 'annual' ? 'by fiscal year' : 'by fiscal quarter'}`}
              valueFormatter={fmtEps}
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
                      reason={FALLBACK_REASON[c.state] || FALLBACK_REASON.error} />
          {fwd.length
            ? <YahooForward rows={fwd} />
            : <p className={styles.note}>Neither FMP nor Yahoo Finance holds forward estimates for this ticker.</p>}
        </section>
      )}

      {!!revs.length && (
        <section className={styles.card} data-testid="ee-revisions">
          <div className={styles.head}><span className={styles.title}>EPS estimate revisions</span></div>
          <SourceLine vendor="Yahoo Finance" activity="yfinance eps_trend / eps_revisions"
                      detail="FMP does not publish estimate revisions on this plan" />
          <Revisions rows={revs} />
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
