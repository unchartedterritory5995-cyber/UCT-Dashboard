// UNVOL: stocks trading far above their usual volume for this time of day, the whole market,
// highest first (2026-11-18).
//
// ⭐ NO NEW ROUTE AND NO PROVIDER CALL ON THE REQUEST. One door the Screener page already uses:
// `POST /api/screener/scan` (api/routers/screener.py, paid), a SQL query over the screener
// snapshot the server holds, with its live overlay joined in (rewritten about every 30 seconds in
// the regular session from the one whole-market snapshot the server already keeps). The pure half
// (the two readings, the scan body, the rows, the typed words) is unusualVolumeModel.js.
//
//   UNVOL           2× its usual volume or more, up or down      UNVOL UP | DOWN
//   UNVOL 3X | 5X   further above usual
//
// ⛔ "USUAL" IS FOR THE TIME OF DAY. The by-now reading divides today's volume so far by what the
// stock usually trades BY THIS MINUTE (its 30-session average × the usual share of a day done by
// now). It is never today's volume so far over a full-day average, which calls every stock quiet at
// 10:00 and every stock unusual by the close.
// ⛔ WHEN THERE IS NO BY-NOW READING THE PANEL SAYS SO AND SHOWS THE LAST FULL SESSION, labelled
// with its date: before 9:45 AM ET, overnight after the nightly build, weekends, holidays, or the
// live overlay switched off. Never an empty table, and never last session's numbers under a "now".
// ⛔ "NOTHING MATCHES" AND "NO READING" ARE DIFFERENT FACTS. A filtered pick that comes back empty
// asks one more one-row question (is there any by-now reading at all) before it says which.
// ⛔ A FAILED READ IS NEVER AN EMPTY LIST: an error with Retry, or locked with no Retry (402, 404).
//
// How it differs from its neighbours: MOST RVOL is a burst in the last minutes on the 300 most
// liquid stocks (the Volume Surge scanner); LEAD VOL1Y / VOLMAX is record volume against the last
// year or all history. This is every liquid stock against its own usual pace for the time of day.
//
// The scan is a POST, so it goes through SWR directly with the same options marketRead.js uses
// (`useMarketRead` reads a URL); SWR skips ticks while the app is hidden (App.jsx `isVisible`).
import { useMemo, useState } from 'react'
import useSWR from 'swr'
import jsonFetcher from '../../../utils/jsonFetcher'
import {
  PanelCommand, PanelSkeleton, PanelState, PanelSymbol, panelAsOf, useInTerminalPanel, usePanelFreshness, usePanelSymbolRows,
} from '../../../components/terminal'
import CoverageLine from '../../../components/provenance/CoverageLine'
import {
  formatCompactTerminal, formatCurrency, formatDateTimeEt, formatNumber, formatPercent, formatTimeEt,
} from '../../../lib/presentation/presentationPrimitives'
import { etYmd } from '../../../lib/marketClock/etTime'
import { canRetry, failureKind, failureText } from './marketRead'
import { usePanelWriteBack } from './commandWriteBack'
import {
  DEFAULT_UNVOL_MIN, DEFAULT_UNVOL_SIDE, UNUSUAL_VOLUME_CODE, UNVOL_FLOORS, UNVOL_MINS, UNVOL_PAGE_SIZE, UNVOL_SIDES,
  multipleText, normUnvolMin, normUnvolSide, unvolCommandArgs, unvolIsMoving, unvolScanBody, unvolView,
} from './unusualVolumeModel'
import styles from './marketPanels.module.css'

export {
  DEFAULT_UNVOL_MIN, DEFAULT_UNVOL_SIDE, UNUSUAL_VOLUME_CODE, UNVOL_COLUMNS_READ, UNVOL_FLOORS, UNVOL_LIVE_FRESH_MS, UNVOL_MINS,
  UNVOL_MIN_ARG_WORDS, UNVOL_MODES, UNVOL_PAGE_SIZE, UNVOL_SIDES, UNVOL_SIDE_ARG_WORDS, multipleText, normUnvolMin, normUnvolSide,
  parseUnvolMin, parseUnvolSide, unvolCommandArgs, unvolIsMoving, unvolScanBody, unvolView,
} from './unusualVolumeModel'

