// CACT: one stock's splits, cash dividends and name or ticker changes. `NVDA CACT`.
//
// Two reads, each its own block with its own source and freshness:
//   GET /api/research/corporate-actions/{ticker}  (paid; api/routers/corporate_actions.py) answers
//       ONLY from what the server already holds beside the stock's chart. It never asks the data
//       vendor, so a stock whose chart nobody has opened answers `not_held`, in words.
//   GET /api/research/rename-notice/{sym}         (paid; api/routers/research_notices.py) is the
//       name and ticker record. A server that has not switched it on answers 404, and the block
//       says that.
// The pure half is corporateActionsModel.js, re-exported below.
//
// WHAT IS HELD IS THIN, AND THE PANEL SAYS SO: splits up to 45 years back, cash dividends up to 5
// years back by ex-date, amounts split-adjusted (what the chart draws), no pay date, no declared
// date, no special-dividend label. A held record with neither in it does not say whether there were
// none or a read failed when it was built, and the panel says that too.
//
// A FAILED READ IS NEVER "NO CORPORATE ACTIONS", and `not_held` is not "none".
// The two blocks fail apart: one is drawn while the other says why it is missing.
//
// WIDTH. Two two-column tables, which fit a 340px panel with nothing folded.
import { useMemo, useState } from 'react'
import {
  PanelCommand, PanelSkeleton, PanelState, PanelSymbol, panelAsOf, useInTerminalPanel, usePanelFreshness,
} from '../../../components/terminal'
import { canRetry, failureKind, failureText, useMarketRead } from './marketRead'
import {
  CACT_CODE, CACT_NAMES_WHAT, CACT_ROWS_SHOWN, CACT_SOURCE, CACT_WHAT, amountWords, cactNamesUrl, cactRead, cactUrl, cutLine,
  NO_TICKER_NOW, dateWords, formerlyLine, heldLine, namesRead, previousLead, splitWords,
} from './corporateActionsModel'
import styles from './marketPanels.module.css'

export {
  CACT_CODE, CACT_NAMES_WHAT, CACT_ROWS_SHOWN, CACT_SOURCE, CACT_WHAT, amountWords, cactNamesUrl, cactRead, cactUrl, cutLine,
  NO_TICKER_NOW, dateWords, formerlyLine, heldLine, namesRead, previousLead, previousLine, splitWords,
} from './corporateActionsModel'

/** `2026-11-18T14:02:11+00:00` -> "Nov 18, 2026, 9:02 AM ET"; '' when there is no instant. */
export function heldAtWords(iso) {
  const d = iso ? new Date(iso) : null
  if (!d || Number.isNaN(d.getTime())) return ''
  return `${d.toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })} ET`
}

