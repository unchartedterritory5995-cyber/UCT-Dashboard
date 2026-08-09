// app/src/components/admin/TwitterAccountsPanel.jsx
//
// Admin-only management of the curated TwitterAPI.io account list.
// Mirrors the Admin.jsx healthSection visual pattern (uses the same
// classes from Admin.module.css via inline reference — keeps the panel
// visually consistent with the rest of /admin without a new stylesheet).
import { useState } from 'react'
import useSWR from 'swr'
import adminStyles from '../../pages/Admin.module.css'
import UIcon from '../ui/UIcon'

// ⛔ NOT `fetch(url).then(r => r.json())` — a 402 answers JSON too, and
// its `{detail}` body is truthy, so every `!data` loading guard below is
// skipped and the consumer throws on an error object. See utils/jsonFetcher.js.
import fetcher from '../../utils/jsonFetcher'

function relativeMin(ts) {
  if (!ts) return '—'
  const secs = Math.max(0, Math.floor(Date.now() / 1000 - ts))
  if (secs < 60) return `${secs}s ago`
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`
  return `${Math.floor(secs / 86400)}d ago`
}

function StatusPill({ status }) {
  const colorMap = {
    ok: '#4ade80',
    auth_error: '#f87171',
    out_of_credits: '#f87171',
    rate_limited: '#fbbf24',
    error: '#f87171',
  }
  const color = colorMap[status] || 'var(--text-muted)'
  return (
    <span
      style={{
        padding: '2px 8px',
        borderRadius: 10,
        fontSize: 11,
        background: status ? `${color}26` : 'transparent',
        color,
      }}
    >
      {status || 'never'}
    </span>
  )
}

export default function TwitterAccountsPanel() {
  const { data: accounts, mutate } = useSWR(
    '/api/admin/twitter-accounts',
    fetcher,
    { refreshInterval: 60000 },
  )
  const { data: stats } = useSWR('/api/admin/twitter-stats', fetcher, {
    refreshInterval: 60000,
  })

  const [newHandle, setNewHandle] = useState('')
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState(null)

  async function addAccount() {
    if (!newHandle.trim()) return
    setAdding(true)
    setError(null)
    const r = await fetch('/api/admin/twitter-accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ handle: newHandle.trim().replace(/^@/, '') }),
    })
    setAdding(false)
    if (!r.ok) {
      const body = await r.json().catch(() => ({}))
      setError(body.detail || `HTTP ${r.status}`)
      return
    }
    setNewHandle('')
    mutate()
  }

  async function toggleEnabled(handle, enabled) {
    await fetch(`/api/admin/twitter-accounts/${handle}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled }),
    })
    mutate()
  }

  async function toggleOfficial(handle, isOfficial) {
    await fetch(`/api/admin/twitter-accounts/${handle}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_official: isOfficial }),
    })
    mutate()
  }

  async function removeAccount(handle) {
    if (!confirm(`Disable @${handle}?`)) return
    await fetch(`/api/admin/twitter-accounts/${handle}`, { method: 'DELETE' })
    mutate()
  }

  async function forcePoll(handle) {
    await fetch(`/api/admin/twitter-accounts/${handle}/force-poll`, {
      method: 'POST',
    })
    mutate()
  }

  return (
    <div className={adminStyles.healthSection}>
      <div className={adminStyles.sectionTitle}>Twitter Accounts</div>

      {!accounts ? (
        <div style={{ opacity: 0.6, fontSize: 13 }}>Loading…</div>
      ) : (
        <table
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            fontSize: 13,
            marginBottom: 12,
          }}
        >
          <thead>
            <tr>
              <th style={{ textAlign: 'left', padding: '4px 8px', opacity: 0.7 }}>Handle</th>
              <th style={{ textAlign: 'left', padding: '4px 8px', opacity: 0.7 }} title="Show in The Desk → Posts">Official</th>
              <th style={{ textAlign: 'left', padding: '4px 8px', opacity: 0.7 }}>Status</th>
              <th style={{ textAlign: 'left', padding: '4px 8px', opacity: 0.7 }}>Last poll</th>
              <th style={{ textAlign: 'right', padding: '4px 8px', opacity: 0.7 }}>Tweets seen</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {accounts.map((a) => {
              const ps = a.poll_state || {}
              return (
                <tr
                  key={a.handle}
                  style={{
                    opacity: a.enabled ? 1 : 0.5,
                    borderTop: '1px solid rgba(255,255,255,0.05)',
                  }}
                >
                  <td style={{ padding: '6px 8px' }}>@{a.handle}</td>
                  <td style={{ padding: '6px 8px' }}>
                    <button
                      onClick={() => toggleOfficial(a.handle, !a.is_official)}
                      title="Official UCT account — surfaces in The Desk → Posts"
                      style={{
                        fontSize: 11,
                        color: a.is_official ? '#c9a84c' : 'var(--text-muted)',
                        fontWeight: a.is_official ? 700 : 400,
                      }}
                    >
                      {a.is_official ? '★ official' : '☆ mark'}
                    </button>
                  </td>
                  <td style={{ padding: '6px 8px' }}>
                    <StatusPill status={ps.last_poll_status} />
                  </td>
                  <td style={{ padding: '6px 8px' }}>{relativeMin(ps.last_poll_at)}</td>
                  <td style={{ padding: '6px 8px', textAlign: 'right' }}>
                    {ps.total_tweets_seen ?? 0}
                  </td>
                  <td style={{ padding: '6px 8px', textAlign: 'right' }}>
                    <button
                      onClick={() => forcePoll(a.handle)}
                      style={{ marginRight: 4, fontSize: 11 }}
                      title="Trigger an immediate poll"
                    >
                      poll
                    </button>
                    <button
                      onClick={() => toggleEnabled(a.handle, !a.enabled)}
                      style={{ marginRight: 4, fontSize: 11 }}
                    >
                      {a.enabled ? 'disable' : 'enable'}
                    </button>
                    <button onClick={() => removeAccount(a.handle)} style={{ fontSize: 11 }}>
                      <UIcon name="x" size={11} />
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <input
          type="text"
          placeholder="handle (no @)"
          value={newHandle}
          onChange={(e) => setNewHandle(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addAccount()}
          style={{ flex: 1, padding: '4px 8px', fontSize: 13 }}
        />
        <button disabled={adding} onClick={addAccount}>
          {adding ? '…' : '+ Add'}
        </button>
      </div>
      {error && <div style={{ color: '#f87171', fontSize: 12 }}>{error}</div>}

      {stats && (
        <div style={{ fontSize: 12, opacity: 0.7, marginTop: 8 }}>
          Total tweets stored: <b>{stats.total_tweets}</b>
          {' · '}MTD estimated cost: <b>${stats.mtd_estimated_cost_usd?.toFixed(2) ?? '0.00'}</b>
        </div>
      )}
    </div>
  )
}
