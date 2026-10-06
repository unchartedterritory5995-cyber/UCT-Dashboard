import { useState } from 'react'
import useSWR from 'swr'
import { sectionFetcher } from '../../../components/research/sections/sectionFetch'
import CoverageLine from '../../../components/provenance/CoverageLine'
import { OffLine } from '../../optionsAnalytics/OffNotice'
import { useInTerminalPanel } from '../../../components/terminal'
import styles from './OptionsScreener.module.css'
import { formatPercent } from '../../../lib/presentation/presentationPrimitives'
import { num } from '../../optionsAnalytics/optionsFormat'

// COV-02 (screen the OPTION, not the stock) + COV-03 (market-wide unusual option volume and
// IV percentile), read ONLY from our own options log (api/services/research/options_screener.py).
//
// ⛔ DARK: mounted only while `options_screener_enabled` rides the auth payload (Screener.jsx),
//    and every route answers 404 until OPTIONS_SCREENER_ENABLED is set.
// ⛔ END-OF-DAY: every row carries its session date and the words "end-of-day"; this is the
//    close-of-session snapshot, not a live chain.
// ⛔ NO NUMBER BELOW ITS MINIMUM: the unusual-volume ratio needs 10 prior sessions and the IV
//    percentile needs 20; below that the row says how many it has, never a number.
// ⛔ READ-ONLY: no trade buttons. Nothing here places, stages or simulates an order.
// ⛔ Polling: none. The log grows once a trading day; bare useSWR with no refreshInterval.

const VIEWS = [['screen', 'Option screen'], ['volume', 'Unusual volume'], ['iv', 'IV percentile']]

const FIELDS = [
  ['underlyings', 'Underlyings (comma list, blank = all)', 'text'],
  ['dte_min', 'DTE min', 'number'], ['dte_max', 'DTE max', 'number'],
  ['otm_min', 'OTM % min', 'number'], ['otm_max', 'OTM % max', 'number'],
  ['delta_min', '|Δ| min', 'number'], ['delta_max', '|Δ| max', 'number'],
  ['spread_max', 'Spread % max', 'number'],
  ['oi_min', 'OI min', 'number'], ['volume_min', 'Volume min', 'number'],
  ['iv_min', 'IV % min', 'number'], ['iv_max', 'IV % max', 'number'],
]

// A fraction rendered as a percent through the shared formatter (em dash when absent).
const pct = (v, d = 1) => formatPercent(v == null ? NaN : Number(v) * 100, { decimals: d })
const int = (v) => (v == null ? '—' : Math.round(Number(v)).toLocaleString('en-US'))

export function screenUrl(preset, filters) {
  const q = new URLSearchParams()
  if (preset) q.set('preset', preset)
  for (const [k, v] of Object.entries(filters)) if (v !== '' && v != null) q.set(k, v)
  if (filters.type === 'any') q.delete('type')
  const s = q.toString()
  return `/api/options-screener/screen${s ? `?${s}` : ''}`
}

// Quality pass 2026-10-05: a 404 here is the route's switch being off
// (OPTIONS_SCREENER_ENABLED), not a failure -- it used to read "unavailable right now".
function ReadFailed({ error, what }) {
  if (error?.status === 404) return <OffLine feature={`The ${what}`} />
  return <Unavailable what={what} />
}

function Unavailable({ what }) {
  return <p className={styles.note} data-testid="opts-unavailable">
    The {what} is unavailable right now. That does not mean there is nothing to show.
  </p>
}

