import { useState } from 'react'
import useMobileSWR from '../../hooks/useMobileSWR'
import useDarkSection from './useDarkSection'
import { sectionFetcher } from '../../components/research/sections/sectionFetch'
import styles from './optionsAnalytics.module.css'
import { formatCompact, formatTimeEt } from '../../lib/presentation/presentationPrimitives'
import OffNotice from './OffNotice'

// The tide's own ladder: B at two decimals, M at one, K whole.
const TIDE_TIERS = [{ at: 1e9, suffix: 'B', decimals: 2 }, { at: 1e6, suffix: 'M', decimals: 1 }, { at: 1e3, suffix: 'K', decimals: 0 }]

// FT-056 Market Tide: market-wide net call / net put premium by minute, COMPUTED from our flow
// tape (api/services/options_analytics/market_tide.py).
//
// ⛔ DARK: the route answers 404 until OPTIONS_MARKET_TIDE_ENABLED is set, and a 404 renders
//    NOTHING, so mounting this on the Options Flow page changes nothing while the switch is off.
// ⛔ The tape's own filters are printed on the panel, every time: this is the tide of 50+ contract,
//    $10K+ prints, not of all option volume.
// ⛔ A failed read is said in words; a source the server could not read is named.
//
// lane/o-options-remainders adds two siblings over the SAME cached tape read (tide_extras.py), each
// its OWN dark surface: FT-056 SectorTide (OPTIONS_SECTOR_TIDE_ENABLED) and FT-057 TideMinute
// (OPTIONS_TIDE_CLICKTHROUGH_ENABLED) -- a click on the tide, or a picked minute, opens that minute's
// prints. While both are off the default export renders exactly the tide it always did.

const SCOPES = [['all', 'All'], ['stocks', 'Stocks'], ['etfs', 'ETFs']]

export function money(v) {
  if (v == null || Number.isNaN(Number(v))) return '—'
  const n = Number(v)
  const a = Math.abs(n)
  const s = formatCompact(a, { tiers: TIDE_TIERS })
  return `${n < 0 ? '-' : n > 0 ? '+' : ''}$${s}`
}

/** A stale tide says WHEN it was last computed, not a bare "Refreshing." that reads as live.
 *  `computed_at` is a UTC ISO stamp (market_tide.py); `cache_age_s` is the fallback. */
export function staleText(data) {
  const at = formatTimeEt(data?.computed_at)
  if (at) return `Not updated since ${at} ET; a refresh is running.`
  const age = Number(data?.cache_age_s)
  if (Number.isFinite(age) && age > 0) {
    return `Not updated for ${Math.max(1, Math.round(age / 60))} min; a refresh is running.`
  }
  return 'Not freshly computed; a refresh is running.'
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

/** The minute under a click on the tide chart (the chart's x maps linearly onto `minutes`). */
export function minuteAt(minutes, fracX) {
  if (!minutes?.length) return null
  const x = fracX * W
  const i = Math.round(((x - PAD) / (W - 2 * PAD)) * (minutes.length - 1))
  return minutes[Math.max(0, Math.min(minutes.length - 1, i))].t
}

function TidePanel({ scope, setScope, onPickMinute }) {
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
        <ul className={styles.legend} data-testid="market-tide-legend" aria-label="Market Tide legend">
          <li><span className={`${styles.legendSwatch} ${styles.legendCall}`} aria-hidden="true" />Net call premium</li>
          <li><span className={`${styles.legendSwatch} ${styles.legendPut}`} aria-hidden="true" />Net put premium</li>
          <li><span className={`${styles.legendSwatch} ${styles.legendZero}`} aria-hidden="true" />Zero</li>
        </ul>
      )}
      {p && (
        <svg className={`${styles.chart}${onPickMinute ? ` ${styles.clickable}` : ''}`} viewBox={`0 0 ${W} ${H}`} role="img" data-testid="market-tide-chart"
          aria-label="Cumulative net call premium (green) and net put premium (red) by minute"
          onClick={onPickMinute ? (e) => {
            const r = e.currentTarget.getBoundingClientRect()
            const t = minuteAt(data.minutes, r.width ? (e.clientX - r.left) / r.width : 0)
            if (t) onPickMinute(t)
          } : undefined}>
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
        {data.stale ? <span data-testid="market-tide-stale"> {staleText(data)}</span> : ''}
      </p>
      <p className={styles.muted}>{data.method}</p>
    </section>
  )
}

// ── FT-056 per-sector tide ────────────────────────────────────────────────────

