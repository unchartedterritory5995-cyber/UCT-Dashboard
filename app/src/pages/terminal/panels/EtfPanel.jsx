// ETF: a security's ETF exposure (wave 7, lane D).
//
//   NVDA ETF   the leveraged and inverse ETFs built on NVDA (and, if NVDA were an ETF, its holdings)
//   SMH ETF    what SMH holds, top weights first
//   NVDL ETF   NVDL is a leveraged ETF on NVDA: the whole NVDA family, NVDL marked
//
// ⭐ NO NEW ROUTE. Three reads the app already serves: `GET /api/etf/holdings/{sym}` (any member;
// the chart's View Holdings list, api/routers/etf.py), `GET /api/single-stock-etfs/{sym}` (paid; the
// chart's Leverage / Inverse pill) and `GET /api/etf/symbols` (the chart's own is-it-an-ETF gate).
// EtfHoldingsResults.jsx is NOT embedded: it mounts the whole Watchlists page inside the /charts
// workspace contexts, which a terminal panel does not have.
//
// ⛔ HONEST GAPS. There is no route that lists which index ETFs hold a stock, so this panel says so
// rather than implying none do. The holdings route answers an empty list both for a non-ETF and when
// its vendor is down, so an ETF with no holdings is an error with Retry, never "holds nothing".
import { useMemo } from 'react'
import useSWR from 'swr'
import jsonFetcher from '../../../utils/jsonFetcher'
import {
  PanelSkeleton, PanelState, PanelSymbol, useInTerminalPanel, usePanelFreshness, usePanelSymbolRows,
} from '../../../components/terminal'
import { formatCompactTerminal, formatNumberMax, formatTimeEt } from '../../../lib/presentation/presentationPrimitives'
import styles from './myNamesPanel.module.css'

export const holdingsUrl = (sym) => `/api/etf/holdings/${encodeURIComponent(sym)}`
export const familyUrl = (sym) => `/api/single-stock-etfs/${encodeURIComponent(sym)}`
export const ETF_SYMBOLS_URL = '/api/etf/symbols'
/** Holdings shown; the rest are counted, never silently dropped. */
export const HOLDINGS_SHOWN = 25

const stamped = (url) => jsonFetcher(url).then((d) => ({ body: d, receivedAt: new Date().toISOString() }))
const SWR_OPTS = { revalidateOnFocus: false, dedupingInterval: 10 * 60 * 1000 }

/** Pure: the single-stock ETF family as rows, long first, each with its side. */
export function familyRows(family) {
  const side = (list, dir) => (Array.isArray(list) ? list : [])
    .filter((r) => r && r.ticker)
    .map((r) => ({ ticker: String(r.ticker).toUpperCase(), name: r.name || '', factor: r.factor, vol: r.avg_dollar_vol, dir }))
  return [...side(family?.long, 'Long'), ...side(family?.short, 'Short')]
}

const factorText = (f) => (Number.isFinite(Number(f)) && f !== null ? `${formatNumberMax(Number(f), { maxDecimals: 2, absent: '' })}x` : 'n/a')
const weightText = (w) => (Number.isFinite(Number(w)) && w !== null ? `${formatNumberMax(Number(w), { maxDecimals: 2, absent: '' })}%` : 'n/a')

function familyNote(err) {
  if (err?.status === 402) return 'The leveraged and inverse ETF list is part of the paid plan.'
  if (err?.timedOut) return 'The leveraged and inverse ETF list did not answer within 30 seconds.'
  return 'The leveraged and inverse ETF list could not be read just now.'
}

