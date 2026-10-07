// REL — relative performance and the A÷B ratio (feature-gaps-2026-10-06 #2).
//
// Bloomberg COMP / Koyfin `AAPL:FB`: up to six names rebased to 0 % over one window, a table of
// return, worst drawdown and excess return over the first name, and the A÷B ratio of the first
// two with its 50-session average — "is A beating B, and since when". `CMP` is a snapshot table
// of two securities; this is the same question asked over time.
//
//   NVDA REL              NVDA vs SPY, 6 months
//   NVDA REL AMD SMH 1Y   three names, one year
//   REL XLK XLU YTD       a bare list (the first name is the base)
//
// Computed in the panel from `/api/bars` daily closes; no new route (useCloses.js).
import { useEffect, useMemo, useState } from 'react'
import { PanelSkeleton, PanelState, usePanelFreshness } from '../../../components/terminal'
import { formatNumber, formatPercent } from '../../../lib/presentation/presentationPrimitives'
import useCloses, { closesProvenance } from './useCloses'
import { LOOKBACK_SESSIONS, collectSymbols, relativePerformance, withArgsKey } from './relativeMath'
import styles from './comparePanels.module.css'

export const REL_MAX = 6
export const REL_DEFAULT_PEER = 'SPY'
export const REL_WINDOWS = [...Object.keys(LOOKBACK_SESSIONS), 'YTD']
const RATIO_AVG = 50

/** Pure: the names REL compares. One name alone is compared with SPY (or QQQ when it IS SPY). */
export function relSymbols(sym, props = {}) {
  const asked = collectSymbols(sym, props, REL_MAX)
  if (asked.length === 1) asked.push(asked[0] === REL_DEFAULT_PEER ? 'QQQ' : REL_DEFAULT_PEER)
  return asked
}

/** Pure: the sentence under the ratio chart. */
export function ratioVerdict(ratio, window) {
  if (!ratio || !Number.isFinite(ratio.change)) return null
  const lead = ratio.change >= 0 ? ratio.a : ratio.b
  const lag = ratio.change >= 0 ? ratio.b : ratio.a
  const by = formatPercent(Math.abs(ratio.change), { decimals: 1 })
  const trend = ratio.aboveAvg == null ? ''
    : ratio.aboveAvg
      ? ` The ratio is above its ${RATIO_AVG}-session average: ${ratio.a} is gaining on ${ratio.b} now.`
      : ` The ratio is below its ${RATIO_AVG}-session average: ${ratio.a} is losing ground to ${ratio.b} now.`
  return `${lead} has outperformed ${lag} by ${by} on the ratio over ${window}.${trend}`
}

const W = 560
const H = 220
const PAD = 30

/** Pure: decimals for the two axis labels, enough that the top and bottom never read the same.
 *  A ratio spanning 0.27 to 0.30 at one decimal printed "0.3" twice. */
export function axisDecimals(hi, lo) {
  const span = Math.abs(hi - lo)
  if (!Number.isFinite(span) || span <= 0) return 1
  return Math.max(1, Math.min(4, Math.ceil(-Math.log10(span)) + 1))
}

function LineChart({ lines, height = H, zero = true, label, testId, extra = null, classes }) {
  const all = lines.flatMap((l) => l.values).filter((v) => v != null)
  if (all.length < 2) return null
  let lo = Math.min(...all)
  let hi = Math.max(...all)
  if (zero) { lo = Math.min(lo, 0); hi = Math.max(hi, 0) }
  if (hi === lo) { hi += 1; lo -= 1 }
  const n = Math.max(...lines.map((l) => l.values.length))
  const px = (i) => PAD + (n > 1 ? (i / (n - 1)) * (W - 2 * PAD) : 0)
  const py = (v) => height - PAD / 2 - ((v - lo) / (hi - lo)) * (height - PAD)
  const pts = (vals) => vals.map((v, i) => (v == null ? null : `${px(i)},${py(v)}`)).filter(Boolean).join(' ')
  return (
    <div className={styles.chartBox}>
      <svg className={styles.chart} viewBox={`0 0 ${W} ${height}`} role="img" aria-label={label} data-testid={testId}>
        {zero && <line className={styles.zeroLine} x1={PAD} x2={W - PAD} y1={py(0)} y2={py(0)} />}
        <text className={styles.axisText} x={2} y={py(hi) + 4}>{formatNumber(hi, { decimals: axisDecimals(hi, lo) })}</text>
        <text className={styles.axisText} x={2} y={py(lo)}>{formatNumber(lo, { decimals: axisDecimals(hi, lo) })}</text>
        {lines.map((l, i) => (
          <polyline key={l.key} className={`${l.className || styles.line} ${classes?.[i] || ''}`} points={pts(l.values)} />
        ))}
        {extra}
      </svg>
    </div>
  )
}

