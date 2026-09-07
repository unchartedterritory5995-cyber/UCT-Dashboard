/**
 * DockEarnings — the Earnings tab of the Company Intelligence panel.
 *
 * ONE CONTINUOUS QUARTERLY TIMELINE, presented as a dense table rather than a
 * stack of cards: future estimates on top, then reported quarters newest-first,
 * so the mental model is simply future → latest → history.
 *
 * PRESENTATION RULES (learned the hard way in review):
 *  • Say a thing ONCE. A forward period is "FY2026 Q4  EST" — not "Next quarter
 *    / Upcoming / EST", which was three ways of saying the same thing.
 *  • YoY growth and estimate SURPRISE are different concepts and must not look
 *    alike. Surprise is labelled ("Beat +7.7%"), growth is suffixed ("+346% YoY").
 *  • A YoY figure over 100% is already visibly over 100%, so it turns gold
 *    rather than earning a redundant "100%+" badge beside it. Only the rarer
 *    both-metrics case gets its own marker.
 *  • Forward quarters are IMPORTANT, not disabled — they get an EST badge, not
 *    grey text.
 *  • With no comparable consensus the estimate and surprise columns vanish
 *    entirely instead of filling the table with em dashes.
 *
 * DATA — unchanged, see api/services/earnings_intel.py:
 *   /api/earnings-intel/{sym}          normalized quarters, basis-checked
 *   /api/fundamentals/earnings-table   annual history + forward estimates
 *   /api/filings/{sym}/primary         authoritative documents
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import useSWR from 'swr'
import useEarningsTable from '../../../hooks/useEarningsTable'
import styles from './dockPanels.module.css'

const jsonFetcher = (url) => fetch(url).then(r => (r.ok ? r.json() : null)).catch(() => null)

// ── formatters ───────────────────────────────────────────────────────────────
function fmtRev(v) {
  if (v == null) return '—'
  const a = Math.abs(v), s = v < 0 ? '-' : ''
  if (a >= 1e12) return `${s}$${(a / 1e12).toFixed(2)}T`
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(2)}B`
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(0)}M`
  return `${s}$${a.toFixed(0)}`
}
const fmtEps = (v) => (v == null ? '—' : `${v < 0 ? '-' : ''}$${Math.abs(Number(v)).toFixed(2)}`)
const pctStr = (v, d = 0) => `${v > 0 ? '+' : ''}${Math.abs(v) >= 1000 ? (v / 1000).toFixed(1) + 'k' : v.toFixed(d)}%`

const shortDate = (iso) => {
  if (!iso) return null
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00`)
  return Number.isNaN(d.getTime()) ? null
    : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })
}
const longDate = (iso) => {
  if (!iso) return null
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00`)
  return Number.isNaN(d.getTime()) ? null
    : d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

/** Forward fiscal periods, counted on from the latest reported quarter — so an
 *  upcoming period is "FY2026 Q4", never "Next quarter" (§2). */
function stepFiscal(year, quarter, n) {
  let y = year, q = quarter
  for (let i = 0; i < n; i += 1) { q += 1; if (q > 4) { q = 1; y += 1 } }
  return `FY${y} Q${q}`
}

/** YoY cell. A swing through zero is a STATE, not a percentage (§27). */
function growth(pct, note) {
  // `isPct` gates the " YoY" suffix — "profitable YoY" reads as broken English.
  if (note === 'turned_profitable') return { text: 'profitable', cls: styles.pos, isPct: false }
  if (note === 'turned_negative') return { text: 'to loss', cls: styles.neg, isPct: false }
  if (pct == null) return null
  // ≥100% growth is already legible as such; gold IS the signal, so no badge.
  const cls = pct >= 100 ? styles.eqGold : pct >= 0 ? styles.pos : styles.neg
  return { text: pctStr(pct), cls, isPct: true }
}

/** Surprise cell — explicitly labelled so it can never be mistaken for growth. */
function surprise(pct, abs, isEps) {
  if (pct == null && abs == null) return null
  const positive = (pct != null ? pct : abs) > 0
  const magnitude = pct != null
    ? pctStr(Math.abs(pct), 1)
    : (isEps ? `$${Math.abs(abs).toFixed(2)}` : fmtRev(Math.abs(abs)))
  if (pct != null && Math.abs(pct) < 0.5) return { text: 'In line', cls: styles.muted }
  return { text: `${positive ? 'Beat' : 'Miss'} ${magnitude}`, cls: positive ? styles.pos : styles.neg }
}

