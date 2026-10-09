// SENT: sentiment and macro in one place (wave 8, lane E). Until now these series lived only
// inside the chart's indicator catalog (feature-gaps 2026-10-05).
//
// ⭐ NO NEW ROUTE. Two reads the app already serves:
//   * `GET /api/breadth-monitor?days=90` (paid): the Breadth Monitor's rows, which carry the
//     collector's AAII, NAAIM, CBOE put/call and CNN Fear & Greed columns with their own dates
//     (`aaii_survey_date`, `naaim_date`, `<key>_asof` when a heal carried a daily print). 90 is the
//     window the server warms at boot, so this read is a cache hit.
//   * `GET /api/econ/catalog` + `/api/econ/series/<SYM>` (bars entitlement): UCT's published
//     economic series. Dark by default (ECON_ENABLED): a 404 catalog says so, it is not an error.
//
// ⛔ NEVER AN INVENTED VALUE. A series with no reading in the window says "No data"; a change
// needs a real earlier reading; the date shown is the series' own date, never "today".
import { useMemo } from 'react'
import { PanelSkeleton, PanelState, useInTerminalPanel, usePanelFreshness } from '../../../components/terminal'
import { formatNumber, formatPercent, formatTimeEt } from '../../../lib/presentation/presentationPrimitives'
import { readEconomicSeries } from '../../../components/chart/engine/economicSeries'
import { observationReadout, shortDate } from '../../../components/chart/economic/econUi'
import { canRetry, failureText, useMarketRead } from './marketRead'
import styles from './marketPanels.module.css'

export const SENTIMENT_URL = '/api/breadth-monitor?days=90'
export const ECON_CATALOG = '/api/econ/catalog'
const POLL_MS = 15 * 60 * 1000
const SPARK_POINTS = 26
const DAY_MS = 86400000

/** The sentiment columns, in reading order. `dateKey` is the series' own as-of field. */
export const SENTIMENT_SERIES = Object.freeze([
  { key: 'aaii_bulls', label: 'AAII bullish', dateKey: 'aaii_survey_date', cadence: 'Weekly', unit: 'pct' },
  { key: 'aaii_bears', label: 'AAII bearish', dateKey: 'aaii_survey_date', cadence: 'Weekly', unit: 'pct' },
  { key: 'aaii_spread', label: 'AAII bull-bear spread', dateKey: 'aaii_survey_date', cadence: 'Weekly', unit: 'pts' },
  { key: 'naaim', label: 'NAAIM exposure', dateKey: 'naaim_date', cadence: 'Weekly', unit: 'num1' },
  { key: 'cboe_putcall', label: 'CBOE put/call ratio', dateKey: 'cboe_putcall_asof', cadence: 'Daily', unit: 'num2' },
  { key: 'cnn_fear_greed', label: 'CNN Fear & Greed', dateKey: 'cnn_fear_greed_asof', cadence: 'Daily', unit: 'num0' },
])

/** The economic series SENT shows when the catalog serves them, in reading order. */
export const ECON_SYMBOLS = Object.freeze([
  'USFEDFUNDSU', 'UST2Y', 'UST10Y', 'UST10Y2Y', 'USCPIYOY', 'USCORECPIYOY', 'USCOREPCEYOY', 'USUNRATE', 'USICSA',
])

const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))
const isoDay = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null)
const dayMs = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10))

/** CNN's own published bands for the Fear & Greed index. */
export function fearGreedBand(v) {
  if (v == null) return null
  if (v < 25) return 'Extreme fear'
  if (v < 45) return 'Fear'
  if (v <= 55) return 'Neutral'
  if (v <= 75) return 'Greed'
  return 'Extreme greed'
}

/** Pure: one series' readings from the Monitor rows, oldest first, one per date. The date is the
 *  series' own (`dateKey`), else the row's session. A newer row wins a shared date. */
export function seriesPoints(rows, spec) {
  const byDate = new Map()
  for (const r of Array.isArray(rows) ? rows : []) {
    const v = num(r?.[spec.key])
    const d = isoDay(r?.[spec.dateKey]) || isoDay(r?.date)
    if (v == null || !d) continue
    const rowDay = isoDay(r?.date) || d
    const prev = byDate.get(d)
    if (!prev || rowDay > prev.rowDay) byDate.set(d, { date: d, v, rowDay })
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)).map(({ date, v }) => ({ date, v }))
}

/** Pure: the latest reading and its change against the last reading at least `days` older. */
export function changeSince(points, days) {
  if (!points.length) return null
  const last = points[points.length - 1]
  const cutoff = dayMs(last.date) - days * DAY_MS
  for (let i = points.length - 2; i >= 0; i--) {
    if (dayMs(points[i].date) <= cutoff) return last.v - points[i].v
  }
  return null
}

