// RRG — relative-rotation graph (feature-gaps-2026-10-06 #1).
//
// Where each sector (or any set of names) sits on RELATIVE STRENGTH TREND × MOMENTUM against
// SPY, and the path it took to get there. The dashboard's Sector Rotation tile ranks one window's
// return; this answers the rotation question a ranking cannot: which groups are gaining
// leadership (Improving → Leading) and which are losing it (Leading → Weakening).
//
//   RRG                  the 11 SPDR sector ETFs, weekly
//   RRG D                the same, daily
//   RRG SMH IGV XBI      any list of names (2–12)
//   NVDA RRG             NVDA placed among the sectors · NVDA RRG AMD AVGO  those names only
//
// ⛔ The RS-Ratio / RS-Momentum formula is UCT's stated approximation (relativeMath.RRG_METHOD),
// printed under the chart. JdK's own formula is proprietary; the panel never claims to be it.
import { useEffect, useMemo } from 'react'
import { PanelSkeleton, PanelState, usePanelFreshness, usePanelLinkedSym } from '../../../components/terminal'
import { formatNumber, formatPercent } from '../../../lib/presentation/presentationPrimitives'
import useCloses, { closesProvenance, failedText, formingThrough } from './useCloses'
import WarmingState from './WarmingState'
import RrgGraph, { RrgMethodNote } from '../../../components/rotation/RrgGraph'
import { RRG_METHOD, collectSymbols, rrgPath, withArgsKey } from './relativeMath'
import styles from './comparePanels.module.css'

/** The 11 SPDR Select Sector ETFs — the same set `api/services/sector_strength.py`
 *  SECTOR_ETFS ranks (RrgPanel.test.jsx pins the two together). */
export const SECTOR_ETFS = Object.freeze({
  XLK: 'Technology', XLF: 'Financials', XLE: 'Energy', XLV: 'Healthcare', XLI: 'Industrials',
  XLY: 'Consumer Discretionary', XLP: 'Consumer Staples', XLB: 'Materials', XLRE: 'Real Estate',
  XLU: 'Utilities', XLC: 'Communication Services',
})
export const RRG_BENCHMARK = 'SPY'
export const RRG_MAX = 12

const P_CLASS = { Leading: 'pLeading', Weakening: 'pWeakening', Lagging: 'pLagging', Improving: 'pImproving' }
const QUAD_ORDER = { Leading: 0, Improving: 1, Weakening: 2, Lagging: 3 }

/** Pure: which names the graph plots, and why. */
export function rrgUniverse(sym, props = {}) {
  const asked = collectSymbols(sym, props, RRG_MAX + 1).filter((s) => s !== RRG_BENCHMARK)
  if (asked.length === 0) return { syms: Object.keys(SECTOR_ETFS), mode: 'sectors' }
  if (asked.length === 1) {
    return { syms: [asked[0], ...Object.keys(SECTOR_ETFS).filter((s) => s !== asked[0])], mode: 'among-sectors' }
  }
  return { syms: asked.slice(0, RRG_MAX), mode: 'custom', dropped: asked.slice(RRG_MAX) }
}

/** The cadences RRG draws: weekly (the default) and daily closes. Every one the `cadence` arg
 *  accepts (args.js CADENCES) is drawn; anything else is SAID, never silently replaced. */
export const RRG_CADENCES = Object.freeze(['W', 'D'])

/** Pure: the cadence a `tf` prop resolves to (RRG reads only weekly or daily closes). */
export function rrgCadence(tf) {
  return tf === 'D' ? 'D' : 'W'
}

/** Pure: every plotted name's read, sorted Leading → Improving → Weakening → Lagging. */
export function rrgRows(series, syms) {
  const bench = series[RRG_BENCHMARK]
  if (!bench) return []
  return syms
    .filter((s) => series[s])
    .map((s) => ({ sym: s, name: SECTOR_ETFS[s] || null, ...(rrgPath(series[s], bench) || {}) }))
    .filter((r) => r.quadrant)
    .sort((a, b) => QUAD_ORDER[a.quadrant] - QUAD_ORDER[b.quadrant] || b.ratio - a.ratio)
}

// The graph itself (SVG, label placement, aria label) lives in components/rotation/RrgGraph.jsx so
// the Compare panel's Rotation tab draws the same one (UCT RS Phase 3, unit 3-12). `placeLabels`
// is re-exported for the callers that import it from here.
export { placeLabels } from '../../../components/rotation/RrgGraph'