// ── one metric line (EPS or REV) inside a period row ────────────────────────
function MetricRow({ tag, actual, est, surp, yoy, showEst, showSurp }) {
  return (
    <>
      <span className={styles.eqTag}>{tag}</span>
      <span className={styles.eqAct}>{actual}</span>
      {showEst && <span className={styles.eqEstCell}>{est ?? ''}</span>}
      {showSurp && <span className={`${styles.eqSurp} ${surp?.cls || ''}`}>{surp?.text || ''}</span>}
      <span className={`${styles.eqYoy} ${yoy?.cls || styles.muted}`}>
        {yoy ? yoy.text : ''}
        {yoy?.isPct && <span className={styles.eqYoyTag}> YoY</span>}
      </span>
    </>
  )
}

function PeriodRow({ p, sym, open, onToggle, showEst, showSurp }) {
  const est = p.reported === false
  const epsY = growth(p.eps_yoy_pct, p.eps_yoy_note)
  const revY = growth(p.rev_yoy_pct, p.rev_yoy_note)
  const epsS = est ? null : surprise(p.eps_surprise_pct, p.eps_surprise_abs, true)
  const revS = est ? null : surprise(p.rev_surprise_pct, p.rev_surprise_abs, false)
  const both = p.double_triple

  return (
    <>
      <div className={`${styles.eqRow}${open ? ' ' + styles.eqOpen : ''}`}
        onClick={onToggle} role="button" tabIndex={0}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle() } }}>
        <div className={styles.eqHead}>
          <span className={styles.eqPeriod}>{p.label}</span>
          {est && <span className={styles.eqBadge}>EST</span>}
          <span className={styles.eqWhen}>
            {est ? (shortDate(p.report_date) || 'Date TBD')
              : (shortDate(p.report_date) || shortDate(p.period_end) || '')}
          </span>
          {both && (
            <span className={styles.eqSignal}
              title="EPS and revenue both increased by at least 100% versus the same quarter one year ago.">
              EPS + SALES 100%+
            </span>
          )}
        </div>
        <div className={`${styles.eqGrid}${showEst ? ' ' + styles.eqGrid5 : showSurp ? ' ' + styles.eqGrid4 : ' ' + styles.eqGrid3}`}>
          <MetricRow tag="EPS" actual={fmtEps(est ? p.eps_estimate : p.eps_actual)}
            est={fmtEps(p.eps_estimate)} surp={epsS} yoy={epsY} showEst={showEst && !est} showSurp={showSurp && !est} />
          <MetricRow tag="REV" actual={fmtRev(est ? p.revenue_estimate : p.revenue_actual)}
            est={fmtRev(p.revenue_estimate)} surp={revS} yoy={revY} showEst={showEst && !est} showSurp={showSurp && !est} />
        </div>
      </div>
      {open && <PeriodDetail p={p} sym={sym} epsS={epsS} revS={revS} est={est} />}
    </>
  )
}

function DRow({ k, v, cls }) {
  if (v == null || v === '—') return null
  return (
    <>
      <span className={styles.eqDK}>{k}</span>
      <span className={`${styles.eqDV} ${cls || ''}`}>{v}</span>
    </>
  )
}

function PeriodDetail({ p, sym, epsS, revS, est }) {
  const { data: docs } = useSWR(!est && sym ? `/api/filings/${encodeURIComponent(sym)}/primary` : null,
    jsonFetcher, { revalidateOnFocus: false, dedupingInterval: 6 * 3600000 })
  const filings = (docs?.filings || []).filter(f => f.direct !== false)
  // The 8-K is where a US company files its earnings release.
  const release = filings.find(f => (f.form || '').startsWith('8-K'))
  const others = filings.filter(f => f !== release)
  const noEstimate = p.eps_surprise_note === 'no_comparable_estimate'

  return (
    <div className={styles.eqDetail}>
      <div className={styles.eqDGrid}>
        <DRow k="EPS actual" v={fmtEps(p.eps_actual)} />
        <DRow k="EPS estimate" v={p.eps_estimate == null ? null : fmtEps(p.eps_estimate)} />
        <DRow k="EPS surprise" v={epsS?.text} cls={epsS?.cls} />
        <DRow k="Revenue actual" v={p.revenue_actual == null ? null : fmtRev(p.revenue_actual)} />
        <DRow k="Revenue estimate" v={p.revenue_estimate == null ? null : fmtRev(p.revenue_estimate)} />
        <DRow k="Revenue surprise" v={revS?.text} cls={revS?.cls} />
        <DRow k="Net margin" v={p.net_margin_pct == null ? null : `${p.net_margin_pct.toFixed(1)}%`} />
        <DRow k="Period ended" v={longDate(p.period_end)} />
        <DRow k="Reported" v={longDate(p.report_date)} />
      </div>

      {noEstimate && (
        <div className={styles.eqNote}>
          No consensus on a comparable basis for this quarter, so no surprise is calculated.
          The actual is {p.eps_basis === 'gaap_diluted' ? 'GAAP diluted EPS as reported' : 'as reported'}.
        </div>
      )}

      {!est && filings.length > 0 && (
        <>
          {release && (
            <a className={styles.eqPrimaryDoc} href={release.url} target="_blank" rel="noreferrer">
              Open earnings report →
            </a>
          )}
          <div className={styles.finDocs}>
            {others.map(f => (
              <a key={f.form} className={styles.finDoc} href={f.url} target="_blank" rel="noreferrer" title={f.blurb}>
                <span className={styles.finDocForm}>{f.form}</span>
                <span className={styles.finDocLabel}>{f.label}</span>
                <span className={styles.finDocDate}>{f.filed || ''}</span>
              </a>
            ))}
          </div>
          {/* Honest about what these links are: we resolve a company's most
              recent filing of each type, not the document for THIS quarter.
              Mapping accession → fiscal period is a real piece of work and
              claiming it before it exists would be the wrong kind of trust. */}
          <div className={styles.eqNote}>Company's most recent filing of each type — not yet mapped to this specific quarter.</div>
        </>
      )}
    </div>
  )
}