export function SectorTide({ scope }) {
  const { data, hidden, failed } = useDarkSection(`/api/options/market-tide/sectors?scope=${scope}`)
  if (hidden || (!data && !failed) || (data && !Array.isArray(data.sectors))) return null
  return (
    <section className={styles.panel} data-testid="sector-tide">
      <div className={styles.head}>
        <span className={styles.title}>Market Tide by sector</span>
        <span className={styles.badge}>computed</span>
      </div>
      {failed ? <p className={styles.note}>The sector tide is unavailable right now. That does not mean the tape is quiet.</p> : (
        <>
          {data.sectors.length ? (
            <div className={styles.scroll}>
              <table className={styles.table} data-testid="sector-tide-table">
                <thead><tr><th>Sector</th><th>Net call premium</th><th>Net put premium</th><th>Net</th><th>Prints</th></tr></thead>
                <tbody>
                  {data.sectors.map((x) => (
                    <tr key={x.sector}>
                      <th>{x.sector}</th>
                      <td>{money(x.totals.net_call_premium)}</td><td>{money(x.totals.net_put_premium)}</td>
                      <td className={x.totals.net_premium >= 0 ? styles.gain : styles.loss}>{money(x.totals.net_premium)}</td>
                      <td>{x.prints}{x.prints_unsigned ? <span className={styles.muted}> ({x.prints_unsigned} unsigned)</span> : null}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className={styles.note}>No prints on the tape for {data.session || 'the last session'}.</p>}
          {data.partial && (data.partial_reasons || []).length > 0 && <p className={styles.muted}>Partial: {data.partial_reasons.join(' ')}</p>}
          <p className={styles.muted}>{data.session} · {data.note} {data.filters}</p>
        </>
      )}
    </section>
  )
}

// ── FT-057 tide click-through ─────────────────────────────────────────────────

// The probe's answer is a list of 'HH:MM' strings; anything else (another route's body) is not armed.
const isMinuteList = (m) => Array.isArray(m) && m.every((t) => typeof t === 'string')

export function TideMinute({ scope, minute, setMinute }) {
  const probe = useDarkSection(`/api/options/market-tide/minute?scope=${scope}`)
  const armed = isMinuteList(probe.data?.minutes)
  const one = useDarkSection(armed && minute ? `/api/options/market-tide/minute?scope=${scope}&t=${encodeURIComponent(minute)}` : null)
  if (probe.hidden || !armed) return null
  const d = one.data
  return (
    <section className={styles.panel} data-testid="tide-minute">
      <div className={styles.head}>
        <span className={styles.title}>Tape at a minute</span>
        <select className={styles.select} aria-label="Tide minute" value={minute} onChange={(e) => setMinute(e.target.value)}>
          <option value="">pick a minute, or click the tide…</option>
          {probe.data.minutes.map((t) => <option key={t} value={t}>{t} ET</option>)}
        </select>
      </div>
      {one.failed && <p className={styles.note}>That minute&apos;s prints are unavailable right now.</p>}
      {d && Array.isArray(d.prints) && (
        <>
          <p className={styles.facts} data-testid="tide-minute-count">
            {d.session} {d.t} ET: {d.count} print{d.count === 1 ? '' : 's'} counted in the tide{d.note ? `. ${d.note}` : ''}
          </p>
          {d.prints.length > 0 && (
            <div className={styles.scroll}>
              <table className={styles.table} data-testid="tide-minute-prints">
                <thead><tr><th>Ticker</th><th>Contract</th><th>Side</th><th>Premium</th><th>Contracts</th><th>Type</th></tr></thead>
                <tbody>
                  {d.prints.map((p, i) => (
                    <tr key={`${p.symbol}-${p.time}-${i}`}>
                      <th>{p.symbol}</th><td>{p.type} {p.strike} {p.expiration}</td><td>{p.side}</td>
                      <td>{money(p.premium)}</td><td>{p.contracts}</td><td>{p.trade_type}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
      <p className={styles.muted}>{probe.data.filters}</p>
    </section>
  )
}

// `offNotice`: set by the terminal's TIDE, which opens this panel on its own. When the tide and both
// siblings answer 404 it says so; on the Options Flow page it stays absent.
export default function MarketTidePanel({ offNotice = false }) {
  const [scope, setScope] = useState('all')
  const [minute, setMinute] = useState('')
  // the same key TideMinute probes (SWR shares the one request): the chart is clickable exactly
  // while the click-through's switch is on
  const probe = useDarkSection(`/api/options/market-tide/minute?scope=${scope}`)
  const clickable = isMinuteList(probe.data?.minutes)
  return (
    <>
      {offNotice && <OffNotice feature="Market Tide" urls={[
        `/api/options/market-tide?scope=${scope}`,
        `/api/options/market-tide/sectors?scope=${scope}`,
        `/api/options/market-tide/minute?scope=${scope}`,
      ]} />}
      <TidePanel scope={scope} setScope={setScope} onPickMinute={clickable ? setMinute : undefined} />
      <SectorTide scope={scope} />
      <TideMinute scope={scope} minute={minute} setMinute={setMinute} />
    </>
  )
}
