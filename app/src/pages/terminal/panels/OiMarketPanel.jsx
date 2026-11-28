// OIC with no ticker (2026-11-27): the biggest open-interest changes across the whole options log, by stock or
// by contract, calls or puts. `NVDA OIC` is still one stock's contracts (OiChangePanel.jsx, unchanged).
//
// ONE read: GET /api/options-screener/oi-change?view=&side= (api/services/options_analytics/oi_market.py; the
// option screener's own switch and paid gate). The server compares the two newest logged sessions, contract by
// contract, once per pair on a background thread, and holds the lists: `computing` until then, and this panel
// asks again every 5 seconds. A plain table of its own (the per-stock OIC's table header is another lane's).
// The pure half is oiMarketModel.js.
//
// ⛔ Open interest is a once-a-day clearing figure: two records one session apart differ by the earlier day's
//    trading. A new contract has no earlier figure and is counted, never ranked; nothing says who opened or closed.
import { useEffect, useMemo, useState } from 'react'
import {
  PanelSkeleton, PanelState, PanelSymbol, panelAsOf, useInTerminalPanel, usePanelFreshness, usePanelSymbolRows,
} from '../../../components/terminal'
import Select from '../../../components/ui/Select'
import { WARMING_TITLE, canRetry, failureText, useMarketRead } from './marketRead'
import { usePanelWriteBack } from './commandWriteBack'
import { OI_SIDES, contractText, countText, expiryText, normOiSide, signOf, signedText } from './oiChangeModel'
import {
  OI_MARKET_SOURCE, OI_VIEWS, changeText, normOiView, oiMarketCommandArgs, oiMarketCutNote, oiMarketNotes, oiMarketRead,
  oiMarketUrl,
} from './oiMarketModel'
import form from './panelForm.module.css'
import styles from './marketPanels.module.css'

export { OI_MARKET_URL, oiMarketRead, oiMarketUrl } from './oiMarketModel'

export const COMPUTING_POLL_MS = 5 * 1000
export const HELD_POLL_MS = 10 * 60 * 1000
const WHAT = 'Open interest changes'
const signClass = (n) => (signOf(n) === 'up' ? styles.up : signOf(n) === 'down' ? styles.down : undefined)

