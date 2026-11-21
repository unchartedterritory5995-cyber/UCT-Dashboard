// MNA: mergers and acquisitions (2026-11-21).
//
//   MNA        the latest announced deals across the market, newest first
//   NVDA MNA   the deals that name one company (as acquirer or target)
//   MNA MARKET the latest deals even on a panel that follows a group's stock: there the shell hands the panel
//              that stock for bare `MNA` (marketViewModel.js), so two chips switch between the stock and the market
//
// `GET /api/research/mergers[?sym=]` (paid; api/services/mergers.py), read from Financial Modeling Prep through
// the site's one adapter. The server holds the answers and never builds them on the request: with nothing held
// it says "computing" and this panel asks again. The pure half is mergersModel.js.
//
// Each deal: the acquirer (a symbol the site follows opens its board), the target (often private: a name with
// no symbol), the day and the SEC filing when the feed links one. A provider that refuses the site's plan says
// so in words, with no Retry. A FAILED READ IS NEVER "NO DEALS".
//
// WIDTH. Three columns of two-line cells that wrap between words, which fit a 340px panel.
import { useMemo, useState } from 'react'
import { PanelSkeleton, PanelState, PanelSymbol, panelAsOf, useInTerminalPanel, usePanelFreshness, usePanelSymbolRows } from '../../../components/terminal'
import { formatTimeEt } from '../../../lib/presentation/presentationPrimitives'
import { usePanelWriteBack } from './commandWriteBack'
import { WARMING_TITLE, canRetry, failureKind, failureText, useMarketRead } from './marketRead'
import { isMarketView, marketViewArgs } from './marketViewModel'
import {
  MNA_CODE, MNA_SOURCE, MNA_WHAT, dealDayWords, mnaCountLine, mnaNoteWords, mnaPollMs, mnaRead, mnaUrl, searchWords, unavailableWords,
} from './mergersModel'
import styles from './marketPanels.module.css'

const clock = (iso) => (iso ? formatTimeEt(iso, { zoneSuffix: 'ET', absent: '' }) : '')

/** A party's symbol: a link when the site follows the stock, plain text otherwise. */
function Sym({ party }) {
  if (!party?.sym) return null
  return party.covered ? <PanelSymbol sym={party.sym} className={styles.sym} /> : <span>{party.sym}</span>
}

function Acquirer({ party }) {
  return (
    <td className={styles.wrapCell}>
      <Sym party={party} />
      {party.name ? <><br /><span className={styles.muted}>{party.name}</span></> : null}
    </td>
  )
}

function Target({ party }) {
  if (!party) return <td className={styles.muted}>Not named</td>
  return (
    <td className={styles.wrapCell}>
      {party.name || <Sym party={party} />}
      {party.name && party.sym ? <><br /><span className={styles.muted}><Sym party={party} /></span></> : null}
      {!party.sym ? <><br /><span className={styles.muted}>No listed symbol</span></> : null}
    </td>
  )
}

