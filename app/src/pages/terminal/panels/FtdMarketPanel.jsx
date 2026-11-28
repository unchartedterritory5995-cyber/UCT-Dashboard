// FTD with no ticker (2026-11-27): the biggest fails-to-deliver across the market in the newest SEC period.
// `FTD` ranks by shares, `FTD VALUE` by dollar value; `NVDA FTD` is still one stock's series (Research > Depth).
//
// ONE read: GET /api/research/ftd-market?rank= (api/services/ftd_dataset.py `market_list`; the same switch,
// FTD_DATASET_ENABLED, and paid gate as the per-stock route; the server's own store of the SEC's cnsfails
// files, worked out once per ingested file, never a vendor). The pure half is ftdMarketModel.js.
//
// ⛔ A FAIL IS A BALANCE ON ONE SETTLEMENT DATE. The list ranks each security's largest single-day balance in
//    the period, never a sum of days, and says so. The price is the SEC file's own price for that day.
// ⛔ The SEC posts each half-month weeks after it ends: the period is named in every view.
// ⛔ "Nothing ingested yet", "no fails in the period" and a failed read are three different sentences.
import { useMemo, useState } from 'react'
import {
  PanelSkeleton, PanelState, PanelSymbol, panelAsOf, useInTerminalPanel, usePanelFreshness, usePanelSymbolRows,
} from '../../../components/terminal'
import Select from '../../../components/ui/Select'
import { formatCompactTerminal, formatCurrency } from '../../../lib/presentation/presentationPrimitives'
import { canRetry, failureText, useMarketRead } from './marketRead'
import { usePanelWriteBack } from './commandWriteBack'
import form from './panelForm.module.css'
import styles from './marketPanels.module.css'
import {
  FTD_MARKET_SOURCE, FTD_RANKS, ftdCommandArgs, ftdCutNote, ftdMarketRead, ftdMarketUrl, normFtdRank,
} from './ftdMarketModel'

export { FTD_MARKET_CODE, FTD_MARKET_URL, ftdMarketRead, ftdMarketUrl } from './ftdMarketModel'

/** The SEC posts twice a month; an hour is plenty. */
const POLL_MS = 60 * 60 * 1000
const WHAT = 'The fails-to-deliver list'
const NA = 'not given'
const shares = (n) => (n == null ? NA : formatCompactTerminal(n))
const money = (n) => (n == null ? 'no price' : formatCompactTerminal(n, { money: true }))

