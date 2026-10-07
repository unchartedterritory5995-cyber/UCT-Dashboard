import { Link } from 'react-router-dom'
import useDarkSection from './useDarkSection'
import { OffLine } from './OffNotice'
import FailedRead from './FailedRead'
import styles from './optionsAnalytics.module.css'
import { formatNumber, formatPercent } from '../../lib/presentation/presentationPrimitives'
import { volPts } from './optionsFormat'
import { usePanelFreshness, panelAsOf } from '../../components/terminal/terminalPanel'

// FT-006 IV rank in the chain header, FT-019 option monitor strip, FT-020 volatility stats.
// (api/services/options_analytics/vol.py)
//
// ⛔ Each reads its own dark route; a 404 renders the caller's fallback (or nothing).
// ⛔ IV rank is a NUMBER only at >= 20 logged sessions. Below that the server's sentence is shown,
//    with the count and the first session a rank can exist on.
// ⛔ HV is computed from completed sessions; volume and earnings are the vendor's / our file's.

const enc = encodeURIComponent
// A fraction rendered as a percent through the shared formatter (em dash when absent).
const pct = (v, d = 1) => formatPercent(v == null ? NaN : Number(v) * 100, { decimals: d })

// The rank / percentile header and the volume strip, through the shared formatter (completeness
// audit 2026-10-07, column f). Same text as the old `Math.round(v)%` / `toLocaleString()` for
// every value the server sends; a missing one is the em dash, never "0%" or "NaN".
export const ivRankText = (v) => formatPercent(v == null ? NaN : Number(v), { decimals: 0 })
export const wholeText = (v) => formatNumber(v == null ? NaN : Number(v), { decimals: 0, grouping: false })
export const countText = (v) => formatNumber(v == null ? NaN : Number(v))

// A hover title cannot be read on a touch screen, so a note that explains how a
// number is measured is ALSO a tap-to-open line. The title stays for desktop.
function TapNote({ text, testid }) {
  if (!text) return null
  return (
    <details className={styles.muted} data-testid={testid} style={{ display: 'inline-block' }}>
      <summary aria-label="How this is measured">how measured</summary>
      {text}
    </details>
  )
}

export function IvRankBadge({ sym, fallback = null }) {
  const { data, hidden, failed, loading, retry } = useDarkSection(sym ? `/api/options/vol/${enc(sym)}/iv-rank` : null)
  if (hidden) return fallback
  if (loading) return <span className={styles.muted} data-testid="iv-rank-badge-loading">Loading…</span>
  if (failed) {
    return (
      <>
        <span className={styles.muted} data-testid="iv-rank-badge-failed">IV rank is unavailable right now.</span>
        {' '}<button type="button" onClick={() => retry()}>Retry</button>
      </>
    )
  }
  if (!data || typeof data.sentence !== 'string') return fallback
  const title = `${data.method} ${data.n} session${data.n === 1 ? '' : 's'} logged since ${data.logging_began || '—'}.`
  if (data.iv_rank == null) {
    return (
      <>
        <span className={styles.muted} data-testid="iv-rank-badge" title={title}>{data.sentence}</span>
        <TapNote text={title} testid="iv-rank-note" />
      </>
    )
  }
  return (
    <span data-testid="iv-rank-badge" title={title}>
      IV rank <b>{ivRankText(data.iv_rank)}</b> {data.rank_word}
      <span className={styles.muted}> · pctl {wholeText(data.iv_percentile)} · {data.window_sessions} sessions</span>
      {' '}<TapNote text={title} testid="iv-rank-note" />
    </span>
  )
}

// The volume / P/C read covers ONE expiration and a band of strikes, and that used to live only in a
// tooltip, so "P/C 0.5" read as the whole chain's. Say it in visible text. The strike count is read
// from the server's own note (vol.py), never retyped here; without it only the expiry is said.
export function volumeScope(v) {
  if (!v?.expiration) return null
  const [, m, d] = String(v.expiration).split('-')
  const n = /the (\d+) strikes nearest spot/i.exec(v.note || '')?.[1]
  return `front expiry ${m}/${d}${n ? `, ${n} strikes nearest spot` : ''}`
}

export function OptionMonitorStrip({ sym }) {
  const { data, hidden, failed, retry } = useDarkSection(sym ? `/api/research/options/${enc(sym)}/monitor` : null)
  if (hidden || (!data && !failed)) return null
  if (failed) return <FailedRead testId="option-monitor" retry={retry} title="The option monitor is unavailable right now." />
  if (!data.events || !data.volume) return null
  const e = data.events
  const v = data.volume
  return (
    <div className={styles.head} data-testid="option-monitor">
      <span title={`${data.hv_method} (computed)`}>HV20 <b>{pct(data.hv?.hv20)}</b></span>
      <span title={`${data.hv_method} (computed)`}>HV30 <b>{pct(data.hv?.hv30)}</b></span>
      <TapNote text={data.hv_method ? `${data.hv_method} (computed)` : ''} testid="hv-method-note" />
      <span data-testid="option-monitor-events">
        EVTS{' '}
        {e.next_earnings
          ? <Link reloadDocument to={`/research/${enc(sym)}?section=catalysts`}>Earnings {e.next_earnings} ({e.days_to_earnings}d)</Link>
          : <span className={styles.muted}>{e.note}</span>}
      </span>
      <span title={v.note || ''}>
        Vol C/P <b>{countText(v.call_volume)}</b>/<b>{countText(v.put_volume)}</b>
        {v.put_call_ratio != null ? <span className={styles.muted}> · P/C {v.put_call_ratio}</span> : null}
        {volumeScope(v) ? <span className={styles.muted} data-testid="option-monitor-scope"> ({volumeScope(v)})</span> : null}
      </span>
      {data.hv_note ? <span className={styles.muted}>{data.hv_note}</span> : null}
    </div>
  )
}

