// app/src/pages/traderArchive/PlaybookCharts.jsx
//
// Charts for a playbook's best calls and failures on /trader-archive: the stock's daily chart
// framed around the day the call was posted, that bar highlighted, the following weeks visible so
// the outcome reads off the chart. The framing is Model Book's year-framed recipe narrowed to the
// call (SetupsView.jsx: entryDate/exitDate + exactDateRange + highlightBarTime).
//
// ⛔ Charts open on demand, at most CHARTS_PER_SIDE per side, and the StockChart chunk loads only
// then: a playbook page must not fetch twelve tickers' bars because someone opened it.
// Reference lines ("auto chart"): when the server sends `lines` (WISDOM_ARCHIVE_LINES_ENABLED),
// each chart draws the team's usual trigger / entry / stop lines for the setup, as of the day the
// call was posted (api/services/wisdom/archive/levels.py owns every formula and label). A call's
// own stated entry/stop appears only once it is more than 20 sessions old, and that gate lives on
// the server with the levels, not here. No `lines` field means no lines.
import { Suspense, lazy, useMemo, useState } from 'react'

import { archiveRefPriceLines, dayOf, fmtR, rTone, traderOf } from '../../utils/traderArchive'
import styles from './PlaybookCharts.module.css'

const StockChart = lazy(() => import('../../components/StockChart'))

export const CHARTS_PER_SIDE = 3
const LEAD_DAYS = 120    // ~80 trading bars of lead-up, Model Book's default
const AFTER_DAYS = 45    // ~30 trading bars after the call: the r20 window and a little more

function shiftIso(iso, days) {
  const d = new Date(`${iso}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return null
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export function chartFrame(posted, today = new Date().toISOString().slice(0, 10)) {
  const day = dayOf(posted)
  const start = shiftIso(day, -LEAD_DAYS)
  const after = shiftIso(day, AFTER_DAYS)
  if (!start || !after) return null
  return { day, start, end: after < today ? after : today }
}

function CallChart({ call, side, lines }) {
  const frame = chartFrame(call.posted)
  const tone = rTone(call.r20)
  const priceLines = useMemo(() => archiveRefPriceLines(lines), [lines])
  return (
    <figure className={styles.card} data-testid="pb-chart" data-side={side}>
      <figcaption className={styles.caption}>
        <span className={side === 'best' ? styles.best : styles.fail}>{side === 'best' ? 'Best call' : 'Failure'}</span>
        <span className={styles.ticker}>{call.ticker}</span>
        <span>{traderOf(call)}</span>
        <span>{frame?.day || ''}</span>
        <span className={tone === 'up' ? styles.up : tone === 'down' ? styles.down : undefined}>r20 {fmtR(call.r20)}</span>
      </figcaption>
      <div className={styles.chart}>
        {frame ? (
          <Suspense fallback={<p className={styles.note}>Loading the chart…</p>}>
            <StockChart
              sym={call.ticker}
              tf="D"
              height="100%"
              liveUpdates={false}
              backgroundWarm={false}
              showDrawingTools={false}
              entryDate={frame.start}
              exitDate={frame.end}
              exactDateRange
              fitPriceToCandles
              frozen
              hideCrosshair
              hideLegend
              hideJournalOverlay
              boldCandles
              hideLastValue
              showVolume
              volumeSeparatePane
              highlightBarTime={frame.day}
              highlightColor="#ffffff"
              {...(priceLines.length ? { priceLines } : {})}
            />
          </Suspense>
        ) : <p className={styles.note}>No usable date for this call.</p>}
      </div>
      {priceLines.length > 0 && (
        <p className={styles.note} data-testid="pb-ref-note">
          Reference lines: where the team usually places these levels on this setup.
        </p>
      )}
    </figure>
  )
}

export default function PlaybookCharts({ winners = [], failures = [], lines = null }) {
  const [open, setOpen] = useState(false)
  const best = winners.filter((c) => c?.ticker && c?.posted).slice(0, CHARTS_PER_SIDE)
  const worst = failures.filter((c) => c?.ticker && c?.posted).slice(0, CHARTS_PER_SIDE)
  const total = best.length + worst.length
  if (!total) return null
  return (
    <section className={styles.wrap} aria-label="Charts of the best calls and failures">
      <button type="button" className={styles.toggle} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {open ? 'Hide the charts' : `Show the charts (${total})`}
      </button>
      {open && (
        <div className={styles.grid}>
          {best.map((c) => <CallChart key={`b:${c.call_id}`} call={c} side="best" lines={lines?.[c.call_id]} />)}
          {worst.map((c) => <CallChart key={`f:${c.call_id}`} call={c} side="failure" lines={lines?.[c.call_id]} />)}
        </div>
      )}
    </section>
  )
}
