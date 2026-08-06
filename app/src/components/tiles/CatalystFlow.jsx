// app/src/components/tiles/CatalystFlow.jsx
import { useState, useRef, useMemo, useCallback } from 'react'
import useMobileSWR from '../../hooks/useMobileSWR'
import useRealtimePrices from '../../hooks/useRealtimePrices'
import TileCard from '../TileCard'
import EarningsResearchModal from '../research/EarningsResearchModal'
import ErrorBoundary from '../ErrorBoundary'
import ErrorState from '../ErrorState'
import { SkeletonTable } from '../Skeleton'
import styles from './CatalystFlow.module.css'

const fetcher = url => fetch(url).then(r => r.json())

function VerdictPill({ verdict }) {
  const v = verdict?.toLowerCase()
  if (v === 'pending') return <span className={`${styles.pill} ${styles.pillPending}`}>PENDING</span>
  if (v === 'beat')    return <span className={`${styles.pill} ${styles.pillBeat}`}>BEAT</span>
  if (v === 'miss')    return <span className={`${styles.pill} ${styles.pillMiss}`}>MISS</span>
  if (v === 'mixed')   return <span className={`${styles.pill} ${styles.pillMixed}`}>MIXED</span>
  return <span className={styles.pillPending}>{verdict ?? '—'}</span>
}

function fmtEps(v) {
  if (v == null) return '—'
  const sign = v < 0 ? '-' : ''
  return `${sign}$${Math.abs(v).toFixed(2)}`
}

function fmtRev(m) {
  if (m == null) return '—'
  return m >= 1000 ? `$${(m / 1000).toFixed(1)}B` : `$${Math.round(m)}M`
}

function GapCell({ value }) {
  if (value == null) return <span className={styles.muted}>—</span>
  const n = typeof value === 'number' ? value : parseFloat(value)
  if (isNaN(n)) return <span className={styles.muted}>—</span>
  const fmt = n >= 0 ? `+${n.toFixed(2)}%` : `${n.toFixed(2)}%`
  return <span className={n >= 0 ? styles.pos : styles.neg}>{fmt}</span>
}

function EarningsTable({ rows, label, onSelect, liveGaps, livePrices }) {
  if (!rows?.length) return null
  return (
    <div className={styles.tableWrap}>
      <div className={styles.tableLabel}>{label}</div>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Ticker</th>
            <th className={styles.hideOnMobile}>Price</th>
            <th>Verdict</th>
            <th>Gap</th>
            <th className={styles.hideOnMobile}>EPS Act</th>
            <th className={styles.hideOnMobile}>Rev Act</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => {
            const lp = livePrices?.[row.sym]
            return (
              <tr key={row.sym} className={styles.clickRow} onClick={() => onSelect(row, label)}>
                <td><span className={styles.sym}>{row.sym}</span></td>
                <td className={styles.hideOnMobile}>
                  {lp ? (
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)' }}>
                      ${lp.price?.toFixed(2)}
                    </span>
                  ) : <span className={styles.muted}>—</span>}
                </td>
                <td><VerdictPill verdict={row.verdict} /></td>
                <td><GapCell value={liveGaps?.[row.sym] ?? row.change_pct} /></td>
                <td className={styles.hideOnMobile}>{fmtEps(row.reported_eps)}</td>
                <td className={styles.hideOnMobile}>{fmtRev(row.rev_actual)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export default function CatalystFlow({ data: propData }) {
  const { data: fetched, error, mutate } = useMobileSWR(
    propData !== undefined ? null : '/api/earnings',
    fetcher,
    { refreshInterval: 300000 }
  )
  const { data: liveGaps } = useMobileSWR(
    '/api/earnings-gaps',
    fetcher,
    { refreshInterval: 30000 }
  )

  const data = propData !== undefined ? propData : fetched
  const [selected, setSelected] = useState(null)
  // T11 review round 1, I5: SectionRail always renders all four tabs and
  // handles its own keyboard nav regardless of whether onSectionChange does
  // anything — passing `section={null}`/`onSectionChange={() => {}}` (the
  // brief's literal snippet) shipped dead controls: clicking History/Brief/
  // Call did nothing, forever. Plain local state instead — the brief only
  // ruled out the ROUTE hook here (double-render / unresolvable across two
  // live Dashboard instances), not local state.
  const [section, setSection] = useState('setup')
  // C3 (T11 review round 1): keys the ErrorBoundary below so a crash has a
  // way out — see Calendar.jsx's openSeq for the full rationale. Bumped on
  // every fresh row click, untouched otherwise (CatalystFlow has no stepping).
  const [openSeq, setOpenSeq] = useState(0)
  const scrollBodyRef = useRef(null)

  const openEntry = useCallback((row, label) => {
    setOpenSeq((s) => s + 1)
    setSection('setup')
    setSelected({ row, label })
  }, [])

  // Live prices for all earnings tickers
  const earningsTickers = useMemo(() => {
    if (!data) return []
    return [
      ...(data.bmo || []),
      ...(data.amc_tonight || []),
      ...(data.amc || []),
    ].map(r => r.sym).filter(Boolean)
  }, [data])
  const { prices: livePrices } = useRealtimePrices(earningsTickers)

  if (error) return <TileCard icon="dollar" title="Earnings"><ErrorState compact message="Failed to load earnings" onRetry={() => mutate()} /></TileCard>
  if (!data) return <TileCard icon="dollar" title="Catalyst Flow"><SkeletonTable rows={5} cols={3} /></TileCard>

  return (
    <>
      <TileCard icon="dollar" title="Earnings">
        <div className={styles.scrollBody} ref={scrollBodyRef}>
          <EarningsTable
            rows={data.bmo}
            label="BEFORE MARKET OPEN"
            onSelect={openEntry}
            liveGaps={liveGaps}
            livePrices={livePrices}
          />
          <EarningsTable
            rows={data.amc_tonight}
            label="AFTER CLOSE · TONIGHT"
            onSelect={openEntry}
            liveGaps={liveGaps}
            livePrices={livePrices}
          />
          <EarningsTable
            rows={data.amc}
            label="AFTER CLOSE · YESTERDAY"
            onSelect={openEntry}
            liveGaps={liveGaps}
            livePrices={livePrices}
          />
          {!data.bmo?.length && !data.amc_tonight?.length && !data.amc?.length && (
            <p className={styles.loading}>No earnings today</p>
          )}
        </div>
      </TileCard>

      {selected && (
        <ErrorBoundary
          key={openSeq}
          fallback={<div style={{ color: 'var(--text-muted)', fontSize: '11px', fontFamily: 'var(--font-mono)', padding: '12px' }}>Unable to load — click a ticker to retry.</div>}
        >
          {/* Plain local state on purpose (§4.4): the Dashboard mounts TWO live
              CatalystFlow instances (desktop + mobile trees) and its rows come
              from today's wire list, so URL-driven opening here would both
              double-render and be unresolvable. `key={openSeq}` — see
              Calendar.jsx's C3 note: un-keying alone removed the only way out
              of a crashed boundary, and here there is no route to fall back on
              via a browser Back, so a crash was TERMINAL until page reload. */}
          <EarningsResearchModal
            row={selected.row}
            label={selected.label}
            onClose={() => setSelected(null)}
            section={section}
            onSectionChange={setSection}
          />
        </ErrorBoundary>
      )}
    </>
  )
}
