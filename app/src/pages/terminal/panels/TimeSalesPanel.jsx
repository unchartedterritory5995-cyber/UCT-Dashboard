// TAS — Time & Sales: the live trade tape for one security (COV-08 / FT-077, the T&S half;
// owner approval 2026-10-12. Level II / the order book is not part of it).
//
// ⭐ ONE STREAM PER OPEN PANEL, AND ONLY WHILE IT CAN BE SEEN. The panel opens an EventSource on
// `/api/stream/time-and-sales/{sym}` (api/routers/time_and_sales.py) and closes it on unmount,
// on a ticker change and while the browser tab is hidden (reopened on return; the snapshot the
// server sends on every open refills the list). The server subscribes a ticker upstream only
// while some panel watches it, and pushes at most 4 batches a second.
//
// ⛔ THE SIDE COLUMN IS THE TICK TEST, AND SAYS SO. No stock quote feed is subscribed, so a print
// cannot be placed at the bid or the ask. Each print is marked uptick / downtick against the
// previous print (zero ticks inherit the last direction). The method line under the table states
// it; nothing here says "buy", "sell", "bid" or "ask".
//
// ⛔ DARK BY DEFAULT. With TIME_AND_SALES_ENABLED unset the server answers one `unavailable`
// event ("off") and the panel says so; no shell flag, the same shape as MOVE.
import { useEffect, useMemo, useState } from 'react'
import { PanelSkeleton, PanelState, useInTerminalPanel, usePanelFreshness, panelAsOf } from '../../../components/terminal'
import {
  TAS_CAP, fromSnapshot, mergePrints, printPrice, printSize, printTimeEt, sessionLine, sizeLabel, tickOf, unavailableText,
} from './timeSalesModel'
import styles from './timeSalesPanel.module.css'

export const tasStreamUrl = (sym) => `/api/stream/time-and-sales/${encodeURIComponent(sym)}`

function pageHidden() {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden'
}

/** The live tape for `sym`: { status, prints (newest first), session, reason, lastAt }.
 *  `attempt` re-opens the stream when it changes (the Retry button). */
