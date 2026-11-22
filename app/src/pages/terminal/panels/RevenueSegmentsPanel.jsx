// SEG: one stock's revenue by segment, by product (or business line) and by region (2026-11-21).
//
//   NVDA SEG                    by product, annual periods
//   NVDA SEG REGION QUARTERLY   by region, quarter by quarter
//
// `GET /api/research/revenue-segments/{ticker}?period=` (paid; api/services/revenue_segments.py), read from
// Financial Modeling Prep through the site's one adapter. The server holds one answer per stock and period
// and never builds it on the request: with nothing held it says "computing" and this panel asks again. The
// pure half is revenueSegmentsModel.js.
//
// The newest period as a ranked list with each segment's share of the listed segments, then the last four
// periods side by side. A plan that does not include the report says so in words (no Retry, no table).
// A MISSING FIGURE IS NEVER 0: it reads "Not reported". A FAILED READ IS NEVER "NO SEGMENTS".
//
// WIDTH. The ranked list: three short columns. The periods: the segment and four periods, the two oldest
// folding away on a phone. Segment names wrap between words.
import { useMemo, useState } from 'react'
import { PanelSkeleton, PanelState, panelAsOf, useInTerminalPanel, usePanelFreshness } from '../../../components/terminal'
import { formatTimeEt } from '../../../lib/presentation/presentationPrimitives'
import { usePanelWriteBack } from './commandWriteBack'
import { WARMING_TITLE, canRetry, failureKind, failureText, useMarketRead } from './marketRead'
import {
  SEG_CODE, SEG_PERIODS, SEG_SOURCE, SEG_VIEWS, currencyNote, legNoteWords, legStateWords, legTables, moneyWords, normSegPeriod,
  normSegView, periodEndWords, segCommandArgs, segLede, segPollMs, segRead, segUrl, shareWords,
} from './revenueSegmentsModel'
import styles from './marketPanels.module.css'

const clock = (iso) => (iso ? formatTimeEt(iso, { zoneSuffix: 'ET', absent: '' }) : '')

