/**
 * CompanySearch — a keyboard-driven "Company Intelligence exploration mode" over
 * the whole panel. Opens over the panel (Ctrl/⌘+K or the header search), searches
 * as you type against the central index, groups + highlights matches. Selecting a
 * result EXPANDS it inline (current value + history + a mini trend) — it does NOT
 * navigate away; search stays active so the user can keep exploring. Escape exits.
 *
 * Reads the already-cached company data (statements / full snapshot / compact) —
 * instant, no per-keystroke network.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import UIcon from '../../../components/ui/UIcon'
import useMobileSWR from '../../../hooks/useMobileSWR'
import { searchCompany, groupResults, highlightParts, POPULAR } from './companySearchIndex'
import styles from './CompanySearch.module.css'

const jsonFetcher = (url) => fetch(url).then(r => (r.ok ? r.json() : null))
const EXPLORE = ['Financial Statements', 'Earnings History', 'Valuation', 'Overview']

// ── formatters ────────────────────────────────────────────────────────────────
function fmtMoney(v) {
  if (v == null) return '—'
  const a = Math.abs(v), s = v < 0 ? '-' : ''
  if (a >= 1e12) return `${s}$${(a / 1e12).toFixed(2)}T`
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(2)}B`
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(1)}M`
  if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(1)}K`
  return `${s}$${a.toFixed(0)}`
}
const fmtShares = (v) => (v == null ? '—' : Math.abs(v) >= 1e9 ? `${(v / 1e9).toFixed(2)}B` : Math.abs(v) >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : `${v}`)
function fmtBy(v, kind) {
  if (v == null || v === '') return '—'
  switch (kind) {
    case 'eps': return `$${Number(v).toFixed(2)}`
    case 'shares': return fmtShares(v)
    case 'pct': return `${Number(v).toFixed(1)}%`
    case 'pct+': return `${Number(v) > 0 ? '+' : ''}${Number(v).toFixed(1)}%`
    case 'x': return `${Number(v).toFixed(Number(v) >= 100 ? 0 : Number(v) >= 10 ? 1 : 2)}x`
    case 'num': return Number(v).toFixed(2)
    case 'moneystr': return v            // already a formatted string ("$5.56T")
    default: return fmtMoney(v)
  }
}
function pctChange(a, b) { return (a == null || b == null || b === 0) ? null : ((a - b) / Math.abs(b)) * 100 }

// how a metric row is formatted inside the Financials statements
const FIN_FMT = {
  eps_diluted: 'eps', eps_basic: 'eps', shares_diluted: 'shares', shares_outstanding: 'shares',
  gross_margin: 'pct', operating_margin: 'pct', net_margin: 'pct',
}
// id → current value resolver from (full snapshot, compact snapshot)
const RESOLVE = {
  roe: (f) => ({ value: f?.roe_pct, fmt: 'pct' }),
  roa: (f) => ({ value: f?.roa_pct, fmt: 'pct' }),
  'rev-growth': (f) => ({ value: f?.revenue_growth_pct, fmt: 'pct+' }),
  'eps-growth': (f) => ({ value: f?.earnings_growth_pct, fmt: 'pct+' }),
  'debt-equity': (f) => ({ value: f?.debt_to_equity, fmt: 'num' }),
  'current-ratio': (f) => ({ value: f?.current_ratio, fmt: 'num' }),
  'ov-fcf': (f) => ({ value: f?.free_cash_flow, fmt: 'moneystr' }),
  pe: (f) => ({ value: f?.pe_trailing, fmt: 'x' }),
  'pe-fwd': (f, c) => ({ value: f?.pe_forward ?? c?.forward_pe, fmt: 'x' }),
  peg: (f) => ({ value: f?.peg, fmt: 'num' }),
  ps: (f) => ({ value: f?.ps, fmt: 'x' }),
  pb: (f) => ({ value: f?.pb, fmt: 'x' }),
  'ev-ebitda': (f) => ({ value: f?.ev_to_ebitda, fmt: 'x' }),
  'ev-rev': (f) => ({ value: f?.ev_to_revenue, fmt: 'x' }),
  'div-yield': (f, c) => ({ value: c?.div_yield, fmt: 'pct' }),
  'market-cap': (f) => ({ value: f?.market_cap, fmt: 'moneystr' }),
  'short-float': (f, c) => ({ value: c?.short_pct_float, fmt: 'pct' }),
  'inst-own': (f, c) => ({ value: c?.inst_own_pct, fmt: 'pct' }),
}
const SECTION_DESC = {
  overview: 'A high-level snapshot: valuation, profitability, growth, financial health and performance.',
  financials: 'Historical income, balance-sheet and cash-flow statements with per-row trends.',
  'income-stmt': 'Revenue down to net income and EPS, annual / quarterly / TTM.',
  'balance-sheet': 'Assets, liabilities, debt and equity over time.',
  'cash-flow-stmt': 'Operating / investing / financing cash flow and free cash flow.',
  'earnings-hist': 'Quarter-by-quarter EPS & revenue vs estimates, with surprises.',
  valuation: 'Current multiples vs historical context — is it expensive or cheap?',
}

function Spark({ series }) {
  const pts = series.filter(v => v != null)
  if (pts.length < 2) return null
  const min = Math.min(...pts), max = Math.max(...pts), rng = (max - min) || 1
  const W = 88, H = 24, step = W / (pts.length - 1)
  const d = pts.map((v, i) => `${(i * step).toFixed(1)},${(H - 3 - ((v - min) / rng) * (H - 6)).toFixed(1)}`).join(' ')
  const up = pts[pts.length - 1] >= pts[0], c = up ? 'var(--dock-up,#26a869)' : 'var(--dock-down,#e5484d)'
  return (
    <svg className={styles.detailSpark} width={W} height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      <polygon points={`0,${H} ${d} ${W},${H}`} fill={c} opacity="0.08" />
      <polyline points={d} fill="none" stroke={c} strokeWidth="1.3" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

function Stat({ label, value, cls }) {
  return <span className={styles.detailStat}><span className={styles.detailStatV}>{value}</span> <span className={`${styles.detailStatL} ${cls || ''}`}>{label}</span></span>
}

// metric-appropriate context chips for a Financials line item
function finExtras(row, latest, statements, full) {
  const revLatest = statements?.income?.annual?.[0]?.values?.revenue
  const margin = (v) => (revLatest && v != null && revLatest !== 0) ? `${((v / revLatest) * 100).toFixed(1)}%` : null
  const out = []
  const push = (label, value) => { if (value != null) out.push({ label, value }) }
  switch (row) {
    case 'free_cash_flow': push('FCF margin', margin(latest)); break
    case 'ebitda': push('EBITDA margin', margin(latest)); break
    case 'gross_profit': push('gross margin', margin(latest)); break
    case 'operating_income': push('op. margin', margin(latest)); break
    case 'net_income': push('net margin', margin(latest)); break
    case 'operating_cf': push('OCF margin', margin(latest)); break
    case 'total_debt': {
      if (full?.debt_to_equity != null) out.push({ label: 'debt/equity', value: Number(full.debt_to_equity).toFixed(2) })
      const nd = statements?.balance?.annual?.[0]?.values?.net_debt
      if (nd != null) out.push({ label: 'net debt', value: fmtMoney(nd) })
      break
    }
    default: break
  }
  return out
}

// Compact, native-feeling inline detail: value + YoY + a small trend + a couple of
// metric-appropriate context stats — shares the panel's typography, not a card.
function ResultDetail({ item, statements, full, compact }) {
  // ── Financials line item ──
  if (item.stmt && item.row) {
    const annual = statements?.[item.stmt]?.annual || []
    if (!annual.length) return <div className={styles.detailNote}>Loading financial history…</div>
    const fmt = FIN_FMT[item.row] || 'money'
    const series = annual.map(p => p.values[item.row])
    const latest = series[0]
    const yoy = pctChange(latest, series[1])
    const extras = finExtras(item.row, latest, statements, full)
    return (
      <div className={styles.detail}>
        <div className={styles.detailHead}>
          <span className={styles.detailVal}>{fmtBy(latest, fmt)}</span>
          {yoy != null && <span className={`${styles.detailDelta} ${yoy >= 0 ? styles.pos : styles.neg}`}>{`${yoy > 0 ? '+' : ''}${yoy.toFixed(0)}% YoY`}</span>}
          <Spark series={series.slice().reverse()} />
        </div>
        {extras.length > 0 && <div className={styles.detailStats}>{extras.map(e => <Stat key={e.label} label={e.label} value={e.value} />)}</div>}
        <div className={styles.detailFoot}>{item.hint}</div>
      </div>
    )
  }
  // ── Resolvable metric (valuation / overview) ──
  const r = RESOLVE[item.id]
  if (r) {
    // `avgKey` used to feed demoValAvg(), which fabricated a "5Y avg" by
    // multiplying the CURRENT value by a fixed constant — so the premium /
    // discount beside it was a constant too. Removed 2026-09-07 along with the
    // same columns in DockValuation: a missing band costs the reader nothing,
    // an invented one costs them trust.
    const { value, fmt } = r(full, compact)
    return (
      <div className={styles.detail}>
        <div className={styles.detailHead}>
          <span className={styles.detailVal}>{fmtBy(value, fmt)}</span>
        </div>
        <div className={styles.detailFoot}>{item.hint}</div>
      </div>
    )
  }
  // ── Section / other → short description ──
  return <div className={styles.detail}><div className={styles.detailDesc}>{SECTION_DESC[item.id] || item.hint}</div></div>
}

export default function CompanySearch({ sym, onClose }) {
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const [expandedId, setExpandedId] = useState(null)
  const inputRef = useRef(null)
  const listRef = useRef(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  const { data: statements } = useMobileSWR(sym ? `/api/fundamentals-statements/${encodeURIComponent(sym)}` : null, jsonFetcher, { refreshInterval: 0, dedupingInterval: 3600000, revalidateOnFocus: false })
  const { data: full } = useMobileSWR(sym ? `/api/fundamentals-full/${encodeURIComponent(sym)}` : null, jsonFetcher, { refreshInterval: 0, dedupingInterval: 300000, revalidateOnFocus: false })
  const { data: compact } = useMobileSWR(sym ? `/api/fundamentals/${encodeURIComponent(sym)}` : null, jsonFetcher, { refreshInterval: 600000, dedupingInterval: 60000, revalidateOnFocus: false })

  const results = useMemo(() => searchCompany(q), [q])
  const groups = useMemo(() => groupResults(results), [results])
  const flat = results

  const onQueryChange = (v) => { setQ(v); setActive(0); setExpandedId(null) }
  const toggle = (item) => { if (item) setExpandedId(id => (id === item.id ? null : item.id)) }

  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose?.(); return }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(flat.length - 1, a + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(0, a - 1)) }
    else if (e.key === 'Enter') { e.preventDefault(); toggle(flat[active]) }
  }
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-idx="${active}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [active])

  let idx = -1
  return (
    <div className={styles.root}>
      <div className={styles.bar}>
        <UIcon name="search" size={15} gold={false} />
        <input ref={inputRef} className={styles.input} value={q} onChange={e => onQueryChange(e.target.value)} onKeyDown={onKey}
          placeholder="Search company information…" spellCheck={false} autoComplete="off" />
        <button type="button" className={styles.escBtn} onClick={onClose} title="Close (Esc)">Esc</button>
      </div>

      <div className={styles.body} ref={listRef}>
        {!q ? (
          <>
            <div className={styles.emptyLabel}>Popular</div>
            <div className={styles.chips}>{POPULAR.map(p => <button key={p} type="button" className={styles.chip} onClick={() => onQueryChange(p)}>{p}</button>)}</div>
            <div className={styles.emptyLabel}>Explore</div>
            <div className={styles.chips}>{EXPLORE.map(name => <button key={name} type="button" className={styles.chip} onClick={() => onQueryChange(name)}>{name}</button>)}</div>
            <div className={styles.hintRow}><span>↑↓ navigate</span><span>↵ expand</span><span>esc close</span></div>
          </>
        ) : flat.length === 0 ? (
          <div className={styles.noRes}>
            <div className={styles.noResTitle}>No matching company information</div>
            <div className={styles.noResSub}>Try: Revenue · Earnings · EBITDA · FCF · Valuation · Debt</div>
          </div>
        ) : (
          groups.map(g => (
            <div key={g.category} className={styles.group}>
              <div className={styles.groupLabel}>{g.category}</div>
              {g.items.map(item => {
                idx += 1
                const i = idx
                const open = expandedId === item.id
                return (
                  <div key={item.id}>
                    <button type="button" data-idx={i}
                      className={`${styles.row}${i === active ? ' ' + styles.rowActive : ''}${open ? ' ' + styles.rowOpen : ''}`}
                      onMouseEnter={() => setActive(i)} onClick={() => toggle(item)}>
                      <span className={styles.rowName}>
                        {highlightParts(item.name, q).map((p, k) => p.hit ? <mark key={k} className={styles.hit}>{p.text}</mark> : <span key={k}>{p.text}</span>)}
                      </span>
                      <span className={styles.rowHint}>{item.hint}</span>
                      <UIcon name={open ? 'chevronUp' : 'chevronDown'} size={12} className={styles.rowChev} />
                    </button>
                    {open && <ResultDetail item={item} statements={statements} full={full} compact={compact} />}
                  </div>
                )
              })}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
