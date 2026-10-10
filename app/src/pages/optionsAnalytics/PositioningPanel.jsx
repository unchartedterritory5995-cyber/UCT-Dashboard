import { useEffect, useState } from 'react'
import useDarkSection from './useDarkSection'
import OffNotice from './OffNotice'
import FailedRead from './FailedRead'
import { money } from './MarketTidePanel'
import { count, num, fracPct, pctNum, signedPct } from './optionsFormat'
import styles from './optionsAnalytics.module.css'
import { usePanelFreshness, panelAsOf } from '../../components/terminal/terminalPanel'

// BRK-08 positioning extensions under the option chain: FT-047 named levels, FT-049 heatmap,
// FT-055 max pain + NOPE, FT-050 Options Impact, FT-052 dealer short.
// (api/services/options_analytics/positioning.py)
//
// ⛔ Each block is its OWN dark surface: it reads its own route, and a 404 (switch off) or 402
//    renders nothing. Arming one never shows another.
// ⛔ Every block is labelled computed; vendor inputs are named. Words for levels come from the
//    server's closed vocabulary (positioning_vocab.py), never typed here.
//
// TERMINAL-NEXT finishing lane L3 adds, each on its OWN switch and rendering nothing on 404/402:
//   BRK-08 base rate (OPTIONS_LEVEL_BASE_RATE_ENABLED) and FT-053 level files
//   (OPTIONS_LEVEL_FILES_ENABLED) inside the levels block; FT-049's forward projection
//   (OPTIONS_TRACE_PROJECTION_ENABLED) as its own block and the 1-minute refresh
//   (OPTIONS_TRACE_REFRESH_ENABLED) on every heatmap.

const enc = encodeURIComponent

// Audit 2026-10-08 (POS #20): NOPE, charm and delta pressure had only the server's method text,
// which is a formula, not an explanation. `about` is a one-line plain-English "what this tells
// you", shown under the title and named as the section's accessible description.
const ABOUT = {
  nope: 'NOPE asks which way today\'s option buying leans, measured against the stock\'s own volume. '
    + 'Positive means option traders are net bullish (more call delta), negative net bearish; '
    + 'the bigger the number, the more option flow could push the stock.',
  delta: 'Delta pressure shows, at each strike and expiry, how much stock dealers would have to hold '
    + 'to hedge the options customers own. Big cells mark the strikes where hedging can move the price.',
  charm: 'Charm shows how those hedges shift overnight from time passing alone, even if the price does '
    + 'not move. Big cells mark where dealers will need to buy or sell stock as expiry nears.',
}

function Block({ title, testid, children, failed, retry, what, about }) {
  const aboutId = about ? `${testid}-about` : undefined
  return (
    <section className={styles.panel} data-testid={testid} aria-describedby={aboutId}>
      <div className={styles.head}>
        <span className={styles.title}>{title}</span>
        <span className={styles.badge}>computed</span>
      </div>
      {about && <p className={styles.note} id={aboutId} data-testid={aboutId}>{about}</p>}
      {failed ? <FailedRead retry={retry} title={`${what} is unavailable right now. That is a failed read, not an empty one.`} /> : children}
    </section>
  )
}

