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
import { PanelSkeleton, PanelState, usePanelFreshness } from '../../../components/terminal'
import { formatNumber, formatPercent } from '../../../lib/presentation/presentationPrimitives'
import useCloses, { closesProvenance, failedText } from './useCloses'
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

const Q_CLASS = { Leading: 'qLeading', Weakening: 'qWeakening', Lagging: 'qLagging', Improving: 'qImproving' }
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

const W = 560
const H = 380
const PAD = 34

const QUADRANT_ORDER = ['Leading', 'Weakening', 'Lagging', 'Improving']

/** What the graph SHOWS, for a screen reader: the axes, then which names sit in which
 *  quadrant (a11y audit 2026-10-06 — a static "relative rotation graph" said nothing). */
function rrgChartLabel(rows) {
  const parts = QUADRANT_ORDER.map((q) => {
    const syms = rows.filter((r) => r.quadrant === q).map((r) => r.sym)
    return syms.length ? `${q}: ${syms.join(', ')}` : null
  }).filter(Boolean)
  return `Relative rotation graph vs ${RRG_BENCHMARK}, RS-Ratio across and RS-Momentum up, centred on 100. `
    + (parts.length ? `${parts.join('. ')}.` : 'Nothing plotted.')
}

function Graph({ rows }) {
  const xs = rows.flatMap((r) => r.tail.map((p) => p.x))
  const ys = rows.flatMap((r) => r.tail.map((p) => p.y))
  const hx = Math.max(0.5, ...xs.map((v) => Math.abs(v - 100))) * 1.15
  const hy = Math.max(0.25, ...ys.map((v) => Math.abs(v - 100))) * 1.15
  const px = (v) => PAD + ((v - (100 - hx)) / (2 * hx)) * (W - 2 * PAD)
  const py = (v) => H - PAD - ((v - (100 - hy)) / (2 * hy)) * (H - 2 * PAD)
  return (
    <div className={styles.chartBox}>
      <svg className={styles.chart} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={rrgChartLabel(rows)}>
        <line className={styles.axis} x1={px(100)} x2={px(100)} y1={PAD / 2} y2={H - PAD} />
        <line className={styles.axis} x1={PAD} x2={W - PAD / 2} y1={py(100)} y2={py(100)} />
        <text className={styles.quadText} x={W - PAD} y={PAD} textAnchor="end">Leading</text>
        <text className={styles.quadText} x={W - PAD} y={H - PAD - 6} textAnchor="end">Weakening</text>
        <text className={styles.quadText} x={PAD + 4} y={H - PAD - 6}>Lagging</text>
        <text className={styles.quadText} x={PAD + 4} y={PAD}>Improving</text>
        <text className={styles.axisText} x={W / 2} y={H - 8} textAnchor="middle">RS-Ratio →</text>
        <text className={styles.axisText} x={10} y={H / 2} transform={`rotate(-90 10 ${H / 2})`} textAnchor="middle">RS-Momentum →</text>
        {rows.map((r) => {
          const head = r.tail[r.tail.length - 1]
          const q = styles[Q_CLASS[r.quadrant]]
          return (
            <g key={r.sym} data-testid={`rrg-point-${r.sym}`} data-quadrant={r.quadrant}>
              <polyline className={`${styles.tailLine} ${q}`} points={r.tail.map((p) => `${px(p.x)},${py(p.y)}`).join(' ')} />
              {r.tail.slice(0, -1).map((p) => <circle key={p.d} className={q} cx={px(p.x)} cy={py(p.y)} r={1.6} />)}
              <circle className={q} cx={px(head.x)} cy={py(head.y)} r={4} />
              <text className={styles.pointLabel} x={px(head.x) + 6} y={py(head.y) - 6}>{r.sym}</text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

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
  const cmds = useMemo(() => rows.map((r) => `${r.sym} GP`), [rows])
  useEffect(() => { onRows?.(cmds) }, [onRows, cmds])

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
      <Graph rows={rows} />
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
                  <button type="button" className={styles.rowBtn} onClick={() => onRun?.(`${r.sym} GP`, { next: true })} title={`Open ${r.sym} GP beside this graph`}>
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
        Closes through {asOf}{cadence === 'W' ? ' (the newest week is still forming until Friday\'s close)' : ''}.
        UCT&apos;s approximation, not JdK&apos;s proprietary formula: RS = 100 × price ÷ {RRG_BENCHMARK};
        RS-Ratio = 100 × RS ÷ its {RRG_METHOD.ratioLen}-{unit} average; RS-Momentum = 100 × RS-Ratio ÷ its{' '}
        {RRG_METHOD.momLen}-{unit} average. Tails show the last {RRG_METHOD.tail} {unit}s. Click a row, or type its number, to open its chart beside this graph.
      </p>
    </div>
  )
}
