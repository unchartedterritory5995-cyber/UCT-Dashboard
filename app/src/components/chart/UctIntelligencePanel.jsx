// app/src/components/chart/UctIntelligencePanel.jsx — the small settings panel the "UCT Intelligence"
// indicator shows on the chart once a member adds it (uctIntelligence.js owns every fact it toggles).
//
// ⛔ A GATED LAYER'S TOGGLE IS NOT RENDERED UNTIL ITS LAYER IS RELEASED (`availability`), never shown
// disabled: a switch that does nothing is the defect, not a teaser. Admin-only layers sit in their own
// "Admin" section, rendered only when the host passes `admin`.
import { useMemo, useState } from 'react'
import useSWR from 'swr'

const EMPTY = Object.freeze([])

const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return r.json()
  })

/** The setups CONFIRMED on this symbol's daily chart: the same member-facing list the Research Technical
 *  tab shows (`GET /api/patterns/{sym}`, confirmed_only; the server drops internal ids for non-admins).
 *  Its key differs from the Technical tab's on purpose (that hook's cache holds a different shape).
 *  Suppressed entirely (null key) unless `enabled`. */
export function useChartSetups(sym, enabled) {
  const key = enabled && sym
    ? `/api/patterns/${encodeURIComponent(sym)}?tf=D&confirmed_only=true`
    : null
  // No polling: the judge confirms setups on daily bars, so one read per chart mount is the honest cadence.
  const { data, error, isLoading } = useSWR(key, fetcher, { dedupingInterval: 30_000 })
  const setups = useMemo(() => chartSetupRows(data), [data])
  return {
    setups,
    loading: Boolean(key && isLoading && !data),
    error: Boolean(key && error),
  }
}

/** The rows the Setups list shows: the judge's confirmed verdicts, then the server's `setup_tags`
 *  (blind-confirmed setups and bar events from the last three sessions, present only while the
 *  server releases them; filtered there, never here). A tag naming a setup already confirmed is
 *  not listed twice. */
export function chartSetupRows(data) {
  const verdicts = Array.isArray(data?.verdicts) ? data.verdicts : EMPTY
  const tags = Array.isArray(data?.setup_tags) ? data.setup_tags : EMPTY
  if (!tags.length) return verdicts
  const seen = new Set(verdicts.map((v) => v?.setup))
  return [...verdicts, ...tags.filter((t) => t && !seen.has(t.setup))]
}

/** The member-facing name: the server's `setup_name`, else the id title-cased (the Technical tab's rule). */
export function setupDisplayName(v) {
  if (v?.setup_name) return v.setup_name
  return String(v?.setup || '').split('_').filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1)).join(' ')
}

function Toggle({ id, label, hint, checked, onChange }) {
  return (
    <label data-testid={`uct-intel-toggle-${id}`}
      style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '4px 0', cursor: 'pointer' }}>
      <input type="checkbox" checked={!!checked} onChange={(e) => onChange(e.target.checked)}
        aria-label={label} style={{ marginTop: 2 }} />
      <span style={{ display: 'flex', flexDirection: 'column' }}>
        <span style={{ color: 'var(--text)', fontSize: 12 }}>{label}</span>
        {hint && <span style={{ color: 'var(--text-muted)', fontSize: 10.5, lineHeight: 1.3 }}>{hint}</span>}
      </span>
    </label>
  )
}

function SetupsList({ setups, loading, error }) {
  if (loading) return <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>Loading setups…</div>
  if (error) return <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>Setups could not be loaded.</div>
  if (!setups.length) {
    return <div data-testid="uct-intel-setups-empty" style={{ color: 'var(--text-muted)', fontSize: 11 }}>
      No confirmed setups on this chart right now.
    </div>
  }
  return (
    <ul data-testid="uct-intel-setups" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
      {setups.map((v, i) => (
        <li key={`${v.setup}|${v.asof_date}|${i}`} data-testid="uct-intel-setup" style={{ padding: '3px 0' }}>
          <div style={{ color: 'var(--text)', fontSize: 12, fontWeight: 600 }}>
            {setupDisplayName(v)}
            {v.asof_date && <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}> · {v.asof_date}</span>}
          </div>
          {v.setup_definition && (
            <div style={{ color: 'var(--text-muted)', fontSize: 10.5, lineHeight: 1.3 }}>{v.setup_definition}</div>
          )}
        </li>
      ))}
    </ul>
  )
}

