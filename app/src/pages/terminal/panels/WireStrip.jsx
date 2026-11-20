// NEWS: "Latest on the news wire", a short strip of the newest UCT News headlines above the
// market tape, with one numbered row that opens the whole wire (`UNEWS`).
//
// ⭐ IT SHARES THE TAB'S ONE STREAM. The strip declares a need (lib/panelContract.js) and reads
// the pool lib/tradeExchangeNewsStreamManager.js already holds: one history load and one stream
// for every UCT News panel, /charts widget and strip in the browser tab, released when the last
// of them closes. It opens no transport and runs no polling loop of its own.
//
// ⛔ THE STRIP AND THE TAPE ARE TWO SOURCES AND FAIL APART. The tape below is the UCT news feed
// (FMP and RSS) and keeps its own states; a wire that is off, loading or unreadable is a state
// of this strip alone, and a wire that could not be read never reads as a quiet wire.
//
// The headlines are drawn as the provider's own text. A ticker in one is not a button here, so
// the strip makes no claim about which stock a headline is about; `UNEWS` is where they load.
import { useMemo, useSyncExternalStore } from 'react'
import PanelCommand from '../../../components/terminal/PanelCommand'
import PanelState from '../../../components/terminal/PanelState'
import { usePanelRows } from '../../../components/terminal/terminalPanel'
import { declareNeed, DELIVERY } from '../../../lib/panelContract'
import {
  WIRE_CREDIT, WIRE_MARKET_COMMAND, WIRE_ROWS, WIRE_ROW_SOURCE, WIRE_TIME_NOTE, wireStripView,
} from './wireInPanelsModel'
import css from './wireInPanels.module.css'

const NEWS_WIRE = declareNeed({ kind: 'trade-exchange-news', delivery: DELIVERY.EVERY_MESSAGE_MATTERS })

export default function WireStrip() {
  const feed = useSyncExternalStore(NEWS_WIRE.subscribe, NEWS_WIRE.read)
  const view = useMemo(() => wireStripView(feed, WIRE_ROWS.NEWS), [feed])
  usePanelRows(view.command ? [WIRE_MARKET_COMMAND] : [])
  const more = view.command ? (
    <p className={css.more} data-testid="terminal-news-wire-more">
      <span className={css.num} aria-hidden="true">1</span>
      <PanelCommand cmd={WIRE_MARKET_COMMAND} label="Open the whole news wire">{WIRE_MARKET_COMMAND}</PanelCommand>
      <span className={css.moreWords}>the whole news wire, live</span>
    </p>
  ) : null
  return (
    <section className={css.strip} data-testid="terminal-news-wire" data-phase={view.phase}>
      <h3 className={css.heading}>Latest on the news wire</h3>
      {view.phase === 'loading' ? (
        <p className={css.note} role="status" data-testid="terminal-news-wire-loading">Reading {WIRE_ROW_SOURCE}.</p>
      ) : null}
      {view.phase === 'off' ? (
        <PanelState compact kind="locked" role="status" title={view.title} testId="terminal-news-wire-off" />
      ) : null}
      {view.phase === 'failed' ? (
        <PanelState compact kind="error" role="status" title={view.title} testId="terminal-news-wire-failed"
          action={view.retry
            ? <button type="button" className={css.retry} onClick={() => NEWS_WIRE.retry()} aria-label={`Retry ${WIRE_ROW_SOURCE}`}>Retry</button>
            : null}>
          {view.hint}
        </PanelState>
      ) : null}
      {view.phase === 'none' ? (
        <PanelState compact kind="empty" role="status" title={view.title} testId="terminal-news-wire-none">
          A new one shows here the moment it arrives.
        </PanelState>
      ) : null}
      {view.phase === 'rows' ? (
        <ol className={css.list} aria-label="Latest news wire headlines, newest first" data-testid="terminal-news-wire-list">
          {view.rows.map((r) => (
            <li key={r.seq} className={css.row} data-testid="terminal-news-wire-row" data-seq={r.seq}>
              <span className={css.text}>{r.item.content}</span>
              <span className={css.meta}>
                <span className={css.time} title="When UCT received it. The provider sends no publication time.">{r.stamp}</span>
                <span>{r.type}</span>
                <span>{WIRE_ROW_SOURCE}</span>
              </span>
            </li>
          ))}
        </ol>
      ) : null}
      {view.note && (view.phase === 'rows' || view.phase === 'none') ? (
        <p className={css.note} role="status" data-testid="terminal-news-wire-status">{view.note}</p>
      ) : null}
      {more}
      {view.phase === 'rows' ? <p className={css.note} data-testid="terminal-news-wire-method">{WIRE_CREDIT}. {WIRE_TIME_NOTE}</p> : null}
    </section>
  )
}