export default function RelPanel({ sym, lookback, ...props }) {
  const withKey = withArgsKey(props)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const syms = useMemo(() => relSymbols(sym, props), [sym, withKey])
  const [win, setWin] = useState(REL_WINDOWS.includes(lookback) ? lookback : '6M')
  useEffect(() => { if (REL_WINDOWS.includes(lookback)) setWin(lookback) }, [lookback])
  const state = useCloses(syms.length >= 2 ? syms : [], 'D')
  // TERM-019: the panel header names the bar store and the newest close on screen.
  usePanelFreshness(closesProvenance(state, 'D'))
  const read = useMemo(() => (state.phase === 'ready' ? relativePerformance(state.series, syms, win, RATIO_AVG) : null),
    [state, syms, win])

  if (!syms.length) {
    return (
      <PanelState kind="input" title="REL needs at least one ticker." testId="terminal-rel-input">
        Type <kbd>NVDA REL</kbd> (vs SPY) or <kbd>NVDA REL AMD SMH 1Y</kbd>.
      </PanelState>
    )
  }
  if (state.phase !== 'ready') return <PanelSkeleton label={`Loading ${syms.join(', ')}`} shape="chart" testId="terminal-rel-loading" />
  if (!read || read.lines.length < 2) {
    const missing = state.failed.length ? `Could not read ${state.failed.join(', ')} just now.` : 'These names share too little trading history to compare.'
    return <PanelState kind="error" title={missing} testId="terminal-rel-error">Run the command again to retry, or drop a name.</PanelState>
  }
  const classes = read.lines.map((_, i) => styles[`s${i}`])
  return (
    <div className={styles.wrap} data-testid="terminal-rel">
      <div className={styles.toolbar} role="group" aria-label="Window">
        {REL_WINDOWS.map((w) => (
          <button key={w} type="button" className={styles.chip} aria-pressed={w === win} onClick={() => setWin(w)}>{w}</button>
        ))}
      </div>
      <p className={styles.lede} data-testid="terminal-rel-lede">
        {read.lines.map((l) => l.sym).join(' vs ')}, rebased to 0 % on {read.dates[0]}, through {read.dates[read.dates.length - 1]} ({read.sessions} sessions).
      </p>
      <LineChart lines={read.lines.map((l) => ({ key: l.sym, values: l.pct }))} classes={classes}
        label={`Percent change since ${read.dates[0]}`} testId="terminal-rel-chart" />
      <div className={styles.tableBox}>
        <table className={styles.table} data-testid="terminal-rel-table">
          <thead>
            <tr><th>Symbol</th><th>Return</th><th>Worst drawdown</th><th>vs {read.rows[0].sym}</th></tr>
          </thead>
          <tbody>
            {read.rows.map((r, i) => (
              <tr key={r.sym} data-testid={`terminal-rel-row-${r.sym}`}>
                <td><span className={`${styles.swatch} ${classes[i]}`} aria-hidden="true" /><span className={styles.symCell}>{r.sym}</span></td>
                <td className={r.ret > 0 ? styles.up : r.ret < 0 ? styles.down : undefined}>{formatPercent(r.ret, { decimals: 1, signed: true })}</td>
                <td>{formatPercent(r.maxDd, { decimals: 1 })}</td>
                <td className={r.excess > 0 ? styles.up : r.excess < 0 ? styles.down : undefined}>
                  {r.excess == null ? 'base' : formatPercent(r.excess, { decimals: 1, signed: true })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {read.ratio && (
        <section data-testid="terminal-rel-ratio">
          <p className={styles.lede}>{read.ratio.a} ÷ {read.ratio.b}</p>
          <LineChart zero={false} height={150} label={`${read.ratio.a} divided by ${read.ratio.b}, with its ${RATIO_AVG}-session average`}
            testId="terminal-rel-ratio-chart"
            lines={[{ key: 'ratio', values: read.ratio.values, className: `${styles.line} ${styles.s0}` },
              { key: 'avg', values: read.ratio.avg, className: styles.avgLine }]} />
          <p className={styles.lede} data-testid="terminal-rel-verdict">{ratioVerdict(read.ratio, win)}</p>
        </section>
      )}
      {state.failed.length > 0 && (
        <p className={styles.note} role="status" data-testid="terminal-rel-failed">Could not read {state.failed.join(', ')} just now; not shown.</p>
      )}
      <p className={styles.muted}>
        Daily closes, compared only on sessions every name traded ({read.overlap} in common). The ratio
        rises when {read.ratio?.a || 'the first name'} outperforms {read.ratio?.b || 'the second'}; the dashed line is its {RATIO_AVG}-session average.
      </p>
    </div>
  )
}