function Screen() {
  const [preset, setPreset] = useState('high_iv_short_premium')
  const [draft, setDraft] = useState({ type: 'any' })
  const [filters, setFilters] = useState({})
  const url = screenUrl(preset, filters)
  const { data, error } = useSWR(url, sectionFetcher, { revalidateOnFocus: false })

  const presets = data?.presets || {}
  return (
    <div data-testid="opts-screen">
      <div className={styles.chips} role="group" aria-label="Preset screens">
        {Object.entries(presets).map(([k, p]) => (
          <button key={k} type="button" className={k === preset ? styles.chipOn : styles.chip}
            aria-pressed={k === preset} title={p.description} onClick={() => setPreset(k)}>{p.label}</button>
        ))}
        <button type="button" className={!preset ? styles.chipOn : styles.chip} aria-pressed={!preset}
          onClick={() => setPreset('')}>Custom</button>
      </div>
      {preset && presets[preset] && <p className={styles.muted} data-testid="opts-preset-desc">{presets[preset].description}</p>}
      <form className={styles.form} onSubmit={(e) => { e.preventDefault(); setFilters(draft) }}>
        <label>Type{' '}
          <select value={draft.type || 'any'} onChange={(e) => setDraft({ ...draft, type: e.target.value })}>
            <option value="any">Any</option><option value="call">Calls</option><option value="put">Puts</option>
          </select>
        </label>
        {FIELDS.map(([k, label, kind]) => (
          <label key={k} className={kind === 'text' ? styles.wide : undefined}>{label}{' '}
            <input type={kind} step="any" value={draft[k] ?? ''} aria-label={label}
              onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} />
          </label>
        ))}
        <button type="submit" className={styles.apply}>Apply filters</button>
        <span className={styles.muted}>{preset ? 'Filters refine the preset.' : ''}</span>
      </form>
      {error?.status === 422 && <p className={styles.note} data-testid="opts-bad">A filter value could not be read.</p>}
      {error && error.status !== 422 && <ReadFailed error={error} what="option screener" />}
      {data?.paywalled && <p className={styles.note}>The option screener requires a paid plan.</p>}
      {!error && !data && <p className={styles.note}>Loading the screen…</p>}
      {data && data.status === 'no_screen' && <p className={styles.note} data-testid="opts-no-screen">{data.note}</p>}
      {data && data.status === 'ok' && (
        <>
          <p className={styles.facts} data-testid="opts-session">
            {int(data.matched)} contracts matched · showing {int(data.shown)} · session {data.session} (end-of-day snapshot)
          </p>
          <div className={styles.scroll}>
            <table className={styles.grid}>
              <thead><tr>
                <th>Session</th><th>Contract</th><th>Und</th><th>Type</th><th>Strike</th><th>Exp</th><th>DTE</th>
                <th>OTM %</th><th>Δ</th><th>IV</th><th>Bid</th><th>Ask</th><th>Spread %</th><th>OI</th><th>Vol</th>
              </tr></thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.contract}>
                    <td className={styles.session}>{r.session} EOD</td>
                    <td className={styles.left}>{r.contract.replace(/^O:/, '')}</td>
                    <td className={styles.left}>{r.underlying}</td><td>{r.type}</td><td>{num(r.strike)}</td>
                    <td>{r.expiration}</td><td>{r.dte}</td><td>{num(r.otm_pct, 1)}</td><td>{num(r.delta, 3)}</td>
                    <td>{pct(r.iv)}</td><td>{num(r.bid)}</td><td>{num(r.ask)}</td><td>{num(r.spread_pct, 1)}</td>
                    <td>{int(r.open_interest)}</td><td>{int(r.volume)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <CoverageLine coverage={data.coverage} />
          <p className={styles.muted}>{data.note} {data.screen_rule} Source: {data.source}.</p>
        </>
      )}
    </div>
  )
}