function useVol(sym, kind) {
  return useDarkSection(sym ? `/api/options/vol/${enc(sym)}/${kind}` : null)
}

// Quality pass 2026-10-05: with one read still in flight, switched off or answering with a
// window missing, the panel printed "HV10 —" -- an em dash that reads as a value. Each line now
// says which of those it is, and a realized window that was not computed is named as such.
function readState(r) {
  if (r.failed) return 'unavailable'
  if (r.loading) return 'still loading…'
  if (r.off) return 'not switched on'
  if (r.paywalled) return 'requires a paid plan'
  return null
}

const HV_WINDOWS = [['hv10', 'HV10'], ['hv20', 'HV20'], ['hv30', 'HV30']]
export function realizedText(hv) {
  const parts = HV_WINDOWS.map(([k, label]) => (hv?.[k] == null ? `${label} not computed` : `${label} ${pct(hv[k])}`))
  const missing = HV_WINDOWS.filter(([k]) => hv?.[k] == null).length
  const why = missing === 0 ? '' : ` (not enough daily closes on file for ${missing === 1 ? 'that window' : 'those windows'})`
  return `${parts.join(' · ')}${why}`
}

// `offNotice`: set by the terminal's VOL, which opens this panel on its own. When all three routes
// answer 404 it says the stats are not switched on, instead of opening blank.
export function VolStatsPanel({ sym, offNotice = false }) {
  const rv = useVol(sym, 'realized')
  const cm = useVol(sym, 'interpolated-iv?days=30')
  const vp = useVol(sym, 'vrp')
  // TERM-019: realized vol is UCT's; the IV it compares against is Massive's (the panel says which).
  // The as-of is the IV surface's build time when one answered, else the last completed session
  // the realized vol runs through.
  const ivAt = cm.data?.as_of || vp.data?.as_of
  usePanelFreshness(sym && (rv.data || cm.data || vp.data)
    ? (ivAt ? panelAsOf('UCT, computed from Massive options data', ivAt)
      : panelAsOf('UCT, computed from Massive options data', rv.data?.through, { dataClass: 'end_of_day' }))
    : null)
  if (offNotice && rv.off && cm.off && vp.off) {
    return <OffLine feature="Volatility stats" />
  }
  // Standalone (the terminal's VOL) the panel IS the page: say what is happening rather than
  // opening blank while the reads are in flight or every read answered the paid gate.
  if (offNotice && rv.paywalled && cm.paywalled && vp.paywalled) {
    return <p className={styles.note} data-testid="feature-paywalled">Volatility stats require a paid plan.</p>
  }
  if (offNotice && rv.loading && cm.loading && vp.loading) {
    return <p className={styles.note} data-testid="feature-loading">Loading volatility stats for {String(sym || '').toUpperCase()}…</p>
  }
  if (rv.hidden && cm.hidden && vp.hidden) return null
  if (rv.loading && cm.loading && vp.loading) return null
  // a body that is not a volatility answer (another route's JSON, an HTML page) renders nothing
  const known = (rv.data && 'hv' in rv.data) || (cm.data && 'iv' in cm.data) || (vp.data && 'vrp_points' in vp.data)
  if (!known && !(rv.failed || cm.failed || vp.failed)) return null
  return (
    <section className={styles.panel} data-testid="vol-stats">
      <div className={styles.head}>
        <span className={styles.title}>Volatility</span>
        <span className={styles.badge}>computed</span>
      </div>
      {/* a failed read is said where the member reads, with one Retry that re-asks every failed read */}
      {(rv.failed || cm.failed || vp.failed) && (
        <FailedRead testId="vol-failed" retry={() => { for (const r of [rv, cm, vp]) if (r.failed) r.retry?.() }}
          title="A volatility read failed. A line marked unavailable is a failed read, not a value." />
      )}
      <ul className={styles.list}>
        <li data-testid="vol-realized">Realized (close to close): {readState(rv) || (rv.data?.available === false ? rv.data.note
          : realizedText(rv.data?.hv))}</li>
        <li data-testid="vol-iv30">30-day constant-maturity IV: {readState(cm) || (cm.data?.iv != null ? pct(cm.data.iv) : (cm.data?.reason || 'not computed'))}
          <span className={styles.muted}> (from vendor ATM IV by expiration)</span></li>
        <li data-testid="vol-vrp">Variance risk premium (IV30 − HV30): {readState(vp) || (vp.data?.vrp_points != null
          ? `${vp.data.vrp_points >= 0 ? '+' : ''}${volPts(vp.data.vrp_points)} vol pts` : (vp.data?.note || 'not computed'))}</li>
      </ul>
      <p className={styles.muted}>{rv.data?.method} {cm.data?.method}</p>
    </section>
  )
}
