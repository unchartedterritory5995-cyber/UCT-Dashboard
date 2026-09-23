// app/src/components/admin/DataPipelineHealthPanel.jsx
//
// Packet Y CP2 (signed 2026-09-23, fingerprint 4007862bd) — admin-only
// visibility panel over the 12 no-auth, read-only, self-documented data
// pipeline health monitors (see the packet's SHAPE A table), every one of
// which had zero frontend callers before this. Modeled directly on
// AiSearchInsightsPanel.jsx's idiom: error-swallowing fetcher, one useSWR per
// monitor, Admin.module.css classes only, no new stylesheet.
//
// Field mapping is read from each route's ACTUAL response shape (verified
// against source, not guessed) — see the packet's own CP2 table and its
// "read from each route's actual response shape" note. Nothing here writes
// anything or changes any of the 12 monitors' own logic, cadence or cost caps.
import useSWR from 'swr'
import styles from '../../pages/Admin.module.css'
import UIcon from '../ui/UIcon'

// Error-swallowing fetcher — the panel must degrade to empty, never throw.
// credentials:'include' costs nothing on these no-auth routes and keeps the
// fetcher byte-identical to every other admin panel in this file.
const fetcher = (url) => fetch(url, { credentials: 'include' }).then((r) => (r.ok ? r.json() : null)).catch(() => null)

const REFRESH_MS = 60000

function Badge({ tone, children }) {
  const colors = {
    flagged: '#f87171',
    clean: '#4ade80',
    info: '#5b9bd5',
  }
  const color = colors[tone] || 'var(--text-muted)'
  return (
    <span style={{
      fontSize: 10, padding: '1px 6px', borderRadius: 8,
      background: `${color}22`, color, whiteSpace: 'nowrap',
    }}>
      {children}
    </span>
  )
}

// One compact row: name / last-run value / one headline number / a
// flagged-or-clean badge, per the packet's CP2 field-mapping table.
function MonitorRow({ name, data, view }) {
  // `view(data)` returns { lastRun, headline, tone, label } for a real
  // payload; a null/undefined `data` (fetch still pending or failed) renders
  // as an em-dash row without calling into per-monitor field logic.
  const v = data ? view(data) : null
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-')
  return (
    <div className={styles.activityRow} data-testid={`monitor-row-${slug}`}>
      <span style={{ flex: '0 0 200px', fontSize: 12, color: 'var(--text)', fontWeight: 600 }}>{name}</span>
      <span style={{ flex: '0 0 220px', fontSize: 11, color: 'var(--text-muted)' }}>
        {v ? v.lastRun : '—'}
      </span>
      <span style={{ flex: 1, fontSize: 12, color: 'var(--text)' }}>
        {v ? v.headline : '—'}
      </span>
      <Badge tone={v ? v.tone : 'info'}>{v ? v.label : 'no data'}</Badge>
    </div>
  )
}

// ── Per-monitor field mapping (packet's CP2 table) ─────────────────────────

function viewFundamentals(d) {
  const flagged = Array.isArray(d.flagged_current) && d.flagged_current.length > 0
  return {
    lastRun: d.last_cycle_at ?? '—',
    headline: `${d.checked_total ?? '—'} checked / ${d.healed_total ?? '—'} healed`,
    tone: flagged ? 'flagged' : 'clean',
    label: flagged ? `flagged (${d.flagged_current.length})` : 'clean',
  }
}

function viewReconciliation(d) {
  const flagged = Array.isArray(d.last_detect_drift) && d.last_detect_drift.length > 0
  return {
    lastRun: d.last_cycle_at ?? '—',
    headline: `${d.audits_run ?? '—'} audits / ${d.rows_healed_total ?? '—'} healed`,
    tone: flagged ? 'flagged' : 'clean',
    label: flagged ? `unhealed drift (${d.last_detect_drift.length})` : 'clean',
  }
}

