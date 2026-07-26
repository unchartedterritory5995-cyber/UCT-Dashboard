// app/src/components/admin/CatalystRulesPanel.jsx
//
// Admin-only view of the catalyst curator's DURABLE rulebook — the rules the
// nightly rule-learner distilled from the owner's ✎ notes (plus any hand-added).
// Mirrors TwitterAccountsPanel's visual pattern (reuses Admin.module.css).
//
// This is the "what has the curator taught itself, and let me kill a bad one"
// surface. Retiring a rule is instant (the curator stops reading it on the next
// list — no redeploy).
import { useState } from 'react'
import useSWR from 'swr'
import adminStyles from '../../pages/Admin.module.css'
import UIcon from '../ui/UIcon'

const fetcher = (url) => fetch(url).then((r) => r.json())

function relative(ts) {
  if (!ts) return '—'
  const secs = Math.max(0, Math.floor(Date.now() / 1000 - ts))
  if (secs < 60) return `${secs}s ago`
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`
  return `${Math.floor(secs / 86400)}d ago`
}

function EnabledPill({ on, label }) {
  const color = on ? '#4ade80' : '#f87171'
  return (
    <span style={{ padding: '2px 8px', borderRadius: 10, fontSize: 11,
                   background: `${color}26`, color }}>
      {label}: {on ? 'on' : 'off'}
    </span>
  )
}

export default function CatalystRulesPanel() {
  const { data, mutate, isValidating } = useSWR(
    '/api/admin/catalyst-learned-rules?include_retired=true',
    fetcher,
    { refreshInterval: 120000 },
  )

  const [newRule, setNewRule] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [showRetired, setShowRetired] = useState(false)

  const active = (data?.all || []).filter((r) => r.active)
  const retired = (data?.all || []).filter((r) => !r.active)

  async function retire(id) {
    if (!confirm('Retire this rule? The curator stops using it on the next list.')) return
    await fetch(`/api/admin/catalyst-learned-rules/${id}/retire`, { method: 'POST' })
    mutate()
  }

  async function addRule() {
    const text = newRule.trim()
    if (text.length < 8) { setError('Rule text too short'); return }
    setBusy(true); setError(null)
    const r = await fetch('/api/admin/catalyst-learned-rules/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rule: text, rationale: 'hand-added via admin' }),
    })
    setBusy(false)
    if (!r.ok) {
      const b = await r.json().catch(() => ({}))
      setError(b.detail || `HTTP ${r.status}`)
      return
    }
    setNewRule(''); mutate()
  }

  async function learnNow() {
    setBusy(true); setError(null)
    await fetch('/api/admin/catalyst-learn-now', { method: 'POST' }).catch(() => {})
    setBusy(false); mutate()
  }

  function tickersOf(r) {
    try {
      const src = JSON.parse(r.source_json || '{}')
      return (src.tickers || []).slice(0, 6).join(', ')
    } catch { return '' }
  }

  return (
    <div className={adminStyles.healthSection}>
      <div className={adminStyles.sectionTitle}>
        Catalyst Curator — Learned Rules
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' }}>
        <EnabledPill on={data?.learner_enabled} label="learning" />
        <EnabledPill on={data?.reader_enabled} label="applying" />
        <span style={{ fontSize: 12, opacity: 0.65 }}>
          last run {relative(data?.learn_state?.last_run_at)} · {active.length} active
        </span>
        <button disabled={busy} onClick={learnNow} style={{ fontSize: 11, marginLeft: 'auto' }}
                title="Distill notes into rules now (normally runs 8:30 PM ET)">
          {busy ? '…' : 'run learner now'}
        </button>
      </div>

      {!data ? (
        <div style={{ opacity: 0.6, fontSize: 13 }}>Loading…</div>
      ) : active.length === 0 ? (
        <div style={{ opacity: 0.6, fontSize: 13, marginBottom: 12 }}>
          No learned rules yet. Leave ✎ notes on catalyst rows; the nightly
          learner (8:30 PM ET) distills recurring themes into rules here.
        </div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, marginBottom: 12 }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', padding: '4px 8px', opacity: 0.7 }}>Rule</th>
              <th style={{ textAlign: 'left', padding: '4px 8px', opacity: 0.7 }}>From</th>
              <th style={{ textAlign: 'left', padding: '4px 8px', opacity: 0.7 }}>Learned</th>
              <th style={{ textAlign: 'right', padding: '4px 8px', opacity: 0.7 }} title="Times applied to a list">Used</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {active.map((r) => (
              <tr key={r.id} style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                <td style={{ padding: '6px 8px', maxWidth: 460 }}>
                  {r.rule_text}
                  {r.rationale ? (
                    <div style={{ fontSize: 11, opacity: 0.5, marginTop: 2 }}>{r.rationale}</div>
                  ) : null}
                </td>
                <td style={{ padding: '6px 8px', fontSize: 11, opacity: 0.7 }}>{tickersOf(r) || '—'}</td>
                <td style={{ padding: '6px 8px', fontSize: 12 }}>{relative(r.created_at)}</td>
                <td style={{ padding: '6px 8px', textAlign: 'right' }}>{r.hit_count ?? 0}</td>
                <td style={{ padding: '6px 8px', textAlign: 'right' }}>
                  <button onClick={() => retire(r.id)} style={{ fontSize: 11 }}
                          title="Retire — curator stops using this rule (instant, no deploy)">
                    <UIcon name="trash" size={11} /> retire
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <input
          type="text"
          placeholder="hand-add a durable rule (e.g. cut biotech names on dilution offerings)"
          value={newRule}
          onChange={(e) => setNewRule(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addRule()}
          style={{ flex: 1, padding: '4px 8px', fontSize: 13 }}
        />
        <button disabled={busy} onClick={addRule}>{busy ? '…' : '+ Add'}</button>
      </div>
      {error && <div style={{ color: '#f87171', fontSize: 12 }}>{error}</div>}

      {retired.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <button onClick={() => setShowRetired((s) => !s)}
                  style={{ fontSize: 12, opacity: 0.7 }}>
            {showRetired ? '▾' : '▸'} {retired.length} retired
          </button>
          {showRetired && (
            <ul style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 12, opacity: 0.55 }}>
              {retired.map((r) => (
                <li key={r.id} style={{ marginBottom: 3 }}>
                  <s>{r.rule_text}</s> <span style={{ opacity: 0.7 }}>· retired {relative(r.retired_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div style={{ fontSize: 11, opacity: 0.5, marginTop: 10 }}>
        Rules are distilled from your ✎ notes each night and applied to the list
        automatically. Retiring one is instant — no deploy.
      </div>
    </div>
  )
}
