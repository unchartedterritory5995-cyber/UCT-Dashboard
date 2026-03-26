import { useState, useEffect, useCallback, useRef } from 'react'
import styles from './Admin.module.css'

const FILTERS = [
  { key: null, label: 'All' },
  { key: 'pro', label: 'Pro' },
  { key: 'free', label: 'Free' },
  { key: 'comped', label: 'Comped' },
]

function formatDate(d) {
  if (!d) return '\u2014'
  const dt = new Date(d)
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function shortDate(d) {
  if (!d) return ''
  return d.slice(5) // "MM-DD" from "YYYY-MM-DD"
}

function getUserPlan(user) {
  if (user.sub_status === 'comped') return 'comped'
  if (user.sub_status === 'active' || user.sub_status === 'trialing') return 'pro'
  return 'free'
}

function StatusText({ status }) {
  if (!status) return <span className={styles.statusCanceled}>none</span>
  if (status === 'active') return <span className={styles.statusActive}>active</span>
  if (status === 'trialing') return <span className={styles.statusTrialing}>trialing</span>
  if (status === 'comped') return <span className={styles.statusActive}>comped</span>
  return <span className={styles.statusCanceled}>{status}</span>
}

function PlanBadge({ plan }) {
  const cls = plan === 'pro' ? styles.badgePro
    : plan === 'comped' ? styles.badgeComped
    : styles.badgeFree
  return <span className={`${styles.badge} ${cls}`}>{plan}</span>
}

// ── Signups Bar Chart (inline SVG) ──
function SignupsChart({ data }) {
  if (!data || data.length === 0) return null
  const maxCount = Math.max(...data.map(d => d.count), 1)
  const barHeight = 120

  return (
    <div className={styles.chart}>
      {data.map(d => (
        <div key={d.date} className={styles.chartBarWrap} title={`${d.date}: ${d.count} signup${d.count !== 1 ? 's' : ''}`}>
          <div
            className={styles.chartBar}
            style={{ height: `${Math.max((d.count / maxCount) * barHeight, 2)}px` }}
          />
          <span className={styles.chartDateLabel}>{shortDate(d.date)}</span>
        </div>
      ))}
    </div>
  )
}

export default function Admin() {
  // Stats
  const [stats, setStats] = useState(null)
  const [statsLoading, setStatsLoading] = useState(true)

  // Users
  const [users, setUsers] = useState([])
  const [usersLoading, setUsersLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [planFilter, setPlanFilter] = useState(null)
  const debounceRef = useRef(null)

  // Comp action
  const [compLoading, setCompLoading] = useState(null) // email being processed

  // Stripe sync
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState('')

  // Error
  const [error, setError] = useState('')

  // ── Fetch Stats ──
  useEffect(() => {
    setStatsLoading(true)
    fetch('/api/auth/admin/stats')
      .then(r => { if (!r.ok) throw new Error('Failed'); return r.json() })
      .then(d => setStats(d))
      .catch(() => setError('Failed to load stats'))
      .finally(() => setStatsLoading(false))
  }, [])

  // ── Fetch Users (debounced search) ──
  const fetchUsers = useCallback(() => {
    setUsersLoading(true)
    const params = new URLSearchParams()
    if (search) params.set('search', search)
    if (planFilter) params.set('plan', planFilter)
    params.set('sort', 'created_at')

    fetch(`/api/auth/admin/users?${params}`)
      .then(r => { if (!r.ok) throw new Error('Failed'); return r.json() })
      .then(d => setUsers(d))
      .catch(() => setError('Failed to load users'))
      .finally(() => setUsersLoading(false))
  }, [search, planFilter])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(fetchUsers, 300)
    return () => clearTimeout(debounceRef.current)
  }, [fetchUsers])

  // ── Comp/Revoke ──
  async function handleComp(email, action) {
    setCompLoading(email)
    setError('')
    try {
      const res = await fetch('/api/auth/admin/comp-access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, action }),
      })
      if (!res.ok) {
        const err = await res.json()
        setError(err.detail || 'Failed')
        return
      }
      // Refresh users + stats
      fetchUsers()
      fetch('/api/auth/admin/stats')
        .then(r => r.json())
        .then(d => setStats(d))
    } catch {
      setError('Network error')
    } finally {
      setCompLoading(null)
    }
  }

  // ── Stripe Sync ──
  async function handleSync() {
    setSyncing(true)
    setSyncMsg('')
    try {
      const res = await fetch('/api/auth/admin/sync-subscriptions', { method: 'POST' })
      const data = await res.json()
      setSyncMsg(`Synced ${data.synced?.length || 0} subscription(s)`)
      // Refresh
      fetchUsers()
      fetch('/api/auth/admin/stats').then(r => r.json()).then(d => setStats(d))
    } catch {
      setSyncMsg('Sync failed')
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.heading}>Admin</h1>
      </div>

      {error && <div className={styles.error}>{error}</div>}

      {/* ── Section 1: Stats Overview ── */}
      <div className={styles.statsGrid}>
        <div className={styles.statCard}>
          <span className={styles.statNumber}>{statsLoading ? '\u2014' : stats?.total_users ?? 0}</span>
          <span className={styles.statLabel}>Total Users</span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statNumber}>{statsLoading ? '\u2014' : stats?.pro_subscribers ?? 0}</span>
          <span className={styles.statLabel}>Active Subscribers</span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statNumber}>
            {statsLoading ? '\u2014' : `$${(stats?.mrr ?? 0).toLocaleString()}`}
          </span>
          <span className={styles.statLabel}>MRR</span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statNumber}>{statsLoading ? '\u2014' : stats?.new_signups_7d ?? 0}</span>
          <span className={styles.statLabel}>New This Week</span>
        </div>
      </div>

      {/* ── Section 2: Signups Chart ── */}
      <div className={styles.chartSection}>
        <div className={styles.chartTitle}>
          Signups — Last 30 Days ({stats?.new_signups_30d ?? 0} total)
        </div>
        {stats?.signups_by_day ? (
          <SignupsChart data={stats.signups_by_day} />
        ) : (
          <div className={styles.loading}>Loading chart...</div>
        )}
      </div>

      {/* ── Section 3: User Management ── */}
      <div className={styles.usersSection}>
        <div className={styles.usersSectionTitle}>User Management</div>

        <div className={styles.controls}>
          <input
            type="text"
            className={styles.searchInput}
            placeholder="Search by email..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <div className={styles.filterPills}>
            {FILTERS.map(f => (
              <button
                key={f.key ?? 'all'}
                className={planFilter === f.key ? styles.pillActive : styles.pill}
                onClick={() => setPlanFilter(f.key)}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {usersLoading ? (
          <div className={styles.loading}>Loading users...</div>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Email</th>
                <th>Display Name</th>
                <th>Plan</th>
                <th>Status</th>
                <th>Signup Date</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.length === 0 ? (
                <tr><td colSpan={6} className={styles.emptyRow}>No users found</td></tr>
              ) : users.map(u => {
                const plan = getUserPlan(u)
                const isComped = u.sub_status === 'comped'
                return (
                  <tr key={u.id}>
                    <td className={styles.emailCell}>{u.email}</td>
                    <td className={styles.nameCell}>{u.display_name || '\u2014'}</td>
                    <td><PlanBadge plan={plan} /></td>
                    <td><StatusText status={u.sub_status} /></td>
                    <td className={styles.dateCell}>{formatDate(u.created_at)}</td>
                    <td>
                      {isComped ? (
                        <button
                          className={styles.revokeBtn}
                          onClick={() => handleComp(u.email, 'revoke')}
                          disabled={compLoading === u.email}
                        >
                          {compLoading === u.email ? '...' : 'Revoke'}
                        </button>
                      ) : (
                        <button
                          className={styles.compBtn}
                          onClick={() => handleComp(u.email, 'grant')}
                          disabled={compLoading === u.email}
                        >
                          {compLoading === u.email ? '...' : 'Comp'}
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Section 4: Stripe Health ── */}
      <div className={styles.stripeSection}>
        <div className={styles.stripeSectionTitle}>Stripe Health</div>
        <button
          className={styles.syncBtn}
          onClick={handleSync}
          disabled={syncing}
        >
          {syncing ? 'Syncing...' : 'Sync Subscriptions'}
        </button>
        {syncMsg && <div className={styles.syncMsg}>{syncMsg}</div>}
      </div>
    </div>
  )
}