function Levels({ sym }) {
  const { data, hidden, failed, retry } = useDarkSection(`/api/options/positioning/${enc(sym)}/levels`)
  if (hidden || (!data && !failed) || (data && !Array.isArray(data.levels))) return null
  return (
    <Block title="Positioning levels" testid="posn-levels" failed={failed} retry={retry} what="The positioning levels">
      {data && (
        <>
          {/* completeness audit 2026-10-07: an answer with no level drew an empty list */}
          {data.levels.length === 0 && (
            <p className={styles.note} data-testid="posn-levels-none">
              No positioning level could be computed for {sym} from the latest chain.
            </p>
          )}
          <ul className={styles.list}>
            {data.levels.map((l) => (
              <li key={l.id} data-testid={`posn-level-${l.id}`}>
                <b>{l.label}</b>: {l.value == null ? '—' : (l.unit === '$ move' ? `±$${num(l.value)}` : num(l.value))}
                {l.role ? <span className={styles.muted}> ({l.role})</span> : null}
              </li>
            ))}
          </ul>
          {(data.notes || []).map((n) => <p key={n} className={styles.muted}>{n}</p>)}
          {Number.isFinite(data.atm_iv?.value) && (
            <p className={styles.muted} data-testid="levels-atm-iv">
              ATM IV {fracPct(data.atm_iv.value)}{data.atm_iv.expiration ? ` on ${data.atm_iv.expiration}` : ' (30-day interpolated)'}.
            </p>
          )}
          <BaseRate sym={sym} />
          <LevelFiles sym={sym} />
          <p className={styles.muted}>{data.method}</p>
        </>
      )}
    </Block>
  )
}

// BRK-08: how often each level type held, from our own levels history. Below the minimum sample
// the server sends a sentence with the count, never a rate, and this prints the sentence.
export function BaseRate({ sym }) {
  const { data, hidden, failed, retry } = useDarkSection(`/api/options/positioning/${enc(sym)}/base-rate`)
  if (hidden || (!data && !failed) || (data && !Array.isArray(data.levels))) return null
  if (failed) return <FailedRead retry={retry} title="The level base rate is unavailable right now. That is a failed read, not an empty history." />
  return (
    <div data-testid="posn-base-rate">
      <p className={styles.facts}><b>How often these levels held</b> (next {data.horizon_sessions} closes)</p>
      {data.note && <p className={styles.note} data-testid="posn-base-rate-note">{data.note}</p>}
      <ul className={styles.list}>
        {data.levels.map((l) => (
          <li key={l.id} data-testid={`posn-base-rate-${l.id}`}>
            <b>{l.label}</b>:{' '}
            {l.held_pct != null
              ? <>held {count(l.held)} of {count(l.tested)} tested ({pctNum(l.held_pct, 1)}), broke {count(l.broke)}</>
              : <span className={styles.muted}>{l.note}</span>}
          </li>
        ))}
      </ul>
      <p className={styles.muted}>
        {data.sessions_with_levels} session{data.sessions_with_levels === 1 ? '' : 's'} of levels on record
        {data.first_session ? ` since ${data.first_session}` : ''}. {data.method}
      </p>
    </div>
  )
}

const FILE_NAMES = { pine: 'TradingView', thinkscript: 'ThinkorSwim', csv: 'CSV' }

// FT-053: the same levels as files TradingView and ThinkorSwim import. The probe (no format) lists
// the formats; each button is a plain download of that format.
export function LevelFiles({ sym }) {
  const base = `/api/options/positioning/${enc(sym)}/level-files`
  const { data, hidden } = useDarkSection(base)
  if (hidden || !Array.isArray(data?.formats)) return null
  return (
    <div data-testid="posn-level-files">
      <p className={styles.facts}><b>Download these levels</b></p>
      <div className={styles.seg}>
        {data.formats.map((f) => (
          <a key={f.id} className={styles.dl} href={`${base}?format=${f.id}`} download
            data-testid={`posn-level-file-${f.id}`} aria-label={`Download the levels as ${f.label}`}>
            {FILE_NAMES[f.id] || f.id}
          </a>
        ))}
      </div>
      <p className={styles.muted}>{data.note}</p>
    </div>
  )
}

