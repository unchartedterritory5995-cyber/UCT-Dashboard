import { useState } from 'react'
import { useParams, useNavigate, useSearchParams, Link } from 'react-router-dom'
import { parseResearchReturnParam, researchReturnTarget, researchReturnLabel } from '../../lib/journal-2-0'
import { useAuth } from '../../context/AuthContext'
import { useIsPhone } from '../../hooks/useBreakpoint'
import useComparison from './hooks/useComparison'
import TileCard from '../../components/TileCard'
import UIcon from '../../components/ui/UIcon'
import PaywallTeaser from './PaywallTeaser'
import ComparisonAskAi from './components/ComparisonAskAi'
import Provenance from '../../components/provenance/Provenance'
import FreshnessBadge from '../../components/provenance/FreshnessBadge'
import { mapAvailability, AVAILABLE, PROVIDER_ERROR } from '../../components/provenance/availabilityContract'
import { epochSecondsToIso } from '../../components/provenance/presentationFormat'
import { computeSessionStale } from '../../components/provenance/sessionStale'
import { sessionModel } from '../../components/dashboard/sessionModel'
import useMarketOpen from '../../hooks/useMarketOpen'
import { formatCurrency, formatNumber, formatPercent } from '../../lib/presentation/presentationPrimitives'
import { signedPct } from './researchFormat'
import styles from './ResearchComparePage.module.css'

// Cross-Security Comparison V1 (owner authorization, Phase B). Deterministic
// only -- no AI synthesis, no peer discovery, exactly two member-chosen
// securities. See api/services/research/comparison.py for the full scope
// note and what's deliberately excluded.

// One formatter (lib/presentation): a non-number is the shared em dash.
const numOrNaN = (v) => (typeof v === 'number' ? v : NaN)
const fmtNum = (v, digits = 2) => formatNumber(numOrNaN(v), { decimals: digits })
const fmtPercentCell = (v, digits = 1) => formatPercent(numOrNaN(v), { decimals: digits })
const fmtPrice = (v) => formatCurrency(numOrNaN(v))

// Compare Coverage V1 (2026-09-06): day-change %, signed and colored, the
// same red/green convention used everywhere else in the app.
function ChangePctCell({ v }) {
  if (typeof v !== 'number') return <td>—</td>
  const cls = v > 0 ? styles.pos : v < 0 ? styles.neg : undefined
  return <td className={cls}>{signedPct(v, 2)}</td>
}

function Week52Cell({ lo, hi }) {
  if (typeof lo !== 'number' || typeof hi !== 'number') return <td>—</td>
  return <td>{formatCurrency(lo)} – {formatCurrency(hi)}</td>
}

function EntityLabel({ side }) {
  if (!side) return null
  if (side.entity?.status === 'not_found') {
    return <div className={styles.notFound}>No data found for {side.sym}</div>
  }
  return null
}

// ─── TERM-019 (FB-S8-01) adoption: the analyst legs' provenance, per side ──
// comparison.py surfaces each side's `consensus_meta` / `price_target_meta` --
// the S8 envelopes analyst_grades.py already attached upstream -- "as-is so
// two securities with different freshness/vendor state show that difference
// rather than reading as equally current". Until TERM-019 this page dropped
// both, so the Analyst Consensus / Price Target rows showed FMP values with no
// source and no as-of while AnalystRatingsTab showed the SAME envelopes.
// Rendered with the same TrustStrip recipe AnalystRatingsTab uses
// (Provenance + FreshnessBadge off the envelope), one per side per leg.
//
// Four honest states per side, and none of them is a blank:
//   * value + envelope      -> S8 Provenance + FreshnessBadge;
//   * value, no envelope    -> Provenance's own degraded state ("provenance
//                              unavailable"), never a fabricated receipt;
//   * no value, `outage`    -> Provenance on S8's availability axis
//                              (provider_error) -- Seam 29: an outage must
//                              not read like "no coverage";
//   * no value, no outage   -> "no analyst data", citing nothing.
// ⛔ The block is omitted only when NEITHER side has a value or an outage for
// either leg -- then the table's own em dashes already say everything.
const ANALYST_LEGS = [
  { leg: 'consensus', label: 'Analyst consensus', value: (s) => s?.analyst?.consensus?.label, meta: (s) => s?.analyst?.consensus_meta },
  { leg: 'price_target', label: 'Analyst price target', value: (s) => s?.analyst?.price_target?.consensus, meta: (s) => s?.analyst?.price_target_meta },
]