export default function OiMarketPanel({ view: viewProp, side: sideProp }) {
  const inPanel = useInTerminalPanel()
  const writeBack = usePanelWriteBack()
  const [pick, setPick] = useState(() => ({ view: normOiView(viewProp), side: normOiSide(sideProp) }))
  const choose = (next) => {
    const want = { ...pick, ...next }
    if (!writeBack(oiMarketCommandArgs(want))) setPick(want)
  }
  const [pace, setPace] = useState(HELD_POLL_MS)
  const read = useMarketRead(oiMarketUrl(pick), { refreshInterval: pace })
  const view = useMemo(() => oiMarketRead(read.body), [read.body])
  const wantPace = view.state === 'computing' ? COMPUTING_POLL_MS : HELD_POLL_MS
  useEffect(() => { setPace(wantPace) }, [wantPace])
  usePanelFreshness(view.state === 'ok' && view.session ? panelAsOf(OI_MARKET_SOURCE, view.session) : null)
  usePanelSymbolRows(view.rows.map((r) => r.sym), 'open interest changes')

  const picker = (
    <div className={form.form} data-testid="terminal-oim-form">
      <label className={form.field}>
        Show{' '}
        <Select value={pick.view} onChange={(e) => choose({ view: e.target.value })} data-testid="terminal-oim-view"
          options={Object.entries(OI_VIEWS).map(([value, v]) => ({ value, label: v.label }))} />
      </label>
      <label className={form.field}>
        Side{' '}
        <Select value={pick.side} onChange={(e) => choose({ side: e.target.value })} data-testid="terminal-oim-side"
          options={Object.entries(OI_SIDES).map(([value, s]) => ({ value, label: s.label }))} />
      </label>
    </div>
  )
  const framed = (body, state) => (
    <div className={`${styles.wrap} ${inPanel ? styles.inPanel : ''}`} data-testid="terminal-oim" data-state={state}>{picker}{body}</div>
  )

  if (read.loading) return <PanelSkeleton label="Loading open interest changes" testId="terminal-oim-loading" />
  if (read.error && !read.body) {
    const locked = !canRetry(read.error)
    return framed(
      <PanelState kind={locked ? 'locked' : 'error'} title={failureText(read.error, WHAT)} testId="terminal-oim-error"
        action={locked ? null : <button type="button" className={styles.chip} onClick={read.retry}>Retry</button>}>
        {locked ? null : 'That is not the same as no change. Retry, or run OIC again.'}
      </PanelState>, 'error')
  }
  if (view.state === 'computing') {
    return framed(
      <PanelState kind="empty" role="status" title={WARMING_TITLE} testId="terminal-oim-computing">
        The server is comparing every contract in the two newest records of the options log. This panel asks again every 5 seconds.
      </PanelState>, 'computing')
  }
  if (view.state === 'no_sessions' || view.state === 'one_session' || view.state === 'unknown') {
    return framed(
      <PanelState kind="empty" role="status" testId="terminal-oim-not-ready"
        title={view.state === 'one_session' ? 'The options log holds one recorded day, so there is nothing to compare yet.' : 'The options log holds no recorded day yet.'}>
        A change needs two recorded days. That is not the same as no change.
      </PanelState>, view.state)
  }
  if (!view.rows.length) {
    return framed(
      <PanelState kind="empty" title={`No ${view.side === 'any' ? '' : `${OI_SIDES[view.side].noun} `}open interest changed between the two records.`} testId="terminal-oim-empty">
        {oiMarketNotes(view)[0]}
      </PanelState>, 'empty')
  }

  const cut = oiMarketCutNote(view)
  const notes = oiMarketNotes(view)
  const byStock = view.view === 'stocks'
  return framed(
    <>
      {read.error && <p className={styles.note} role="status">{failureText(read.error, WHAT)} Showing the last read.</p>}
      {view.refreshing && <p className={styles.note} role="status">A newer record is being compared; this is the last one.</p>}
      {cut && <p className={styles.note} data-testid="terminal-oim-cut">{cut}</p>}
      <div className={styles.tableBox}>
        <table className={styles.table} data-testid="terminal-oim-table"
          aria-label={`Biggest open interest changes ${byStock ? 'by stock' : 'by contract'}${view.side === 'any' ? '' : `, ${OI_SIDES[view.side].label.toLowerCase()} only`}`}>
          <thead>
            {byStock ? (
              <tr>
                <th scope="col">Symbol</th>
                <th scope="col" title="Net change in open interest over the contracts in both records">Change</th>
                <th scope="col" title="Open interest now, and what it was">Open interest</th>
                <th scope="col" className={styles.phoneHide} title="The calls' and the puts' own net change">Calls, puts</th>
                <th scope="col" className={styles.phoneHide} title="Contracts in both records">Contracts</th>
              </tr>
            ) : (
              <tr>
                <th scope="col">Contract</th>
                <th scope="col" title="Change in open interest">Change</th>
                <th scope="col" title="Open interest now, and what it was">Open interest</th>
                <th scope="col" className={styles.phoneHide} title="Contracts traded on the earlier recorded day">Volume</th>
              </tr>
            )}
          </thead>
          <tbody>
            {view.rows.map((r, i) => (
              <tr key={r.key} data-testid={`terminal-oim-row-${i}`}>
                <td className={styles.wrapCell}>
                  <span className={styles.rowNum} aria-hidden="true">{i + 1}</span>
                  <PanelSymbol sym={r.sym} className={styles.sym} />
                  {byStock ? null : (
                    <><br /><span className={styles.muted}>{`${contractText(r)}, ${expiryText(r.expiration, view.session)}`}</span></>
                  )}
                </td>
                <td className={signClass(r.change)}>{changeText(r)}</td>
                <td>
                  {countText(r.oi)}
                  <br />
                  <span className={styles.muted}>{`was ${countText(r.priorOi)}`}</span>
                </td>
                {byStock ? (
                  <>
                    <td className={styles.phoneHide}>
                      {`${signedText(r.callChange)} calls`}
                      <br />
                      <span className={styles.muted}>{`${signedText(r.putChange)} puts`}</span>
                    </td>
                    <td className={styles.phoneHide}>{countText(r.contracts)}</td>
                  </>
                ) : (
                  <td className={styles.phoneHide}>{view.volumePresent ? countText(r.volume) : 'not in the log'}</td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {notes.map((n) => <p key={n} className={styles.muted} data-testid="terminal-oim-note">{n}</p>)}
      <p className={styles.muted} data-testid="terminal-oim-method">
        {`Every underlying in UCT's options log (the vendor's end-of-day options snapshot, recorded once a trading day), ${byStock ? 'each stock’s net change over its contracts in both records' : 'each contract in both records'}, biggest change either way first.`}
        {byStock ? '' : ' Volume is the earlier recorded day’s, the trading the change came from.'}
        {' '}Nothing here says who opened or closed. Click a symbol to open it; NVDA OIC shows one stock&apos;s contracts.
      </p>
    </>, 'ok')
}