/** Pure: every sentiment row the panel draws. */
export function sentimentRows(body) {
  const rows = Array.isArray(body?.rows) ? body.rows : []
  return SENTIMENT_SERIES.map((spec) => {
    const points = seriesPoints(rows, spec)
    const last = points[points.length - 1] || null
    return {
      ...spec,
      last,
      week: changeSince(points, 7),
      month: changeSince(points, 28),
      spark: points.slice(-SPARK_POINTS).map((p) => p.v),
    }
  })
}

function fmtValue(v, unit) {
  if (v == null) return null
  if (unit === 'pct') return formatPercent(v, { decimals: 1 })
  if (unit === 'pts') return `${v > 0 ? '+' : ''}${formatNumber(v, { decimals: 1 })} pts`
  if (unit === 'num2') return formatNumber(v, { decimals: 2 })
  if (unit === 'num0') return formatNumber(v, { decimals: 0 })
  return formatNumber(v, { decimals: 1 })
}

function fmtChange(d, unit) {
  if (d == null) return 'n/a'
  const decimals = unit === 'num2' ? 2 : unit === 'num0' ? 0 : 1
  const suffix = unit === 'pct' || unit === 'pts' ? ' pts' : ''
  return `${d > 0 ? '+' : ''}${formatNumber(d, { decimals })}${suffix}`
}

/** A small neutral sparkline. No colour: a rising reading is not good or bad on its own. Its
 *  name says where the line starts and ends, so the shape is not the only way to read it. */