export default function FtdMarketPanel({ rank: rankProp }) {
  const inPanel = useInTerminalPanel()
  const writeBack = usePanelWriteBack()
  const [rank, setRank] = useState(() => normFtdRank(rankProp))
  const choose = (next) => { if (!writeBack(ftdCommandArgs(next))) setRank(normFtdRank(next)) }
  const read = useMarketRead(ftdMarketUrl(rank), { refreshInterval: POLL_MS })
  const view = useMemo(() => ftdMarketRead(read.body), [read.body])
  usePanelFreshness(view.state === 'ok' && view.period ? panelAsOf(FTD_MARKET_SOURCE, view.period.through) : null)
  usePanelSymbolRows(view.rows.map((r) => r.sym), 'fails to deliver')

  const picker = (
    <div className={form.form} data-testid="terminal-ftdm-form">
      <label className={form.field}>
        Rank by{' '}
        <Select value={rank} onChange={(e) => choose(e.target.value)} data-testid="terminal-ftdm-rank"
          options={Object.entries(FTD_RANKS).map(([value, r]) => ({ value, label: r.label }))} />
      </label>
    </div>
  )
  const framed = (body, state) => (
    <div className={`${styles.wrap} ${inPanel ? styles.inPanel : ''}`} data-testid="terminal-ftdm" data-state={state}>{picker}{body}</div>
  )

  if (read.loading) return <PanelSkeleton label="Loading the fails-to-deliver list" testId="terminal-ftdm-loading" />
  if (read.error && !read.body) {
    const locked = !canRetry(read.error)
    return framed(
      <PanelState kind={locked ? 'locked' : 'error'} title={failureText(read.error, WHAT)} testId="terminal-ftdm-error"
        action={locked ? null : <button type="button" className={styles.chip} onClick={read.retry}>Retry</button>}>
        {locked ? null : 'That is not the same as no fails. Retry, or run FTD again.'}
      </PanelState>, 'error')
  }
  if (view.state === 'not_ingested' || view.state === 'unknown') {
    return framed(
      <PanelState kind="empty" role="status" title="No fails-to-deliver file has been read on this server yet." testId="terminal-ftdm-none-read">
        The server reads the SEC&apos;s twice-monthly files each morning. This is not the same as no fails.
      </PanelState>, 'not_ingested')
  }
  if (view.state === 'none_reported' || !view.rows.length) {
    return framed(
      <PanelState kind="empty" title={`No fails reported${view.period ? ` between ${view.period.from} and ${view.period.through}` : ''}.`} testId="terminal-ftdm-empty">
        The newest SEC file the server holds lists no security with a fail balance.
      </PanelState>, 'none_reported')
  }

  const cut = ftdCutNote(view)
  return framed(
    <>
      {read.error && <p className={styles.note} role="status">{failureText(read.error, WHAT)} Showing the last read.</p>}
      {cut && <p className={styles.note} data-testid="terminal-ftdm-cut">{cut}</p>}
      <div className={styles.tableBox}>
        <table className={styles.table} data-testid="terminal-ftdm-table"
          aria-label={`Biggest fails to deliver ${FTD_RANKS[rank].what}, ${view.period ? `${view.period.from} to ${view.period.through}` : 'newest period'}`}>
          <thead>
            <tr>
              <th scope="col" title="Click a symbol to open its DES">Symbol</th>
              <th scope="col" title="The largest single-day fail balance in the period, and its settlement date">Largest fail</th>
              <th scope="col" title="That balance times the SEC file's own price that day">Value</th>
              <th scope="col" className={styles.phoneHide} title="The newest balance in the period, and its date">Newest</th>
              <th scope="col" title="On how many of the period's settlement dates it was listed">Days listed</th>
            </tr>
          </thead>
          <tbody>
            {view.rows.map((r, i) => {
              const v = rank === 'value' ? r.peakValue : r.peak
              return (
                <tr key={r.key} data-testid={`terminal-ftdm-row-${r.sym}`}>
                  <td className={styles.wrapCell}>
                    <span className={styles.rowNum} aria-hidden="true">{i + 1}</span>
                    <PanelSymbol sym={r.sym} className={styles.sym} />
                    {r.name ? <><br /><span className={styles.muted}>{r.name}</span></> : null}
                  </td>
                  <td>
                    {shares(v?.shares)}
                    <br />
                    <span className={styles.muted}>{v?.date || NA}</span>
                  </td>
                  <td>
                    {money(v?.value)}
                    <br />
                    <span className={styles.muted}>{v?.price == null ? 'no price in the file' : `at ${formatCurrency(v.price)}`}</span>
                  </td>
                  <td className={styles.phoneHide}>
                    {shares(r.latest?.shares)}
                    <br />
                    <span className={styles.muted}>{r.latest?.date || NA}</span>
                  </td>
                  <td>{r.days == null ? NA : `${r.days}${view.settleDates ? ` of ${view.settleDates}` : ''}`}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className={styles.muted} data-testid="terminal-ftdm-method">
        {`Every security in the SEC's fails-to-deliver file for ${view.period ? `${view.period.from} to ${view.period.through}` : 'the newest period'}, ranked ${FTD_RANKS[rank].what}. `}
        Each figure is one settlement day&apos;s fail balance, never a sum of days; value is that balance times the SEC
        file&apos;s own price. The SEC posts each half-month a few weeks after it ends.
        {rank === 'value' && view.noPrice ? ` ${view.noPrice} with no price in the file are left out of this order.` : ''}
        {view.mismatch ? ' The file’s own row count did not match what was read, so it may be incomplete.' : ''}
        {' '}Click a symbol to open its DES; type a row number to load it into the linked panels. NVDA FTD shows one stock&apos;s series.
      </p>
    </>, 'ok')
}
