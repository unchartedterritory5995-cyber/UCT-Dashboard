// IDXC: index additions and removals for the S&P 500, the Nasdaq 100 and the Dow 30 (2026-11-21).
//
//   IDXC             all three, newest first
//   IDXC NASDAQ100   one index (S&P500, NASDAQ100, DOW30)
//   NVDA IDXC        one stock's own index history
//   IDXC MARKET      all three even on a panel that follows a group's stock: there the shell hands the panel that
//                    stock for bare `IDXC` (marketViewModel.js), so a chip switches between the stock and the indexes
//
// `GET /api/research/index-changes?index=&sym=` (paid; api/services/index_changes.py), read from Financial
// Modeling Prep through the site's one adapter. The server holds the three lists and never builds them on the
// request: with nothing held it says "computing" and this panel asks again. The pure half is indexChangesModel.js.
//
// Each change: the day, the stock added and the stock it replaced (a symbol the site follows opens its board),
// and the provider's reason. An index whose list the provider's plan lacks says so. A FAILED READ IS NEVER "NO
// CHANGES". The server reads today's members elsewhere (api/services/index_constituents.py); this is the history.
//
// WIDTH. Two columns: the day (with the index under it when all three are shown) and the change, which wraps
// between words.
import { useMemo, useState } from 'react'
import { PanelSkeleton, PanelState, PanelSymbol, panelAsOf, useInTerminalPanel, usePanelFreshness, usePanelSymbolRows } from '../../../components/terminal'
import { formatTimeEt } from '../../../lib/presentation/presentationPrimitives'
import { usePanelWriteBack } from './commandWriteBack'
import { WARMING_TITLE, canRetry, failureKind, failureText, useMarketRead } from './marketRead'
import { isMarketView, marketViewArgs } from './marketViewModel'
import {
  IDXC_CODE, IDXC_INDEXES, IDXC_SOURCE, IDXC_WHAT, changeDayWords, droppedWords, idxcCommandArgs, idxcCountLine, idxcPollMs, idxcRead,
  idxcUrl, legWords, normIdxcIndex,
} from './indexChangesModel'
import styles from './marketPanels.module.css'

const clock = (iso) => (iso ? formatTimeEt(iso, { zoneSuffix: 'ET', absent: '' }) : '')

function Side({ verb, side }) {
  if (!side) return null
  return (
    <span>
      {verb}{' '}
      {side.covered ? <PanelSymbol sym={side.sym} className={styles.sym} /> : <span>{side.sym}</span>}
      {side.name ? <span className={styles.muted}> {side.name}</span> : null}
    </span>
  )
}