function Ranked({ tables, sym, what }) {
  const { newest, ranked } = tables
  return (
    <div className={styles.tableBox}>
      <table className={styles.table} data-testid="terminal-seg-ranked"
        aria-label={`${what} for ${sym}, ${newest.label}, largest first, ${ranked.length} ${ranked.length === 1 ? 'segment' : 'segments'}`}>
        <caption className={styles.caption}>{newest.label}, largest first</caption>
        <thead>
          <tr>
            <th scope="col">Segment</th>
            <th scope="col" title="The segment's revenue for the period, as reported">Revenue</th>
            <th scope="col" title="The segment's share of the segments listed for the period (they may not add up to total revenue)">Share</th>
          </tr>
        </thead>
        <tbody>
          {ranked.map((s) => (
            <tr key={s.name} data-testid="terminal-seg-ranked-row">
              <td className={styles.wrapCell}>{s.name}</td>
              <td>{moneyWords(s.revenue, newest.currency)}</td>
              <td className={s.share == null ? styles.muted : undefined}>{shareWords(s.share)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Periods({ tables, sym, what }) {
  const { columns, grid } = tables
  // the two oldest periods fold away on a phone; the newest two always show
  const fold = (i) => (i >= 2 ? styles.phoneHide : undefined)
  return (
    <div className={styles.tableBox}>
      <table className={styles.table} data-testid="terminal-seg-periods"
        aria-label={`${what} for ${sym}, the last ${columns.length} ${columns.length === 1 ? 'period' : 'periods'}, newest first`}>
        <caption className={styles.caption}>Period by period</caption>
        <thead>
          <tr>
            <th scope="col">Segment</th>
            {columns.map((p, i) => <th key={p.date} scope="col" className={fold(i)} title={`Period ended ${periodEndWords(p)}`}>{p.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {grid.map((row) => (
            <tr key={row.name} data-testid="terminal-seg-periods-row">
              <td className={styles.wrapCell}>{row.name}</td>
              {row.cells.map((c, i) => (
                <td key={columns[i].date} className={`${fold(i) || ''} ${c ? '' : styles.muted}`.trim() || undefined}>
                  {c ? moneyWords(c.revenue, columns[i].currency) : 'Not reported'}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Segments({ sym, view, period, code, inPanel, onPick }) {
  const read = useMarketRead(segUrl(sym, period), { refreshInterval: (latest) => segPollMs(latest?.body) })
  const answer = useMemo(() => segRead(read.body), [read.body])
  const leg = answer.state === 'ok' ? answer.legs[view] : null
  const tables = useMemo(() => legTables(leg), [leg])
  usePanelFreshness(tables ? panelAsOf(SEG_SOURCE, tables.newest.date) : null)
  const what = SEG_VIEWS[view].what

  const chips = (
    <div className={styles.toolbar} role="toolbar" aria-label="Revenue by segment choices">
      <div className={styles.group} role="group" aria-label="Split by">
        {Object.entries(SEG_VIEWS).map(([key, v]) => (
          <button key={key} type="button" className={styles.chip} aria-pressed={view === key} data-testid={`terminal-seg-view-${key}`}
            onClick={() => (view === key ? null : onPick({ view: key, period }))}>{v.label}</button>
        ))}
      </div>
      <div className={styles.group} role="group" aria-label="Periods">
        {Object.entries(SEG_PERIODS).map(([key, v]) => (
          <button key={key} type="button" className={styles.chip} aria-pressed={period === key} data-testid={`terminal-seg-period-${key}`}
            onClick={() => (period === key ? null : onPick({ view, period: key }))}>{v.label}</button>
        ))}
      </div>
    </div>
  )
  const wrap = (state, body) => (
    <div className={`${styles.wrap} ${inPanel ? styles.inPanel : ''}`} data-testid="terminal-seg" data-state={state} data-sym={sym}
      data-view={view} data-period={period}>
      {chips}
      {body}
    </div>
  )

  if (read.loading) return <PanelSkeleton label={`Loading revenue by segment for ${sym}`} testId="terminal-seg-loading" />
  if (!read.body || answer.state === 'failed') {
    const err = read.body ? null : read.error
    const locked = err ? !canRetry(err) : false
    return wrap('error', (
      <PanelState kind={err ? failureKind(err) : 'error'} testId="terminal-seg-error"
        title={err ? failureText(err, 'Revenue by segment') : 'Revenue by segment came back in a shape this panel cannot read.'}
        action={locked ? null : <button type="button" className={styles.chip} onClick={read.retry}>Retry</button>}>
        {locked ? null : `That is not the same as no segments. Retry, or run ${sym} ${code} again.`}
      </PanelState>
    ))
  }
  if (answer.state === 'computing') {
    return wrap('computing', (
      <PanelState kind="empty" role="status" title={WARMING_TITLE} testId="terminal-seg-computing">
        The server is reading {sym}&apos;s segment figures from {SEG_SOURCE}. That takes a few seconds the first time. This panel
        asks again every 3 seconds and fills in on its own.
      </PanelState>
    ))
  }
  if (answer.state === 'unavailable') {
    return wrap('unavailable', (
      <PanelState kind="error" testId="terminal-seg-unavailable" title={`Revenue by segment could not be read from ${SEG_SOURCE} just now.`}
        action={<button type="button" className={styles.chip} onClick={read.retry}>Retry</button>}>
        That is not the same as no segments. The server asks again within a few minutes.
      </PanelState>
    ))
  }

  const stale = read.error
    ? <p className={styles.note} role="status" data-testid="terminal-seg-stale-read">{failureText(read.error, 'Revenue by segment')} Showing the last read.</p>
    : null
  const method = (
    <p className={styles.muted} data-testid="terminal-seg-method">
      Source: {SEG_SOURCE}, read by the server{clock(answer.readAt) ? ` at ${clock(answer.readAt)}` : ''}. Figures are as the company
      reports them, period by period. A share is the segment&apos;s part of the segments listed for the period, worked out by the
      server; a company&apos;s segments may not add up to its total revenue. A figure not reported reads &quot;Not reported&quot;,
      never 0. The server keeps the figures for up to a day.
    </p>
  )
  if (!tables) {
    const words = legStateWords(leg, view, sym)
    return wrap(leg?.state || 'none', (
      <>
        {stale}
        <PanelState kind={words.kind} role={words.kind === 'error' ? undefined : 'status'} testId={`terminal-seg-${(leg?.state || 'none').replace(/_/g, '-')}`}
          title={words.title}
          action={words.retry ? <button type="button" className={styles.chip} onClick={read.retry}>Retry</button> : null}>
          {words.body}
        </PanelState>
        {method}
      </>
    ))
  }
  const note = legNoteWords(leg)
  const cur = currencyNote(tables.newest)
  return wrap('ok', (
    <>
      {stale}
      <p className={styles.lede} data-testid="terminal-seg-lede">{segLede(sym, view, leg)}</p>
      <Ranked tables={tables} sym={sym} what={what} />
      {tables.columns.length > 1 ? <Periods tables={tables} sym={sym} what={what} /> : null}
      {cur ? <p className={styles.muted} data-testid="terminal-seg-currency">{cur} Figures are as reported.</p> : null}
      {note ? <p className={styles.note} role="status" data-testid="terminal-seg-note">{note}</p> : null}
      {method}
    </>
  ))
}

export default function RevenueSegmentsPanel({ sym, view: viewProp, period: periodProp }) {
  const inPanel = useInTerminalPanel()
  const code = inPanel?.code || SEG_CODE
  const writeBack = usePanelWriteBack()
  const s = String(sym || '').trim().toUpperCase()
  // Outside the shell (or if the registry cannot take a word) a chip switches here, in state.
  const [pick, setPick] = useState(() => ({ view: normSegView(viewProp), period: normSegPeriod(periodProp) }))
  if (!s) {
    return (
      <PanelState kind="empty" role="status" testId="terminal-seg-no-sym" title="Revenue by segment is for one stock.">
        Type a symbol first, e.g. <kbd>NVDA {SEG_CODE}</kbd>.
      </PanelState>
    )
  }
  const onPick = (next) => {
    if (!writeBack(segCommandArgs(next), s)) setPick({ view: normSegView(next.view), period: normSegPeriod(next.period) })
  }
  // Keyed by what is asked: a new stock or period is a new read, never drawn under another's name.
  return <Segments key={`${s} ${pick.period}`} sym={s} view={pick.view} period={pick.period} code={code} inPanel={inPanel} onPick={onPick} />
}
