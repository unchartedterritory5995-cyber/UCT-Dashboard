// OIC: where open interest changed in one stock between the two newest recorded days. `NVDA OIC`.
//
//   NVDA OIC      every contract, biggest change first      NVDA OIC C | P    calls or puts only
//
// One read: GET /api/options-screener/oi-change/{sym} (paid, behind the option screener's own
// switch). It answers from UCT's own options log, never a vendor call on the request. The pure
// half is oiChangeModel.js, re-exported below.
//
// ⛔ WHAT THIS PANEL NEVER DOES
//   * It never says who opened or closed, or which way: a rise in open interest is not a bullish
//     or a bearish fact. Green and red mark the sign of a number and nothing else.
//   * It never draws a missing number as 0: a new contract is "New", a change from 0 has no percent,
//     a side with no contract in both records has no total.
//   * It never reads as live: the two recorded days are named above the table, and the one
//     sentence about the clearing house's once-a-day figure is always on screen with them.
import { useMemo, useState } from 'react'
import {
  PanelCommand, PanelSkeleton, PanelState, panelAsOf, useInTerminalPanel, usePanelFreshness,
} from '../../../components/terminal'
import { WARMING_TITLE, canRetry, failureKind, failureText, useMarketRead } from './marketRead'
import { usePanelWriteBack } from './commandWriteBack'
import {
  OI_CHANGE_CODE, OI_CHANGE_SOURCE, OI_CHANGE_WHAT, OI_ROWS_SHOWN, OI_SIDES, asOfWords, changeLines, contractText, countText,
  cutLine, dayWords, expiryText, limitNotes, normOiSide, oiChangeCommandArgs, oiChangeRead, oiChangeUrl, oiLines, sideTotalText,
  signOf, tradingDayWords,
} from './oiChangeModel'
import styles from './marketPanels.module.css'

export {
  OI_CHANGE_CODE, OI_CHANGE_SOURCE, OI_CHANGE_WHAT, OI_ROWS_SHOWN, OI_SIDES, OI_SIDE_ARG_WORDS, asOfWords, changeLines,
  contractText, countText, cutLine, dayWords, expiryText, limitNotes, normOiSide, oiChangeCommandArgs, oiChangeRead, oiChangeUrl,
  oiLines, parseOiSide, sideTotalText, signOf, signedText, tradingDayWords,
} from './oiChangeModel'

/** While the server fetches the two files the panel asks again this often; a held answer changes once a day. */
export const COMPUTING_POLL_MS = 5 * 1000
export const HELD_POLL_MS = 10 * 60 * 1000

const signClass = (n) => (signOf(n) === 'up' ? styles.up : signOf(n) === 'down' ? styles.down : undefined)

function Row({ row, session, withVolume }) {
  const [change, pct] = changeLines(row)
  const [oi, was] = oiLines(row)
  return (
    <tr data-testid="terminal-oic-row" data-contract={row.contract} data-kind={row.kind} data-type={row.type}>
      <td>
        {contractText(row)}
        <br />
        <span className={styles.muted}>{expiryText(row.expiration, session)}</span>
      </td>
      <td>
        {oi}
        <br />
        <span className={styles.muted}>{was}</span>
      </td>
      <td data-testid="terminal-oic-change">
        <span className={row.kind === 'new' ? undefined : signClass(row.change)}>{change}</span>
        <br />
        <span className={styles.muted}>{pct}</span>
      </td>
      {withVolume ? <td className={styles.phoneHide}>{row.kind === 'new' ? 'n/a' : countText(row.volume)}</td> : null}
    </tr>
  )
}