export function Spark({ values, label, fmt = null }) {
  const pts = (values || []).filter((v) => Number.isFinite(v))
  if (pts.length < 2) return <span className={styles.muted}>n/a</span>
  const say = fmt || ((v) => formatNumber(v, { decimals: 2 }))
  const name = `${label}, from ${say(pts[0])} to ${say(pts[pts.length - 1])}`
  const min = Math.min(...pts)
  const span = Math.max(...pts) - min || 1
  const d = pts.map((v, i) => {
    const x = Math.round((i / (pts.length - 1)) * 1000) / 10
    const y = Math.round((100 - ((v - min) / span) * 100) * 10) / 10
    return `${i ? 'L' : 'M'}${x} ${y}`
  }).join(' ')
  return (
    <svg className={styles.spark} viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label={name}>
      <path d={d} fill="none" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

function SentimentTable({ read }) {
  const rows = useMemo(() => sentimentRows(read.body), [read.body])
  if (read.loading) return <PanelSkeleton label="Loading sentiment" testId="terminal-sent-loading" />
  if (read.error && !read.body) {
    const locked = !canRetry(read.error)
    return (
      <PanelState kind={locked ? 'locked' : 'error'} title={failureText(read.error, 'Sentiment')} testId="terminal-sent-error"
        action={locked ? null : <button type="button" className={styles.chip} onClick={read.retry}>Retry</button>}>
        {locked ? null : 'That is not the same as no readings. Retry, or run SENT again.'}
      </PanelState>
    )
  }
  return (
    <div className={styles.tableBox}>
      {read.error && <p className={styles.note} role="status">{failureText(read.error, 'Sentiment')} Showing the last read.</p>}
      <table className={styles.table} data-testid="terminal-sent-table">
        <caption className={styles.caption}>Sentiment</caption>
        <thead>
          <tr>
            <th scope="col">Series</th><th scope="col">Latest</th><th scope="col">As of</th>
            <th scope="col" title="Against the last reading at least 7 days older">1W chg</th>
            <th scope="col" className={styles.phoneHide} title="Against the last reading at least 28 days older">1M chg</th>
            <th scope="col" className={styles.phoneHide}>Trend</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} data-testid={`terminal-sent-row-${r.key}`}>
              <td>{r.label} <span className={styles.muted}>{r.cadence}</span></td>
              {r.last ? (
                <>
                  <td>
                    {fmtValue(r.last.v, r.unit)}
                    {r.key === 'cnn_fear_greed' ? <span className={styles.muted}> {fearGreedBand(r.last.v)}</span> : null}
                  </td>
                  <td>{shortDate(r.last.date)}</td>
                  <td>{fmtChange(r.week, r.unit)}</td>
                  <td className={styles.phoneHide}>{fmtChange(r.month, r.unit)}</td>
                  <td className={styles.phoneHide}><Spark values={r.spark} label={`${r.label}, last ${r.spark.length} readings`} fmt={(v) => fmtValue(v, r.unit)} /></td>
                </>
              ) : (
                <td colSpan={5} className={styles.muted} data-testid={`terminal-sent-none-${r.key}`}>No data in the last 90 sessions.</td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** A start date one year back, so a daily series stays a small read. */
function yearAgo() {
  const d = new Date(Date.now() - 366 * DAY_MS)
  return d.toISOString().slice(0, 10)
}

function EconRow({ sym, meta, start }) {
  const read = useMarketRead(`/api/econ/series/${encodeURIComponent(sym)}?start=${start}`, { refreshInterval: POLL_MS })
  const name = meta?.short_name || meta?.name || sym
  const series = useMemo(() => (read.body ? readEconomicSeries(read.body) : null), [read.body])
  const valued = (series?.points || []).filter((p) => Number.isFinite(p.v))
  const last = valued[valued.length - 1] || null
  const prev = valued[valued.length - 2] || null
  const out = last ? observationReadout(last, prev, series.meta && Object.keys(series.meta).length ? series.meta : meta) : null
  let body
  if (read.loading) body = <td colSpan={4} className={styles.muted}>Loading</td>
  else if (read.error && !read.body && read.error.status === 404) body = <td colSpan={4} className={styles.muted} data-testid={`terminal-sent-econ-none-${sym}`}>No data yet.</td>
  else if (read.error && !read.body) {
    body = (
      <td colSpan={4} className={styles.muted} data-testid={`terminal-sent-econ-error-${sym}`}>
        {failureText(read.error, name)} <button type="button" className={styles.chip} onClick={read.retry}>Retry</button>
      </td>
    )
  } else if (!out) body = <td colSpan={4} className={styles.muted} data-testid={`terminal-sent-econ-none-${sym}`}>No data yet.</td>
  else {
    body = (
      <>
        <td>{out.value}</td>
        <td>{out.period}{out.released ? <span className={styles.muted}> {out.released}</span> : null}</td>
        <td>{out.change ? out.change.replace('−', '-') : 'n/a'}</td>
        <td className={styles.phoneHide}><Spark values={valued.slice(-13).map((p) => p.v)} label={`${name}, recent prints`} /></td>
      </>
    )
  }
  return (
    <tr data-testid={`terminal-sent-econ-${sym}`}>
      <td>{name}</td>
      {body}
    </tr>
  )
}

function EconTable() {
  const cat = useMarketRead(ECON_CATALOG)
  const start = useMemo(yearAgo, [])
  const metaBy = useMemo(() => new Map((Array.isArray(cat.body?.series) ? cat.body.series : [])
    .filter((r) => r && r.symbol).map((r) => [String(r.symbol).toUpperCase(), r])), [cat.body])
  const shown = ECON_SYMBOLS.filter((s) => metaBy.has(s))

  if (cat.loading) return <p className={styles.muted}>Loading economic series.</p>
  if (cat.error && !cat.body) {
    const st = cat.error?.status
    if (st === 404) return <p className={styles.muted} data-testid="terminal-sent-econ-off">Economic series are not switched on on this server yet.</p>
    const locked = st === 402 || st === 403
    return (
      <p className={styles.muted} role="status" data-testid="terminal-sent-econ-error">
        {locked ? 'Economic series need a paid plan.' : failureText(cat.error, 'Economic series')}{' '}
        {locked ? null : <button type="button" className={styles.chip} onClick={cat.retry}>Retry</button>}
      </p>
    )
  }
  if (!shown.length) return <p className={styles.muted} data-testid="terminal-sent-econ-empty">No key economic series are published here yet.</p>
  return (
    <div className={styles.tableBox}>
      <table className={styles.table} data-testid="terminal-sent-econ">
        <caption className={styles.caption}>Economy</caption>
        <thead>
          <tr>
            <th scope="col">Series</th><th scope="col">Latest</th><th scope="col">Period</th>
            <th scope="col" title="Against the print before it">Chg</th><th scope="col" className={styles.phoneHide}>Trend</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((s) => <EconRow key={s} sym={s} meta={metaBy.get(s)} start={start} />)}
        </tbody>
      </table>
    </div>
  )
}

export default function SentimentPanel() {
  const inPanel = useInTerminalPanel()
  const read = useMarketRead(SENTIMENT_URL, { refreshInterval: POLL_MS })
  usePanelFreshness(read.body ? { source: 'UCT breadth collector (AAII, NAAIM, CBOE, CNN)', asOf: read.receivedAt, freshnessClass: 'end_of_day' } : null)
  return (
    <div className={`${styles.wrap} ${inPanel ? styles.inPanel : ''}`} data-testid="terminal-sent">
      <SentimentTable read={read} />
      <EconTable />
      <p className={styles.muted} data-testid="terminal-sent-method">
        Each date is the series' own: AAII and NAAIM are weekly surveys, put/call and Fear & Greed are daily prints.
        A change compares with the last reading at least a week or four weeks older.
        {read.receivedAt ? ` Read at ${formatTimeEt(read.receivedAt, { zoneSuffix: 'ET', absent: '' })}.` : ''}
      </p>
    </div>
  )
}
