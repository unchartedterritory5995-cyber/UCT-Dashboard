import { useId, useRef, useState } from 'react'
import useSWR from 'swr'
import { sectionFetcher } from '../../../components/research/sections/sectionFetch'
import CoverageLine from '../../../components/provenance/CoverageLine'
import { OffLine } from '../../optionsAnalytics/OffNotice'
import FailedRead from '../../optionsAnalytics/FailedRead'
import { BoardFromList, useInTerminalPanel, usePanelSymbolRows } from '../../../components/terminal'
import styles from './OptionsScreener.module.css'
import { formatNumber, formatPercent } from '../../../lib/presentation/presentationPrimitives'
import Input from '../../../components/ui/Input'
import Select from '../../../components/ui/Select'
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

// Audit 2026-10-08 (OSCR, point 20): a member reads "AAA Nov 20 '26 $90 Put", not the OCC code
// "AAA261120P00090000". Built from the row's own fields; the raw code stays as the title. A row
// missing any field falls back to the code, never to a half-built label.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export const typeLabel = (t) => {
  const s = String(t || '').toLowerCase()
  return s === 'call' ? 'Call' : s === 'put' ? 'Put' : (t || '—')
}
export function contractLabel(r) {
  const raw = String(r?.contract || '').replace(/^O:/, '')
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(r?.expiration || ''))
  const strike = Number(r?.strike)
  const type = String(r?.type || '').toLowerCase()
  if (!r?.underlying || !m || !Number.isFinite(strike) || !['call', 'put'].includes(type)) return raw || '—'
  const mon = MONTHS[Number(m[2]) - 1]
  if (!mon) return raw || '—'
  const k = Number.isInteger(strike) ? String(strike) : strike.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
  return `${r.underlying} ${mon} ${Number(m[3])} '${m[1].slice(2)} $${k} ${typeLabel(type)}`
}

// A fraction rendered as a percent through the shared formatter (em dash when absent).
const pct = (v, d = 1) => formatPercent(v == null ? NaN : Number(v) * 100, { decimals: d })
const int = (v) => (v == null ? '—' : formatNumber(Math.round(Number(v))))

// Row <GO> (completeness audit 2026-10-07, column g): each view's rows, in table order, load
// their UNDERLYING (`$SYM`) into the linked group; the underlyings are the list a "Board of"
// opens. A view with no table on screen publishes nothing.
const underlyings = (rows) => (Array.isArray(rows) ? rows.map((r) => r.underlying) : [])

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
function ReadFailed({ error, what, retry }) {
  if (error?.status === 404) return <OffLine feature={`The ${what}`} />
  return <Unavailable what={what} retry={retry} />
}

function Unavailable({ what, retry }) {
  return <FailedRead testId="opts-unavailable" retry={retry}
    title={`The ${what} is unavailable right now. That does not mean there is nothing to show.`} />
}