function viewBarsStream(d) {
  if (!d.enabled) {
    return { lastRun: '—', headline: 'disabled (STREAM_BARS_ENABLED unset)', tone: 'info', label: 'off' }
  }
  const emitAge = d.broadcaster?.last_emit_age_s
  const flagged = d.enabled === true &&
    (d.websocket?.connected === false || (d.broadcaster?.bars_dropped_total ?? 0) > 0)
  return {
    lastRun: emitAge != null ? `${emitAge}s since last emit` : '—',
    headline: `${d.broadcaster?.bars_emitted_total ?? '—'} emitted`,
    tone: flagged ? 'flagged' : 'clean',
    label: flagged ? 'flagged' : 'clean',
  }
}

function viewWarmUniverse(d) {
  const lastRun = d.completed_iso || (d.running ? d.started_iso : null) || '—'
  const flagged = (d.errors ?? 0) > 0
  return {
    lastRun,
    headline: `${d.done ?? '—'}/${d.total ?? '—'}`,
    tone: flagged ? 'flagged' : 'clean',
    label: flagged ? `${d.errors} errors` : 'clean',
  }
}

function viewProviderCoverage(d) {
  const fieldCount = d.fields && typeof d.fields === 'object' ? Object.keys(d.fields).length : 0
  const flagged = Array.isArray(d.defects_current) && d.defects_current.length > 0
  return {
    lastRun: d.last_cycle_at ?? '—',
    headline: `${fieldCount} fields tracked`,
    tone: flagged ? 'flagged' : 'clean',
    label: flagged ? `defects (${d.defects_current.length})` : 'clean',
  }
}

// No timestamp is published by this route — say so rather than invent one.
function viewCalendarDateIntegrity(d) {
  return {
    lastRun: '(no timestamp published)',
    headline: `${d.tracked ?? '—'} tracked / ${d.with_moves ?? '—'} moved`,
    // No defect signal in this payload — badge is always "info", never flags.
    tone: 'info',
    label: 'info',
  }
}

function viewCalendarCoverage(d) {
  const days = d.days && typeof d.days === 'object' ? Object.values(d.days) : []
  // Empty `days` means "no build yet since restart", never a defect — guard
  // against the vacuous-`every()`-on-empty-array false positive.
  const allServedAsScheduleOnly = days.length > 0 && days.every((day) => day.served === day.schedule_only)
  const flagged = !!d.error || (d.supplemented === 0 && allServedAsScheduleOnly)
  return {
    lastRun: d.as_of ?? '—',
    headline: d.error ? d.error : `${d.supplemented ?? '—'} supplemented`,
    tone: flagged ? 'flagged' : 'clean',
    label: flagged ? 'flagged' : 'clean',
  }
}

function viewCalendarEnrichment(d) {
  const dateEntries = d.dates && typeof d.dates === 'object' ? Object.values(d.dates) : []
  const newest = dateEntries[0]
  const flagged = dateEntries.some((entry) => entry.em_collapsed === true)
  return {
    lastRun: newest?.computed_at ?? '—',
    headline: newest ? `${newest.with_em ?? '—'}/${newest.total ?? '—'} with EM` : '—',
    tone: flagged ? 'flagged' : 'clean',
    label: flagged ? 'em_collapsed' : 'clean',
  }
}

function viewImpliedSweep(d) {
  const latest = Array.isArray(d.runs) ? d.runs[0] : null
  const flagged = Array.isArray(d.unfinished) && d.unfinished.length > 0
  return {
    lastRun: latest?.started_at ?? '—',
    headline: latest ? `${latest.symbols_done ?? '—'}/${latest.symbols_total ?? '—'} symbols` : '—',
    tone: flagged ? 'flagged' : 'clean',
    label: flagged ? `unfinished (${d.unfinished.length})` : 'clean',
  }
}

function viewCallRecap(d) {
  const flagged = d.spend_today_usd != null && d.daily_cap_usd != null && d.spend_today_usd >= d.daily_cap_usd
  return {
    lastRun: '(no timestamp published)',
    headline: `${d.generated_today ?? '—'} generated / $${d.spend_today_usd?.toFixed?.(2) ?? d.spend_today_usd ?? '—'} spend`,
    tone: flagged ? 'flagged' : 'clean',
    label: flagged ? 'at daily cap' : 'clean',
  }
}