export function useTimeAndSales(sym, attempt = 0) {
  const [state, setState] = useState({ status: 'connecting', prints: [], session: null, reason: null, lastAt: null })
  const [hidden, setHidden] = useState(pageHidden)

  useEffect(() => {
    if (typeof document === 'undefined') return undefined
    const onVis = () => setHidden(pageHidden())
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [])

  useEffect(() => {
    if (!sym) return undefined
    if (hidden) {
      setState((s) => ({ ...s, status: s.status === 'unavailable' ? s.status : 'paused' }))
      return undefined
    }
    if (typeof EventSource === 'undefined') {
      setState((s) => ({ ...s, status: 'failed' }))
      return undefined
    }
    // A new ticker starts empty; the same ticker (tab shown again, Retry) keeps its rows on screen
    // until the snapshot replaces them.
    setState((s) => (s.sym === sym && s.prints.length
      ? { ...s, status: 'reconnecting', reason: null }
      : { status: 'connecting', prints: [], session: null, reason: null, lastAt: null, sym }))
    let heard = false
    let closed = false
    const es = new EventSource(tasStreamUrl(sym))
    const read = (e) => { try { return JSON.parse(e.data) } catch { return null } }
    const stamp = () => new Date().toISOString()

    es.addEventListener('snapshot', (e) => {
      const d = read(e)
      if (!d) return
      heard = true
      setState({ status: 'live', prints: fromSnapshot(d.prints, TAS_CAP), session: d.session || null, reason: null, lastAt: stamp(), sym })
    })
    es.onmessage = (e) => {
      const d = read(e)
      if (!d) return
      heard = true
      setState((s) => ({ ...s, status: 'live', prints: mergePrints(s.prints, d.prints, TAS_CAP), session: d.session || s.session, lastAt: stamp() }))
    }
    es.addEventListener('heartbeat', (e) => {
      const d = read(e)
      heard = true
      setState((s) => ({ ...s, status: 'live', session: d?.session || s.session }))
    })
    es.addEventListener('unavailable', (e) => {
      const d = read(e)
      closed = true
      es.close()   // a refusal is final for this open: no automatic reconnect loop
      setState((s) => ({ ...s, status: 'unavailable', reason: d?.reason || null }))
    })
    es.onerror = () => {
      if (closed) return
      // CLOSED: the server refused the request outright (signed out, not paid, 4xx) — the browser
      // will not retry. CONNECTING: a dropped stream the browser is already reopening.
      if (es.readyState === 2) {
        closed = true
        setState((s) => ({ ...s, status: heard ? 'dropped' : 'failed' }))
      } else {
        setState((s) => ({ ...s, status: 'reconnecting' }))
      }
    }
    return () => { closed = true; es.close() }
  }, [sym, hidden, attempt])

  return state
}

export default function TimeSalesPanel({ sym }) {
  const s = String(sym || '').trim().toUpperCase()
  const inPanel = useInTerminalPanel()
  const [retry, setRetry] = useState(0)
  const tape = useTimeAndSales(s, retry)
  usePanelFreshness(tape.lastAt ? panelAsOf('Massive trade feed (live)', tape.lastAt) : null)
  const rows = tape.prints
  const counts = useMemo(() => ({
    large: rows.filter((r) => r.b === 1).length,
    block: rows.filter((r) => r.b === 2).length,
  }), [rows])

  if (!s) {
    return (
      <PanelState kind="input" title="TAS needs a ticker.">
        Type one first, e.g. <kbd>NVDA TAS</kbd>
      </PanelState>
    )
  }
  if (tape.status === 'unavailable') {
    const t = unavailableText(tape.reason)
    return (
      <PanelState kind="locked" role="status" testId="terminal-tas-unavailable" title={t.title}>
        {t.body}
      </PanelState>
    )
  }
  if (tape.status === 'failed') {
    return (
      <PanelState kind="error" testId="terminal-tas-error"
        title={`Could not open the live tape for ${s}.`}
        action={<button type="button" className={styles.chip} onClick={() => setRetry((n) => n + 1)}>Retry</button>}>
        You may be signed out, or the server did not answer. That is not the same as no trades. Run {s} TAS again to retry.
      </PanelState>
    )
  }
  if (tape.status === 'connecting') return <PanelSkeleton label={`Opening the live tape for ${s}`} testId="terminal-tas-loading" />

  const closed = tape.session === 'closed'
  return (
    <div className={`${styles.wrap} ${inPanel ? styles.inPanel : ''}`} data-testid="terminal-tas">
      <div className={styles.head}>
        <span className={styles.session} data-testid="terminal-tas-session">{sessionLine(tape.session, rows.length > 0)}</span>
        <span className={styles.lede} data-testid="terminal-tas-link" role="status">
          {tape.status === 'live' ? 'Live' : tape.status === 'paused' ? 'Paused while this tab is hidden' : tape.status === 'reconnecting' ? 'Reconnecting…' : 'Stream ended'}
        </span>
      </div>
      {rows.length === 0 ? (
        <PanelState kind="empty" role="status" testId="terminal-tas-empty"
          title={closed ? 'No prints yet.' : `Waiting for the first print in ${s}.`}>
          {closed
            ? `This server has not seen a trade in ${s} since it started. Prints appear here live when the market opens.`
            : 'Prints appear here the moment they trade.'}
        </PanelState>
      ) : (
        <div className={styles.tableBox}>
          <table className={styles.table} data-testid="terminal-tas-table" aria-label={`Time and sales for ${s}, newest first`}>
            <thead>
              <tr>
                <th scope="col">Time (ET)</th>
                <th scope="col">Price</th>
                <th scope="col">Size</th>
                <th scope="col">Tick</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const tk = tickOf(r.d)
                const big = sizeLabel(r.b)
                const cls = [
                  tk.tone ? styles[tk.tone] : '',
                  r.b === 2 ? styles.block : r.b === 1 ? styles.large : '',
                  r.o ? styles.odd : '',
                ].filter(Boolean).join(' ')
                return (
                  <tr key={r.seq} className={cls} data-testid={`terminal-tas-row-${r.seq}`} data-size-tier={r.b || 0}>
                    <td>{printTimeEt(r.t)}</td>
                    <td>{printPrice(r.p)}</td>
                    <td>
                      {printSize(r.s)}
                      {big ? <span className={styles.bigTag} title={big}>{r.b === 2 ? 'BLOCK' : 'LARGE'}</span> : null}
                      {r.o ? <span className={styles.oddTag} title="Odd lot (under 100 shares)">odd</span> : null}
                    </td>
                    <td><span aria-hidden="true">{tk.mark}</span> <span className={styles.tickWord}>{tk.label}</span></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className={styles.muted} data-testid="terminal-tas-counts">
        {rows.length} print{rows.length === 1 ? '' : 's'} shown (newest {TAS_CAP} kept)
        {counts.large || counts.block ? `, ${counts.large} large and ${counts.block} block` : ''}.
      </p>
      <p className={styles.muted} data-testid="terminal-tas-method">
        Tick column: each print against the previous print — uptick, downtick, or a zero tick that keeps the last direction.
        It is not the bid or the ask; no quote feed is used. Large = at least $200K or 10,000 shares; block = at least $1M.
        Source: the Massive consolidated trade feed.
      </p>
    </div>
  )
}
