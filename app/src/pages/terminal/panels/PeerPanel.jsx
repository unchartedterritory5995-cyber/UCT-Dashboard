// PEER — a stock beside its peers, for relative value (wave 7, lane D).
//
// ⭐ NO NEW ROUTE. The peer list is `GET /api/groups/peers?sym=` (api/routers/groups.py, paid), the
// SAME peer engine the /charts Stock Profile and the earnings modal's profile read
// (ProfileSection.jsx / ProfileWidget.jsx): the stock's primary UCT theme, else its industry, else
// the index board, else AI-picked names, and the response says which. Prices come from the shared
// live-price store; 1W / 1M / 3M / YTD from ONE batched `POST /api/watchlist-performance`, the
// read MON already makes.
//
// The stock itself is row 1, so every peer reads against it. A symbol click loads that name into
// the linked panels (PanelSymbol), and typing its row number does the same.
//
// ⛔ A failed read is an ERROR with Retry, never "no peers": an outage and an empty group are
// different sentences. A 402 says it is part of the paid plan.
import { useMemo } from 'react'
import useSWR from 'swr'
import jsonFetcher from '../../../utils/jsonFetcher'
import useLivePrices from '../../../hooks/useLivePrices'
import {
  PanelSkeleton, PanelState, PanelSymbol, useInTerminalPanel, usePanelFreshness, usePanelSymbolRows, panelAsOf,
} from '../../../components/terminal'
import { formatNumber, formatPercent, formatTimeEt } from '../../../lib/presentation/presentationPrimitives'
import styles from './myNamesPanel.module.css'

export const PEERS_N = 12
export const peersUrl = (sym) => `/api/groups/peers?sym=${encodeURIComponent(sym)}&n=${PEERS_N}`
export const PERF_URL = '/api/watchlist-performance'

const stamped = (url) => jsonFetcher(url).then((d) => ({ body: d, receivedAt: new Date().toISOString() }))
const perfFetcher = ([url, key]) => jsonFetcher(url, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tickers: key.split(',') }),
})

/** Where the peer list came from, in plain words (the route's own `source`). */
export const SOURCE_TEXT = {
  taxonomy: 'UCT theme',
  industry: 'Same industry',
  macro: 'Index and macro board',
  ai: 'AI-picked (no theme or industry match)',
}

/** Pure: the peer names, upper-cased, de-duplicated, the stock itself removed. The route sends
 *  strings; an object row ({ sym }) is read too, as ProfileSection does. */
export function peerSyms(payload, sym) {
  const self = String(sym || '').toUpperCase()
  const seen = new Set([self])
  const out = []
  for (const p of Array.isArray(payload?.peers) ? payload.peers : []) {
    const s = String(typeof p === 'string' ? p : p?.sym || '').trim().toUpperCase()
    if (s && !seen.has(s)) { seen.add(s); out.push(s) }
  }
  return out
}

const num = (v) => (v !== null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null)
const pct = (v, decimals = 1) => formatPercent(v, { decimals, signed: true, absent: 'n/a' })
const tone = (v) => (v > 0 ? styles.up : v < 0 ? styles.down : undefined)

const COLUMNS = [
  { key: 'sym', label: 'Symbol' },
  { key: 'last', label: 'Last' },
  { key: 'pct', label: 'Today' },
  { key: 'w1', label: '1W', phoneHide: true },
  { key: 'm1', label: '1M' },
  { key: 'm3', label: '3M', phoneHide: true },
  { key: 'ytd', label: 'YTD', phoneHide: true },
]

function failureTitle(err, sym) {
  if (err?.status === 402) return 'Peers are part of the paid plan.'
  if (err?.status === 401) return 'You are signed out, so peers cannot be read. Sign in again.'
  if (err?.timedOut) return `Peers for ${sym} did not answer within 30 seconds.`
  return `Could not read the peers for ${sym} just now.`
}