function GroupLabel({ children }) {
  return <div className={styles.eqGroup}>{children}</div>
}

export default function DockEarnings({ sym }) {
  const [period, setPeriod] = useState('quarterly')
  const [openKey, setOpenKey] = useState(null)
  const [methodOpen, setMethodOpen] = useState(false)
  // Measured, not guessed — the dock is user-resizable, and the column set
  // depends on real available width.
  const [width, setWidth] = useState(0)
  const hostRef = useRef(null)
  useEffect(() => {
    const el = hostRef.current
    if (!el || typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver(entries => {
      for (const e of entries) setWidth(Math.round(e.contentRect.width))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const { data: intel, isLoading } = useSWR(sym ? `/api/earnings-intel/${encodeURIComponent(sym)}` : null,
    jsonFetcher, { revalidateOnFocus: false, dedupingInterval: 300000 })
  const { data: table } = useEarningsTable(sym || null)
  // Only for the scheduled next-earnings date — already cached for other panels.
  const { data: fund } = useSWR(sym ? `/api/fundamentals/${encodeURIComponent(sym)}` : null,
    jsonFetcher, { revalidateOnFocus: false, dedupingInterval: 600000 })

  // Memoised so the `forward` useMemo below doesn't see a new array identity on
  // every render and recompute the fiscal labels each pass.
  const quarters = useMemo(() => intel?.quarters || [], [intel])
  const summary = intel?.summary || {}
  const meta = intel?.meta || {}

  // Column set by available width (§35). Surprise needs consensus to exist at
  // all, so with tier-2 data the whole column disappears rather than showing
  // a wall of em dashes (§14/§15).
  const hasConsensus = !!meta.estimates_available
  const showSurp = hasConsensus && width >= 330
  const showEst = hasConsensus && width >= 560

  const forward = useMemo(() => {
    const rows = (table?.quarterly || [])
      .filter(r => !r.reported && (r.eps_estimate != null || r.rev_estimate != null))
    const newest = quarters[0]
    const mapped = rows.map((r, i) => ({
      ...r,
      label: r.label || (newest?.year && newest?.quarter ? stepFiscal(newest.year, newest.quarter, i + 1) : `Est ${i + 1}`),
      reported: false,
      revenue_estimate: r.rev_estimate,
    }))
    // The estimate rows carry no date, but the scheduled next-earnings date is
    // already in the fundamentals snapshot (it's what the chart header shows).
    // It belongs to the NEAREST upcoming quarter — mapped[0] before reversal.
    if (mapped[0] && !mapped[0].report_date && fund?.next_earnings) {
      mapped[0] = { ...mapped[0], report_date: fund.next_earnings, date_scheduled: true }
    }
    return mapped.reverse()   // furthest-out first, reading down toward the present
  }, [table, quarters, fund])

  const annual = useMemo(() => {
    const rows = (table?.annual || []).slice().reverse()
    return rows.map((a, i) => {
      const prev = rows[i + 1]
      let pct = a.eps_chg_pct, note = null
      if (prev && prev.eps != null && a.eps != null) {
        if (prev.eps < 0 && a.eps >= 0) { note = 'turned_profitable'; pct = null }
        else if (prev.eps > 0 && a.eps < 0) { note = 'turned_negative'; pct = null }
      }
      return { ...a, eps_pct: pct, eps_note: note }
    })
  }, [table])

  if (!sym) return <div className={styles.emptyState}>No symbol.</div>

  const accel = summary.eps_accel_quarters
  const annualFwd = annual.filter(a => a.estimate)
  const annualRep = annual.filter(a => !a.estimate)

  return (
    <div className={styles.earn} ref={hostRef}>
      <div className={styles.finBar}>
        <div className={styles.finSeg}>
          {['quarterly', 'annual'].map(p => (
            <button key={p} type="button"
              className={`${styles.finSegBtn}${period === p ? ' ' + styles.finSegOn : ''}`}
              onClick={() => { setPeriod(p); setOpenKey(null) }}>
              {p === 'quarterly' ? 'Quarterly' : 'Annual'}
            </button>
          ))}
        </div>
        <div className={styles.finSpacer} />
        {accel > 0 && (
          <span className={styles.eqAccel}
            title="Consecutive recent quarters in which the year-over-year EPS growth RATE moved in this direction.">
            EPS {summary.eps_trend === 'decelerating' ? 'decel' : 'accel'} ×{accel}
          </span>
        )}
        {summary.double_beat_streak > 0 && (
          <span className={styles.eqAccel} title="Consecutive most-recent quarters beating BOTH the EPS and revenue consensus.">
            2×beat ×{summary.double_beat_streak}
          </span>
        )}
      </div>

      {isLoading && !intel ? (
        <div className={styles.finSkeleton}>
          {Array.from({ length: 9 }).map((_, i) => <div key={i} className={styles.finSkelRow} />)}
        </div>
      ) : !quarters.length && !annual.length ? (
        <div className={styles.emptyState}>No earnings history is available for {sym}.</div>
      ) : (
        <div className={styles.earnList}>
          {period === 'quarterly' ? (
            <>
              {forward.length > 0 && <GroupLabel>Upcoming</GroupLabel>}
              {forward.map((p, i) => (
                <PeriodRow key={`f-${p.label}-${i}`} p={p} sym={sym} showEst={showEst} showSurp={showSurp}
                  open={openKey === `f${i}`} onToggle={() => setOpenKey(openKey === `f${i}` ? null : `f${i}`)} />
              ))}
              {quarters.length > 0 && <GroupLabel>Reported</GroupLabel>}
              {quarters.map((p, i) => (
                <PeriodRow key={`q-${p.label}-${i}`} p={p} sym={sym} showEst={showEst} showSurp={showSurp}
                  open={openKey === `q${i}`} onToggle={() => setOpenKey(openKey === `q${i}` ? null : `q${i}`)} />
              ))}
            </>
          ) : (
            <>
              {annualFwd.length > 0 && <GroupLabel>Forward</GroupLabel>}
              {annualFwd.map(a => <AnnualRow key={a.year} a={a} />)}
              {annualRep.length > 0 && <GroupLabel>Reported</GroupLabel>}
              {annualRep.map(a => <AnnualRow key={a.year} a={a} />)}
            </>
          )}

          <button type="button" className={styles.finMethodBtn} onClick={() => setMethodOpen(o => !o)}>
            {methodOpen ? 'Hide data & methodology' : 'Data & methodology'}
          </button>
          {methodOpen && (
            <div className={styles.finMethod}>
              <div className={styles.finProvGrid}>
                <span className={styles.finProvK}>Actuals</span>
                <span className={styles.finProvV}>{meta.actuals_source || '—'}</span>
                <span className={styles.finProvK}>EPS basis</span>
                <span className={styles.finProvV}>{meta.eps_basis || '—'}</span>
                <span className={styles.finProvK}>Consensus</span>
                <span className={styles.finProvV}>{hasConsensus ? 'Available — surprise calculated' : 'Not configured — surprise columns hidden rather than left empty'}</span>
                <span className={styles.finProvK}>Fiscal year</span>
                <span className={styles.finProvV}>{meta.fiscal_year_end_month ? `Ends month ${meta.fiscal_year_end_month} — quarters are fiscal, not calendar` : '—'}</span>
              </div>
              <p className={styles.finMethodP}>{meta.surprise_method}</p>
              <p className={styles.finMethodP}>{meta.yoy_method}</p>
              <p className={styles.finMethodP}>
                A YoY figure of 100% or more is shown in gold; when EPS and revenue both
                clear it the period is marked. That describes reported growth only — a small
                year-ago base can produce it, so it is not a quality rating.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function AnnualRow({ a }) {
  const epsY = growth(a.eps_pct, a.eps_note)
  const revY = growth(a.sales_chg_pct, null)
  return (
    <div className={styles.eqRow}>
      <div className={styles.eqHead}>
        <span className={styles.eqPeriod}>FY{a.year}</span>
        {a.estimate && <span className={styles.eqBadge}>EST</span>}
      </div>
      <div className={`${styles.eqGrid} ${styles.eqGrid3}`}>
        <MetricRow tag="EPS" actual={fmtEps(a.eps)} yoy={epsY} showEst={false} showSurp={false} />
        <MetricRow tag="REV" actual={fmtRev(a.sales)} yoy={revY} showEst={false} showSurp={false} />
      </div>
    </div>
  )
}