function Screen() {
  const [preset, setPreset] = useState('high_iv_short_premium')
  const [draft, setDraft] = useState({ type: 'any' })
  const [filters, setFilters] = useState({})
  const url = screenUrl(preset, filters)
  const { data, error, mutate } = useSWR(url, sectionFetcher, { revalidateOnFocus: false })

  const presets = data?.presets || {}
  const shownSyms = usePanelSymbolRows(!error && data?.status === 'ok' ? underlyings(data.rows) : [], 'OSCR screen')
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
          <Select value={draft.type || 'any'} onChange={(e) => setDraft({ ...draft, type: e.target.value })}>
            <option value="any">Any</option><option value="call">Calls</option><option value="put">Puts</option>
          </Select>
        </label>
        {FIELDS.map(([k, label, kind]) => (
          <label key={k} className={kind === 'text' ? styles.wide : undefined}>{label}{' '}
            <Input type={kind} step="any" value={draft[k] ?? ''} aria-label={label}
              onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} />
          </label>
        ))}
        <button type="submit" className={styles.apply}>Apply filters</button>
        <span className={styles.muted}>{preset ? 'Filters refine the preset.' : ''}</span>
      </form>
      {/* Audit 2026-10-08 (OSCR, point 20): the filter labels are trader shorthand. */}
      <p className={styles.muted} data-testid="opts-filter-key">
        DTE: days to expiry. OTM %: how far the strike is from the stock price. |Δ|: delta without its
        sign (about 0.50 at the money). Spread %: ask minus bid as a share of the midpoint. OI: open interest.
      </p>
      {error?.status === 422 && <p className={styles.note} data-testid="opts-bad">A filter value could not be read.</p>}
      {error && error.status !== 422 && <ReadFailed error={error} what="option screener" retry={mutate} />}
      {data?.paywalled && <p className={styles.note}>The option screener requires a paid plan.</p>}
      {!error && !data && <p className={styles.note}>Loading the screen…</p>}
      {data && data.status === 'no_screen' && <p className={styles.note} data-testid="opts-no-screen">{data.note}</p>}
      {data && data.status === 'ok' && (
        <>
          <p className={styles.facts} data-testid="opts-session">
            {int(data.matched)} contracts matched · showing {int(data.shown)} · session {data.session} (end-of-day snapshot)
          </p>
          <BoardFromList syms={shownSyms} label="OSCR screen" testId="oscr-board" />
          {!data.rows?.length ? (
            <p className={styles.note} data-testid="opts-none">No contract in the {data.session} snapshot passed these filters.</p>
          ) : (
          // Audit 2026-10-08 (OSCR, point 24): on a phone the five columns the contract label
          // already spells out (session, underlying, type, strike, expiry) drop out, and the
          // contract column stays pinned while the numbers scroll. The session is in the line above.
          <div className={styles.scroll}>
            <table className={`${styles.grid} ${styles.screenGrid}`} aria-label="Option screener results">
              <thead><tr>
                <th scope="col" className={styles.narrowHide}>Session</th><th scope="col" className={styles.pin}>Contract</th><th scope="col" className={styles.narrowHide}>Und</th><th scope="col" className={styles.narrowHide}>Type</th><th scope="col" className={styles.narrowHide}>Strike</th><th scope="col" className={styles.narrowHide}>Exp</th><th scope="col">DTE</th>
                <th scope="col">OTM %</th><th scope="col">Δ</th><th scope="col">IV</th><th scope="col">Bid</th><th scope="col">Ask</th><th scope="col">Spread %</th><th scope="col">OI</th><th scope="col">Vol</th>
              </tr></thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.contract}>
                    <td className={`${styles.session} ${styles.narrowHide}`}>{r.session} EOD</td>
                    <th scope="row" className={`${styles.left} ${styles.pin}`} title={String(r.contract || '').replace(/^O:/, '')} data-testid="opts-contract">{contractLabel(r)}</th>
                    <td className={`${styles.left} ${styles.narrowHide}`}>{r.underlying}</td><td className={styles.narrowHide}>{typeLabel(r.type)}</td><td className={styles.narrowHide}>{num(r.strike)}</td>
                    <td className={styles.narrowHide}>{r.expiration}</td><td>{r.dte}</td><td>{num(r.otm_pct, 1)}</td><td>{num(r.delta, 3)}</td>
                    <td>{pct(r.iv)}</td><td>{num(r.bid)}</td><td>{num(r.ask)}</td><td>{num(r.spread_pct, 1)}</td>
                    <td>{int(r.open_interest)}</td><td>{int(r.volume)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          )}
          <CoverageLine coverage={data.coverage} />
          <p className={styles.muted}>{data.note} {data.screen_rule} Source: {data.source}.</p>
        </>
      )}
    </div>
  )
}

