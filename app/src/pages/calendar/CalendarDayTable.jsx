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
import TickerActionsMenu, { useTickerActions } from '../../components/TickerActions'
import { BeatDots, DateMovedChip, MoveUnavailableMark, moveIsUnavailable } from './cardBits'
import { formatCompactTerminal, formatCurrency, formatPercent } from '../../lib/presentation/presentationPrimitives'
import styles from './Calendar.module.css'
import { ASC, DESC, ariaSortFor, nextSort, sortCaretFor } from '../../lib/presentation/dataGrid'

// ── TERM-065: the day table's header decisions come from the DataGrid seed ─────
// The table keeps its numeric direction (1 asc / -1 desc, read by its comparator),
// its per-column first direction (Symbol A→Z, every number high→low) and its third
// click back to importance order; the seed decides the flip, the direction words and
// the caret. Parity with the hand-rolled code:
// lib/presentation/dataGrid/pageGrids2.seedParity.test.js
const dayTableToSeed = (s) => s && { key: s.key, dir: s.dir === 1 ? ASC : DESC }
const dayTableFirstDir = (key) => (key === 'sym' ? ASC : DESC)
export function nextDayTableSort(prev, key) {
  // already on the column's second direction → the third click restores importance order
  if (prev?.key === key && dayTableToSeed(prev).dir !== dayTableFirstDir(key)) return null
  const n = nextSort(dayTableToSeed(prev), key, dayTableFirstDir)
  return { key, dir: n.dir === ASC ? 1 : -1 }
}
export const dayTableSortWords = (sort, key) => ariaSortFor(dayTableToSeed(sort), key, null)
export function dayTableCaret(sort, key) {
  const c = sortCaretFor(dayTableToSeed(sort), key)
  return c ? ` ${c}` : ''
}

function fmtEps(v) { return v == null ? '' : formatCurrency(v) }
// Revenue arrives in $M and market cap in $B; both read on the terminal compact ladder.
function fmtRev(v) { return v == null ? '' : formatCompactTerminal(v * 1e6, { money: true, absent: '' }) }
function fmtCap(v) { return v == null || v <= 0 ? '' : formatCompactTerminal(v * 1e9, { money: true, absent: '' }) }

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

function Row({ e, gap, enrichReady, onSelect, longPressProps }) {
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
        {/* Seam 19: right-click/long-press scoped to the sym itself (not the
            whole wide row) -- matches VirtualResults.jsx/ResultCards.jsx's
            existing precedent for dense multi-column tables. Tap still opens
            the peek modal via the row's own onClick, unchanged. */}
        <span className={styles.dtSym} {...longPressProps(e.sym)}>
          {e.sym}
          {e.mine && <UIcon name="star-fill" size={10} style={{ marginLeft: 4, verticalAlign: '-1px' }} />}
        </span>
        {e.name && <span className={styles.dtName}>{e.name}</span>}
        {e.date_moved ? <DateMovedChip moved={e.date_moved} /> : (e.date_est && <span className={styles.dateEst}>est.</span>)}
      </span>
      <span className={styles.dtNum}>{fmtCap(e.mc_b)}</span>
      <span className={styles.dtNum}>
        {reported
          ? <>{fmtEps(e.eps_act)}{surp != null && (
              <span className={surp >= 0 ? styles.pos : styles.neg}> {formatPercent(surp, { decimals: 1, signed: true })}</span>
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
          column reads as broken, not loading.

          The unavailable branch sits BELOW the priced branch (a priced move
          renders byte-identically to before) and is gated on `enrichReady`, so
          a row whose enrichment is still in flight can never be labelled — it
          keeps the '…'. The em dash survives for the one case with nothing to
          explain: a past report, where the read was never attempted and the
          server sends no outcome. */}
      <span className={`${styles.dtNum} ${styles.dtMoveCell} ${reported && gap != null ? '' : styles.dtMove}`}>
        {reported && gap != null
          ? <span className={gap >= 0 ? styles.pos : styles.neg}>
              {gap >= 0 ? '▲ +' : '▼ '}{formatPercent(gap, { decimals: 1 })}
            </span>
          : e.expected_move?.pct != null ? `±${e.expected_move.pct}%`
          : enrichReady && moveIsUnavailable(e.expected_move_outcome)
            ? <MoveUnavailableMark outcome={e.expected_move_outcome} className={styles.dtNa} />
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
  const ta = useTickerActions()

  const clickSort = (key) => {
    setSort(s => nextDayTableSort(s, key))   // third click restores importance order
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
                  ? `${c.label}, sorted ${dayTableSortWords(sort, c.key)}`
                  : `${c.label}, not sorted`)
              : c.label}
          >
            {c.label}{dayTableCaret(sort, c.key)}
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
                   enrichReady={enrichReady} onSelect={onSelect}
                   longPressProps={ta.longPressProps} />
            ))}
          </div>
        )
      })}
      {ta.menu && <TickerActionsMenu menu={ta.menu} onClose={ta.closeMenu} />}
    </div>
  )
}
