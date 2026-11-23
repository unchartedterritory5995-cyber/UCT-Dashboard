// OSCR RICH / OSCR CHEAP: the highest and the lowest IV rank across the site's own options log (2026-11-22).
//
// `GET /api/options-screener/iv-rank` (paid; api/services/research/iv_rank_leaders.py) answers only the list the
// evening build holds: every symbol with at least 20 logged sessions, ranked by where its latest ATM IV sits
// between its own low and high, the 100 highest and the 100 lowest. Each row: the stock (PanelSymbol), its IV
// rank with the word the option chain's header uses, its ATM IV with the low and high it is ranked between, its
// IV percentile, how many sessions the rank reads and the open interest across its listed options.
//
// The option screener (bare OSCR) is a different body and is unchanged; this one is reached by `OSCR RICH` or
// `OSCR CHEAP`. Its chips write the view back into the command line.
// ⛔ A failed read is an error with Retry, never "no symbols"; a list no evening has built says when it will be;
// every symbol left out is counted in words, never ranked on fewer sessions.
import { useMemo, useState } from 'react'
import {
  PanelSkeleton, PanelState, PanelSymbol, panelAsOf, useInTerminalPanel, usePanelFreshness, usePanelSymbolRows,
} from '../../../components/terminal'
import { canRetry, failureText, useMarketRead } from './marketRead'
import { usePanelWriteBack } from './commandWriteBack'
import {
  IV_RANK_SOURCE, IV_RANK_URL, IV_RANK_WHAT, OSCR_VIEWS, builtText, countsText, cutText, ivRankPollMs, ivRankRead,
  ivText, leftOutText, logText, rankedText, notBuiltText, oiText, oscrViewCommandArgs, percentileText, rangeText, rankText, sessionsText, viewOfSide,
} from './ivRankModel'
import styles from './marketPanels.module.css'

const SIDES = ['high', 'low']