function Volume() {
  const { data, error, mutate } = useSWR('/api/options-screener/unusual-volume', sectionFetcher, { revalidateOnFocus: false })
  const volRows = !error && data?.status === 'ok' ? (data.ranked.length ? data.ranked : data.not_ranked) : []
  const volSyms = usePanelSymbolRows(underlyings(volRows), 'OSCR unusual volume')
  if (error) return <ReadFailed error={error} what="unusual-volume ranking" retry={mutate} />
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
      <BoardFromList syms={volSyms} label="OSCR unusual volume" testId="oscr-vol-board" />
      {/* Audit 2026-10-08 (OSCR, point 7): nothing to rank used to draw a header-only table. */}
      {!rows.length ? (
        <p className={styles.note} data-testid="opts-vol-empty">
          No underlying has option volume in the {data.session} snapshot, so there is nothing to rank yet.
        </p>
      ) : (
      <div className={styles.scroll}>
        <table className={styles.grid} aria-label="Option volume ranking">
          <thead><tr><th scope="col">Session</th><th scope="col">Underlying</th><th scope="col">Volume</th><th scope="col">Calls</th><th scope="col">Puts</th><th scope="col">Own average</th><th scope="col">Ratio</th></tr></thead>
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
      )}
      <CoverageLine coverage={data.coverage} />
      {data.missing_sessions?.length > 0 && <p className={styles.muted}>Not logged: {data.missing_sessions.join(', ')}.</p>}
      <p className={styles.muted}>{data.method} Source: {data.source}.</p>
    </div>
  )
}

function Iv() {
  const { data, error, mutate } = useSWR('/api/options-screener/iv-percentile', sectionFetcher, { revalidateOnFocus: false })
  const ivSyms = usePanelSymbolRows(!error && data?.status === 'ok' ? underlyings(data.ranked) : [], 'OSCR IV percentile')
  if (error) return <ReadFailed error={error} what="IV percentile ranking" retry={mutate} />
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
      <BoardFromList syms={ivSyms} label="OSCR IV percentile" testId="oscr-iv-board" />
      {data.ranked.length > 0 && (
        <div className={styles.scroll}>
          <table className={styles.grid} aria-label="IV percentile ranking">
            <thead><tr><th scope="col">Session</th><th scope="col">Underlying</th><th scope="col">ATM IV</th><th scope="col">Percentile</th><th scope="col">Bucket</th><th scope="col">Sessions</th></tr></thead>
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
  const tabRefs = useRef({})
  const uid = useId()
  // In a UCT Terminal panel the shell already insets the body; drop the page padding.
  const inset = !!useInTerminalPanel()?.inset
  // Audit 2026-10-08 (OSCR, points 18/26): role=tab promises the ARIA tabs contract. Only the
  // selected tab is in the Tab order; Left/Right (wrapping), Home and End move between views and
  // focus follows; the view below is the tabpanel each tab controls.
  const onTabKey = (e) => {
    const i = VIEWS.findIndex(([k]) => k === view)
    const to = { ArrowRight: (i + 1) % VIEWS.length, ArrowLeft: (i - 1 + VIEWS.length) % VIEWS.length,
      Home: 0, End: VIEWS.length - 1 }[e.key]
    if (to === undefined) return
    e.preventDefault()
    const k = VIEWS[to][0]
    setView(k)
    tabRefs.current[k]?.focus()
  }
  return (
    <section className={inset ? `${styles.wrap} ${styles.wrapInPanel}` : styles.wrap} data-testid="options-screener">
      <div className={styles.tabs} role="tablist" aria-label="Option screener views" onKeyDown={onTabKey}>
        {VIEWS.map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={k === view}
            id={`${uid}-tab-${k}`} aria-controls={`${uid}-panel`} tabIndex={k === view ? 0 : -1}
            ref={(el) => { tabRefs.current[k] = el }}
            className={k === view ? styles.tabOn : styles.tab} onClick={() => setView(k)}>{label}</button>
        ))}
      </div>
      <p className={styles.muted}>From our own options log: the close-of-session snapshot of every listed contract, recorded once a trading day. Not a live chain.</p>
      <div role="tabpanel" id={`${uid}-panel`} aria-labelledby={`${uid}-tab-${view}`}>
        {view === 'screen' && <Screen />}
        {view === 'volume' && <Volume />}
        {view === 'iv' && <Iv />}
      </div>
    </section>
  )
}
