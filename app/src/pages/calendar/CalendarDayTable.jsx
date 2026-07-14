// app/src/pages/calendar/CalendarDayTable.jsx
// The density engine: every non-featured reporter WITH data as a 36px row.
// Session-grouped (BMO → AMC → TBD) with colored spines, imp-ordered within
// groups, sortable column headers (pro-grid table stakes), right-aligned
// EPS/Rev estimate columns (the WSE/EarningsHub row grammar), click →
// EarningsModal. Reported rows flip EPS to actual + surprise and the Move
// column to the realized post-print gap.
import { useMemo, useState } from 'react'
import CompanyLogo from '../../components/CompanyLogo'
import UIcon from '../../components/ui/UIcon'
import { BeatDots, DateMovedChip } from './cardBits'
import styles from './Calendar.module.css'

function fmtEps(v) { return v == null ? '' : `${v < 0 ? '-' : ''}$${Math.abs(v).toFixed(2)}` }
function fmtRev(v) { if (v == null) return ''; return v >= 1000 ? `$${(v / 1000).toFixed(1)}B` : `$${Math.round(v)}M` }
function fmtCap(v) { if (v == null || v <= 0) return ''; return v >= 1000 ? `$${(v / 1000).toFixed(1)}T` : v >= 1 ? `$${Math.round(v)}B` : `$${Math.round(v * 1000)}M` }

const SESSIONS = [
  ['bmo', 'Before Open'],
  ['amc', 'After Close'],
  ['tbd', 'Time TBD'],
]

const SPINE_CLASS = { bmo: 'dtRowBmo', amc: 'dtRowAmc', tbd: 'dtRowTbd' }
const DOT_CLASS   = { bmo: 'dtDotBmo', amc: 'dtDotAmc', tbd: 'dtDotTbd' }

const COLUMNS = [
  { key: 'sym',  label: 'Company',  sortable: true,  numeric: false },
  { key: 'mc_b', label: 'Cap',      sortable: true,  numeric: true },
  { key: 'eps',  label: 'EPS est',  sortable: true,  numeric: true },
  { key: 'rev',  label: 'Rev est',  sortable: true,  numeric: true },
  { key: 'move', label: 'Move ±%',  sortable: true,  numeric: true },
  { key: 'beat', label: 'Beats',    sortable: false, numeric: false },
]

function sortVal(e, key) {
  switch (key) {
    case 'sym':  return e.sym || ''
    case 'mc_b': return e.mc_b
    case 'eps':  return e.eps_act ?? e.eps_est
    case 'rev':  return e.rev_act ?? e.rev_est
    case 'move': return e.expected_move?.pct
    default:     return null
  }
}

function Row({ e, gap, enrichReady, onSelect }) {
  const reported = e.eps_act != null
  const surp = (reported && e.eps_est != null && e.eps_est !== 0)
    ? ((e.eps_act - e.eps_est) / Math.abs(e.eps_est)) * 100
    : null
  const spine = styles[SPINE_CLASS[e._timing] || 'dtRowTbd']
  return (
    <div className={`${styles.dtRow} ${spine} ${e.mine ? styles.dtRowMine : ''}`}
         onClick={() => onSelect?.(e, e._timing)}>
      <span className={styles.dtCompany}>
        <CompanyLogo sym={e.sym} size={20} tile />
        <span className={styles.dtSym}>
          {e.sym}
          {e.mine && <UIcon name="star-fill" size={10} style={{ marginLeft: 4, verticalAlign: '-1px' }} />}
        </span>
        {e.name && <span className={styles.dtName}>{e.name}</span>}
        {e.date_moved ? <DateMovedChip moved={e.date_moved} /> : (e.date_est && <span className={styles.dateEst}>est.</span>)}
      </span>
      <span className={`${styles.dtNum} ${styles.dtCap}`}>{fmtCap(e.mc_b)}</span>
      <span className={styles.dtNum}>
        {reported
          ? <>{fmtEps(e.eps_act)}{surp != null && (
              <span className={surp >= 0 ? styles.pos : styles.neg}> {surp >= 0 ? '+' : ''}{surp.toFixed(1)}%</span>
            )}</>
          : fmtEps(e.eps_est)}
      </span>
      <span className={`${styles.dtNum} ${styles.dtRev}`}>
        {reported && e.rev_act != null
          ? <>{fmtRev(e.rev_act)}{e.rev_est != null && <span className={styles.dtRevEst}> / {fmtRev(e.rev_est)}</span>}</>
          : fmtRev(e.rev_est)}
      </span>
      {/* Pre-report: the options-implied move. Post-print: the REALIZED gap —
          the implied number is stale the moment actuals land. While the
          enrichment fetch is in flight the cell shows a loading mark; a blank
          column reads as broken, not loading. */}
      <span className={`${styles.dtNum} ${styles.dtMoveCell} ${reported && gap != null ? '' : styles.dtMove}`}>
        {reported && gap != null
          ? <span className={gap >= 0 ? styles.pos : styles.neg}>
              {gap >= 0 ? '▲ +' : '▼ '}{gap.toFixed(1)}%
            </span>
          : e.expected_move?.pct != null ? `±${e.expected_move.pct}%`
          : enrichReady ? <span className={styles.dtDash}>—</span>
          : <span className={styles.dtLoading}>…</span>}
      </span>
      <span className={styles.dtBeats}>
        {e.beat_history?.length
          ? <BeatDots history={e.beat_history} />
          : enrichReady ? <span className={styles.dtDash}>—</span>
          : <span className={styles.dtLoading}>…</span>}
      </span>
    </div>
  )
}