export default function IvRankPanel({ side: sideProp = 'high', onView = null }) {
  const inPanel = useInTerminalPanel()
  const writeBack = usePanelWriteBack()
  const [side, setSide] = useState(() => (sideProp === 'low' ? 'low' : 'high'))
  const read = useMarketRead(IV_RANK_URL, { refreshInterval: (latest) => ivRankPollMs(latest?.body) })
  const view = useMemo(() => ivRankRead(read.body), [read.body])
  const rows = useMemo(() => (view.state === 'ok' ? (side === 'low' ? view.low : view.high) : []), [view, side])
  usePanelFreshness(view.state === 'ok' && view.session ? panelAsOf(IV_RANK_SOURCE, view.session) : null)
  usePanelSymbolRows(rows.map((r) => r.sym), side === 'low' ? 'lowest IV rank' : 'highest IV rank')

  const pick = (next) => {
    if (next === side) return
    setSide(next)
    writeBack(oscrViewCommandArgs({ view: viewOfSide(next) }))
  }
  const toScreener = () => {
    if (!writeBack([]) && onView) onView(null)
  }
  const label = side === 'low' ? OSCR_VIEWS.cheap.label : OSCR_VIEWS.rich.label
  const chips = (
    <div className={styles.toolbar} role="toolbar" aria-label="Option screener views">
      <div className={styles.group} role="group" aria-label="Which end of the IV rank list">
        {SIDES.map((s) => {
          const v = OSCR_VIEWS[viewOfSide(s)]
          return (
            <button key={s} type="button" className={styles.chip} aria-pressed={side === s} onClick={() => pick(s)}
              data-testid={`terminal-ivrank-side-${s}`} title={`${v.label} first (OSCR ${v.token})`}>{v.label}</button>
          )
        })}
      </div>
      <button type="button" className={styles.chip} onClick={toScreener} data-testid="terminal-ivrank-screener"
        title="The option screen, unusual option volume and IV percentile (OSCR)">Option screener</button>
    </div>
  )
  const wrap = (state, body) => (
    <div className={`${styles.wrap} ${inPanel ? styles.inPanel : ''}`} data-testid="terminal-ivrank" data-state={state} data-side={side}>
      {chips}
      {body}
    </div>
  )

  if (read.loading) return <PanelSkeleton label="Loading the IV rank list" testId="terminal-ivrank-loading" />
  if (read.error && !read.body) {
    const locked = !canRetry(read.error)
    return wrap('error', (
      <PanelState kind={locked ? 'locked' : 'error'} title={failureText(read.error, IV_RANK_WHAT)} testId="terminal-ivrank-error"
        action={locked ? null : <button type="button" className={styles.chip} onClick={read.retry}>Retry</button>}>
        {locked ? null : 'That is not the same as an empty list. Retry, or run the command again.'}
      </PanelState>
    ))
  }
  if (view.state === 'failed') {
    return wrap('error', (
      <PanelState kind="error" title={`${IV_RANK_WHAT} came back in a shape this panel cannot read.`} testId="terminal-ivrank-error"
        action={<button type="button" className={styles.chip} onClick={read.retry}>Retry</button>} />
    ))
  }
  if (view.state === 'not_built') {
    return wrap('not_built', (
      <PanelState kind="empty" role="status" title="The IV rank list has not been built yet." testId="terminal-ivrank-not-built">
        {notBuiltText(view)} Nothing is built when you open the panel.
      </PanelState>
    ))
  }
  if (view.state === 'no_log') {
    return wrap('no_log', (
      <PanelState kind="empty" role="status" title="The options log held no session at the last build." testId="terminal-ivrank-no-log">
        The list ranks the site&apos;s own end-of-day options log, so there is nothing to rank until a session is logged.
      </PanelState>
    ))
  }

  const notes = (
    <>
      <p className={styles.muted} data-testid="terminal-ivrank-built">{builtText(view)}</p>
      <p className={styles.muted} data-testid="terminal-ivrank-method">
        {view.method} {side === 'low' ? view.order.low : view.order.high} {logText(view)} Source: the site&apos;s own options log, recorded once a trading day after the close (a snapshot, not a live chain).
      </p>
    </>
  )
  if (!rows.length) {
    return wrap('empty', (
      <>
        <PanelState kind="empty" title={`No symbol has an IV rank on ${view.session ? 'the latest session' : 'any session read'} yet.`} testId="terminal-ivrank-empty">
          {view.session ? countsText(view) : 'No session of the log could be read under the current ATM rule.'}
        </PanelState>
        {notes}
      </>
    ))
  }

  return wrap('ok', (
    <>
      {read.error && <p className={styles.note} role="status">{failureText(read.error, IV_RANK_WHAT)} Showing the last read.</p>}
      <p className={styles.lede} data-testid="terminal-ivrank-counts">{rankedText(view)}</p>
      {leftOutText(view) ? <p className={styles.muted} data-testid="terminal-ivrank-left-out">{leftOutText(view)}</p> : null}
      <div className={styles.tableBox}>
        <table className={styles.table} data-testid="terminal-ivrank-table" aria-label={`${label}, ${rows.length} symbols`}>
          <thead>
            <tr>
              <th scope="col">Stock</th>
              <th scope="col" title="Where the latest ATM IV sits between its own low and high, 0 to 100">IV rank</th>
              <th scope="col" className={styles.snugWrap} title="The latest ATM IV, with the low and high it is ranked between">ATM IV</th>
              <th scope="col" title="The share of its earlier sessions whose ATM IV was below the latest">Percentile</th>
              <th scope="col" className={styles.phoneHide} title="How many logged sessions the rank reads">Sessions</th>
              <th scope="col" className={styles.phoneHide} title="Open interest across the symbol's listed options">Open int.</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.key} data-testid={`terminal-ivrank-row-${r.sym}`}>
                <td className={`${styles.wrapCell} ${styles.snugTight}`}>
                  <span className={styles.rowNum} aria-hidden="true">{i + 1}</span>
                  <PanelSymbol sym={r.sym} className={styles.sym} />
                </td>
                <td>
                  <span data-testid={`terminal-ivrank-rank-${r.sym}`}>{rankText(r.ivRank)}</span>
                  {r.word ? <><br /><span className={styles.muted}>{r.word}</span></> : null}
                </td>
                <td>
                  <span>{ivText(r.atmIv)}</span>
                  {rangeText(r) ? <><br /><span className={`${styles.muted} ${styles.snugWrap} ${styles.phoneWrap}`}>{rangeText(r)}</span></> : null}
                </td>
                <td>{percentileText(r.ivPercentile)}</td>
                <td className={styles.phoneHide}>{sessionsText(r.sessions)}</td>
                <td className={styles.phoneHide}>{oiText(r.openInterest)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {cutText(view, side) ? <p className={styles.muted} data-testid="terminal-ivrank-cut">{cutText(view, side)}</p> : null}
      {notes}
    </>
  ))
}