const present = (v) => v !== null && v !== undefined && v !== ''

function AnalystSide({ leg, sym, side, value, meta, sessionContext }) {
  let body
  if (!present(value)) {
    body = side?.analyst?.outage
      ? <Provenance value="FMP" availability={PROVIDER_ERROR} />
      : <span>no analyst data</span>
  } else if (!meta) {
    body = <Provenance value="FMP" provenance={null} />
  } else {
    const availability = mapAvailability({ value: true, degraded: meta.degraded })
    const asOfIso = epochSecondsToIso(meta.sourceObservedAt)
    body = (
      <>
        <Provenance
          value="FMP"
          availability={availability}
          provenance={availability === AVAILABLE ? {
            sourceActivity: meta.sourceActivity,
            timestamp: asOfIso,
            tieBreak: meta.tieBreak,
          } : null}
        />
        {availability === AVAILABLE && (
          <FreshnessBadge
            freshnessClass={meta.freshnessClass}
            asOf={asOfIso}
            sessionState={sessionContext}
            sessionStale={computeSessionStale(asOfIso)}
          />
        )}
      </>
    )
  }
  return (
    <span
      data-testid="compare-analyst-provenance-side"
      data-leg={leg}
      data-side={sym}
      className={styles.provSide}
    >
      <b>{sym}</b> {body}
    </span>
  )
}

function AnalystProvenance({ sides, sessionContext }) {
  const any = ANALYST_LEGS.some(({ value }) =>
    sides.some(([, side]) => present(value(side)) || !!side?.analyst?.outage))
  if (!any) return null
  return (
    <div className={styles.footnote} data-testid="compare-analyst-provenance">
      {ANALYST_LEGS.map(({ leg, label, value, meta }) => (
        <div key={leg} className={styles.provLeg}>
          <span>{label}:</span>
          {sides.map(([sym, side]) => (
            <AnalystSide
              key={sym}
              leg={leg}
              sym={sym}
              side={side}
              value={value(side)}
              meta={meta(side)}
              sessionContext={sessionContext}
            />
          ))}
        </div>
      ))}
    </div>
  )
}

function SummaryRow({ label, a, b, fmt = (v) => (v == null ? '—' : v) }) {
  return (
    <tr>
      <th scope="row">{label}</th>
      <td>{fmt(a)}</td>
      <td>{fmt(b)}</td>
    </tr>
  )
}