export default function PeerPanel({ sym }) {
  const s = String(sym || '').trim().toUpperCase()
  const inPanel = useInTerminalPanel()
  const peers = useSWR(s ? peersUrl(s) : null, stamped, { revalidateOnFocus: false, dedupingInterval: 60 * 60 * 1000 })
  const names = useMemo(() => peerSyms(peers.data?.body, s), [peers.data, s])
  const all = useMemo(() => (s && names.length ? [s, ...names] : []), [s, names])

  const { prices } = useLivePrices(all)
  const perfKey = all.length ? [PERF_URL, all.join(',')] : null
  const perf = useSWR(perfKey, perfFetcher, { revalidateOnFocus: false, dedupingInterval: 5 * 60 * 1000 })

  const rows = useMemo(() => all.map((t) => {
    const p = prices[t] || {}
    const f = perf.data?.[t] || {}
    return { sym: t, self: t === s, last: num(p.price), pct: num(p.change_pct),
      w1: num(f['1w']), m1: num(f['1m']), m3: num(f['3m']), ytd: num(f.ytd) }
  }), [all, prices, perf.data, s])

  usePanelSymbolRows(all, `peers of ${s}`)
  const body = peers.data?.body
  const asOf = peers.data?.receivedAt || null
  usePanelFreshness(asOf && all.length
    ? panelAsOf('UCT peer groups (themes, industry), live prices, daily closes', asOf)
    : null)

  if (!s) {
    return (
      <PanelState kind="input" title="PEER needs a ticker.">
        Type one first, e.g. <kbd>NVDA PEER</kbd>
      </PanelState>
    )
  }
  if (!peers.data && !peers.error) return <PanelSkeleton label={`Finding peers for ${s}`} testId="terminal-peer-loading" />
  if (peers.error && !peers.data) {
    const paid = peers.error?.status === 402
    return (
      <PanelState kind={paid ? 'locked' : 'error'} testId="terminal-peer-error" title={failureTitle(peers.error, s)}
        action={paid ? null : <button type="button" className={styles.chip} onClick={() => peers.mutate()}>Retry</button>}>
        {paid ? null : 'That is not the same as having no peers. Retry, or run PEER again.'}
      </PanelState>
    )
  }
  if (body?.error) {
    return (
      <PanelState kind="error" testId="terminal-peer-error" title={`Could not read the peers for ${s} just now.`}
        action={<button type="button" className={styles.chip} onClick={() => peers.mutate()}>Retry</button>}>
        The peer groups are not loaded on the server yet.
      </PanelState>
    )
  }
  if (!names.length) {
    return (
      <PanelState kind="empty" role="status" testId="terminal-peer-empty" title={`No peers found for ${s}.`}>
        It is in no UCT theme and no industry group we track. Try <kbd>{s} IMOV</kbd> or <kbd>{s} REL</kbd>.
      </PanelState>
    )
  }

  const group = body?.group_name || null
  const sourceText = SOURCE_TEXT[body?.source] || null
  const alsoIn = (Array.isArray(body?.also_in) ? body.also_in : []).map((g) => g?.name).filter(Boolean)

  return (
    <div className={`${styles.wrap} ${inPanel ? styles.inPanel : ''}`} data-testid="terminal-peer">
      <div className={styles.head}>
        {group ? <strong data-testid="terminal-peer-group">{group}</strong> : null}
        {sourceText ? <span className={styles.lede} data-testid="terminal-peer-source">{sourceText}</span> : null}
      </div>
      {alsoIn.length ? <p className={styles.muted} data-testid="terminal-peer-also">{s} is also in: {alsoIn.join(', ')}.</p> : null}
      {perf.error ? <p className={styles.note} role="status">1W, 1M, 3M and YTD could not be read just now; prices are still live.</p> : null}

      <div className={styles.tableBox}>
        <table className={styles.table} data-testid="terminal-peer-table" aria-label={`${s} and its peers`}>
          <thead>
            <tr>
              {COLUMNS.map((c) => (
                <th scope="col" key={c.key} className={c.phoneHide ? styles.phoneHide : undefined}>{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.sym} data-testid={`terminal-peer-row-${r.sym}`} aria-current={r.self ? 'true' : undefined}>
                <td>
                  <span className={styles.rowNum} aria-hidden="true">{i + 1}</span>
                  <PanelSymbol sym={r.sym} className={styles.sym} />
                  {r.self ? <span className={styles.lede}> (this stock)</span> : null}
                </td>
                <td>{formatNumber(r.last, { decimals: 2, absent: 'n/a' })}</td>
                <td className={tone(r.pct)}>{pct(r.pct, 2)}</td>
                <td className={`${styles.phoneHide} ${tone(r.w1) || ''}`}>{pct(r.w1)}</td>
                <td className={tone(r.m1)}>{pct(r.m1)}</td>
                <td className={`${styles.phoneHide} ${tone(r.m3) || ''}`}>{pct(r.m3)}</td>
                <td className={`${styles.phoneHide} ${tone(r.ytd) || ''}`}>{pct(r.ytd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className={styles.muted} data-testid="terminal-peer-method">
        {s} is row 1, so each peer reads against it. Prices from the live feed; 1W to YTD from daily closes. A sign (+/-)
        marks every change, so colour is never the only signal. Click a symbol, or type its row number, to load it.
        {asOf ? ` Peers as of ${formatTimeEt(asOf, { zoneSuffix: 'ET', absent: '' })}.` : ''}
      </p>
    </div>
  )
}
