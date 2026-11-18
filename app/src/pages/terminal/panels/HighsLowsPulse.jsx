// HILO's small chart: new highs against new lows through the session, above the lists (data wave 4).
//
// ⭐ NO NEW ROUTE. `GET /api/nhnl/series`, the read behind the /charts "H/L Pulse" widget. The pure
// half (the read, the scaling, the words) is highsLowsPulseModel.js.
//
// ⛔ THE LINES ARE RATES, NOT COUNTS: new highs (and new lows) being set per second across the
// market, smoothed. The counts of stocks stay where HILO already states them; the chart's text
// alternative says both.
// ⛔ THIS CHART NEVER FAILS THE LISTS. It makes its own read and draws its own small state: a
// failed read is one line with a Retry, and the lists under it are untouched.
// ⛔ The server keeps a rolling buffer, so on a long session the line does not reach back to the
// open. The caption states the span from the readings' own times and says when older ones are gone.
// HILO mounts it only while the scanner is running, so a closed market shows HILO's own "market is
// closed" state and this component makes no request at all.
// Its own error boundary too: a fault while drawing is one line in the chart's place, never the
// panel's crash screen over the lists.
import { useMemo } from 'react'
import ErrorBoundary from '../../../components/ErrorBoundary'
import { formatNumber } from '../../../lib/presentation/presentationPrimitives'
import { canRetry, failureText, useMarketRead } from './marketRead'
import {
  NHNL_SERIES_URL, PULSE_MIN_POINTS, PULSE_POLL_MS, PULSE_SERVER_MAX_POINTS, PULSE_VIEW, clockEt, pulseAltText, pulseChart,
  pulseRead, rateText,
} from './highsLowsPulseModel'
import styles from './marketPanels.module.css'
import css from './highsLowsPulse.module.css'

const WHAT = 'The highs and lows chart'
const count = (n) => formatNumber(n, { decimals: 0 })

function PulseBody({ scoped }) {
  const read = useMarketRead(NHNL_SERIES_URL, { refreshInterval: PULSE_POLL_MS })
  const view = useMemo(() => pulseRead(read.body), [read.body])
  const chart = useMemo(() => (view.state === 'ok' && view.active ? pulseChart(view.points) : null), [view])
  const alt = useMemo(() => pulseAltText(chart, view), [chart, view])
  const retry = <button type="button" className={styles.linkBtn} onClick={read.retry}>Retry the chart</button>

  let body
  if (read.loading) {
    body = <p className={styles.lede} role="status" data-testid="terminal-hilo-pulse-loading">Reading the highs and lows chart.</p>
  } else if (!read.body) {
    body = (
      <p className={styles.note} role="status" data-testid="terminal-hilo-pulse-error">
        {failureText(read.error, WHAT)} The lists below are not affected.{' '}{canRetry(read.error) ? retry : null}
      </p>
    )
  } else if (view.state !== 'ok') {
    body = (
      <p className={styles.note} role="status" data-testid="terminal-hilo-pulse-error">
        {WHAT} came back in a form this panel cannot read. The lists below are not affected.{' '}{retry}
      </p>
    )
  } else if (!view.active) {
    body = (
      <p className={styles.muted} data-testid="terminal-hilo-pulse-idle">
        The scanner is not running right now, so there is no highs and lows line to draw.
      </p>
    )
  } else if (!chart) {
    body = (
      <p className={styles.muted} data-testid="terminal-hilo-pulse-few">
        Too few readings to draw the highs and lows chart yet ({count(view.points.length)} so far, and it needs{' '}
        {count(PULSE_MIN_POINTS)}). It fills in within a minute of the session starting.
      </p>
    )
  } else {
    const baseline = PULSE_VIEW.height - PULSE_VIEW.pad
    body = (
      <>
        {read.error ? <p className={styles.note} role="status" data-testid="terminal-hilo-pulse-stale">{failureText(read.error, WHAT)} Showing the last read.</p> : null}
        <div className={css.plot}>
          <svg className={css.svg} viewBox={`0 0 ${PULSE_VIEW.width} ${PULSE_VIEW.height}`} preserveAspectRatio="none" role="img"
            aria-label={alt} data-testid="terminal-hilo-pulse-svg">
            <title>{alt}</title>
            <line className={css.axis} x1="0" y1={baseline} x2={PULSE_VIEW.width} y2={baseline} />
            <path className={`${css.line} ${css.highs}`} d={chart.hiPath} data-testid="terminal-hilo-pulse-highs" />
            <path className={`${css.line} ${css.lows}`} d={chart.loPath} data-testid="terminal-hilo-pulse-lows" />
          </svg>
          {/* The end labels repeat what the text alternative already says, so they are hidden from it. */}
          <span className={css.end} style={{ top: `${chart.hiLabelTop}%` }} aria-hidden="true" data-testid="terminal-hilo-pulse-label-highs">
            <span className={css.key} />Highs {rateText(chart.last.hi)}/s
          </span>
          <span className={css.end} style={{ top: `${chart.loLabelTop}%` }} aria-hidden="true" data-testid="terminal-hilo-pulse-label-lows">
            <span className={`${css.key} ${css.keyLows}`} />Lows {rateText(chart.last.lo)}/s
          </span>
        </div>
        <p className={styles.muted} data-testid="terminal-hilo-pulse-caption">
          New highs (solid line) and new lows (dashed line) being set each second across the market, from{' '}
          {clockEt(chart.startT)} to {clockEt(chart.endT)} ET, smoothed over about a minute and a half. The scale runs from 0
          to {rateText(chart.yMax)} a second.
          {view.bufferFull ? ` The scanner keeps its latest ${count(PULSE_SERVER_MAX_POINTS)} readings, so earlier readings of this session are not shown.` : ''}
          {scoped ? ' The chart is every stock the scanner watches, not only the view below.' : ''}
        </p>
      </>
    )
  }

  return (
    <section className={css.pulse} aria-label="New highs and new lows through the session" data-testid="terminal-hilo-pulse">
      {body}
    </section>
  )
}

const crashed = () => (
  <p className={styles.muted} role="status" data-testid="terminal-hilo-pulse-crashed">
    The highs and lows chart could not be drawn. The lists below are not affected.
  </p>
)

/** `scoped`: the lists under the chart are narrowed (a sector, an industry, a theme); the chart is not. */
export default function HighsLowsPulse({ scoped = false }) {
  return (
    <ErrorBoundary fallback={crashed}>
      <PulseBody scoped={scoped} />
    </ErrorBoundary>
  )
}