export default function RrgPanel({ sym, tf, onRun, onRows, ...props }) {
  const cadence = rrgCadence(tf)
  // A typed window this panel cannot draw is SAID, never silently replaced (the CORR pattern).
  const unapplied = tf && !RRG_CADENCES.includes(tf) ? tf : null
  const withKey = withArgsKey(props)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const universe = useMemo(() => rrgUniverse(sym, props), [sym, withKey])
  const fetchList = useMemo(() => [RRG_BENCHMARK, ...universe.syms], [universe])
  const state = useCloses(fetchList, cadence)
  // TERM-019: the panel header names the bar store and the newest close on screen.
  usePanelFreshness(closesProvenance(state, cadence))
  const rows = useMemo(() => (state.phase === 'ready' ? rrgRows(state.series, universe.syms) : []), [state, universe])
  // Linked panels (2026-10-09): a row LOADS its name into this graph's group, like every list;
  // with nothing on screen following the group it opens `SYM GP` beside the graph (LIST_OPENS).
  const cmds = useMemo(() => rows.map((r) => `$${r.sym}`), [rows])
  const linked = usePanelLinkedSym()
  useEffect(() => { onRows?.(cmds) }, [onRows, cmds])

  if (state.phase === 'warming') return <WarmingState what="price history for these names" testId="terminal-rrg-warming" />
  if (state.phase !== 'ready') return <PanelSkeleton label="Loading the rotation graph" shape="chart" testId="terminal-rrg-loading" />
  // Re-running RRG keeps this panel and reads nothing, so every failure offers a Retry button.
  const retry = <button type="button" onClick={state.retry} data-testid="terminal-rrg-retry">Retry</button>
  if (state.failed.includes(RRG_BENCHMARK)) {
    return (
      <PanelState kind="error" title={`Could not read ${RRG_BENCHMARK}, the benchmark, just now.`} testId="terminal-rrg-error" action={retry}>
        Every point on the graph is measured against it, so nothing is drawn.
      </PanelState>
    )
  }
  // 2026-10-07 completeness audit: with the benchmark read but EVERY other name failing, this
  // said "Not enough common history" — a failed read drawn as a genuine empty graph.
  if (!rows.length && state.failed.length) {
    return (
      <PanelState kind="error" title={failedText(state)} testId="terminal-rrg-error" action={retry}>
        Nothing could be placed on the graph.
      </PanelState>
    )
  }
  if (!rows.length) {
    return (
      <PanelState kind="empty" title="Not enough common history to place anything on the graph." testId="terminal-rrg-empty">
        RRG needs about {RRG_METHOD.ratioLen + RRG_METHOD.momLen} {cadence === 'W' ? 'weeks' : 'sessions'} of closes shared with {RRG_BENCHMARK}.
      </PanelState>
    )
  }
  const unit = cadence === 'W' ? 'week' : 'session'
  const plotted = new Set(rows.map((r) => r.sym))
  const short = universe.syms.filter((s) => !plotted.has(s) && !state.failed.includes(s))
  const asOf = rows.reduce((m, r) => (r.asOf > m ? r.asOf : m), '')
  const lead = rows.filter((r) => r.quadrant === 'Leading').map((r) => r.sym)
  const improving = rows.filter((r) => r.quadrant === 'Improving').map((r) => r.sym)
  return (
    <div className={styles.wrap} data-testid="terminal-rrg">
      <p className={styles.lede} data-testid="terminal-rrg-lede">
        {universe.mode === 'sectors' ? 'Sector rotation' : universe.mode === 'among-sectors' ? `${universe.syms[0]} among the sectors` : 'Rotation'}
        {` vs ${RRG_BENCHMARK}, ${cadence === 'W' ? 'weekly' : 'daily'}. `}
        {lead.length ? `Leading: ${lead.join(', ')}. ` : 'Nothing is in Leading. '}
        {improving.length ? `Improving: ${improving.join(', ')}.` : ''}
      </p>
      {unapplied && (
        <p className={styles.note} role="status" data-testid="terminal-rrg-unapplied">
          Window {unapplied} is not available here; showing {cadence}.
        </p>
      )}
      <RrgGraph rows={rows} benchmark={RRG_BENCHMARK} />
      <div className={styles.tableBox}>
        <table className={styles.table} data-testid="terminal-rrg-table" aria-label={`Rotation quadrants vs ${RRG_BENCHMARK}`}>
          <thead>
            <tr>
              <th scope="col">Symbol</th><th scope="col">Quadrant</th><th scope="col">{unit === 'week' ? 'Weeks' : 'Sessions'} in it</th>
              <th scope="col">RS-Ratio</th><th scope="col">RS-Momentum</th><th scope="col">vs {RRG_BENCHMARK}, last {RRG_METHOD.tail} {unit}s</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.sym} data-testid={`terminal-rrg-row-${r.sym}`}>
                <td>
                  <button type="button" className={styles.rowBtn} onClick={() => onRun?.(`$${r.sym}`, { keepFunction: true })} aria-current={linked === r.sym ? 'true' : undefined}
                    title={`Load ${r.sym} into the linked panels`}>
                    <span className={styles.rowNum}>{i + 1}</span>
                    <span className={styles.symCell}>{r.sym}</span>
                    {r.name ? <span className={styles.muted}> {r.name}</span> : null}
                  </button>
                </td>
                <td><span className={`${styles.quadPill} ${styles[P_CLASS[r.quadrant]]}`}>{r.quadrant}</span></td>
                <td>{r.inQuadrant}</td>
                <td>{formatNumber(r.ratio, { decimals: 2 })}</td>
                <td>{formatNumber(r.momentum, { decimals: 2 })}</td>
                <td className={r.relRet > 0 ? styles.up : r.relRet < 0 ? styles.down : undefined}>
                  {formatPercent(r.relRet, { decimals: 1, signed: true })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {state.failed.length > 0 && (
        <p className={styles.note} role="status" data-testid="terminal-rrg-failed">
          {failedText(state)} {state.failed.length === 1 ? 'It is' : 'They are'} not on the graph.{' '}
          <button type="button" className={styles.chip} onClick={state.retry}>Retry</button>
        </p>
      )}
      {short.length > 0 && (
        <p className={styles.note} role="status">
          Too little history shared with {RRG_BENCHMARK} to place {short.join(', ')}.
        </p>
      )}
      {universe.dropped?.length > 0 && (
        <p className={styles.note} role="status">RRG plots at most {RRG_MAX} names; not shown: {universe.dropped.join(', ')}.</p>
      )}
      <p className={styles.muted} data-testid="terminal-rrg-method">
        Closes through {asOf}{cadence === 'W' ? ' (the newest week is still forming until Friday\'s close)'
          : formingThrough(state) === asOf ? ' (today\'s bar is still forming: intraday, not a close)' : ''}.{' '}
        <RrgMethodNote benchmark={RRG_BENCHMARK} unit={unit} /> Click a row, or type its number, to open its chart beside this graph.
      </p>
    </div>
  )
}
