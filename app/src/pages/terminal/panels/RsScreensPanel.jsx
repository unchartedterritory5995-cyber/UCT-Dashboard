// RSS: the five UCT RS screens (relative strength leader lists), one chip each (data wave 2).
//
// ⭐ NO NEW ROUTE AND NO INVENTED SPEC. The same two doors the Screener page uses
// (api/routers/screener.py, paid): `GET /api/screener/saved-screens` serves the screens (their
// names, one-line descriptions, rules and row recipes), and `POST /api/screener/scan` runs the
// chosen screen's OWN spec over the nightly screener snapshot. The pure half (which starters are
// the RS screens, the scan body, the columns and rows) is rsScreensModel.js, re-exported below.
//
//   RSS           UCT RS Leaders            RSS TOP    Top RS Rating
//   RSS NH        RS New Highs              RSS NHBP   RS New High Before Price
//   RSS EXIT      RS exit warnings
//
// A chip switches the screen and writes it back into the panel's command. Each row shows the
// ticker, its RS Rating and the two or three things that screen is about, in the screen's own
// order. A symbol loads that name into the linked panels; typing its row number does the same.
//
// ⛔ THE GATE IS THE SERVER'S. The RS screens have their own switch (RS_SCREENS_ENABLED): when the
// saved-screens answer carries none of them the panel says they are not switched on, and it never
// runs a scan. While the lists have not been built yet it shows the server's own sentence.
// ⛔ A FAILED READ IS NEVER AN EMPTY LIST. A scan that fails is an error with Retry; an answer
// with no rows says the screen matched nothing, and the scan's four-count receipt (`coverage`,
// served while COVERAGE_RECEIPTS_SCANS_ENABLED is on) is drawn through CoverageLine so "no match"
// and "could not compute" stay different facts.
//
// The screens are built overnight, so nothing here polls.
import { useMemo, useState } from 'react'
import useSWR from 'swr'
import jsonFetcher from '../../../utils/jsonFetcher'
import {
  PanelCommand, PanelSkeleton, PanelState, PanelSymbol, panelAsOf, useInTerminalPanel, usePanelFreshness, usePanelSymbolRows,
} from '../../../components/terminal'
import CoverageLine from '../../../components/provenance/CoverageLine'
import { formatCurrency, formatNumber, formatPercent, formatTimeEt } from '../../../lib/presentation/presentationPrimitives'
import { canRetry, failureKind, failureText, useMarketRead } from './marketRead'
import { usePanelWriteBack } from './commandWriteBack'
import {
  RS_SCREENS_CODE, RS_SCREEN_FOLD, parseRsScreen, pickRsScreen, rsScanBody, rsScanView, rsScreenColumns, rsScreensCommandArgs, rsScreensOf,
} from './rsScreensModel'
import styles from './marketPanels.module.css'

export {
  DEFAULT_RS_SCREEN, RS_PAGE_SIZE, RS_SCREENS_CODE, RS_SCREENS_GROUP, RS_SCREEN_TOKENS, RS_SCREEN_WORDS, parseRsScreen,
  pickRsScreen, rsScanBody, rsScanView, rsScreenColumns, rsScreensCommandArgs, rsScreensOf,
} from './rsScreensModel'

/** The two doors. They live HERE, in the module that draws the results: TERM-047's result-surface
 *  census finds a surface by the scan routes its own module names (helpers are not followed). */
export const RS_SCREENS_URL = '/api/screener/saved-screens'
export const RS_SCAN_URL = '/api/screener/scan'

const SOURCE = 'UCT screener snapshot and RS ratings (nightly build)'
const NA = 'n/a'
const WHAT = 'The RS screens'

const fetchScan = ([url, , , body]) => jsonFetcher(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body,
}).then((answer) => ({ body: answer, receivedAt: new Date().toISOString() }))

const tone = (v) => (v > 0 ? styles.up : v < 0 ? styles.down : undefined)

/** Pure: one cell as `{ text, toneOf }`; `toneOf` is the signed number a change is coloured by. */
export function rsScreenCell(key, r) {
  switch (key) {
    case 'rs': return { text: formatNumber(r.rs, { decimals: 0, absent: NA }) }
    case 'place': return { text: r.place == null ? NA : `#${formatNumber(r.place, { decimals: 0 })}` }
    case 'days': return { text: formatNumber(r.days, { decimals: 0, absent: NA }) }
    case 'price': return { text: formatCurrency(r.price, { absent: NA }) }
    case 'chgPct': return { text: formatPercent(r.chgPct, { decimals: 2, signed: true, absent: NA }), toneOf: r.chgPct }
    case 'group': return { text: r.group || NA }
    // A row with no note says nothing: no note is never "nothing to know".
    case 'tag': return { text: r.tag || '' }
    default: return { text: r.parts?.[key] || NA }
  }
}