function Volume() {
  const { data, error } = useSWR('/api/options-screener/unusual-volume', sectionFetcher, { revalidateOnFocus: false })
  if (error) return <ReadFailed error={error} what="unusual-volume ranking" />
  if (!data) return <p className={styles.note}>Loading the unusual-volume ranking…</p>
  if (data.paywalled) return <p className={styles.note}>The option rankings require a paid plan.</p>
  if (data.status !== 'ok') return <p className={styles.note} data-testid="opts-vol-none">{data.note}</p>
  const rows = data.ranked.length ? data.ranked : data.not_ranked
  return (
    <div data-testid="opts-volume">
      <p className={styles.facts} data-testid="opts-vol-state">
        Session {data.session} (end-of-day) · {data.sessions_logged} sessions logged
        {data.ranked.length === 0 && data.available_on ? ` · the ratio becomes available on ${data.available_on} if every session from here is logged` : ''}
      </p>
      {data.note && <p className={styles.note} data-testid="opts-vol-note">{data.note}</p>}
      {/* ⛔ WHICH VOLUME, IN WORDS: the log's own, or the flow tape's large prints only. */}
      <p className={styles.facts} data-testid="opts-vol-source">
        {data.volume_rule}{data.fallback_note ? ` ${data.fallback_note}` : ''}
      </p>
      <div className={styles.scroll}>
        <table className={styles.grid}>
          <thead><tr><th>Session</th><th>Underlying</th><th>Volume</th><th>Calls</th><th>Puts</th><th>Own average</th><th>Ratio</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.underlying}>
                <td className={styles.session}>{r.session} EOD</td>
                <td className={styles.left}>{r.underlying}</td><td>{int(r.volume)}</td>
                <td>{int(r.call_volume)}</td><td>{int(r.put_volume)}</td>
                <td>{r.average == null ? '—' : int(r.average)}</td>
                <td data-testid="opts-vol-ratio">{r.ratio != null ? `${num(r.ratio, 2)}× over ${r.n_sessions} sessions` : r.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <CoverageLine coverage={data.coverage} />
      {data.missing_sessions?.length > 0 && <p className={styles.muted}>Not logged: {data.missing_sessions.join(', ')}.</p>}
      <p className={styles.muted}>{data.method} Source: {data.source}.</p>
    </div>
  )
}

function Iv() {
  const { data, error } = useSWR('/api/options-screener/iv-percentile', sectionFetcher, { revalidateOnFocus: false })
  if (error) return <ReadFailed error={error} what="IV percentile ranking" />
  if (!data) return <p className={styles.note}>Loading the IV percentile ranking…</p>
  if (data.paywalled) return <p className={styles.note}>The option rankings require a paid plan.</p>
  if (data.status !== 'ok') return <p className={styles.note} data-testid="opts-iv-none">{data.note}</p>
  return (
    <div data-testid="opts-iv">
      <p className={styles.facts} data-testid="opts-iv-state">
        Session {data.session} (end-of-day) · {data.rankable_sessions} sessions logged under the current ATM read
        {data.ranked.length === 0 && data.available_on ? ` · the percentile becomes available on ${data.available_on} if every session from here is logged` : ''}
      </p>
      {data.note && <p className={styles.note} data-testid="opts-iv-note">{data.note}</p>}
      {data.ranked.length > 0 && (
        <div className={styles.scroll}>
          <table className={styles.grid}>
            <thead><tr><th>Session</th><th>Underlying</th><th>ATM IV</th><th>Percentile</th><th>Bucket</th><th>Sessions</th></tr></thead>
            <tbody>
              {data.ranked.map((r) => (
                <tr key={r.underlying}>
                  <td className={styles.session}>{r.session} EOD</td>
                  <td className={styles.left}>{r.underlying}</td><td>{pct(r.atm_iv)}</td>
                  <td>{num(r.iv_percentile, 0)}</td><td>{r.bucket}</td><td>{r.n_sessions}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <CoverageLine coverage={data.coverage} />
      <p className={styles.muted}>{data.method} Source: {data.source}.</p>
    </div>
  )
}

export default function OptionsScreener() {
  const [view, setView] = useState('screen')
  // In a UCT Terminal panel the shell already insets the body; drop the page padding.
  const inset = !!useInTerminalPanel()?.inset
  return (
    <section className={inset ? `${styles.wrap} ${styles.wrapInPanel}` : styles.wrap} data-testid="options-screener">
      <div className={styles.tabs} role="tablist" aria-label="Option screener views">
        {VIEWS.map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={k === view}
            className={k === view ? styles.tabOn : styles.tab} onClick={() => setView(k)}>{label}</button>
        ))}
      </div>
      <p className={styles.muted}>From our own options log: the close-of-session snapshot of every listed contract, recorded once a trading day. Not a live chain.</p>
      {view === 'screen' && <Screen />}
      {view === 'volume' && <Volume />}
      {view === 'iv' && <Iv />}
    </section>
  )
}