export default function EtfPanel({ sym }) {
  const s = String(sym || '').trim().toUpperCase()
  const inPanel = useInTerminalPanel()
  const holdings = useSWR(s ? holdingsUrl(s) : null, stamped, SWR_OPTS)
  const family = useSWR(s ? familyUrl(s) : null, stamped, SWR_OPTS)
  const etfs = useSWR(s ? ETF_SYMBOLS_URL : null, jsonFetcher, { revalidateOnFocus: false, dedupingInterval: 60 * 60 * 1000 })

  const held = useMemo(() => (Array.isArray(holdings.data?.body?.holdings) ? holdings.data.body.holdings : [])
    .filter((h) => h && h.sym), [holdings.data])
  const fam = useMemo(() => familyRows(family.data?.body), [family.data])
  const underlying = String(family.data?.body?.underlying || '').toUpperCase() || null
  const knownEtf = Array.isArray(etfs.data?.symbols) ? etfs.data.symbols.includes(s) : null
  const isEtf = held.length > 0 || knownEtf === true
  const shown = held.slice(0, HOLDINGS_SHOWN)

  usePanelSymbolRows([...fam.map((r) => r.ticker), ...shown.map((h) => h.sym)], `ETF exposure of ${s}`)
  const asOf = holdings.data?.receivedAt || family.data?.receivedAt || null
  usePanelFreshness(asOf && (held.length || fam.length)
    ? { source: 'FMP ETF holdings, UCT single-stock ETF map', observedAt: asOf }
    : null)

  if (!s) {
    return (
      <PanelState kind="input" title="ETF needs a ticker.">
        Type one first, e.g. <kbd>NVDA ETF</kbd> or <kbd>SMH ETF</kbd>
      </PanelState>
    )
  }
  const settled = (q) => q.data !== undefined || q.error !== undefined
  if (!settled(holdings) || !settled(family)) {
    return <PanelSkeleton label={`Reading ETF exposure for ${s}`} testId="terminal-etf-loading" />
  }
  const retryAll = () => { holdings.mutate(); family.mutate(); etfs.mutate() }
  const retry = <button type="button" className={styles.chip} onClick={retryAll}>Retry</button>
  if (holdings.error && family.error && family.error?.status !== 402) {
    return (
      <PanelState kind="error" testId="terminal-etf-error" title={`Could not read ETF exposure for ${s} just now.`} action={retry}>
        That is not the same as having none. Retry, or run {s} ETF again.
      </PanelState>
    )
  }

  const leveragedEtf = underlying && underlying !== s
  const familyEmpty = !family.error && fam.length === 0
  const holdingsMissing = isEtf && held.length === 0

  return (
    <div className={`${styles.wrap} ${inPanel ? styles.inPanel : ''}`} data-testid="terminal-etf">
      <section aria-labelledby="terminal-etf-family-h">
        <h3 id="terminal-etf-family-h" className={styles.lede}>
          {leveragedEtf ? `${s} is a leveraged ETF on ${underlying}. The ${underlying} family:` : `Leveraged and inverse ETFs on ${s}`}
        </h3>
        {family.error ? (
          <p className={styles.note} role="status" data-testid="terminal-etf-family-error">{familyNote(family.error)}</p>
        ) : familyEmpty ? (
          <p className={styles.muted} data-testid="terminal-etf-family-empty">No leveraged or inverse ETFs track {s}.</p>
        ) : (
          <div className={styles.tableBox}>
            <table className={styles.table} data-testid="terminal-etf-family" aria-label={`Leveraged and inverse ETFs on ${leveragedEtf ? underlying : s}`}>
              <thead>
                <tr>
                  <th scope="col">ETF</th>
                  <th scope="col">Side</th>
                  <th scope="col">Factor</th>
                  <th scope="col" className={styles.phoneHide}>Avg $ volume</th>
                  <th scope="col" className={styles.phoneHide}>Name</th>
                </tr>
              </thead>
              <tbody>
                {fam.map((r, i) => (
                  <tr key={r.ticker} data-testid={`terminal-etf-family-row-${r.ticker}`} aria-current={r.ticker === s ? 'true' : undefined}>
                    <td><span className={styles.rowNum} aria-hidden="true">{i + 1}</span><PanelSymbol sym={r.ticker} className={styles.sym} />{r.ticker === s ? <span className={styles.lede}> (this one)</span> : null}</td>
                    <td>{r.dir}</td>
                    <td>{factorText(r.factor)}</td>
                    <td className={styles.phoneHide}>{formatCompactTerminal(Number.isFinite(Number(r.vol)) && r.vol !== null ? Number(r.vol) : NaN, { money: true, absent: 'n/a' })}</td>
                    <td className={styles.phoneHide}>{r.name || 'n/a'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-labelledby="terminal-etf-holdings-h">
        <h3 id="terminal-etf-holdings-h" className={styles.lede}>{isEtf ? `What ${s} holds` : `Index ETFs that hold ${s}`}</h3>
        {holdings.error || holdingsMissing ? (
          <PanelState kind="error" compact testId="terminal-etf-holdings-error" action={retry}
            title={`Could not read the holdings of ${s} just now.`}>
            The holdings source may be down. That is not the same as holding nothing.
          </PanelState>
        ) : !isEtf ? (
          <p className={styles.muted} data-testid="terminal-etf-no-reverse">
            We do not have a list of which index ETFs hold {s} yet. Run an ETF ticker, e.g. <kbd>SMH ETF</kbd>, to see its holdings.
          </p>
        ) : (
          <div className={styles.tableBox}>
            <table className={styles.table} data-testid="terminal-etf-holdings" aria-label={`Holdings of ${s}`}>
              <thead>
                <tr>
                  <th scope="col">Symbol</th>
                  <th scope="col">Weight</th>
                  <th scope="col" className={styles.phoneHide}>Name</th>
                  <th scope="col" className={styles.phoneHide}>Sector</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((h, i) => (
                  <tr key={h.sym} data-testid={`terminal-etf-holding-${h.sym}`}>
                    <td><span className={styles.rowNum} aria-hidden="true">{fam.length + i + 1}</span><PanelSymbol sym={h.sym} className={styles.sym} /></td>
                    <td>{weightText(h.weight)}</td>
                    <td className={styles.phoneHide}>{h.name || 'n/a'}</td>
                    <td className={styles.phoneHide}>{h.sector || 'n/a'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {held.length > HOLDINGS_SHOWN ? (
          <p className={styles.muted} data-testid="terminal-etf-more">Showing the top {HOLDINGS_SHOWN} of {held.length} holdings by weight.</p>
        ) : null}
      </section>

      <p className={styles.muted} data-testid="terminal-etf-method">
        Holdings from FMP (US-listed names only); the leveraged and inverse list is the one the chart&apos;s Leverage pill uses.
        Click a symbol, or type its row number, to load it.
        {asOf ? ` Read at ${formatTimeEt(asOf, { zoneSuffix: 'ET', absent: '' })}.` : ''}
      </p>
    </div>
  )
}