/**
 * Props:
 *   state:         readUctIntelligence(settings)
 *   availability:  layerAvailability(...) — which gated toggles exist
 *   onSetLayer:    (key, value) => void   ('autoPatterns' | 'labels' | 'supportResistance' | 'candles' | 'setups')
 *   onRemove:      () => void
 *   setups:        { setups, loading, error } from useChartSetups
 *   setupsList:    show the confirmed-setup LIST under the Setups toggle (the Technical tab's release);
 *                  default true. False when the toggle exists only for the setup-drawing lines.
 *   admin:         null, or { showAll, onShowAll, showLevels, onShowLevels, showLearned, onShowLearned }
 *   defaultOpen:   start expanded
 */
export default function UctIntelligencePanel({
  state, availability, onSetLayer, onRemove, setups = null, setupsList = true, admin = null, defaultOpen = true,
}) {
  const [open, setOpen] = useState(defaultOpen)
  const a = availability || {}
  const setupCount = state.setups && a.setups && setups ? setups.setups.length : 0
  return (
    <div data-testid="uct-intel-panel" role="group" aria-label="UCT Intelligence"
      style={{
        position: 'absolute', top: 'calc(var(--price-pane-top, 0px) + 30px)', right: 72, zIndex: 6,
        maxWidth: 'min(280px, calc(100% - 96px))', borderRadius: 6, border: '1px solid var(--border)',
        background: 'var(--bg-elevated)', boxShadow: '0 4px 14px rgba(0,0,0,0.25)', fontSize: 12,
      }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 6px 4px 8px' }}>
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
          data-testid="uct-intel-header"
          style={{ flex: 1, textAlign: 'left', background: 'none', border: 0, padding: 0, cursor: 'pointer',
            color: 'var(--text)', fontWeight: 700, fontSize: 11.5, letterSpacing: 0.3 }}>
          UCT Intelligence{setupCount > 0 && !open ? ` · ${setupCount} setup${setupCount === 1 ? '' : 's'}` : ''}
        </button>
        <button type="button" onClick={() => onRemove?.()} aria-label="Remove UCT Intelligence"
          title="Remove UCT Intelligence" data-testid="uct-intel-remove"
          style={{ background: 'none', border: 0, cursor: 'pointer', color: 'var(--text-muted)', fontSize: 13 }}>×</button>
      </div>
      {open && (
        <div style={{ padding: '0 10px 8px', maxHeight: 360, overflowY: 'auto' }}>
          <Toggle id="autoPatterns" label="Auto patterns" hint="Chart pattern drawings"
            checked={state.autoPatterns} onChange={(v) => onSetLayer('autoPatterns', v)} />
          <Toggle id="labels" label="Pattern labels & numbers" hint="Buy point, depth, stage and volume"
            checked={state.labels} onChange={(v) => onSetLayer('labels', v)} />
          {a.supportResistance && (
            <Toggle id="supportResistance" label="Support & resistance" hint="Automatic levels"
              checked={state.supportResistance} onChange={(v) => onSetLayer('supportResistance', v)} />
          )}
          {a.candles && (
            <Toggle id="candles" label="Candlestick patterns" hint="Markers on the candles"
              checked={state.candles} onChange={(v) => onSetLayer('candles', v)} />
          )}
          {a.setups && (
            <>
              <Toggle id="setups" label="Setups"
                hint={setupsList ? 'Setups confirmed on this chart (daily)' : 'Setup lines on this chart (daily)'}
                checked={state.setups} onChange={(v) => onSetLayer('setups', v)} />
              {state.setups && setupsList && setups && <SetupsList {...setups} />}
            </>
          )}
          {admin && (
            <div data-testid="uct-intel-admin" style={{ borderTop: '1px solid var(--border)', marginTop: 6, paddingTop: 4 }}>
              <div style={{ color: 'var(--text-muted)', fontSize: 10, fontWeight: 700, letterSpacing: 0.5 }}>ADMIN</div>
              <Toggle id="admin-learned" label="Learned levels & trendlines"
                checked={admin.showLearned} onChange={(v) => admin.onShowLearned?.(v)} />
              <Toggle id="admin-all" label="All tiers" hint="Experimental tiers and the rare-pattern preview"
                checked={admin.showAll} onChange={(v) => admin.onShowAll?.(v)} />
              {admin.showAll && (
                <Toggle id="admin-levels" label="Key levels layer" hint="Nearest support / resistance detectors"
                  checked={admin.showLevels} onChange={(v) => admin.onShowLevels?.(v)} />
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
