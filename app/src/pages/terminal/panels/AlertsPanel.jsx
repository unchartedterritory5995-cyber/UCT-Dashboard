// ALRT — the member's price alerts in the terminal (lane 9, top-10 #4).
//
//   NVDA ALRT 950   sets an alert (the SHELL does that, once, from a typed command:
//                   alertCommand.js), then this panel opens on NVDA's alerts
//   NVDA ALRT       NVDA's alerts          ALRT          every alert
//
// ⭐ NO NEW BACKEND. The list is `GET /api/watchlist-alerts?active_only=false` — the same read the
// dashboard's Alerts widget makes, so a triggered alert shows here too — and Delete is the same
// `DELETE /api/watchlist-alerts/{id}` the bell and the chart menus use. Every alert cache in the
// app re-reads after a change (alertCommand.revalidateAlerts).
//
// ⛔ A failed read is an ERROR with Retry, never "no alerts": "you have none" and "we could not
// ask" are different sentences, and only one of them is true.
import { useEffect, useMemo, useState } from 'react'
import useSWR from 'swr'
import jsonFetcher from '../../../utils/jsonFetcher'
import useLivePrices from '../../../hooks/useLivePrices'
import { PanelSkeleton, PanelState, useInTerminalPanel, usePanelFreshness, usePanelLinkedSym } from '../../../components/terminal'
import { formatDateTimeEt, formatNumber, formatPercent, formatTimeEt } from '../../../lib/presentation/presentationPrimitives'
import { money } from '../alertModel'
import { ALERTS_URL, revalidateAlerts } from '../alertCommand'
import styles from './myNamesPanel.module.css'

/** The widget's read: active AND recently triggered alerts. Its key starts with ALERTS_URL, so
 *  every create/delete anywhere in the app refreshes it. */
export const ALERTS_LIST_URL = `${ALERTS_URL}?active_only=false`
const stamped = (url) => jsonFetcher(url).then((d) => ({ rows: Array.isArray(d) ? d : [], receivedAt: new Date().toISOString() }))

/** Pure: a failed read in a member's words — a paywall and a signed-out session are not outages. */
export function alertsFailureText(err) {
  if (err?.status === 401) return 'You are signed out, so your alerts cannot be read. Sign in again.'
  if (err?.status === 402) return 'Price alerts need a paid plan.'
  if (err?.timedOut) return 'The alert list did not answer within 30 seconds.'
  return 'Your alerts could not be read just now.'
}

/** Pure: the rows a panel shows — one ticker's or all, active first, then by ticker and price. */
export function alertRows(rows, sym = null) {
  const want = sym ? String(sym).toUpperCase() : null
  return (Array.isArray(rows) ? rows : [])
    .filter((a) => a && a.sym && (!want || String(a.sym).toUpperCase() === want))
    .map((a) => ({
      id: a.id,
      sym: String(a.sym).toUpperCase(),
      target: Number(a.target_price),
      direction: a.direction === 'below' ? 'below' : 'above',
      active: a.is_active === 1 || a.is_active === true,
      triggeredAt: a.triggered_at || null,
      kind: a.alert_type || 'price',
    }))
    .sort((a, b) => (Number(b.active) - Number(a.active)) || (a.sym < b.sym ? -1 : a.sym > b.sym ? 1 : 0)
      || (a.target - b.target))
}

/** Pure: how far the price has to travel to the alert, as a % of the price now (signed). */
export function distancePct(target, last) {
  const t = Number(target)
  const p = Number(last)
  if (!Number.isFinite(t) || !Number.isFinite(p) || p <= 0) return null
  return ((t - p) / p) * 100
}

const KIND_TEXT = { line: 'chart line', trendline: 'trendline' }