export default function ResearchComparePage() {
  const { sym: rawSym, comparator: rawComparator } = useParams()
  const navigate = useNavigate()
  const { isPaid } = useAuth()
  const isPhone = useIsPhone()
  const sym = (rawSym || '').toUpperCase()
  const comparator = (rawComparator || '').toUpperCase()
  const { data, isLoading, error: loadError, retry } = useComparison(sym, comparator)
  const sessionContext = sessionModel(useMarketOpen())
  const [searchParams] = useSearchParams()
  // Seam 22. All THREE writers already send this page a return marker --
  // PositionDetailPage, TradeDetailPage and TradeDrawer each route their
  // Compare action through withResearchReturnParam -- but this page never
  // read it, so Compare was the one destination of the Seam 12 fix that
  // still dead-ended. Same shared parse helper as ResearchPage.jsx (never a
  // second copy of the format), seeded once at mount, same convention: a
  // one-time entry marker, not live state.
  const [returnTo] = useState(() => parseResearchReturnParam(searchParams.get('from')))
  const returnLink = returnTo ? (
    <Link to={researchReturnTarget(returnTo)} className={styles.returnLink}
          data-testid="compare-return-link">
      &larr; {researchReturnLabel(returnTo)}
    </Link>
  ) : null

  if (!isPaid) {
    return <div className={styles.page}><PaywallTeaser sym={sym} /></div>
  }

  const swap = () => navigate(`/research/${comparator}/compare/${sym}`)

  if (isLoading) {
    return <div className={styles.page}><div className={styles.loading}>Loading comparison…</div></div>
  }

  // TERM-033: a failed request is said as one, never drawn as two empty columns.
  if (loadError && !data) {
    return (
      <div className={styles.page}>
        {returnLink}
        <div className={styles.errorBox} role="alert" data-testid="compare-load-failed">
          The comparison of {sym} and {comparator} couldn&apos;t be loaded. The request failed;
          this is not a statement about either company.
          {' '}
          <button type="button" className={styles.hdrBtn} onClick={() => retry?.()}>Retry</button>
        </div>
        <button className={styles.backLink} onClick={() => navigate(`/research/${sym}`)}>
          &larr; Back to {sym} Research
        </button>
      </div>
    )
  }

  if (data?.error) {
    return (
      <div className={styles.page}>
        {returnLink}
        <div className={styles.errorBox}>{data.error}</div>
        <button className={styles.backLink} onClick={() => navigate(`/research/${sym}`)}>
          &larr; Back to {sym} Research
        </button>
      </div>
    )
  }

  const a = data?.a
  const b = data?.b

  return (
    <div className={styles.page} data-testid="research-compare-page">
      {returnLink}
      <header className={styles.hdr}>
        <UIcon name="columns" size={20} />
        <div className={styles.hdrTitle}>
          {sym} <span className={styles.vs}>vs</span> {comparator}
        </div>
        <div className={styles.hdrActions}>
          <button className={styles.hdrBtn} onClick={swap} title="Swap A and B">Swap</button>
          <button className={styles.hdrBtn} onClick={() => navigate(`/research/${sym}`)}>
            Open {sym} Research
          </button>
          <button className={styles.hdrBtn} onClick={() => navigate(`/research/${comparator}`)}>
            Open {comparator} Research
          </button>
        </div>
      </header>

      <EntityLabel side={a} />
      <EntityLabel side={b} />

      <div className={isPhone ? styles.stackPhone : styles.columns2}>
        <TileCard title="Summary" icon="columns">
          <table className={styles.tbl} aria-label={`Summary: ${sym} versus ${comparator}`}>
            <thead><tr><td /><th scope="col">{sym}</th><th scope="col">{comparator}</th></tr></thead>
            <tbody>
              <SummaryRow label="Price" a={a?.price?.last} b={b?.price?.last} fmt={fmtPrice} />
              <tr>
                <th scope="row">Today</th>
                <ChangePctCell v={a?.price?.change_pct} />
                <ChangePctCell v={b?.price?.change_pct} />
              </tr>
              <tr>
                <th scope="row">52-Week Range</th>
                <Week52Cell lo={a?.price?.week52_low} hi={a?.price?.week52_high} />
                <Week52Cell lo={b?.price?.week52_low} hi={b?.price?.week52_high} />
              </tr>
              <SummaryRow label="Sector" a={a?.fundamentals?.sector} b={b?.fundamentals?.sector} />
              <SummaryRow label="Industry" a={a?.fundamentals?.industry} b={b?.fundamentals?.industry} />
              <SummaryRow label="Market Cap" a={a?.fundamentals?.market_cap} b={b?.fundamentals?.market_cap} />
              <SummaryRow label="UCT Composite Rating" a={a?.ratings?.composite} b={b?.ratings?.composite}
                fmt={(v) => (v == null ? '—' : String(v))} />
              <SummaryRow label="Analyst Consensus" a={a?.analyst?.consensus?.label} b={b?.analyst?.consensus?.label} />
              <SummaryRow label="Next Earnings" a={a?.fundamentals?.next_earnings} b={b?.fundamentals?.next_earnings} />
            </tbody>
          </table>
        </TileCard>

        <TileCard title="Fundamentals / Valuation" icon="dollar">
          {(a?.fundamentals?.error || b?.fundamentals?.error) && (
            <div className={styles.caveat}>
              {a?.fundamentals?.error && <div>No fundamentals available for {sym}.</div>}
              {b?.fundamentals?.error && <div>No fundamentals available for {comparator}.</div>}
            </div>
          )}
          <table className={styles.tbl} aria-label={`Fundamentals and valuation: ${sym} versus ${comparator}`}>
            <thead><tr><td /><th scope="col">{sym}</th><th scope="col">{comparator}</th></tr></thead>
            <tbody>
              <SummaryRow label="P/E (trailing)" a={a?.fundamentals?.pe_trailing} b={b?.fundamentals?.pe_trailing} fmt={(v) => fmtNum(v)} />
              <SummaryRow label="P/E (forward)" a={a?.fundamentals?.pe_forward} b={b?.fundamentals?.pe_forward} fmt={(v) => fmtNum(v)} />
              <SummaryRow label="P/S" a={a?.fundamentals?.ps} b={b?.fundamentals?.ps} fmt={(v) => fmtNum(v)} />
              <SummaryRow label="EV/Revenue" a={a?.fundamentals?.ev_to_revenue} b={b?.fundamentals?.ev_to_revenue} fmt={(v) => fmtNum(v)} />
              <SummaryRow label="Revenue Growth" a={a?.fundamentals?.revenue_growth_pct} b={b?.fundamentals?.revenue_growth_pct} fmt={(v) => fmtPercentCell(v)} />
              <SummaryRow label="Operating Margin" a={a?.fundamentals?.operating_margin_pct} b={b?.fundamentals?.operating_margin_pct} fmt={(v) => fmtPercentCell(v)} />
              <SummaryRow label="ROE" a={a?.fundamentals?.roe_pct} b={b?.fundamentals?.roe_pct} fmt={(v) => fmtPercentCell(v)} />
            </tbody>
          </table>
          {data?.fundamentals_period_note && (
            <div className={styles.footnote}>{data.fundamentals_period_note}</div>
          )}
        </TileCard>

        {Array.isArray(data?.estimates_aligned) && data.estimates_aligned.length > 0 && (
          <TileCard title="Estimates" icon="chart">
            <table className={styles.tbl} aria-label={`EPS estimates: ${sym} versus ${comparator}`}>
              <thead><tr><th scope="col">Period</th><th scope="col">{sym} EPS</th><th scope="col">{comparator} EPS</th></tr></thead>
              <tbody>
                {data.estimates_aligned.map(row => (
                  <SummaryRow key={row.period} label={row.period} a={row.a?.eps_avg} b={row.b?.eps_avg} fmt={(v) => fmtNum(v)} />
                ))}
              </tbody>
            </table>
          </TileCard>
        )}

        <TileCard title="Ratings" icon="sparkle">
          <table className={styles.tbl} aria-label={`Ratings: ${sym} versus ${comparator}`}>
            <thead><tr><td /><th scope="col">{sym}</th><th scope="col">{comparator}</th></tr></thead>
            <tbody>
              <SummaryRow label="UCT Composite" a={a?.ratings?.composite} b={b?.ratings?.composite} fmt={(v) => (v == null ? '—' : String(v))} />
              <SummaryRow label="Analyst Consensus" a={a?.analyst?.consensus?.label} b={b?.analyst?.consensus?.label} />
              <SummaryRow label="Analyst Price Target" a={a?.analyst?.price_target?.consensus} b={b?.analyst?.price_target?.consensus} fmt={(v) => fmtNum(v)} />
            </tbody>
          </table>
          {(a?.ratings?.price_as_of || b?.ratings?.price_as_of) && (
            <div className={styles.footnote}>
              As of: {sym} {a?.ratings?.price_as_of || '—'} · {comparator} {b?.ratings?.price_as_of || '—'}
            </div>
          )}
          <AnalystProvenance sides={[[sym, a], [comparator, b]]} sessionContext={sessionContext} />
        </TileCard>
      </div>

      <div className={styles.aiSection}>
        <TileCard title="Ask AI" icon="sparkle">
          <ComparisonAskAi symA={sym} symB={comparator} />
        </TileCard>
      </div>
    </div>
  )
}