/** The one door. It lives HERE, in the module that draws the results: TERM-047's result-surface
 *  census finds a surface by the scan routes its own module names (helpers are not followed). */
export const UNVOL_SCAN_URL = '/api/screener/scan'

/** While the by-now reading is moving the server rewrites it about every 30 to 60 seconds. */
export const LIVE_POLL_MS = 60 * 1000
/** Otherwise: often enough to see the reading start at 9:45 AM ET, or the nightly build land. */
export const IDLE_POLL_MS = 5 * 60 * 1000

const SOURCE = 'UCT screener (live volume reading, Massive prices)'
const WHAT = 'The unusual volume list'
const NA = 'n/a'

const fetchScan = ([url, , , body]) => jsonFetcher(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body,
}).then((answer) => ({ body: answer, receivedAt: new Date().toISOString() }))

/** One scan read: `mode` null asks nothing. Keyed by the body, so a new pick is a new read and one
 *  pick's rows are never drawn under another's chips. */
function useScan(mode, { side, min, probe = false, refreshInterval = 0 }) {
  const body = useMemo(() => (mode ? JSON.stringify(unvolScanBody(mode, { side, min, probe })) : null), [mode, side, min, probe])
  return useSWR(body ? [UNVOL_SCAN_URL, 'terminal-unvol', `${mode}${probe ? '-probe' : ''}`, body] : null, fetchScan,
    { refreshInterval, revalidateOnFocus: false })
}

const tone = (v) => (v > 0 ? styles.up : v < 0 ? styles.down : undefined)
const count = (n) => formatNumber(n, { decimals: 0 })
const plural = (n, one, many) => (n === 1 ? one : many)

/** Pure: when a by-now reading was worked out, in words: the time alone when it is today's (ET),
 *  the date and the time when it is an earlier day's. `now` is epoch ms. */
export function readingStamp(iso, now = Date.now()) {
  const t = iso ? Date.parse(iso) : NaN
  if (!Number.isFinite(t)) return null
  return etYmd(t) === etYmd(now) ? formatTimeEt(iso, { zoneSuffix: 'ET', absent: null }) : formatDateTimeEt(t / 1000)
}

/** Pure: the picks in words: "2× its usual volume or more, up or down on the day". */
export const picksWords = (side, min) => `${min}× its usual volume or more, ${UNVOL_SIDES[side].words}`

function FailedRead({ err, onRetry, code }) {
  const locked = err ? !canRetry(err) : false
  const title = !err ? `${WHAT} came back in a form this panel cannot read.`
    : err.status === 400 ? `${WHAT} cannot run on this server yet. The screener snapshot is missing a column it needs.`
      : failureText(err, WHAT)
  return (
    <PanelState kind={err ? failureKind(err) : 'error'} title={title} testId="terminal-unvol-error"
      action={locked ? null : <button type="button" className={styles.chip} onClick={onRetry}>Retry</button>}>
      {locked ? null : `That is not the same as a quiet market. Retry, or run ${code} again.`}
    </PanelState>
  )
}