function OiChangeBody({ sym: s, code, side: sideProp }) {
  const inPanel = useInTerminalPanel()
  const writeBack = usePanelWriteBack()
  const [side, setSide] = useState(() => normOiSide(sideProp))
  const [showAll, setShowAll] = useState(false)
  const [pace, setPace] = useState(HELD_POLL_MS)
  const read = useMarketRead(oiChangeUrl(s, side), { refreshInterval: pace })
  const view = useMemo(() => oiChangeRead(read.body), [read.body])
  // The pace follows the server's own word (adjusted during render from the last answer).
  const wantPace = view.state === 'computing' ? COMPUTING_POLL_MS : HELD_POLL_MS
  if (wantPace !== pace) setPace(wantPace)

  // While another side is being read the answer in hand is the last side's: never drawn under this chip.
  const other = view.state === 'ok' && view.side !== side
  const dated = !read.loading && !!read.body && !other && (view.state === 'ok' || view.state === 'unknown')
  usePanelFreshness(dated ? panelAsOf(OI_CHANGE_SOURCE, view.session) : null)

  // A side writes itself into the command (`NVDA OIC P`) where the registry takes it; outside the
  // shell it stays in this panel's own state.
  const pick = (next) => {
    if (next === side) return
    setSide(next)
    setShowAll(false)
    writeBack(oiChangeCommandArgs({ side: next }), s)
  }

  const wrap = (state, body) => (
    <div className={`${styles.wrap} ${inPanel ? styles.inPanel : ''}`} data-testid="terminal-oic" data-state={state} data-sym={s} data-side={side}>{body}</div>
  )
  if (read.loading || (other && !read.error)) return <PanelSkeleton label={`Loading the open interest change for ${s}`} testId="terminal-oic-loading" />
  if (!read.body || view.state === 'failed' || other) {
    const err = read.body && !other ? null : read.error
    if (err?.status === 422) {
      return (
        <PanelState kind="input" role="status" testId="terminal-oic-bad-ticker" title={`${s} is not a ticker this panel can read.`}>
          Check the ticker, then run it again, e.g. <kbd>NVDA {code}</kbd>
        </PanelState>
      )
    }
    const locked = err ? !canRetry(err) : false
    return (
      <PanelState kind={err ? failureKind(err) : 'error'} testId="terminal-oic-error"
        title={err ? failureText(err, OI_CHANGE_WHAT) : `${OI_CHANGE_WHAT} for ${s} could not be read just now.`}
        action={locked ? null : <button type="button" className={styles.chip} onClick={read.retry}>Retry</button>}>
        {locked ? null : `That is not the same as no change. Retry, or run ${s} ${code} again.`}
      </PanelState>
    )
  }
  if (view.state === 'computing') {
    return wrap('computing', (
      <PanelState kind="empty" role="status" title={WARMING_TITLE} testId="terminal-oic-computing">
        The server is fetching the two newest days of the options log. The first read after a new day lands can take a
        minute or two. This panel asks again every 5 seconds and fills in on its own. That is not the same as no change.
      </PanelState>
    ))
  }
  if (view.state === 'no-sessions') {
    return wrap('no-sessions', (
      <PanelState kind="empty" role="status" testId="terminal-oic-no-sessions" title="The options log has no recorded day to read yet.">
        This panel compares the two newest days UCT has recorded. None is stored, which is not the same as no change
        in {s}.
      </PanelState>
    ))
  }
  if (view.state === 'one-session') {
    return wrap('one-session', (
      <PanelState kind="empty" role="status" testId="terminal-oic-one-session"
        title={view.session ? `Only one day is recorded so far (${dayWords(view.session)}).` : 'Only one day is recorded so far.'}>
        A change needs two recorded days. The next one is stored after the next close, about 4:30 PM ET on a weekday.
      </PanelState>
    ))
  }
  if (view.state === 'unknown') {
    return wrap('unknown', (
      <PanelState kind="empty" role="status" testId="terminal-oic-unknown"
        title={`${s} has no option contract in the ${dayWords(view.session)} or the ${dayWords(view.priorSession)} record.`}>
        The log holds every listed contract that had an ask, open interest or volume that day. Check the ticker, or
        try a stock with listed options, e.g. <kbd>NVDA {code}</kbd>
      </PanelState>
    ))
  }

  const noun = OI_SIDES[side].noun
  const shown = showAll ? view.rows : view.rows.slice(0, OI_ROWS_SHOWN)
  const cut = cutLine(view, shown.length)
  const notes = limitNotes(view, s)
  const withVolume = view.volumePresent
  const prior = dayWords(view.priorSession)
  const tradingDay = tradingDayWords(view)
  return wrap('ok', (
    <>
      {read.error ? <p className={styles.note} role="status" data-testid="terminal-oic-stale-read">{failureText(read.error, OI_CHANGE_WHAT)} Showing the last read.</p> : null}
      <p className={styles.lede} data-testid="terminal-oic-asof">
        {asOfWords(view)}{tradingDay ? ` ${tradingDay}` : ''} Open interest is published once a day by the clearing
        house, for the previous session, so it is never live.
      </p>
      <div className={styles.toolbar} role="toolbar" aria-label="Open interest change controls">
        <div className={styles.group} role="group" aria-label="Which contracts">
          {Object.entries(OI_SIDES).map(([key, spec]) => (
            <button key={key} type="button" className={styles.chip} aria-pressed={key === side} onClick={() => pick(key)}
              data-testid={`terminal-oic-side-${key}`}>{spec.label}</button>
          ))}
        </div>
      </div>
      <dl className={styles.fields} data-testid="terminal-oic-summary">
        <div style={{ display: 'contents' }}>
          <dt>Call open interest</dt>
          <dd data-testid="terminal-oic-total-call"><span className={signClass(view.call.change)}>{sideTotalText(view.call, 'call')}</span></dd>
        </div>
        <div style={{ display: 'contents' }}>
          <dt>Put open interest</dt>
          <dd data-testid="terminal-oic-total-put"><span className={signClass(view.put.change)}>{sideTotalText(view.put, 'put')}</span></dd>
        </div>
        <div style={{ display: 'contents' }}>
          <dt>Contracts compared</dt>
          <dd data-testid="terminal-oic-compared">
            {view.compared ? `${countText(view.compared)} in both records, ${countText(view.unchanged)} of them unchanged` : 'None is in both records'}
          </dd>
        </div>
      </dl>
      {notes.map((n) => (
        <p key={n.key} className={n.key === 'skipped' ? styles.note : styles.muted} role={n.key === 'skipped' ? 'status' : undefined}
          data-testid={`terminal-oic-note-${n.key}`}>{n.text}</p>
      ))}
      {shown.length ? (
        <div className={styles.tableBox}>
          <table className={styles.table} data-testid="terminal-oic-table"
            aria-label={`Open interest change for ${s}, ${side === 'any' ? 'calls and puts' : `${noun}s only`}, biggest change in contracts first`}>
            <thead>
              <tr>
                <th scope="col">Contract</th>
                <th scope="col" title={`Open interest in the ${dayWords(view.session)} record, and in the ${prior} record`}>Open interest</th>
                <th scope="col" title="The change in contracts, and as a percent of the earlier figure">Change</th>
                {withVolume ? <th scope="col" className={styles.phoneHide} title={`Contracts traded on ${dayWords(view.volumeSession)}`}>Volume</th> : null}
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => <Row key={r.contract} row={r} session={view.session} withVolume={withVolume} />)}
            </tbody>
          </table>
        </div>
      ) : (
        <PanelState kind="empty" compact role="status" testId="terminal-oic-none"
          title={side === 'any' ? `No contract of ${s} changed between the two records.` : `No ${noun} of ${s} changed between the two records.`}
          action={side === 'any' ? null : <button type="button" className={styles.chip} onClick={() => pick('any')}>Show calls and puts</button>}>
          {view.compared ? 'Every contract in both records holds the same open interest in each.' : null}
        </PanelState>
      )}
      {cut ? (
        <p className={styles.muted} role="status" data-testid="terminal-oic-cut">
          {cut}{' '}
          {!showAll && view.rows.length > OI_ROWS_SHOWN ? (
            <button type="button" className={styles.linkBtn} onClick={() => setShowAll(true)} data-testid="terminal-oic-more">
              Show {countText(view.rows.length - OI_ROWS_SHOWN)} more
            </button>
          ) : null}
        </p>
      ) : null}
      <p className={styles.muted} data-testid="terminal-oic-method">
        Covered: every listed {s} contract that had an ask, open interest or volume in the day&apos;s record, not only
        contracts with recent flow. Each record is taken once after the close, about 4:30 PM ET, and holds the clearing
        house&apos;s figure published that morning, so it counts positions as they stood before that day&apos;s
        trading. A change in open interest does not say who opened or closed, or in which direction; green and red
        mark a rise or a fall in the number only.
        {withVolume ? ` Volume is the contracts traded on ${dayWords(view.volumeSession)}.` : ' The log carried no traded volume for these days, so there is no volume column.'}
        {' '}Source: UCT&apos;s options log, recorded from the options data vendor&apos;s end-of-day snapshot.
      </p>
      <p className={styles.muted} data-testid="terminal-oic-links">
        Also for {s}:{' '}
        <PanelCommand cmd={`${s} LVL`} label={`Key levels (LVL) for ${s}`}>Key levels (LVL)</PanelCommand>,{' '}
        <PanelCommand cmd={`${s} OMON`} label={`Options monitor (OMON) for ${s}`}>Options monitor (OMON)</PanelCommand>
      </p>
    </>
  ))
}

export default function OiChangePanel({ sym, side }) {
  const s = String(sym || '').trim().toUpperCase()
  const code = useInTerminalPanel()?.code || OI_CHANGE_CODE
  if (!s) {
    return (
      <PanelState kind="input" title={`${code} needs a ticker.`}>
        Type one first, e.g. <kbd>NVDA {code}</kbd>
      </PanelState>
    )
  }
  // Keyed by ticker: a new ticker is a new read, so one stock's contracts are never drawn under another's name.
  return <OiChangeBody key={s} sym={s} code={code} side={side} />
}
