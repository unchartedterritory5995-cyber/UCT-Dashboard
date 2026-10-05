/**
 * ChartEarningsStrip — the optional earnings row inside the chart widget.
 *
 * Lives INSIDE `.dockChartCol`, as a flex sibling of the chart rather than a
 * sibling of the whole dock row. That is what makes it stop exactly where the
 * chart's plotting area stops: it inherits the chart column's width, so it can
 * never run under the Company Panel, and dragging the panel divider reflows it
 * with no listener of its own. lightweight-charts is created with
 * `autoSize: true`, so shrinking the column's remaining height is all the chart
 * needs — there is no resize call to make.
 *
 * ⛔ ONE SOURCE OF TRUTH. It reads the SAME `/api/earnings-intel/{sym}` payload
 * the Company Panel's Earnings tab reads, under the same SWR key, and formats
 * it with the same `earningsRows` helpers — including `growthCell`, which owns
 * the green / red / gold rule AND the guard that a swing off a loss never earns
 * gold. Nothing here re-derives EPS, revenue, YoY or the estimate state, so the
 * strip cannot drift from the panel and costs no extra provider request.
 */
import { useMemo } from 'react'

import useMobileSWR from '../../../hooks/useMobileSWR'
import { sectionFetcher } from '../../../components/research/sections/sectionFetch'
import { CELL_PX, stripCells } from './chartEarningsStripModel'
import styles from './ChartEarningsStrip.module.css'

// ⛔ A FAILURE MUST NOT READ AS "STILL LOADING". The old fetcher turned a non-OK
// response into `null`, which this component rendered as `Loading earnings…`
// for ever. `sectionFetcher` THROWS, so SWR reports `error` and the strip can say
// the data is unavailable. (`null` is still honoured below: the Company panel's
// Earnings tab shares this SWR key and its own fetcher may be the one that
// populated it.)
const TONE = { gold: styles.gold, up: styles.up, down: styles.down, none: styles.flat }

function Metric({ k, value, cell, est }) {
  const word = !!cell?.semantic
  return (
    <div className={styles.metric}>
      <span className={styles.mKey}>{k}</span>
      <span className={`${styles.mVal}${est ? ' ' + styles.mValEst : ''}`}>{value}</span>
      <span
        className={`${styles.mPct}${word ? ' ' + styles.mPctWord : ''} ${cell ? (TONE[cell.tone] || '') : styles.flat}`}
        title={cell?.title || undefined}
      >
        {cell ? cell.text : '—'}
      </span>
    </div>
  )
}

export default function ChartEarningsStrip({ sym, width }) {
  const { data: intel, error } = useMobileSWR(
    sym ? `/api/earnings-intel/${encodeURIComponent(sym)}` : null,
    sectionFetcher,
    { refreshInterval: 0, dedupingInterval: 300000, revalidateOnFocus: false },
  )

  // How many cells the measured column can hold. Driven by the CHART's width,
  // never the browser's — the panel opening changes one and not the other.
  const max = Math.max(2, Math.floor((width || 0) / CELL_PX)) || 6
  const cells = useMemo(() => stripCells(intel, max), [intel, max])

  if (!sym) return null
  if (!cells.length) {
    // ⛔ The strip stays ADDED whatever the symbol is — a fund, an index, a
    // breadth or synthetic symbol, or a company with no reports. It says so
    // here instead of removing itself; the next company symbol fills it again.
    // SWR resets `intel` to undefined on a key change, so nothing from the
    // previous symbol is ever shown while the new one loads.
    const unavailable = !!error || intel === null || !!intel?.paywalled
    const text = unavailable
      ? `Earnings data is unavailable for ${sym}.`
      : intel === undefined
        ? 'Loading earnings…'
        : `No quarterly earnings for ${sym}.`
    return (
      <div className={styles.strip} data-testid="chart-earnings-strip-empty">
        <div className={styles.empty}>{text}</div>
      </div>
    )
  }

  return (
    <div className={styles.strip} data-testid="chart-earnings-strip">
      {cells.map(c => (
        <div key={c.key} className={`${styles.cell}${c.firstEst ? ' ' + styles.cellFirstEst : ''}`}>
          <div className={styles.head}>
            <span className={`${styles.q}${c.est ? ' ' + styles.qEst : ''}`}>{c.label}</span>
            {c.est
              ? <span className={styles.est}>EST</span>
              : <span className={styles.date}>{c.date || ''}</span>}
          </div>
          <Metric k="EPS" value={c.eps} cell={c.epsCell} est={c.est} />
          <Metric k="REV" value={c.rev} cell={c.revCell} est={c.est} />
        </div>
      ))}
    </div>
  )
}