function VolumeTable({ rows, label }) {
  return (
    <div className={styles.tableBox} data-fold="510">
      <table className={styles.table} data-testid="terminal-unvol-table" aria-label={label}>
        <thead>
          <tr>
            <th scope="col" title="Click a symbol to load it into the linked panels">Symbol</th>
            <th scope="col" title="Volume against the stock's usual volume. 3.0× is three times the usual.">Vol vs usual</th>
            <th scope="col" title="The change on the day and the price it is measured at">Day change</th>
            <th scope="col" className={styles.phoneHide} title="Average shares traded a day over the last 30 completed sessions">Avg volume</th>
            <th scope="col" className={`${styles.phoneHide} ${styles.wrapCell}`}>Industry</th>
            <th scope="col" title="Open the why-is-it-moving read for the stock, beside this list">Why</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.sym} data-testid={`terminal-unvol-row-${r.sym}`}>
              <td>
                <span className={styles.rowNum} aria-hidden="true">{i + 1}</span>
                <PanelSymbol sym={r.sym} className={styles.sym} />
              </td>
              <td>{multipleText(r.multiple)}</td>
              <td>
                <span className={tone(r.chgPct)}>{formatPercent(r.chgPct, { decimals: 2, signed: true, absent: NA })}</span>
                <br />
                <span className={styles.muted}>{formatCurrency(r.price, { absent: 'no price' })}</span>
              </td>
              <td className={styles.phoneHide}>{formatCompactTerminal(r.avgVol, { absent: NA })}</td>
              <td className={`${styles.phoneHide} ${styles.wrapCell}`}>{r.industry || NA}</td>
              <td>
                <PanelCommand cmd={`${r.sym} MOVE`} label={`Why is ${r.sym} moving`} className={styles.linkBtn}>Why</PanelCommand>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function UnusualVolumePanel({ side: sideProp = null, min: minProp = null }) {
  const inPanel = useInTerminalPanel()
  const writeBack = usePanelWriteBack()
  const code = inPanel?.code || UNUSUAL_VOLUME_CODE
  // A new `UNVOL UP 3X` remounts the panel (the shell keys the body on code + args), so the typed
  // words only ever seed the state.
  const [side, setSide] = useState(() => normUnvolSide(sideProp))
  const [min, setMin] = useState(() => normUnvolMin(minProp))
  // A pick writes itself into the command where the registry takes the words, so a reload keeps
  // it; otherwise it is plain component state (commandWriteBack.js).
  const pick = (next) => {
    const now = { side, min, ...next }
    setSide(now.side)
    setMin(now.min)
    writeBack(unvolCommandArgs(now))
  }
  const isBase = side === DEFAULT_UNVOL_SIDE && min === DEFAULT_UNVOL_MIN

  // 1. The by-now reading for these picks.
  const now = useScan('now', {
    side,
    min,
    refreshInterval: (latest) => {
      const v = unvolView(latest?.body, 'now')
      return v.ok && v.rows.length && unvolIsMoving(v.liveAt) ? LIVE_POLL_MS : IDLE_POLL_MS
    },
  })
  const nowView = useMemo(() => unvolView(now.data?.body, 'now'), [now.data])
  const nowEmpty = !!now.data && nowView.ok && nowView.rows.length === 0
  // 2. Empty under a filtered pick: is there a by-now reading at all? (One row, the base picks.)
  const probe = useScan(nowEmpty && !isBase ? 'now' : null, { side, min, probe: true, refreshInterval: IDLE_POLL_MS })
  const probeView = useMemo(() => unvolView(probe.data?.body, 'now'), [probe.data])
  const readingRuns = !!probe.data && probeView.ok && probeView.rows.length > 0
  const noReading = nowEmpty && (isBase || (!!probe.data && probeView.ok && probeView.rows.length === 0))
  // 3. No by-now reading: the last full session, for the same picks.
  const last = useScan(noReading ? 'last' : null, { side, min, refreshInterval: IDLE_POLL_MS })
  const lastView = useMemo(() => unvolView(last.data?.body, 'last'), [last.data])

  let stage = 'loading'
  let failed = null   // { err, retry } for a read that failed with nothing to show
  if (!now.data) {
    if (now.error) failed = { err: now.error, retry: () => now.mutate() }
  } else if (!nowView.ok) {
    failed = { err: null, retry: () => now.mutate() }
  } else if (nowView.rows.length) {
    stage = 'now'
  } else if (!isBase && !probe.data) {
    if (probe.error) failed = { err: probe.error, retry: () => probe.mutate() }
  } else if (!isBase && !probeView.ok) {
    failed = { err: null, retry: () => probe.mutate() }
  } else if (readingRuns) {
    stage = 'nowEmpty'
  } else if (!last.data) {
    if (last.error) failed = { err: last.error, retry: () => last.mutate() }
  } else if (!lastView.ok) {
    failed = { err: null, retry: () => last.mutate() }
  } else {
    stage = lastView.rows.length ? 'last' : 'lastEmpty'
  }

  const onLast = stage === 'last' || stage === 'lastEmpty'
  const view = stage === 'now' ? nowView : onLast ? lastView : null
  const read = stage === 'now' || stage === 'nowEmpty' ? now : onLast ? last : null
  const rows = view ? view.rows : []
  const moving = stage === 'now' && unvolIsMoving(nowView.liveAt)
  const stamp = stage === 'now' ? readingStamp(nowView.liveAt) : null
  usePanelFreshness(stage === 'now' ? panelAsOf(SOURCE, nowView.liveAt) : onLast ? panelAsOf(SOURCE, lastView.session) : null)
  usePanelSymbolRows(rows.map((r) => r.sym), 'Unusual volume', { total: view ? view.total : null })

  const wrap = (children, attrs = {}) => (
    <div className={`${styles.wrap} ${inPanel ? styles.inPanel : ''}`} data-testid="terminal-unvol" data-stage={failed ? 'error' : stage}
      data-side={side} data-min={min} {...attrs}>{children}</div>
  )
  const chips = (
    <div className={styles.toolbar} role="toolbar" aria-label="Unusual volume controls">
      <div className={styles.group} role="group" aria-label="Direction on the day">
        {Object.entries(UNVOL_SIDES).map(([key, s]) => (
          <button key={key} type="button" className={styles.chip} aria-pressed={key === side} onClick={() => pick({ side: key })}
            data-testid={`terminal-unvol-side-${key}`}>{s.chip}</button>
        ))}
      </div>
      <div className={styles.group} role="group" aria-label="How far above usual">
        {Object.entries(UNVOL_MINS).map(([key, m]) => (
          <button key={key} type="button" className={styles.chip} aria-pressed={Number(key) === min} onClick={() => pick({ min: Number(key) })}
            data-testid={`terminal-unvol-min-${key}`}>{m.chip}</button>
        ))}
      </div>
    </div>
  )

  if (failed) return wrap(<>{chips}<FailedRead err={failed.err} onRetry={failed.retry} code={code} /></>)
  if (stage === 'loading') {
    return wrap(
      <>
        {chips}
        <PanelSkeleton label={now.data ? 'Checking for a by-now volume reading' : 'Loading the unusual volume list'} testId="terminal-unvol-loading" />
      </>,
    )
  }

  const reset = isBase ? null : (
    <button type="button" className={styles.chip} onClick={() => pick({ side: DEFAULT_UNVOL_SIDE, min: DEFAULT_UNVOL_MIN })}
      data-testid="terminal-unvol-reset">Show {UNVOL_MINS[DEFAULT_UNVOL_MIN].chip}, {UNVOL_SIDES[DEFAULT_UNVOL_SIDE].chip.toLowerCase()}</button>
  )
  const receivedAt = read?.data?.receivedAt ? formatTimeEt(read.data.receivedAt, { zoneSuffix: 'ET', absent: '' }) : ''
  const method = (
    <p className={styles.muted} data-testid="terminal-unvol-method">
      {onLast
        ? 'Vol vs usual here is that session\'s full-day volume divided by the stock\'s average volume over the 30 sessions before it. '
        : 'Vol vs usual is today\'s volume so far divided by what the stock usually trades by this time of day: its average daily '
          + 'volume over the last 30 completed sessions, times the share of a day\'s volume usually done by this minute. That share is '
          + 'learned each night from 5-minute bars of the last 20 full sessions (the stock\'s own pattern when it has 15 of them, else '
          + 'the market\'s). It starts at 9:45 AM ET, because the first 15 minutes swing too much to mean anything. '}
      Listed: US stocks (no funds) priced {formatCurrency(UNVOL_FLOORS.price, { decimals: 0 })} or more that trade{' '}
      {formatCurrency(UNVOL_FLOORS.dollarVol30d / 1_000_000, { decimals: 0 })} million or more a day on average, at {picksWords(side, min)},
      highest first. The screener leaves out a stock with a pending buyout and one whose prices stopped updating. From the UCT
      screener, on prices from Massive. This is a list of what is active, not a forecast or a recommendation. For a burst in the
      last few minutes open <PanelCommand cmd="MOST RVOL" label="Open the movers list on unusual volume">MOST RVOL</PanelCommand>;
      for record volume against the last year open{' '}
      <PanelCommand cmd="LEAD VOL1Y" label="Open the 1-year volume highs">LEAD VOL1Y</PanelCommand>. Click a symbol to load it into
      the linked panels; type a row number to do the same.
      {receivedAt ? ` Read at ${receivedAt}; this panel reads again every ${moving ? 'minute' : '5 minutes'}.` : ''}
    </p>
  )

  if (stage === 'nowEmpty') {
    return wrap(
      <>
        {chips}
        <PanelState kind="empty" role="status" testId="terminal-unvol-empty" action={reset}
          title={`No stock is at ${picksWords(side, min)} right now.`}>
          The by-now reading is running and nothing passes these picks. That is what the market is doing, not a failed read.
        </PanelState>
        <CoverageLine coverage={nowView.coverage} density="widget" />
        {method}
      </>,
    )
  }

  const lastNote = onLast ? (
    <p className={styles.note} role="status" data-testid="terminal-unvol-last-note">
      There is no by-now volume reading at the moment. It runs in the regular session from 9:45 AM ET and holds its closing value
      until the overnight build. Showing the last full session instead{lastView.session ? `, ${lastView.session}` : ''}: that
      day&apos;s whole volume against the stock&apos;s average over the 30 sessions before it.
      {lastView.pricesLive ? ' The prices and day changes below are today\'s; the volume is that session\'s.' : ''}
    </p>
  ) : null

  if (stage === 'lastEmpty') {
    return wrap(
      <>
        {chips}
        {lastNote}
        <PanelState kind="empty" role="status" testId="terminal-unvol-empty" action={reset}
          title={`No stock traded ${picksWords(side, min)} in the last full session${lastView.session ? ` (${lastView.session})` : ''}.`}>
          That is what the screener holds for that session, not a failed read.
        </PanelState>
        <CoverageLine coverage={lastView.coverage} density="widget" />
        {method}
      </>,
    )
  }

  return wrap(
    <>
      {chips}
      {read?.error ? <p className={styles.note} role="status" data-testid="terminal-unvol-stale-read">{failureText(read.error, WHAT)} Showing the last read.</p> : null}
      {lastNote}
      <div className={styles.head}>
        <span className={`${styles.badge} ${moving ? styles.badge_up : styles.badge_flat}`} data-testid="terminal-unvol-badge">
          {moving ? 'By now' : onLast ? 'Last session' : 'Earlier reading'}
        </span>
        <span className={styles.lede} data-testid="terminal-unvol-lede">
          {stage === 'now'
            ? `${count(view.total)} ${plural(view.total, 'stock', 'stocks')} at ${picksWords(side, min)}${stamp ? `, as of ${stamp}` : ''}.`
              + (moving ? '' : ' This reading is not moving now: the session is over, or the server has stopped rewriting it. It is the volume against the usual by that time of day.')
            : `${count(view.total)} ${plural(view.total, 'stock', 'stocks')} at ${picksWords(side, min)}${lastView.session ? ` in the session of ${lastView.session}` : ''}.`}
        </span>
      </div>
      {view.total > rows.length ? (
        <p className={styles.note} role="status" data-testid="terminal-unvol-capped">
          {count(view.total)} stocks matched; the {count(rows.length)} furthest above their usual volume are shown. The chips
          above narrow the list.
        </p>
      ) : null}
      {view.unread ? (
        <p className={styles.muted} data-testid="terminal-unvol-unread">
          {count(view.unread)} {plural(view.unread, 'stock', 'stocks')} came back with no volume reading and {plural(view.unread, 'is', 'are')} not listed.
        </p>
      ) : null}
      <VolumeTable rows={rows}
        label={`Unusual volume, ${onLast ? 'the last full session' : 'by now'}, ${rows.length} ${plural(rows.length, 'stock', 'stocks')}, highest first`} />
      <CoverageLine coverage={view.coverage} density="widget" />
      {method}
    </>,
    { 'data-total': view.total, 'data-page': UNVOL_PAGE_SIZE },
  )
}