export default function CalendarDayTable({ entries, reactions, enrichReady = true, onSelect }) {
  const [sort, setSort] = useState(null)   // { key, dir: 1|-1 } | null = imp order

  const clickSort = (key) => {
    setSort(s => {
      if (!s || s.key !== key) return { key, dir: key === 'sym' ? 1 : -1 }
      if ((key === 'sym' && s.dir === 1) || (key !== 'sym' && s.dir === -1)) return { key, dir: -s.dir }
      return null   // third click restores importance order
    })
  }

  const groups = useMemo(() => {
    const bySession = { bmo: [], amc: [], tbd: [] }
    for (const e of entries) bySession[e._timing || 'tbd']?.push(e)
    if (sort) {
      const cmp = (a, b) => {
        const va = sortVal(a, sort.key)
        const vb = sortVal(b, sort.key)
        if (va == null && vb == null) return 0
        if (va == null) return 1        // blanks always sink
        if (vb == null) return -1
        return (va < vb ? -1 : va > vb ? 1 : 0) * sort.dir
      }
      for (const k of Object.keys(bySession)) bySession[k] = [...bySession[k]].sort(cmp)
    }
    return bySession
  }, [entries, sort])

  if (!entries.length) return null

  return (
    <div className={styles.dayTable}>
      <div className={styles.dtHead}>
        {COLUMNS.map(c => (
          <button
            key={c.key}
            className={`${styles.dtTh} ${sort?.key === c.key ? styles.dtThActive : ''}`}
            onClick={() => c.sortable && clickSort(c.key)}
            disabled={!c.sortable}
            /* aria-sort is only valid on role=columnheader; these are plain
               buttons in a div grid. Encode the tri-state sort in the
               accessible name instead (aria-pressed can't express 3 states). */
            aria-label={c.sortable
              ? (sort?.key === c.key
                  ? `${c.label}, sorted ${sort.dir === 1 ? 'ascending' : 'descending'}`
                  : `${c.label}, not sorted`)
              : c.label}
          >
            {c.label}{sort?.key === c.key ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}
          </button>
        ))}
      </div>
      {SESSIONS.map(([key, label]) => {
        const rows = groups[key]
        if (!rows.length) return null
        const repN = rows.filter(e => e.eps_act != null).length
        return (
          <div key={key}>
            <div className={`${styles.dtSession} ${
              key === 'bmo' ? styles.bmoHd : key === 'amc' ? styles.amcHd : styles.tbdHd}`}>
              <span className={`${styles.dtDot} ${styles[DOT_CLASS[key]]}`} aria-hidden="true" />
              {label}
              <span className={styles.timedCount}>{rows.length}</span>
              {repN > 0 && <span className={styles.dtRepN}>· {repN} reported</span>}
            </div>
            {rows.map(e => (
              <Row key={`${key}-${e.sym}`} e={e} gap={reactions?.[e.sym]}
                   enrichReady={enrichReady} onSelect={onSelect} />
            ))}
          </div>
        )
      })}
    </div>
  )
}