// FT-049: re-read a heatmap every minute while the regular session is open. The policy route is
// its own switch; off (404) means no timer at all. A few seconds of jitter per panel keeps a room
// of open panels from asking the server in the same second.
export function useHeatmapRefresh(retry) {
  const policy = useDarkSection('/api/options/positioning/refresh-policy')
  const every = policy.data?.market_open ? Number(policy.data.interval_s) : 0
  const jitter = Number(policy.data?.client_jitter_s) || 0
  const again = policy.retry
  useEffect(() => {
    if (!every) return undefined
    const ms = (every + Math.random() * jitter) * 1000
    const t = setInterval(() => { retry(); again() }, ms)
    return () => clearInterval(t)
    // `again` is a fresh closure each render; the interval only needs the period
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [every, jitter])
  return policy.hidden ? null : policy.data
}

export function refreshWords(policy) {
  if (!policy) return null
  if (!policy.market_open || !policy.interval_s) return policy.note
  const s = Number(policy.interval_s)
  const every = s % 60 === 0 ? `${s / 60} minute${s === 60 ? '' : 's'}` : `${s} seconds`
  return `Refreshes every ${every} while the market is open.`
}

function RefreshNote({ retry, testid }) {
  const policy = useHeatmapRefresh(retry)
  if (!policy) return null
  return <p className={styles.muted} data-testid={`${testid}-refresh`}>{refreshWords(policy)}</p>
}

// One strike x expiry grid. FT-049's gamma heatmap, and (lane/o-options-remainders) its delta-pressure
// and charm siblings: each its OWN route and switch (OPTIONS_DELTA_PRESSURE_ENABLED /
// OPTIONS_CHARM_HEATMAP_ENABLED), same chain, same cell rule (blank = no computable contract, never 0).
function Heatmap({ sym, path = 'heatmap', title = 'Gamma exposure by strike and expiry', testid = 'posn-heatmap', what = 'The gamma heatmap', about }) {
  const { data, hidden, failed, retry } = useDarkSection(`/api/options/positioning/${enc(sym)}/${path}?dte=month`)
  if (hidden || (!data && !failed) || (data && !Array.isArray(data.cells))) return null
  const max = data?.max_abs || 1
  return (
    <Block title={title} testid={testid} failed={failed} retry={retry} what={what} about={about}>
      {data && (
        <>
          <div className={styles.scroll}>
            <table className={styles.table} aria-label={title}>
              <thead><tr><th scope="col">Expiry</th>{data.strikes.map((k) => <th scope="col" key={k}>{num(k)}</th>)}</tr></thead>
              <tbody>
                {data.expirations.map((e, i) => (
                  <tr key={e}>
                    <th scope="row">{e}</th>
                    {data.cells[i].map((v, j) => (
                      <td key={data.strikes[j]} className={v == null ? undefined : (v >= 0 ? styles.cellPos : styles.cellNeg)}
                        style={v == null ? undefined : { '--heat': Math.min(1, Math.abs(v) / max) }}>
                        {v == null ? '' : money(v)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className={styles.muted}>Unit: {data.unit}. {data.note} {data.method}</p>
          {data.contracts_without_defined_charm > 0 && (
            <p className={styles.muted} data-testid={`${testid}-undefined`}>
              {data.contracts_without_defined_charm} contract{data.contracts_without_defined_charm === 1 ? '' : 's'} had no defined charm (expiring today, delta pinned at 0/1, or no gamma) and are left out.
            </p>
          )}
          {data.not_built && <p className={styles.muted}>{data.not_built}</p>}
          <RefreshNote retry={retry} testid={testid} />
        </>
      )}
    </Block>
  )
}

const ABOUT_PROJECTION = 'If nobody traded, where would dealer gamma sit at nearby prices over the next few sessions? '
  + 'Green cells are prices where dealer hedging would damp moves, red cells where it would add to them. '
  + 'The projected flip is the price where it changes over.'

// FT-049 forward projection: projected net GEX by price (rows) and session (columns).
function Projection({ sym }) {
  const { data, hidden, failed, retry } = useDarkSection(`/api/options/positioning/${enc(sym)}/projection?dte=month`)
  if (hidden || (!data && !failed) || (data && !Array.isArray(data.cells))) return null
  const max = data?.max_abs || 1
  const title = 'Projected gamma by price and session'
  return (
    <Block title={title} testid="posn-projection" failed={failed} retry={retry} what="The gamma projection" about={ABOUT_PROJECTION}>
      {data && (
        <>
          <div className={styles.scroll}>
            <table className={styles.table} aria-label={title}>
              <thead><tr><th scope="col">Price</th>{data.sessions.map((d) => <th scope="col" key={d}>{d}</th>)}</tr></thead>
              <tbody>
                {data.prices.map((p, i) => (
                  <tr key={p}>
                    <th scope="row">{num(p)}</th>
                    {data.cells[i].map((v, j) => (
                      <td key={data.sessions[j]} className={v == null ? undefined : (v >= 0 ? styles.cellPos : styles.cellNeg)}
                        style={v == null ? undefined : { '--heat': Math.min(1, Math.abs(v) / max) }}>
                        {v == null ? '' : money(v)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className={styles.facts} data-testid="posn-projection-flips">
            Projected flip: {data.sessions.map((d, j) => `${d} ${data.zero_gamma_by_session?.[j] == null ? 'none in range' : num(data.zero_gamma_by_session[j])}`).join(' · ')}
          </p>
          <p className={styles.muted}>Unit: {data.unit}. {data.note} {data.method}</p>
          {data.contracts_without_recoverable_iv > 0 && (
            <p className={styles.muted}>{count(data.contracts_without_recoverable_iv)} contracts had no recoverable volatility (expiring today, delta pinned at 0/1, or no gamma) and are left out.</p>
          )}
          <RefreshNote retry={retry} testid="posn-projection" />
        </>
      )}
    </Block>
  )
}

function MaxPain({ sym }) {
  const { data, hidden, failed, retry } = useDarkSection(`/api/options/positioning/${enc(sym)}/max-pain?dte=month`)
  if (hidden || (!data && !failed) || (data && !Array.isArray(data.expirations))) return null
  return (
    <Block title="Max pain" testid="posn-maxpain" failed={failed} retry={retry} what="Max pain">
      {data && (
        <>
          <ul className={styles.list}>
            {data.expirations.map((e) => (
              <li key={e.expiration}>{e.expiration}: <b>{num(e.max_pain)}</b>
                {e.distance_pct != null ? ` (${signedPct(e.distance_pct)} from spot)` : ''}
                <span className={styles.muted}> · call OI {count(e.call_oi)} · put OI {count(e.put_oi)}</span>
              </li>
            ))}
          </ul>
          <p className={styles.muted}>{data.band_note} {data.method}</p>
        </>
      )}
    </Block>
  )
}

function Nope({ sym }) {
  const { data, hidden, failed, retry } = useDarkSection(`/api/options/positioning/${enc(sym)}/nope`)
  if (hidden || (!data && !failed) || (data && !('nope' in data))) return null
  return (
    <Block title="NOPE (net options pricing effect)" testid="posn-nope" failed={failed} retry={retry} what="NOPE" about={ABOUT.nope}>
      {data && (
        <>
          <p className={styles.facts}>
            {data.nope != null
              ? <>NOPE <b className={data.nope >= 0 ? styles.gain : styles.loss}>{signedPct(data.nope)}</b>{' '}
                ({count(data.net_option_delta_shares)} delta-shares on {count(data.share_volume)} shares traded)</>
              : data.nope_note}
          </p>
          <p className={styles.muted}>{data.method}</p>
        </>
      )}
    </Block>
  )
}

const BAND_WORDS = {
  low: 'Low: the stock trades far more than dealers would need to hedge a 1% move. Ignore the positioning read.',
  moderate: 'Moderate: dealer hedging is a real but minor part of the day\'s volume.',
  high: 'High: dealer hedging is large against the stock\'s volume. Positioning can steer price.',
}

function Impact({ sym }) {
  const { data, hidden, failed, retry } = useDarkSection(`/api/options/positioning/${enc(sym)}/impact`)
  if (hidden || (!data && !failed) || (data && !('impact_ratio' in data))) return null
  return (
    <Block title="Options Impact" testid="posn-impact" failed={failed} retry={retry} what="Options Impact">
      {data && (
        <>
          <p className={styles.facts} data-testid="posn-impact-read">
            {data.impact_ratio != null
              ? <>{pctNum(data.impact_ratio * 100)} of daily dollar volume · {BAND_WORDS[data.band]}</>
              : data.impact_note}
          </p>
          <p className={styles.muted}>{data.method}</p>
        </>
      )}
    </Block>
  )
}

function DealerShort({ sym }) {
  const { data, hidden, failed, retry } = useDarkSection(`/api/options/positioning/${enc(sym)}/dealer-short`)
  if (hidden || (!data && !failed) || (data && !Array.isArray(data.dealer_short))) return null
  return (
    <Block title="Dealer short" testid="posn-dealer-short" failed={failed} retry={retry} what="The dealer-short read">
      {data && (
        <>
          <p className={styles.facts}>{data.summary}</p>
          <p className={styles.muted}>{data.explanation}</p>
          <ul className={styles.list}>
            {data.dealer_short.slice(0, 10).map((r) => (
              <li key={r.contract_key}>{r.expiration} {num(r.strike)} {r.cp === 'C' ? 'call' : 'put'}: dealers {count(r.est_dealer_net)} contracts
                {r.flow_confidence != null ? <span className={styles.muted}> (confidence {num(r.flow_confidence)})</span> : null}
              </li>
            ))}
          </ul>
          <p className={styles.muted}>{data.method}</p>
        </>
      )}
    </Block>
  )
}

// FT-054 "N minutes ago": per-strike dealer gamma from today's flow, now against how it stood 30 or
// 60 minutes ago. Served by flow-worker (api/flow_exposure_history.py) through web's flow proxy, dark
// on FLOW_EXPOSURE_HISTORY_ENABLED. A strike absent from a snapshot had no flow by then, so it reads
// $0 there; a snapshot that does not exist yet (history too short) is said in words, never drawn.
export const EXPOSURE_AGO = [30, 60]
const EXPOSURE_MAX_STRIKES = 20

export function exposureRows(data, ago) {
  const series = data?.series || []
  const now = series.find((s) => s.minutes_ago === 0)
  const then = series.find((s) => s.minutes_ago === ago)
  if (!now) return []
  const thenOk = Boolean(then?.as_of)
  const val = (s, k) => {
    const v = s?.strikes?.[k]?.dealer_gamma
    return Number.isFinite(v) ? v : 0
  }
  const keys = new Set([...Object.keys(now.strikes || {}), ...(thenOk ? Object.keys(then.strikes || {}) : [])])
  const rows = [...keys].map((k) => {
    const n = val(now, k)
    const t = thenOk ? val(then, k) : null
    return { strike: Number(k), now: n, then: t, change: t == null ? null : n - t }
  })
  const top = rows.sort((a, b) => Math.max(Math.abs(b.now), Math.abs(b.then || 0)) - Math.max(Math.abs(a.now), Math.abs(a.then || 0)))
    .slice(0, EXPOSURE_MAX_STRIKES)
  return top.sort((a, b) => a.strike - b.strike)
}

const etTime = (iso) => (iso ? new Date(iso).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }) : null)

function ExposureHistory({ sym }) {
  const [ago, setAgo] = useState(EXPOSURE_AGO[0])
  const { data, hidden, failed, retry } = useDarkSection(`/api/flow/exposure-history/${enc(sym)}?ago=${EXPOSURE_AGO.join(',')}`)
  if (hidden || (!data && !failed) || (data && !Array.isArray(data.series))) return null
  const then = data?.series?.find((s) => s.minutes_ago === ago)
  const rows = data ? exposureRows(data, ago) : []
  const nowAt = etTime(data?.series?.[0]?.as_of)
  return (
    <Block title="Positioning now vs earlier today" testid="posn-exposure-history" failed={failed} retry={retry}
      what="The intraday exposure history"
      about="How much gamma dealers took on from today's option prints at each strike, now and as it stood earlier. A strike that grew more negative means dealers sold more options there and will hedge against the move.">
      {data && (
        <>
          <span className={styles.seg} role="group" aria-label="Compare with">
            {EXPOSURE_AGO.map((m) => (
              <button key={m} type="button" aria-pressed={ago === m} onClick={() => setAgo(m)} data-testid={`posn-exposure-ago-${m}`}>
                {m} minutes ago
              </button>
            ))}
          </span>
          {data.empty ? (
            <p className={styles.note} data-testid="posn-exposure-empty">No option flow has been recorded for {sym} today yet.</p>
          ) : (
            <>
              {!then?.as_of && <p className={styles.note} data-testid="posn-exposure-short">{then?.note || `No snapshot is ${ago} minutes old yet.`}</p>}
              <div className={styles.scroll}>
                <table className={styles.table} aria-label={`Dealer gamma by strike for ${sym}, now and ${ago} minutes ago`}>
                  <thead><tr>
                    <th scope="col">Strike</th>
                    <th scope="col">Now{nowAt ? ` (${nowAt} ET)` : ''}</th>
                    {then?.as_of && <th scope="col">{ago} minutes ago ({etTime(then.as_of)} ET)</th>}
                    {then?.as_of && <th scope="col">Change</th>}
                  </tr></thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.strike} data-testid={`posn-exposure-row-${r.strike}`}>
                        <th scope="row">{num(r.strike)}</th>
                        <td>{money(r.now)}</td>
                        {then?.as_of && <td>{money(r.then)}</td>}
                        {then?.as_of && <td className={r.change > 0 ? styles.gain : r.change < 0 ? styles.loss : undefined}>{money(r.change)}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          <p className={styles.muted}>{data.settle_note} {data.method}</p>
        </>
      )}
    </Block>
  )
}

// Every route this panel reads, in render order -- OffNotice asks the SAME keys (SWR shares the
// request), so it can say "not switched on" exactly when every block above rendered nothing.
export const positioningUrls = (s) => [
  `/api/options/positioning/${enc(s)}/levels`,
  `/api/options/positioning/${enc(s)}/heatmap?dte=month`,
  `/api/options/positioning/${enc(s)}/delta-heatmap?dte=month`,
  `/api/options/positioning/${enc(s)}/charm-heatmap?dte=month`,
  `/api/options/positioning/${enc(s)}/projection?dte=month`,
  `/api/options/positioning/${enc(s)}/max-pain?dte=month`,
  `/api/options/positioning/${enc(s)}/nope`,
  `/api/options/positioning/${enc(s)}/impact`,
  `/api/options/positioning/${enc(s)}/dealer-short`,
  `/api/flow/exposure-history/${enc(s)}?ago=${EXPOSURE_AGO.join(',')}`,
]

// `offNotice`: set by the terminal's POS, which opens this panel on its own.
export default function PositioningPanel({ sym, offNotice = false }) {
  const s = (sym || '').toUpperCase().trim()
  // TERM-019: every section below is computed by UCT from Massive's chain; each dates itself.
  // The header carries the levels read's `computed_at` (same SWR key as <Levels>, one request).
  const levels = useDarkSection(s ? positioningUrls(s)[0] : null)
  usePanelFreshness(s ? panelAsOf('UCT, computed from Massive options data', levels.data?.computed_at) : null)
  if (!s) return null
  return (
    <div data-testid="positioning">
      {offNotice && <OffNotice urls={positioningUrls(s)} feature="Options positioning" />}
      <Levels sym={s} />
      <Heatmap sym={s} />
      <Heatmap sym={s} path="delta-heatmap" title="Delta pressure by strike and expiry" testid="posn-delta-heatmap" what="The delta-pressure heatmap" about={ABOUT.delta} />
      <Heatmap sym={s} path="charm-heatmap" title="Charm by strike and expiry" testid="posn-charm-heatmap" what="The charm heatmap" about={ABOUT.charm} />
      <Projection sym={s} />
      <MaxPain sym={s} />
      <Nope sym={s} />
      <Impact sym={s} />
      <DealerShort sym={s} />
      <ExposureHistory sym={s} />
    </div>
  )
}