function ChangesTable({ view }) {
  const n = view.changes.length
  const many = view.index === 'all'
  return (
    <div className={styles.tableBox}>
      <table className={styles.table} data-testid="terminal-idxc-changes"
        aria-label={`Index changes${view.sym ? ` for ${view.sym}` : ''}, newest first, ${n} ${n === 1 ? 'change' : 'changes'}`}>
        <thead>
          <tr>
            <th scope="col" title={many ? 'The day the change took effect, and the index' : 'The day the change took effect'}>Day</th>
            <th scope="col" className={styles.wrapCell} title="The stock added, the stock it replaced, and the provider's reason">Change</th>
          </tr>
        </thead>
        <tbody>
          {view.changes.map((c, i) => (
            <tr key={`${c.index} ${c.date} ${i}`} data-testid="terminal-idxc-row" data-index={c.index}>
              <td className={styles.wrapCell}>
                {changeDayWords(c.date)}
                {many ? <><br /><span className={styles.muted}>{IDXC_INDEXES[c.index].label}</span></> : null}
              </td>
              <td className={styles.wrapCell}>
                <Side verb="Added" side={c.added} />
                {c.added && c.removed ? <br /> : null}
                <Side verb="Removed" side={c.removed} />
                {c.reason ? <><br /><span className={styles.muted}>{c.reason}</span></> : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Changes({ sym, stock, index, code, inPanel, onPick, onScope }) {
  const read = useMarketRead(idxcUrl({ index, sym }), { refreshInterval: (latest) => idxcPollMs(latest?.body) })
  const view = useMemo(() => idxcRead(read.body), [read.body])
  const answered = !read.loading && !!read.body && (view.state === 'ok' || view.state === 'none')
  usePanelFreshness(answered ? panelAsOf(IDXC_SOURCE, view.readAt) : null)
  usePanelSymbolRows(view.state === 'ok' ? view.symbols : [], sym ? `${sym}'s index changes` : 'index changes')
  const run = sym ? `${sym} ${code}` : stock ? `${stock} ${code} MARKET` : code

  const scope = stock ? (
    <div className={styles.group} role="group" aria-label="Whose changes">
      <button type="button" className={styles.chip} aria-pressed={!!sym} data-testid="terminal-idxc-view-stock"
        title={`${stock}'s own index history (${stock} ${code})`} onClick={() => (sym ? null : onScope(false))}>{stock}</button>
      <button type="button" className={styles.chip} aria-pressed={!sym} data-testid="terminal-idxc-view-market"
        title={`Every change to the three indexes (${code} MARKET)`} onClick={() => (sym ? onScope(true) : null)}>All changes</button>
    </div>
  ) : null
  const chips = sym ? <div className={styles.toolbar} role="toolbar" aria-label="Index changes choices">{scope}</div> : (
    <div className={styles.toolbar} role="toolbar" aria-label="Index changes choices">
      {scope}
      <div className={styles.group} role="group" aria-label="Which index">
        <button type="button" className={styles.chip} aria-pressed={index === 'all'} data-testid="terminal-idxc-index-all"
          onClick={() => (index === 'all' ? null : onPick('all'))}>All three</button>
        {Object.entries(IDXC_INDEXES).map(([key, v]) => (
          <button key={key} type="button" className={styles.chip} aria-pressed={index === key} data-testid={`terminal-idxc-index-${key}`}
            onClick={() => (index === key ? null : onPick(key))}>{v.label}</button>
        ))}
      </div>
    </div>
  )
  const wrap = (state, body) => (
    <div className={`${styles.wrap} ${inPanel ? styles.inPanel : ''}`} data-testid="terminal-idxc" data-state={state} data-sym={sym || ''} data-index={index}>
      {chips}
      {body}
    </div>
  )
  if (read.loading) return <PanelSkeleton label={sym ? `Loading ${sym}'s index changes` : 'Loading index changes'} testId="terminal-idxc-loading" />
  if (!read.body || view.state === 'failed') {
    const err = read.body ? null : read.error
    const locked = err ? !canRetry(err) : false
    return wrap('error', (
      <PanelState kind={err ? failureKind(err) : 'error'} testId="terminal-idxc-error"
        title={err ? failureText(err, IDXC_WHAT) : `${IDXC_WHAT} came back in a shape this panel cannot read.`}
        action={locked ? null : <button type="button" className={styles.chip} onClick={read.retry}>Retry</button>}>
        {locked ? null : `That is not the same as no changes. Retry, or run ${run} again.`}
      </PanelState>
    ))
  }
  if (view.state === 'computing') {
    return wrap('computing', (
      <PanelState kind="empty" role="status" title={WARMING_TITLE} testId="terminal-idxc-computing">
        The server is reading the index histories from {IDXC_SOURCE}. That takes a few seconds the first time. This panel asks
        again every 3 seconds and fills in on its own.
      </PanelState>
    ))
  }
  if (view.state === 'source') {
    return wrap('source', (
      <PanelState kind="error" testId="terminal-idxc-source" title={`${IDXC_WHAT} could not be read from ${IDXC_SOURCE} just now.`}
        action={<button type="button" className={styles.chip} onClick={read.retry}>Retry</button>}>
        That is not the same as no changes. The server asks again within a few minutes.
      </PanelState>
    ))
  }

  const legs = legWords(view)
  const dropped = droppedWords(view)
  const method = (
    <p className={styles.muted} data-testid="terminal-idxc-method">
      Source: {IDXC_SOURCE}, read by the server{clock(view.readAt) ? ` at ${clock(view.readAt)}` : ''}. Each row is a change as the
      provider lists it: the stock added, the stock it replaced and the reason, on the day it took effect. A symbol the site
      follows opens its board. The server reads the three lists at most once a day.
      {sym ? '' : <> One stock&apos;s history: type its symbol first, e.g. <kbd>NVDA {IDXC_CODE}</kbd>.</>}
    </p>
  )
  const notes = (
    <>
      {read.error ? <p className={styles.note} role="status" data-testid="terminal-idxc-stale-read">{failureText(read.error, IDXC_WHAT)} Showing the last read.</p> : null}
      {view.check ? <p className={styles.note} role="status" data-testid="terminal-idxc-check">A later look at {IDXC_SOURCE} did not answer, so these are the last lists read.</p> : null}
      {legs ? <p className={styles.note} role="status" data-testid="terminal-idxc-legs">{legs}</p> : null}
    </>
  )
  if (view.state === 'none') {
    return wrap('none', (
      <>
        {notes}
        <PanelState kind="empty" role="status" title={idxcCountLine(view)} testId="terminal-idxc-none">
          That is the provider&apos;s list, not a failed read.
        </PanelState>
        {method}
      </>
    ))
  }
  return wrap('ok', (
    <>
      {notes}
      <p className={styles.lede} data-testid="terminal-idxc-count">{idxcCountLine(view)}</p>
      <ChangesTable view={view} />
      {dropped ? <p className={styles.note} role="status" data-testid="terminal-idxc-dropped">{dropped}</p> : null}
      {method}
    </>
  ))
}

export default function IndexChangesPanel({ sym, index: indexProp, view: viewProp }) {
  const inPanel = useInTerminalPanel()
  const code = inPanel?.code || IDXC_CODE
  const writeBack = usePanelWriteBack()
  const s = String(sym || '').trim().toUpperCase() || null
  // Outside the shell (or if the registry cannot take a word) a chip switches here, in state.
  const [index, setIndex] = useState(() => normIdxcIndex(indexProp))
  const [market, setMarket] = useState(() => isMarketView(viewProp))
  const asked = s && !market ? s : null
  // On a panel that follows a stock the market view keeps its MARKET word, so the shell resolves it the same way.
  const onPick = (next) => {
    if (!writeBack([...marketViewArgs(!!s), ...idxcCommandArgs({ index: next })], s)) setIndex(normIdxcIndex(next))
  }
  const onScope = (toMarket) => {
    if (!writeBack(marketViewArgs(toMarket), s)) setMarket(toMarket)
  }
  const shown = asked ? 'all' : index
  // Keyed by what is asked: a new stock or index is a new read, never drawn under another's name.
  return <Changes key={`${asked || 'market'} ${shown}`} sym={asked} stock={s} index={shown} code={code} inPanel={inPanel}
    onPick={onPick} onScope={onScope} />
}