function DealsTable({ view }) {
  const n = view.deals.length
  return (
    <div className={styles.tableBox}>
      <table className={styles.table} data-testid="terminal-mna-deals"
        aria-label={`${view.scope === 'company' ? `Deals naming ${view.sym}` : 'The latest deals'}, newest first, ${n} ${n === 1 ? 'deal' : 'deals'}`}>
        <thead>
          <tr>
            <th scope="col" title="The company that filed the deal">Acquirer</th>
            <th scope="col" className={styles.wrapCell} title="The company being bought, as the filing names it">Target</th>
            <th scope="col" className={`${styles.wrapCell} ${styles.phoneWrap}`} title="The day of the deal in the filing, and the filing on sec.gov">Filed</th>
          </tr>
        </thead>
        <tbody>
          {view.deals.map((d, i) => (
            <tr key={`${d.date} ${d.acquirer.sym} ${i}`} data-testid="terminal-mna-row">
              <Acquirer party={d.acquirer} />
              <Target party={d.target} />
              <td className={`${styles.wrapCell} ${styles.phoneWrap}`}>
                {dealDayWords(d.date)}
                {d.link ? (
                  <>
                    <br />
                    <a className={styles.linkBtn} href={d.link} target="_blank" rel="noopener noreferrer"
                      aria-label={`The SEC filing for ${d.acquirer.sym}${d.target?.name ? ` and ${d.target.name}` : ''}, opens sec.gov in a new tab`}>SEC filing</a>
                  </>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Deals({ sym, stock, code, inPanel, onPick }) {
  const read = useMarketRead(mnaUrl(sym), { refreshInterval: (latest) => mnaPollMs(latest?.body) })
  const view = useMemo(() => mnaRead(read.body), [read.body])
  const answered = !read.loading && !!read.body && (view.state === 'ok' || view.state === 'none')
  usePanelFreshness(answered ? panelAsOf(MNA_SOURCE, view.readAt) : null)
  usePanelSymbolRows(view.state === 'ok' ? view.symbols : [], sym ? `deals naming ${sym}` : 'the latest deals')
  const run = sym ? `${sym} ${code}` : stock ? `${stock} ${code} MARKET` : code

  // On a panel that follows a stock: that stock's deals, or the latest deals across the market.
  const chips = stock ? (
    <div className={styles.toolbar} role="toolbar" aria-label="Mergers and acquisitions views">
      <div className={styles.group} role="group" aria-label="Which deals">
        <button type="button" className={styles.chip} aria-pressed={!!sym} data-testid="terminal-mna-view-stock"
          title={`Deals naming ${stock} (${stock} ${code})`} onClick={() => (sym ? null : onPick(false))}>{stock}</button>
        <button type="button" className={styles.chip} aria-pressed={!sym} data-testid="terminal-mna-view-market"
          title={`The latest deals across the market (${code} MARKET)`} onClick={() => (sym ? onPick(true) : null)}>Latest deals</button>
      </div>
    </div>
  ) : null
  const wrap = (state, body) => (
    <div className={`${styles.wrap} ${inPanel ? styles.inPanel : ''}`} data-testid="terminal-mna" data-state={state} data-sym={sym || ''}>
      {chips}
      {body}
    </div>
  )
  if (read.loading) return <PanelSkeleton label={sym ? `Loading the deals naming ${sym}` : 'Loading the latest deals'} testId="terminal-mna-loading" />
  if (!read.body || view.state === 'failed') {
    const err = read.body ? null : read.error
    const locked = err ? !canRetry(err) : false
    return wrap('error', (
      <PanelState kind={err ? failureKind(err) : 'error'} testId="terminal-mna-error"
        title={err ? failureText(err, MNA_WHAT) : `${MNA_WHAT} came back in a shape this panel cannot read.`}
        action={locked ? null : <button type="button" className={styles.chip} onClick={read.retry}>Retry</button>}>
        {locked ? null : `That is not the same as no deals. Retry, or run ${run} again.`}
      </PanelState>
    ))
  }
  if (view.state === 'computing') {
    return wrap('computing', (
      <PanelState kind="empty" role="status" title={WARMING_TITLE} testId="terminal-mna-computing">
        The server is reading the filings from {MNA_SOURCE}. That takes a few seconds the first time. This panel asks again
        every 3 seconds and fills in on its own.
      </PanelState>
    ))
  }
  if (view.state === 'unavailable') {
    return wrap('unavailable', (
      <PanelState kind="locked" role="status" testId="terminal-mna-unavailable" title={unavailableWords(view.reason)}>
        {MNA_SOURCE} did not include this feed for the site&apos;s plan. That is an answer about the source, not a failed read.
      </PanelState>
    ))
  }
  if (view.state === 'source') {
    return wrap('source', (
      <PanelState kind="error" testId="terminal-mna-source" title={`${MNA_WHAT} could not be read from ${MNA_SOURCE} just now.`}
        action={<button type="button" className={styles.chip} onClick={read.retry}>Retry</button>}>
        That is not the same as no deals. The server asks again within a few minutes.
      </PanelState>
    ))
  }

  const search = searchWords(view)
  const note = mnaNoteWords(view)
  const method = (
    <p className={styles.muted} data-testid="terminal-mna-method">
      Source: {MNA_SOURCE}, from SEC filings, read by the server{clock(view.readAt) ? ` at ${clock(view.readAt)}` : ''}. The acquirer is the
      company that filed; the target is named as the filing names it, often a private company with no listed symbol. A symbol
      the site follows opens its board. {sym ? '' : 'The server reads the newest filings at most once an hour. '}
      For one company&apos;s deals, type its symbol first, e.g. <kbd>NVDA {MNA_CODE}</kbd>.
    </p>
  )
  const notes = (
    <>
      {read.error ? <p className={styles.note} role="status" data-testid="terminal-mna-stale-read">{failureText(read.error, MNA_WHAT)} Showing the last read.</p> : null}
      {view.check ? <p className={styles.note} role="status" data-testid="terminal-mna-check">A later look at {MNA_SOURCE} did not answer, so this is the last list read.</p> : null}
      {search ? <p className={styles.note} role="status" data-testid="terminal-mna-search">{search}</p> : null}
    </>
  )
  if (view.state === 'none') {
    return wrap('none', (
      <>
        {notes}
        <PanelState kind="empty" role="status" title={mnaCountLine(view)} testId="terminal-mna-none">
          {MNA_SOURCE} answered and lists none. That is an answer, not a failed read.
        </PanelState>
        {method}
      </>
    ))
  }
  return wrap('ok', (
    <>
      {notes}
      <p className={styles.lede} data-testid="terminal-mna-count">{mnaCountLine(view)}</p>
      <DealsTable view={view} />
      {note ? <p className={styles.note} role="status" data-testid="terminal-mna-note">{note}</p> : null}
      {method}
    </>
  ))
}

export default function MergersPanel({ sym, view: viewProp }) {
  const inPanel = useInTerminalPanel()
  const code = inPanel?.code || MNA_CODE
  const writeBack = usePanelWriteBack()
  const s = String(sym || '').trim().toUpperCase() || null
  // Outside the shell (or if the registry cannot take the word) a chip switches here, in state.
  const [market, setMarket] = useState(() => isMarketView(viewProp))
  const asked = s && !market ? s : null
  const onPick = (toMarket) => {
    if (!writeBack(marketViewArgs(toMarket), s)) setMarket(toMarket)
  }
  // Keyed by what is asked: one company's deals are never drawn under another's name.
  return <Deals key={asked || 'latest'} sym={asked} stock={s} code={code} inPanel={inPanel} onPick={onPick} />
}