function ActionTable({ sym, kind, rows, shown, total }) {
  const splits = kind === 'splits'
  return (
    <div className={styles.tableBox}>
      <table className={styles.table} data-testid={`terminal-cact-${kind}`}
        aria-label={splits ? `${sym} splits, newest first, ${shown} of ${total} held` : `${sym} cash dividends by ex-date, newest first, ${shown} of ${total} held`}>
        <caption className={styles.caption}>{splits ? 'Splits' : 'Cash dividends'}</caption>
        <thead>
          <tr>
            <th scope="col" title={splits ? 'The day the split took effect' : 'The first day the stock traded without the dividend'}>{splits ? 'Date' : 'Ex-date'}</th>
            <th scope="col" className={styles.phoneWrap}
              title={splits ? 'Shares after the split for shares before it' : 'Cash per share, adjusted for every later split, as the chart draws it'}>
              {splits ? 'Split' : 'Per share, split-adjusted'}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, shown).map((r) => (
            <tr key={r.date} data-testid={`terminal-cact-${splits ? 'split' : 'dividend'}-${r.date}`}>
              <td>{dateWords(r.date)}</td>
              <td className={styles.phoneWrap}>{splits ? splitWords(r.ratio) : amountWords(r.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ActionBlock({ sym, kind, view }) {
  const [all, setAll] = useState(false)
  const noun = kind === 'splits' ? 'splits' : 'dividends'
  if (!view.rows.length) {
    return <p className={styles.muted} data-testid={`terminal-cact-${kind}-none`}>No {kind === 'splits' ? 'split' : 'cash dividend'} is in the held record for {sym}.</p>
  }
  const shown = all ? view.rows.length : Math.min(CACT_ROWS_SHOWN, view.rows.length)
  const cut = cutLine(view, shown, noun)
  return (
    <>
      <ActionTable sym={sym} kind={kind} rows={view.rows} shown={shown} total={view.total} />
      {view.rows.length > CACT_ROWS_SHOWN || cut ? (
        <div className={styles.toolbar}>
          {view.rows.length > CACT_ROWS_SHOWN ? (
            <button type="button" className={styles.chip} aria-pressed={all} onClick={() => setAll((v) => !v)} data-testid={`terminal-cact-${kind}-more`}>
              {all ? `Show ${CACT_ROWS_SHOWN}` : `Show all ${view.rows.length}`}
            </button>
          ) : null}
          {cut ? <span className={styles.muted} data-testid={`terminal-cact-${kind}-cut`}>{cut}</span> : null}
        </div>
      ) : null}
    </>
  )
}

function NamesBlock({ sym }) {
  const read = useMarketRead(cactNamesUrl(sym))
  const view = useMemo(() => namesRead(read.body), [read.body])
  let body
  if (read.loading) {
    body = <p className={styles.muted} role="status">Reading the name and ticker record for {sym}.</p>
  } else if (!read.body || view.state === 'failed') {
    const err = read.body ? null : read.error
    body = (
      <p className={styles.note} role="status" data-testid="terminal-cact-names-error">
        {err ? failureText(err, CACT_NAMES_WHAT) : `${CACT_NAMES_WHAT} could not be read just now.`} That is not the same as no name or ticker change.
        {!err || canRetry(err) ? <>{' '}<button type="button" className={styles.linkBtn} onClick={read.retry}>Read it again</button></> : null}
      </p>
    )
  } else if (view.state === 'unavailable') {
    body = (
      <p className={styles.note} role="status" data-testid="terminal-cact-names-unavailable">
        {CACT_NAMES_WHAT} could not be opened on the server just now. That is not the same as no name or ticker change.{' '}
        <button type="button" className={styles.linkBtn} onClick={read.retry}>Read it again</button>
      </p>
    )
  } else if (view.state === 'none') {
    body = <p className={styles.muted} data-testid="terminal-cact-names-none">The record has no entry for {sym}, so it cannot say whether its name or ticker changed.</p>
  } else {
    body = (
      <>
        {view.state === 'ambiguous' ? (
          <p className={styles.note} role="status" data-testid="terminal-cact-names-ambiguous">
            More than one company is on record under {sym} today, so no earlier ticker is listed for it.
          </p>
        ) : null}
        {view.formerly.length || view.previous.length ? (
          <ul className={styles.reasons} data-testid="terminal-cact-names-list">
            {view.formerly.map((f) => (
              <li key={`f-${f.alias}-${f.to}`} data-testid="terminal-cact-formerly">{formerlyLine(sym, f)}</li>
            ))}
            {view.previous.map((p, i) => (
              <li key={`p-${p.from}-${p.to}-${i}`} data-testid="terminal-cact-previous">
                {previousLead(sym, p)}{' '}
                {p.nowAs.length ? (
                  <>It now trades as{p.nowAs.map((a, j) => <span key={a}>{j ? ', ' : ' '}<PanelSymbol sym={a} /></span>)}.</>
                ) : NO_TICKER_NOW}
              </li>
            ))}
          </ul>
        ) : view.state === 'ok' ? (
          <p className={styles.muted} data-testid="terminal-cact-names-clear">
            No earlier ticker is on record for {sym}, and no other company is on record as having used {sym}.
          </p>
        ) : null}
      </>
    )
  }
  return (
    <section aria-label={`Name and ticker changes for ${sym}`} data-testid="terminal-cact-names">
      <p className={styles.head}>Name and ticker changes</p>
      {body}
      <p className={styles.muted} data-testid="terminal-cact-names-source">
        Source: UCT&apos;s dated ticker history. A change is recorded only from the data vendor&apos;s own ticker-change events,
        never inferred, so a rename the vendor has not reported is not here. The record carries no as-of time of its own.
      </p>
    </section>
  )
}

function CorporateActionsBody({ sym: s, code }) {
  const inPanel = useInTerminalPanel()
  const read = useMarketRead(cactUrl(s))
  const view = useMemo(() => cactRead(read.body), [read.body])
  const ok = !read.loading && !!read.body && view.state === 'ok'
  usePanelFreshness(ok ? panelAsOf(CACT_SOURCE, view.heldAt) : null)

  const wrap = (state, body) => (
    <div className={`${styles.wrap} ${inPanel ? styles.inPanel : ''}`} data-testid="terminal-cact" data-state={state} data-sym={s}>{body}</div>
  )
  if (read.loading) return <PanelSkeleton label={`Loading corporate actions for ${s}`} testId="terminal-cact-loading" />
  if (!read.body || view.state === 'failed') {
    const err = read.body ? null : read.error
    if (err?.status === 400) {
      return wrap('bad-symbol', (
        <PanelState kind="input" testId="terminal-cact-bad-symbol" title={`${s} is not a stock or fund symbol this screen can read.`}>
          Type one first, e.g. <kbd>NVDA {code}</kbd>
        </PanelState>
      ))
    }
    const locked = err ? !canRetry(err) : false
    return (
      <PanelState kind={err ? failureKind(err) : 'error'} testId="terminal-cact-error"
        title={err ? failureText(err, CACT_WHAT) : `${CACT_WHAT} for ${s} could not be read just now.`}
        action={locked ? null : <button type="button" className={styles.chip} onClick={read.retry}>Retry</button>}>
        {locked ? null : `That is not the same as no corporate actions. Retry, or run ${s} ${code} again.`}
      </PanelState>
    )
  }
  const stale = read.error ? (
    <p className={styles.note} role="status" data-testid="terminal-cact-stale-read">{failureText(read.error, CACT_WHAT)} Showing the last read.</p>
  ) : null
  if (view.state === 'not_held') {
    return wrap('not_held', (
      <>
        {stale}
        <PanelState kind="empty" role="status" testId="terminal-cact-not-held" title={`No splits or dividends are held on the server for ${s}.`}>
          This panel reads only what the server already holds and never asks the data vendor. A stock&apos;s splits and
          dividends are held once its chart has been opened: open{' '}
          <PanelCommand cmd={`${s} GP`} label={`Chart (GP) for ${s}`}>Chart (GP)</PanelCommand>, then run {s} {code} again.
          That is not the same as {s} having had no split or dividend.
        </PanelState>
        <NamesBlock sym={s} />
      </>
    ))
  }
  const held = heldAtWords(view.heldAt)
  return wrap('ok', (
    <>
      {stale}
      <section aria-label={`Splits and dividends for ${s}`} data-testid="terminal-cact-actions">
        <p className={styles.lede} data-testid="terminal-cact-headline">{heldLine(s, view)}</p>
        {view.empty ? (
          <p className={styles.note} role="status" data-testid="terminal-cact-empty">
            The held record does not say whether that is because there were none or because a read failed when it was
            built. That is not the same as none.
          </p>
        ) : (
          <>
            <ActionBlock sym={s} kind="splits" view={view.splits} />
            <ActionBlock sym={s} kind="dividends" view={view.dividends} />
          </>
        )}
        <p className={styles.muted} data-testid="terminal-cact-source">
          Source: Massive reference data, as the server holds it beside the chart.
          {held ? ` Held since ${held}.` : ' The held record carries no time.'} This panel never asks the data vendor; the
          record is built and refreshed when the stock&apos;s chart is opened. Splits reach back up to {view.splits.years ?? 45} years
          and dividends up to {view.dividends.years ?? 5} years, by ex-date. Dividend amounts are split-adjusted, as the chart
          draws them, so an amount from before a split is smaller than the amount declared at the time. No pay date is held.
        </p>
      </section>
      <NamesBlock sym={s} />
      <p className={styles.muted} data-testid="terminal-cact-links">
        Declared dividends and splits ahead for {s}:{' '}
        <PanelCommand cmd={`${s} DVD`} label={`Dividend calendar (DVD) for ${s}`}>Dividend calendar (DVD)</PanelCommand>
      </p>
    </>
  ))
}

export default function CorporateActionsPanel({ sym }) {
  const s = String(sym || '').trim().toUpperCase()
  const code = useInTerminalPanel()?.code || CACT_CODE
  if (!s) {
    return (
      <PanelState kind="input" title={`${code} needs a ticker.`}>
        Type one first, e.g. <kbd>NVDA {code}</kbd>
      </PanelState>
    )
  }
  // Keyed by ticker: a new ticker is a new read, so one stock's record is never drawn under another's name.
  return <CorporateActionsBody key={s} sym={s} code={code} />
}