function RsScreenList({ screen }) {
  const body = useMemo(() => JSON.stringify(rsScanBody(screen)), [screen])
  const r = useSWR([RS_SCAN_URL, 'terminal-rss', screen.id, body], fetchScan, { revalidateOnFocus: false })
  const view = useMemo(() => rsScanView(r.data?.body, screen), [r.data, screen])
  const columns = useMemo(() => rsScreenColumns(screen), [screen])
  const asOf = view.session || view.snapshotDate
  usePanelFreshness(view.ok ? panelAsOf(SOURCE, asOf) : null)
  usePanelSymbolRows(view.rows.map((x) => x.sym), screen.name, { total: view.total })
  const retry = () => r.mutate()
  const listName = `The ${screen.name} screen`

  if (!r.data && !r.error) return <PanelSkeleton label={`Loading ${screen.name}`} testId="terminal-rss-loading" />
  if (!r.data && r.error) {
    const locked = !canRetry(r.error)
    const title = r.error?.status === 400
      ? `${listName} cannot run on this server yet. The screener snapshot is missing a column it needs.`
      : failureText(r.error, listName)
    return (
      <PanelState kind={failureKind(r.error)} title={title} testId="terminal-rss-error"
        action={locked ? null : <button type="button" className={styles.chip} onClick={retry}>Retry</button>}>
        {locked ? null : 'That is not the same as an empty list. Retry, or pick another screen.'}
      </PanelState>
    )
  }
  if (!view.ok) {
    return (
      <PanelState kind="error" title={`${listName} could not be read just now.`} testId="terminal-rss-error"
        action={<button type="button" className={styles.chip} onClick={retry}>Retry</button>}>
        That is not the same as an empty list. Retry, or pick another screen.
      </PanelState>
    )
  }

  const method = (
    <p className={styles.muted} data-testid="terminal-rss-method">
      {view.total > view.rows.length
        ? `Showing the first ${formatNumber(view.rows.length, { decimals: 0 })} of ${formatNumber(view.total, { decimals: 0 })} in the screen's own order. `
        : view.rows.length ? `${formatNumber(view.rows.length, { decimals: 0 })} ${view.rows.length === 1 ? 'stock' : 'stocks'}, in the screen's own order. ` : ''}
      This is the screen as the Screener opens it, with its own rules, from the nightly screener snapshot
      {view.session ? ` (ratings as of ${view.session})` : view.snapshotDate ? ` (as of ${view.snapshotDate})` : ''}. RS Rating is
      our own 1 to 99 rating of a stock&apos;s price strength against the market. A list says which stocks to study; it is
      not a forecast or a recommendation. Click a symbol to load it into the linked panels; type a row number to do the
      same. To change a screen&apos;s quick choices or see every column, open the{' '}
      <PanelCommand cmd="SCR" label="Open the Screener">Screener (SCR)</PanelCommand>.
      {r.data?.receivedAt ? ` Read at ${formatTimeEt(r.data.receivedAt, { zoneSuffix: 'ET', absent: '' })}.` : ''}
    </p>
  )

  if (!view.rows.length) {
    return (
      <>
        <PanelState kind="empty" title={screen.emptyText || `No stock is on ${screen.name} in the latest snapshot.`} testId="terminal-rss-empty">
          Nothing passed this screen&apos;s rules. The list fills again when stocks qualify.
        </PanelState>
        <CoverageLine coverage={view.coverage} density="widget" />
        {method}
      </>
    )
  }

  return (
    <>
      {r.error && <p className={styles.note} role="status">{failureText(r.error, listName)} Showing the last read.</p>}
      <div className={styles.tableBox} data-fold={RS_SCREEN_FOLD[screen.id]}>
        <table className={styles.table} data-testid="terminal-rss-table" aria-label={`${screen.name}, ${view.rows.length} ${view.rows.length === 1 ? 'stock' : 'stocks'}`}>
          <thead>
            <tr>
              {columns.map((c) => (
                <th scope="col" key={c.key} title={c.title}
                  className={[c.phoneHide ? styles.phoneHide : '', c.wrap ? `${styles.wrapCell} ${styles.mediumTight}` : styles.mediumWrap].join(' ').trim() || undefined}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {view.rows.map((x, i) => (
              <tr key={x.sym} data-testid={`terminal-rss-row-${x.sym}`}>
                {columns.map((c) => {
                  if (c.key === 'sym') {
                    return (
                      <td key={c.key}>
                        <span className={styles.rowNum} aria-hidden="true">{i + 1}</span>
                        <PanelSymbol sym={x.sym} className={styles.sym} />
                      </td>
                    )
                  }
                  const cell = rsScreenCell(c.key, x)
                  return (
                    <td key={c.key}
                      className={[c.phoneHide ? styles.phoneHide : '', c.wrap ? `${styles.wrapCell} ${styles.mediumTight}` : '', tone(cell.toneOf) || ''].join(' ').trim() || undefined}>
                      {cell.text}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <CoverageLine coverage={view.coverage} density="widget" />
      {method}
    </>
  )
}

export default function RsScreensPanel({ screen: screenProp = null }) {
  const inPanel = useInTerminalPanel()
  const writeBack = usePanelWriteBack()
  const code = inPanel?.code || RS_SCREENS_CODE
  const saved = useMarketRead(RS_SCREENS_URL)
  const served = useMemo(() => rsScreensOf(saved.body), [saved.body])
  // A new `RSS NHBP` remounts the panel (the shell keys the body on code + args), so the typed
  // screen only ever seeds the state. The prop is a starter id (the registry's arg kind gives
  // one) or a typed word.
  const [wanted, setWanted] = useState(() => parseRsScreen(screenProp) || (screenProp ? String(screenProp) : null))
  const screen = pickRsScreen(served.screens, wanted)
  // A chip writes itself into the command (`RSS TOP`) where the registry takes the word, so a
  // reload keeps it; otherwise it is plain component state (commandWriteBack.js).
  const pick = (id) => { setWanted(id); writeBack(rsScreensCommandArgs({ screen: id })) }
  const wrap = (children, attrs = {}) => (
    <div className={`${styles.wrap} ${inPanel ? styles.inPanel : ''}`} data-testid="terminal-rss" {...attrs}>{children}</div>
  )

  if (!saved.body && !saved.error) return wrap(<PanelSkeleton label="Loading the RS screens" testId="terminal-rss-loading" />)
  if (!saved.body && saved.error) {
    const locked = !canRetry(saved.error)
    return wrap(
      <PanelState kind={failureKind(saved.error)} title={failureText(saved.error, WHAT)} testId="terminal-rss-error"
        action={locked ? null : <button type="button" className={styles.chip} onClick={saved.retry}>Retry</button>}>
        {locked ? null : `That is not the same as an empty list. Retry, or run ${code} again.`}
      </PanelState>,
    )
  }
  if (!served.ok) {
    return wrap(
      <PanelState kind="error" title={`${WHAT} could not be read just now.`} testId="terminal-rss-error"
        action={<button type="button" className={styles.chip} onClick={saved.retry}>Retry</button>}>
        That is not the same as an empty list. Retry, or run {code} again.
      </PanelState>,
    )
  }
  if (!screen) {
    return wrap(
      <PanelState kind="locked" title="The RS screens are not switched on for your account on this server yet." testId="terminal-rss-off">
        That is not the same as an empty list. The five screens (UCT RS Leaders, Top RS Rating, RS New Highs, RS New High
        Before Price and RS exit warnings) show here once they are switched on.
      </PanelState>,
    )
  }
  if (served.pending) {
    return wrap(
      <PanelState kind="empty" role="status" title="The RS screens are not ready yet." testId="terminal-rss-pending"
        action={<button type="button" className={styles.chip} onClick={saved.retry}>Check again</button>}>
        {served.pending} That is not the same as no stock qualifying.
      </PanelState>,
    )
  }

  return wrap(
    <>
      <div className={styles.toolbar} role="toolbar" aria-label="RS screens controls">
        <div className={styles.group} role="group" aria-label="Screen">
          {served.screens.map((s) => (
            <button key={s.id} type="button" className={styles.chip} aria-pressed={s.id === screen.id} onClick={() => pick(s.id)}
              data-testid={`terminal-rss-screen-${s.token || s.id}`}>{s.name}</button>
          ))}
        </div>
      </div>
      {saved.error && <p className={styles.note} role="status">{failureText(saved.error, WHAT)} Showing the last read.</p>}
      {screen.description ? <p className={styles.lede} data-testid="terminal-rss-about">{screen.description}</p> : null}
      {served.market ? (
        <p className={styles.note} role="status" data-testid="terminal-rss-market">
          {served.market.text}{served.market.asOf ? ` Market read as of ${served.market.asOf}.` : ''}
        </p>
      ) : null}
      {/* Keyed by screen: a new screen is a new read, so one screen's rows are never drawn under another's columns. */}
      <RsScreenList key={screen.id} screen={screen} />
    </>,
    { 'data-screen': screen.id },
  )
}
