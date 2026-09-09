import { useParams, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { useIsPhone } from '../../hooks/useBreakpoint'
import useComparison from './hooks/useComparison'
import TileCard from '../../components/TileCard'
import UIcon from '../../components/ui/UIcon'
import PaywallTeaser from './PaywallTeaser'
import ComparisonAskAi from './components/ComparisonAskAi'
import styles from './ResearchComparePage.module.css'

// Cross-Security Comparison V1 (owner authorization, Phase B). Deterministic
// only -- no AI synthesis, no peer discovery, exactly two member-chosen
// securities. See api/services/research/comparison.py for the full scope
// note and what's deliberately excluded.

function fmtNum(v, digits = 2) {
  return typeof v === 'number' ? v.toFixed(digits) : '—'
}
function fmtPct(v, digits = 1) {
  return typeof v === 'number' ? `${v.toFixed(digits)}%` : '—'
}
function fmtPrice(v) {
  return typeof v === 'number' ? `$${v.toFixed(2)}` : '—'
}

// Compare Coverage V1 (2026-09-06): day-change %, signed and colored, the
// same red/green convention used everywhere else in the app.
function ChangePctCell({ v }) {
  if (typeof v !== 'number') return <td>—</td>
  const cls = v > 0 ? styles.pos : v < 0 ? styles.neg : undefined
  const sign = v > 0 ? '+' : ''
  return <td className={cls}>{sign}{v.toFixed(2)}%</td>
}

function Week52Cell({ lo, hi }) {
  if (typeof lo !== 'number' || typeof hi !== 'number') return <td>—</td>
  return <td>${lo.toFixed(2)} – ${hi.toFixed(2)}</td>
}

function EntityLabel({ side }) {
  if (!side) return null
  if (side.entity?.status === 'not_found') {
    return <div className={styles.notFound}>No data found for {side.sym}</div>
  }
  return null
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
  const { data, isLoading } = useComparison(sym, comparator)

  if (!isPaid) {
    return <div className={styles.page}><PaywallTeaser sym={sym} /></div>
  }

  const swap = () => navigate(`/research/${comparator}/compare/${sym}`)

  if (isLoading) {
    return <div className={styles.page}><div className={styles.loading}>Loading comparison…</div></div>
  }

  if (data?.error) {
    return (
      <div className={styles.page}>
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
          <table className={styles.tbl}>
            <thead><tr><th /><th>{sym}</th><th>{comparator}</th></tr></thead>
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
          <table className={styles.tbl}>
            <thead><tr><th /><th>{sym}</th><th>{comparator}</th></tr></thead>
            <tbody>
              <SummaryRow label="P/E (trailing)" a={a?.fundamentals?.pe_trailing} b={b?.fundamentals?.pe_trailing} fmt={(v) => fmtNum(v)} />
              <SummaryRow label="P/E (forward)" a={a?.fundamentals?.pe_forward} b={b?.fundamentals?.pe_forward} fmt={(v) => fmtNum(v)} />
              <SummaryRow label="P/S" a={a?.fundamentals?.ps} b={b?.fundamentals?.ps} fmt={(v) => fmtNum(v)} />
              <SummaryRow label="EV/Revenue" a={a?.fundamentals?.ev_to_revenue} b={b?.fundamentals?.ev_to_revenue} fmt={(v) => fmtNum(v)} />
              <SummaryRow label="Revenue Growth" a={a?.fundamentals?.revenue_growth_pct} b={b?.fundamentals?.revenue_growth_pct} fmt={(v) => fmtPct(v)} />
              <SummaryRow label="Operating Margin" a={a?.fundamentals?.operating_margin_pct} b={b?.fundamentals?.operating_margin_pct} fmt={(v) => fmtPct(v)} />
              <SummaryRow label="ROE" a={a?.fundamentals?.roe_pct} b={b?.fundamentals?.roe_pct} fmt={(v) => fmtPct(v)} />
            </tbody>
          </table>
          {data?.fundamentals_period_note && (
            <div className={styles.footnote}>{data.fundamentals_period_note}</div>
          )}
        </TileCard>

        {Array.isArray(data?.estimates_aligned) && data.estimates_aligned.length > 0 && (
          <TileCard title="Estimates" icon="chart">
            <table className={styles.tbl}>
              <thead><tr><th>Period</th><th>{sym} EPS</th><th>{comparator} EPS</th></tr></thead>
              <tbody>
                {data.estimates_aligned.map(row => (
                  <SummaryRow key={row.period} label={row.period} a={row.a?.eps_avg} b={row.b?.eps_avg} fmt={(v) => fmtNum(v)} />
                ))}
              </tbody>
            </table>
          </TileCard>
        )}

        <TileCard title="Ratings" icon="sparkle">
          <table className={styles.tbl}>
            <thead><tr><th /><th>{sym}</th><th>{comparator}</th></tr></thead>
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