export default function AlertsPanel({ sym = null, onRun, onRows }) {
  const inPanel = useInTerminalPanel()
  const { data, error, mutate } = useSWR(ALERTS_LIST_URL, stamped, { refreshInterval: 30000, keepPreviousData: true })
  const rows = useMemo(() => alertRows(data?.rows, sym), [data, sym])
  const syms = useMemo(() => [...new Set(rows.map((r) => r.sym))], [rows])
  const { prices } = useLivePrices(syms)   // the shared 2 s pool, never a per-row read
  const [failed, setFailed] = useState(null)   // { id, text } — a Delete that did not land
  const [busy, setBusy] = useState(null)

  const cmds = useMemo(() => rows.map((r) => `$${r.sym}`), [rows])
  useEffect(() => { onRows?.(cmds) }, [onRows, cmds])

  usePanelFreshness(data?.receivedAt ? { freshnessClass: 'real_time', asOf: data.receivedAt } : null)

  const load = (s) => onRun?.(`$${s}`, { keepFunction: true })
  const linked = usePanelLinkedSym()
  const remove = async (row) => {
    setBusy(row.id)
    setFailed(null)
    try {
      await jsonFetcher(`${ALERTS_URL}/${encodeURIComponent(row.id)}`, { method: 'DELETE' })
      await mutate()
      revalidateAlerts()
    } catch (err) {
      setFailed({ id: row.id, text: err?.status === 404
        ? `The ${row.sym} alert was already gone.`
        : `The ${row.sym} alert could not be deleted just now. It is still set; try again.` })
      if (err?.status === 404) mutate()
    } finally {
      setBusy(null)
    }
  }

  if (!data && !error) return <PanelSkeleton label="Loading your price alerts" testId="terminal-alerts-loading" />
  if (!data && error) {
    return (
      <PanelState kind={error?.status === 402 ? 'locked' : 'error'} testId="terminal-alerts-error"
        title={alertsFailureText(error)}
        action={error?.status === 402 ? null
          : <button type="button" className={styles.chip} onClick={() => mutate()}>Retry</button>}>
        {error?.status === 402 ? null : 'That is not the same as having no alerts. Retry, or run ALRT again.'}
      </PanelState>
    )
  }

  const example = sym || 'NVDA'
  const activeCount = rows.filter((r) => r.active).length

  return (
    <div className={`${styles.wrap} ${inPanel ? styles.inPanel : ''}`} data-testid="terminal-alerts">
      <div className={styles.head}>
        <span className={styles.lede}>
          {sym ? `${sym}: ` : ''}{activeCount} active alert{activeCount === 1 ? '' : 's'}.
          Set one from the command line: <kbd>{example} ALRT 950</kbd> (above or below is worked out from the price; <kbd>&gt;950</kbd> or <kbd>&lt;950</kbd> to say which).
        </span>
      </div>

      {error ? <p className={styles.note} role="status">{alertsFailureText(error)} Showing the last list read.</p> : null}
      {failed ? <p className={styles.note} role="alert" data-testid="terminal-alerts-delete-error">{failed.text}</p> : null}

      {rows.length === 0 ? (
        <PanelState kind="empty" compact testId="terminal-alerts-empty"
          title={sym ? `No price alerts on ${sym}.` : 'You have no price alerts yet.'}>
          Type <kbd>{example} ALRT 950</kbd> to be told when {example} crosses $950. Alerts ring the bell, and
          send email or Discord if you have those turned on.
          {sym ? <> <button type="button" className={styles.linkBtn} onClick={() => onRun?.('ALRT')}>See all your alerts</button>.</> : null}
        </PanelState>
      ) : (
        <div className={styles.tableBox}>
          <table className={styles.table} data-testid="terminal-alerts-table"
            aria-label={sym ? `Price alerts on ${sym}` : 'Your price alerts'}>
            <thead>
              <tr>
                <th scope="col" title="Click a symbol to load it into the linked panels">Symbol</th>
                <th scope="col">Alert</th>
                <th scope="col">Last</th>
                <th scope="col" className={styles.phoneHide} title="How far the price has to move to reach the alert">To go</th>
                <th scope="col">Status</th>
                <th scope="col"><span className="sr-only">Delete</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const last = prices[r.sym]?.price
                const dist = r.active ? distancePct(r.target, last) : null
                return (
                  <tr key={r.id} data-testid={`terminal-alerts-row-${r.id}`}>
                    <td>
                      <button type="button" className={styles.rowBtn} onClick={() => load(r.sym)} aria-current={linked === r.sym ? 'true' : undefined}
                        aria-label={`Load ${r.sym} into the linked panels`}>
                        <span className={styles.rowNum} aria-hidden="true">{i + 1}</span>
                        <span className={styles.sym}>{r.sym}</span>
                      </button>
                    </td>
                    <td>
                      {r.direction === 'above' ? 'Above' : 'Below'} {money(r.target)}
                      {KIND_TEXT[r.kind] ? <span className={styles.muted}> ({KIND_TEXT[r.kind]})</span> : null}
                    </td>
                    <td>{Number.isFinite(Number(last)) && Number(last) > 0 ? money(last) : formatNumber(null)}</td>
                    <td className={styles.phoneHide}>{formatPercent(dist, { decimals: 1, signed: true })}</td>
                    <td>
                      {r.active ? 'Active'
                        : `Triggered${r.triggeredAt ? ` ${formatDateTimeEt(Date.parse(r.triggeredAt) / 1000, { absent: '' })}` : ''}`}
                    </td>
                    <td>
                      <button type="button" className={styles.delBtn} onClick={() => remove(r)} disabled={busy === r.id}
                        aria-label={`Delete the ${r.sym} alert ${r.direction} ${money(r.target)}`}
                        data-testid={`terminal-alerts-delete-${r.id}`}>
                        {busy === r.id ? 'Deleting…' : 'Delete'}
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className={styles.muted} data-testid="terminal-alerts-method">
        Your alerts from the alert bell, the charts and the command line, all in one list. Prices from the live feed.
        Click a symbol, or type its row number, to load it into the linked panels.
        {data?.receivedAt ? ` List as of ${formatTimeEt(data.receivedAt, { zoneSuffix: 'ET', absent: '' })}.` : ''}
      </p>
    </div>
  )
}
