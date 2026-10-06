import { Link } from 'react-router-dom'
import useDarkSection from './useDarkSection'
import { OffLine } from './OffNotice'
import styles from './optionsAnalytics.module.css'

// FT-006 IV rank in the chain header, FT-019 option monitor strip, FT-020 volatility stats.
// (api/services/options_analytics/vol.py)
//
// ⛔ Each reads its own dark route; a 404 renders the caller's fallback (or nothing).
// ⛔ IV rank is a NUMBER only at >= 20 logged sessions. Below that the server's sentence is shown,
//    with the count and the first session a rank can exist on.
// ⛔ HV is computed from completed sessions; volume and earnings are the vendor's / our file's.

const enc = encodeURIComponent
const pct = (v, d = 1) => (v == null || Number.isNaN(Number(v)) ? '—' : `${(Number(v) * 100).toFixed(d)}%`)

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
  const { data, hidden, failed, loading } = useDarkSection(sym ? `/api/options/vol/${enc(sym)}/iv-rank` : null)
  if (hidden) return fallback
  if (loading) return <span className={styles.muted} data-testid="iv-rank-badge-loading">Loading…</span>
  if (failed) return <span className={styles.muted} data-testid="iv-rank-badge-failed">IV rank is unavailable right now.</span>
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
      IV rank <b>{Math.round(data.iv_rank)}%</b> {data.rank_word}
      <span className={styles.muted}> · pctl {Math.round(data.iv_percentile)} · {data.window_sessions} sessions</span>
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
  const { data, hidden, failed } = useDarkSection(sym ? `/api/research/options/${enc(sym)}/monitor` : null)
  if (hidden || (!data && !failed)) return null
  if (failed) return <p className={styles.note} data-testid="option-monitor">The option monitor is unavailable right now.</p>
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
        Vol C/P <b>{v.call_volume == null ? '—' : v.call_volume.toLocaleString()}</b>/<b>{v.put_volume == null ? '—' : v.put_volume.toLocaleString()}</b>
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

// `offNotice`: set by the terminal's VOL, which opens this panel on its own. When all three routes
// answer 404 it says the stats are not switched on, instead of opening blank.
export function VolStatsPanel({ sym, offNotice = false }) {
  const rv = useVol(sym, 'realized')
  const cm = useVol(sym, 'interpolated-iv?days=30')
  const vp = useVol(sym, 'vrp')
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
      <ul className={styles.list}>
        <li data-testid="vol-realized">Realized (close to close): {rv.failed ? 'unavailable' : rv.data?.available === false ? rv.data.note
          : `HV10 ${pct(rv.data?.hv?.hv10)} · HV20 ${pct(rv.data?.hv?.hv20)} · HV30 ${pct(rv.data?.hv?.hv30)}`}</li>
        <li data-testid="vol-iv30">30-day constant-maturity IV: {cm.failed ? 'unavailable' : cm.data?.iv != null ? pct(cm.data.iv) : (cm.data?.reason || '—')}
          <span className={styles.muted}> (from vendor ATM IV by expiration)</span></li>
        <li data-testid="vol-vrp">Variance risk premium (IV30 − HV30): {vp.failed ? 'unavailable' : vp.data?.vrp_points != null
          ? `${vp.data.vrp_points >= 0 ? '+' : ''}${(vp.data.vrp_points * 100).toFixed(1)} vol pts` : (vp.data?.note || '—')}</li>
      </ul>
      <p className={styles.muted}>{rv.data?.method} {cm.data?.method}</p>
    </section>
  )
}
