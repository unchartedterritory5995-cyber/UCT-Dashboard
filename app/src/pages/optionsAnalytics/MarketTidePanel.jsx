import { useState } from 'react'
import useMobileSWR from '../../hooks/useMobileSWR'
import { sectionFetcher } from '../../components/research/sections/sectionFetch'
import styles from './optionsAnalytics.module.css'

// FT-056 Market Tide: market-wide net call / net put premium by minute, COMPUTED from our flow
// tape (api/services/options_analytics/market_tide.py).
//
// ⛔ DARK: the route answers 404 until OPTIONS_MARKET_TIDE_ENABLED is set, and a 404 renders
//    NOTHING, so mounting this on the Options Flow page changes nothing while the switch is off.
// ⛔ The tape's own filters are printed on the panel, every time: this is the tide of 50+ contract,
//    $10K+ prints, not of all option volume.
// ⛔ A failed read is said in words; a source the server could not read is named.

const SCOPES = [['all', 'All'], ['stocks', 'Stocks'], ['etfs', 'ETFs']]

export function money(v) {
  if (v == null || Number.isNaN(Number(v))) return '—'
  const n = Number(v)
  const a = Math.abs(n)
  const s = a >= 1e9 ? `${(a / 1e9).toFixed(2)}B` : a >= 1e6 ? `${(a / 1e6).toFixed(1)}M`
    : a >= 1e3 ? `${(a / 1e3).toFixed(0)}K` : `${Math.round(a)}`
  return `${n < 0 ? '-' : n > 0 ? '+' : ''}$${s}`
}

const W = 720
const H = 200
const PAD = 28

export function tidePaths(minutes) {
  if (!minutes || minutes.length < 2) return null
  const calls = minutes.map((m) => m.cum_net_call_premium)
  const puts = minutes.map((m) => m.cum_net_put_premium)
  const lo = Math.min(0, ...calls, ...puts)
  const hi = Math.max(0, ...calls, ...puts)
  const span = hi - lo || 1
  const x = (i) => PAD + (i / (minutes.length - 1)) * (W - 2 * PAD)
  const y = (v) => H - PAD - ((v - lo) / span) * (H - 2 * PAD)
  const path = (vals) => vals.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  return { call: path(calls), put: path(puts), zeroY: y(0) }
}

export default function MarketTidePanel() {
  const [scope, setScope] = useState('all')
  const { data, error } = useMobileSWR(`/api/options/market-tide?scope=${scope}`, sectionFetcher,
    { refreshInterval: 60_000, revalidateOnFocus: false })

  if (error?.status === 404 || data?.paywalled) return null
  const head = (
    <div className={styles.head}>
      <span className={styles.title}>Market Tide</span>
      <span className={styles.badge}>computed</span>
      <span className={styles.seg} role="group" aria-label="Tide scope">
        {SCOPES.map(([k, l]) => (
          <button key={k} type="button" aria-pressed={scope === k} onClick={() => setScope(k)}>{l}</button>
        ))}
      </span>
    </div>
  )
  if (error) {
    return <section className={styles.panel} data-testid="market-tide">{head}
      <p className={styles.note} data-testid="market-tide-unavailable">
        Market Tide is unavailable right now. That does not mean the tape is quiet.
      </p></section>
  }
  if (!data) return <section className={styles.panel} data-testid="market-tide">{head}<p className={styles.note}>Reading the tape…</p></section>
  // A body that is not a tide (an HTML page, another route's JSON) renders nothing rather
  // than crashing the Options Flow page it is mounted on.
  if (!Array.isArray(data.minutes)) return null

  const p = tidePaths(data.minutes)
  const t = data.totals || {}
  const last = data.minutes[data.minutes.length - 1]
  return (
    <section className={styles.panel} data-testid="market-tide">
      {head}
      {data.session ? (
        <p className={styles.facts} data-testid="market-tide-totals">
          {data.session}{last ? ` through ${last.t} ET` : ''}: net call premium{' '}
          <b className={t.net_call_premium >= 0 ? styles.gain : styles.loss}>{money(t.net_call_premium)}</b>,
          net put premium{' '}
          <b className={t.net_put_premium > 0 ? styles.loss : styles.gain}>{money(t.net_put_premium)}</b>,
          net <b className={t.net_premium >= 0 ? styles.gain : styles.loss}>{money(t.net_premium)}</b>
        </p>
      ) : <p className={styles.note}>No prints on the tape for the last session.</p>}
      {p && (
        <svg className={styles.chart} viewBox={`0 0 ${W} ${H}`} role="img" data-testid="market-tide-chart"
          aria-label="Cumulative net call premium (green) and net put premium (red) by minute">
          <line className={styles.axis} x1={PAD} x2={W - PAD} y1={p.zeroY} y2={p.zeroY} />
          <path className={styles.lineCall} d={p.call} />
          <path className={styles.linePut} d={p.put} />
        </svg>
      )}
      {data.partial && (data.partial_reasons || []).length > 0 && (
        <p className={styles.muted} data-testid="market-tide-partial">Partial: {data.partial_reasons.join(' ')}</p>
      )}
      <p className={styles.muted} data-testid="market-tide-filters">
        {data.filters} {data.prints_counted} prints counted, {data.prints_unsigned} at the mid or unsided (counted, not signed).
        {data.stale ? ' Refreshing.' : ''}
      </p>
      <p className={styles.muted}>{data.method}</p>
    </section>
  )
}