// No defect signal in this payload — badge is always "info", never flags.
function viewTranscriptIndex(d) {
  return {
    lastRun: d.newest ?? '—',
    headline: `${d.transcripts ?? '—'} transcripts / ${d.symbols ?? '—'} symbols`,
    tone: 'info',
    label: 'info',
  }
}

function viewYfinanceGuard(d) {
  const flagged = d.breaker_open === true
  return {
    lastRun: d.last_trip_epoch ?? 'never tripped',
    headline: `${d.calls_total ?? '—'} calls / ${d.suppressed_total ?? '—'} suppressed`,
    tone: flagged ? 'flagged' : 'clean',
    label: flagged ? 'breaker OPEN' : 'clean',
  }
}

export default function DataPipelineHealthPanel() {
  const opts = { refreshInterval: REFRESH_MS }
  const { data: fundamentals } = useSWR('/api/admin/fundamentals-health', fetcher, opts)
  const { data: reconciliation } = useSWR('/api/admin/reconciliation-status', fetcher, opts)
  const { data: barsStream } = useSWR('/api/admin/bars-stream-status', fetcher, opts)
  const { data: warmUniverse } = useSWR('/api/admin/warm-universe-status', fetcher, opts)
  const { data: providerCoverage } = useSWR('/api/admin/provider-coverage', fetcher, opts)
  const { data: calendarDateIntegrity } = useSWR('/api/admin/calendar-date-integrity', fetcher, opts)
  const { data: calendarCoverage } = useSWR('/api/admin/calendar-coverage-status', fetcher, opts)
  const { data: calendarEnrichment } = useSWR('/api/admin/calendar-enrichment-status', fetcher, opts)
  const { data: impliedSweep } = useSWR('/api/admin/implied-sweep-status', fetcher, opts)
  const { data: callRecap } = useSWR('/api/admin/call-recap-status', fetcher, opts)
  const { data: transcriptIndex } = useSWR('/api/admin/transcript-index-status', fetcher, opts)
  const { data: yfinanceGuard } = useSWR('/api/admin/yfinance-guard', fetcher, opts)

  return (
    <div className={styles.healthSection}>
      <div className={styles.sectionTitle}>
        <UIcon name="compass" size={16} style={{ verticalAlign: '-3px', marginRight: 6 }} />
        Data Pipeline Health
      </div>
      <div className={styles.analyticsBarLabel} style={{ margin: '4px 0 12px', opacity: 0.7 }}>
        12 no-auth, read-only monitors — every route below already exists and computes this on
        every request; this panel is read-only visibility, nothing more.
      </div>

      <div className={styles.activityList} style={{ maxHeight: 'none' }}>
        <MonitorRow name="Fundamentals Accuracy" data={fundamentals} view={viewFundamentals} />
        <MonitorRow name="Bars Reconciliation" data={reconciliation} view={viewReconciliation} />
        <MonitorRow name="Bars Push Feed" data={barsStream} view={viewBarsStream} />
        <MonitorRow name="Warm Universe" data={warmUniverse} view={viewWarmUniverse} />
        <MonitorRow name="Provider Coverage" data={providerCoverage} view={viewProviderCoverage} />
        <MonitorRow name="Calendar Date Integrity" data={calendarDateIntegrity} view={viewCalendarDateIntegrity} />
        <MonitorRow name="Calendar Coverage" data={calendarCoverage} view={viewCalendarCoverage} />
        <MonitorRow name="Calendar Enrichment" data={calendarEnrichment} view={viewCalendarEnrichment} />
        <MonitorRow name="Implied Sweep" data={impliedSweep} view={viewImpliedSweep} />
        <MonitorRow name="Call Recap" data={callRecap} view={viewCallRecap} />
        <MonitorRow name="Transcript Index" data={transcriptIndex} view={viewTranscriptIndex} />
        <MonitorRow name="yfinance Guard" data={yfinanceGuard} view={viewYfinanceGuard} />
      </div>
    </div>
  )
}
