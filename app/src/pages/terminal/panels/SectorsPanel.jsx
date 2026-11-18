// SCTR: the 11 sector funds ranked by return over a period (data wave 1).
//
// ⭐ NO NEW ROUTE. `GET /api/sector-strength?period=Today|1W|1M|3M` (api/routers/sector_strength.py
// over api/services/sector_strength.py) answers `{ period, sectors: [{ sector, ticker, change_pct }] }`,
// strongest first: the 11 SPDR Select Sector funds, each fund's latest daily bar against the bar
// 1, 5, 21 or 63 sessions before it, cached on the server for 15 minutes. The Dashboard's Sector
// Rotation tile reads the same route; this panel's SWR key is the stamped one (marketRead.js), so
// the two never share a cache entry.
//
// ⛔ AN EMPTY `sectors` LIST IS NOT A FLAT MARKET. The service returns [] when the funds' bars could
// not be fetched (and never caches it), and drops a single fund it could not price. So an empty
// answer is drawn as "not available" with Retry, and a short list says how many funds are missing.
// ⛔ The read keeps the previous period's answer while the next one loads (SWR keepPreviousData), so
// the panel only draws an answer whose own `period` echo matches the chip that is pressed.
//
// The payload carries no time of its own, so the header shows when it was read (as RSL does) and
// the method sentence says the server recomputes about every 15 minutes.
import { useMemo, useState } from 'react'
import {
  PanelCommand, PanelSkeleton, PanelState, PanelSymbol, panelAsOf, useInTerminalPanel, usePanelFreshness, usePanelSymbolRows,
} from '../../../components/terminal'
import { formatPercent, formatTimeEt } from '../../../lib/presentation/presentationPrimitives'
import { canRetry, failureKind, failureText, useMarketRead } from './marketRead'
import { usePanelWriteBack } from './commandWriteBack'
import { groupDrillCommand, sectorFundOf } from './groupDrillModel'
import styles from './marketPanels.module.css'
import bars from './barCells.module.css'

/** The periods the route takes (sector_strength.PERIOD_TO_BARS), with the words a member reads. */
export const SECTOR_PERIODS = Object.freeze({
  Today: { chip: 'Today', column: 'Change today', sessions: 1 },
  '1W': { chip: '1 week', column: 'Change, 1 week', sessions: 5 },
  '1M': { chip: '1 month', column: 'Change, 1 month', sessions: 21 },
  '3M': { chip: '3 months', column: 'Change, 3 months', sessions: 63 },
})
export const DEFAULT_SECTOR_PERIOD = 'Today'
/** How many funds a complete answer ranks (sector_strength.SECTOR_ETFS). */
export const SECTOR_FUND_COUNT = 11
const POLL_MS = 5 * 60 * 1000
const SOURCE = 'UCT sector ranking (daily closes)'

/** Pure: the route's period for whatever was typed or passed. `1D` and `TODAY` (what the command
 *  line's window argument yields) both mean Today; anything unknown falls back to Today. */
export function normPeriod(raw) {
  const t = String(raw ?? '').trim().toUpperCase()
  if (t === '1W' || t === '1M' || t === '3M') return t
  return DEFAULT_SECTOR_PERIOD
}

/** The read for one period. */
export const sectorsUrl = (period = DEFAULT_SECTOR_PERIOD) => `/api/sector-strength?period=${encodeURIComponent(normPeriod(period))}`
/** The default read (Today). */
export const SECTORS_URL = sectorsUrl()

/** Pure: the arguments a period writes into the panel's command (Today is the bare command). */
export const sectorsCommandArgs = (period) => (normPeriod(period) === DEFAULT_SECTOR_PERIOD ? [] : [normPeriod(period)])

const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))

/**
 * Pure: the payload as ranked rows. `rows` is strongest first, each `{ sym, name, pct, order, share }`
 * where `share` is the size of the move against the biggest move on the board (0 to 1, for the bar).
 * A fund with no ticker or no return is dropped, never shown as 0. `missing` is how many of the 11
 * funds the answer does not rank; `period` is the answer's own echo of what it was asked for.
 */
export function sectorRows(body) {
  const list = Array.isArray(body?.sectors) ? body.sectors : []
  const seen = new Set()
  const ranked = []
  for (const s of list) {
    const sym = String(s?.ticker || '').trim().toUpperCase()
    const pct = num(s?.change_pct)
    if (!sym || pct == null || seen.has(sym)) continue
    seen.add(sym)
    ranked.push({ sym, name: String(s.sector || '').trim() || sym, pct })
  }
  ranked.sort((a, b) => b.pct - a.pct || a.name.localeCompare(b.name))
  const biggest = ranked.reduce((m, r) => Math.max(m, Math.abs(r.pct)), 0)
  return {
    period: typeof body?.period === 'string' ? body.period : null,
    rows: ranked.map((r, i) => ({ ...r, order: i, share: biggest > 0 ? Math.abs(r.pct) / biggest : 0 })),
    missing: Math.max(0, SECTOR_FUND_COUNT - ranked.length),
  }
}

/** Half the track at most: a bar grows from the middle, right for a gain and left for a loss. */
const barWidth = (share) => `${Math.round(share * 500) / 10}%`

