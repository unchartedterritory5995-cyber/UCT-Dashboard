// The news wire for one stock, as a SECTION of another panel: MOVE's "On the news wire" and
// CN's "News wire" block draw this one body, so a state reads the same in both.
//
// The host owns the heading and the frame; this draws the section's own states from the hook's
// answer (useStockWire.js): checking, rows, none found (with how far back the search reached),
// could not check (with Retry; never the same as none), and the wire being off on this server
// (the UCT News panel's one sentence, no Retry). `children` is the host's way to the full
// history (`NVDA UCN`): it is left out when the wire is off, where that panel has nothing to show.
//
// Each row keeps its source label, its type and UCT's receipt time; a ticker in a headline is a
// `PanelSymbol` (the headline's own words, never rewritten). The sentence that says headlines
// are matched to the stock automatically is the UCT News panel's own, shown once per section.
import PanelState from '../../../components/terminal/PanelState'
import PanelSymbol from '../../../components/terminal/PanelSymbol'
import { matchingSentence, rowPieces } from './uctNewsModel'
import { WIRE_CREDIT, WIRE_ROW_SOURCE, WIRE_TIME_NOTE, stockWireLede, stockWireNone, stockWireReadNote } from './wireInPanelsModel'
import css from './wireInPanels.module.css'

/** One wire headline: its words, then when UCT received it, its type and its source. */
export function WireRow({ row, testId }) {
  const pieces = rowPieces(row.item)
  return (
    <li className={css.row} data-testid={`${testId}-row`} data-seq={row.seq} data-today={row.today ? 'true' : 'false'}>
      <span className={css.text}>
        {pieces.map((p) => (p.sym
          ? <PanelSymbol key={p.key} sym={p.sym} className={css.sym}>{p.text}</PanelSymbol>
          : <span key={p.key}>{p.text}</span>))}
      </span>
      <span className={css.meta}>
        <span className={css.time} data-testid={`${testId}-time`} title="When UCT received it. The provider sends no publication time.">{row.stamp}</span>
        <span data-testid={`${testId}-type`}>{row.type}</span>
        <span data-testid={`${testId}-source`}>{WIRE_ROW_SOURCE}</span>
      </span>
    </li>
  )
}

export default function StockWire({ sym, wire, testId = 'stock-wire', children = null }) {
  const phase = wire?.phase || 'idle'
  if (phase === 'idle') return null
  if (phase === 'loading') {
    return (
      <div className={css.body} data-testid={testId} data-phase="loading">
        <p className={css.note} role="status" data-testid={`${testId}-loading`}>Checking {WIRE_ROW_SOURCE} for {sym}.</p>
        {children}
      </div>
    )
  }
  if (phase === 'off') {
    return (
      <div className={css.body} data-testid={testId} data-phase="off">
        <PanelState compact kind="locked" role="status" title={wire.title} testId={`${testId}-off`} />
      </div>
    )
  }
  if (phase === 'failed') {
    return (
      <div className={css.body} data-testid={testId} data-phase="failed">
        <PanelState compact kind="error" role="status" title={wire.title} testId={`${testId}-failed`}
          action={wire.retry
            ? <button type="button" className={css.retry} onClick={wire.retry} aria-label={`Retry ${WIRE_ROW_SOURCE} for ${sym}`}>Retry</button>
            : null}>
          {wire.hint}
        </PanelState>
        {children}
      </div>
    )
  }
  if (phase === 'none') {
    const none = stockWireNone(sym, wire)
    return (
      <div className={css.body} data-testid={testId} data-phase="none">
        <PanelState compact kind="empty" role="status" title={none.title} testId={`${testId}-none`}>{none.hint}</PanelState>
        <p className={css.note} data-testid={`${testId}-matching`}>{matchingSentence(sym)}</p>
        {children}
      </div>
    )
  }
  return (
    <div className={css.body} data-testid={testId} data-phase="rows">
      <p className={css.lede} data-testid={`${testId}-lede`}>{stockWireLede(sym, wire)}</p>
      <ol className={css.list} aria-label={`News wire headlines naming ${sym}, newest first`} data-testid={`${testId}-list`}>
        {wire.rows.map((r) => <WireRow key={r.seq} row={r} testId={testId} />)}
      </ol>
      {children}
      <p className={css.note} data-testid={`${testId}-matching`}>{matchingSentence(sym)}</p>
      <p className={css.note} data-testid={`${testId}-method`}>{WIRE_CREDIT}. {WIRE_TIME_NOTE} {stockWireReadNote(sym, wire)}</p>
    </div>
  )
}