export default function SectorsPanel({ period: periodProp = null }) {
  const inPanel = useInTerminalPanel()
  const writeBack = usePanelWriteBack()
  // A new `SCTR 1M` remounts the panel (the shell keys the body on code + args), so the typed
  // period only ever seeds the state.
  const [period, setPeriod] = useState(() => normPeriod(periodProp))
  const read = useMarketRead(sectorsUrl(period), { refreshInterval: POLL_MS })
  // Only an answer for THIS period is drawn (the previous period's is kept while this one loads).
  const body = read.body && read.body.period === period ? read.body : null
  const board = useMemo(() => sectorRows(body), [body])
  usePanelFreshness(board.rows.length ? panelAsOf(SOURCE, read.receivedAt) : null)
  usePanelSymbolRows(board.rows.map((r) => r.sym), 'sector funds')

  // The chip writes itself into the command (`SCTR 1M`) where the registry takes a window, so a
  // reload keeps it; otherwise it is plain component state (commandWriteBack.js).
  const pick = (next) => { setPeriod(next); writeBack(sectorsCommandArgs(next)) }
  const meta = SECTOR_PERIODS[period]

  if (!body && read.error && !canRetry(read.error)) {
    return <PanelState kind="locked" title={failureText(read.error, 'Sector performance')} testId="terminal-sectors-error" />
  }

  let state = null
  if (!body && !read.error) {
    state = <PanelSkeleton label="Loading sector performance" testId="terminal-sectors-loading" />
  } else if (!body) {
    state = (
      <PanelState kind={failureKind(read.error)} title={failureText(read.error, 'Sector performance')} testId="terminal-sectors-error"
        action={<button type="button" className={styles.chip} onClick={read.retry}>Retry</button>}>
        That is not the same as a flat market. Retry, or pick another period.
      </PanelState>
    )
  } else if (!board.rows.length) {
    state = (
      <PanelState kind="error" title="Sector returns are not available right now." testId="terminal-sectors-unavailable"
        action={<button type="button" className={styles.chip} onClick={read.retry}>Retry</button>}>
        The server could not price the sector funds for this period. That is not the same as a flat market.
      </PanelState>
    )
  }

  return (
    <div className={`${styles.wrap} ${inPanel ? styles.inPanel : ''}`} data-testid="terminal-sectors" data-period={period}>
      <div className={styles.toolbar} role="toolbar" aria-label="Sector performance controls">
        <div className={styles.group} role="group" aria-label="Period">
          {Object.entries(SECTOR_PERIODS).map(([key, p]) => (
            <button key={key} type="button" className={styles.chip} aria-pressed={key === period} onClick={() => pick(key)}
              data-testid={`terminal-sectors-period-${key}`}>{p.chip}</button>
          ))}
        </div>
      </div>
      {state || (
        <>
          {read.error && <p className={styles.note} role="status">{failureText(read.error, 'Sector performance')} Showing the last read.</p>}
          {board.missing > 0 && (
            <p className={styles.note} role="status" data-testid="terminal-sectors-missing">
              Only {board.rows.length} of the {SECTOR_FUND_COUNT} sector funds could be priced for this period. The rest are
              left out, not shown as flat.
            </p>
          )}
          <div className={styles.tableBox}>
            <table className={styles.table} data-testid="terminal-sectors-table"
              aria-label={`Sector funds ranked by ${meta.column.toLowerCase()}, strongest first`}>
              <thead>
                <tr>
                  <th scope="col" className={styles.wrapCell}>Sector</th>
                  <th scope="col" title="Click a fund to load it into the linked panels">Fund</th>
                  <th scope="col">{meta.column}</th>
                </tr>
              </thead>
              <tbody>
                {board.rows.map((r, i) => (
                  <tr key={r.sym} data-testid={`terminal-sectors-row-${r.sym}`}>
                    <td className={styles.wrapCell}>
                      <span className={styles.rowNum} aria-hidden="true">{i + 1}</span>
                      {/* The sector opens GRP beside this panel: its stocks ranked. 1 month and 3 months carry over; a fund GRP does not know stays plain text. */}
                      <PanelCommand cmd={sectorFundOf(r.sym) ? groupDrillCommand({ fund: r.sym, range: period }) : ''}
                        label={`Open the stocks of ${r.name}, ranked`}>{r.name}</PanelCommand>
                    </td>
                    <td><PanelSymbol sym={r.sym} className={styles.sym} /></td>
                    <td>
                      <div className={bars.barRow}>
                        <span className={bars.track} aria-hidden="true">
                          <span className={bars.mid} />
                          <span className={`${bars.bar} ${r.pct < 0 ? bars.barDown : bars.barUp}`} style={{ width: barWidth(r.share) }}
                            data-testid={`terminal-sectors-bar-${r.sym}`} />
                        </span>
                        <span className={`${bars.value} ${r.pct > 0 ? styles.up : r.pct < 0 ? styles.down : ''}`}>
                          {formatPercent(r.pct, { decimals: 2, signed: true })}
                        </span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className={styles.muted} data-testid="terminal-sectors-method">
            The {SECTOR_FUND_COUNT} SPDR sector funds, strongest first. Today compares each fund&apos;s latest daily bar with the
            one before it; 1 week, 1 month and 3 months look back {SECTOR_PERIODS['1W'].sessions}, {SECTOR_PERIODS['1M'].sessions} and{' '}
            {SECTOR_PERIODS['3M'].sessions} trading days. The server recomputes the ranking
            about every 15 minutes. Each bar is sized against the biggest move on the board, and a sign (+/−) marks every
            return, so color is never the only signal. Click a sector to open its stocks, ranked. Click a fund to load it
            into the linked panels; type a row number to do the same.
            {read.receivedAt ? ` Read at ${formatTimeEt(read.receivedAt, { zoneSuffix: 'ET', absent: '' })}.` : ''}
          </p>
        </>
      )}
    </div>
  )
}
