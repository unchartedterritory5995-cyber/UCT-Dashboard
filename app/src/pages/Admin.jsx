import { useState, useEffect, useCallback, useRef } from 'react'
import styles from './Admin.module.css'

// ── Constants ──
const FILTERS = [
  { key: null, label: 'All' },
  { key: 'pro', label: 'Pro' },
  { key: 'free', label: 'Free' },
  { key: 'comped', label: 'Comped' },
]

const ACTION_COLORS = {
  LOGIN: 'muted',
  SIGNUP: 'green',
  EMAIL_VERIFIED: 'blue',
  PASSWORD_RESET: 'amber',
  COMP: 'gold',
  REVOKE: 'red',
}

// ── Helpers ──
function timeAgo(dateString) {
  if (!dateString) return '\u2014'
  const now = Date.now()
  const then = new Date(dateString).getTime()
  const diff = Math.max(0, now - then)
  const seconds = Math.floor(diff / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  const months = Math.floor(days / 30)
  return `${months}mo ago`
}

function formatDate(d) {
  if (!d) return '\u2014'
  const dt = new Date(d)
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function shortDate(d) {
  if (!d) return ''
  return d.slice(5)
}

function getUserPlan(user) {
  if (user.sub_status === 'comped') return 'comped'
  if (user.sub_status === 'active' || user.sub_status === 'trialing') return 'pro'
  return 'free'
}

function exportUsersCSV(users) {
  const headers = ['Email', 'Display Name', 'Plan', 'Status', 'Email Verified', 'Last Login', 'Signup Date']
  const rows = users.map(u => [
    u.email,
    u.display_name || '',
    getUserPlan(u),
    u.sub_status || 'none',
    u.email_verified ? 'Yes' : 'No',
    u.last_login_at || '',
    u.created_at || '',
  ])
  const csv = [headers, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `uct-users-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

// ── Sub-components ──
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

function ActionBadge({ action }) {
  const color = ACTION_COLORS[action] || 'muted'
  return <span className={`${styles.actBadge} ${styles[`act_${color}`]}`}>{action}</span>
}

// ── Signups Bar Chart ──
function SignupsChart({ data }) {
  if (!data || data.length === 0) return null
  const maxCount = Math.max(...data.map(d => d.count), 1)
  const barHeight = 180
  const [hover, setHover] = useState(null)

  return (
    <div className={styles.chart}>
      {data.map((d, i) => (
        <div
          key={d.date}
          className={styles.chartBarWrap}
          onMouseEnter={() => setHover(i)}
          onMouseLeave={() => setHover(null)}
        >
          {hover === i && (
            <div className={styles.chartTooltip}>
              <div className={styles.chartTooltipDate}>{formatDate(d.date)}</div>
              <div className={styles.chartTooltipCount}>{d.count} signup{d.count !== 1 ? 's' : ''}</div>
            </div>
          )}
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

// ── Activity Feed ──
function ActivityFeed({ items, loading, onRefresh }) {
  return (
    <div className={styles.activitySection}>
      <div className={styles.sectionHeader}>
        <span className={styles.sectionTitle}>Activity Feed</span>
        <button className={styles.refreshBtn} onClick={onRefresh} disabled={loading}>
          {loading ? 'Loading...' : 'Refresh'}
        </button>
      </div>
      <div className={styles.activityList}>
        {loading && items.length === 0 ? (
          <div className={styles.loading}>Loading activity...</div>
        ) : items.length === 0 ? (
          <div className={styles.emptyActivity}>No recent activity</div>
        ) : (
          items.map((a, i) => (
            <div key={i} className={styles.activityRow}>
              <span className={styles.activityTime}>{timeAgo(a.timestamp)}</span>
              <span className={styles.activityEmail}>{a.email || a.user_email || '\u2014'}</span>
              <ActionBadge action={a.action} />
            </div>
          ))
        )}
      </div>
    </div>
  )
}

// ── User Detail Drawer ──
function UserDetailDrawer({ userId, onClose, onAction }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!userId) return
    setLoading(true)
    setError('')
    fetch(`/api/auth/admin/users/${userId}`)
      .then(r => { if (!r.ok) throw new Error('Failed'); return r.json() })
      .then(d => setUser(d))
      .catch(() => setError('Failed to load user details'))
      .finally(() => setLoading(false))
  }, [userId])

  async function handleAction(action, payload = {}) {
    setActionLoading(action)
    setError('')
    try {
      let res
      if (action === 'comp' || action === 'revoke') {
        res = await fetch('/api/auth/admin/comp-access', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: user.email, action: action === 'comp' ? 'grant' : 'revoke' }),
        })
      } else if (action === 'force_verify') {
        res = await fetch(`/api/auth/admin/users/${userId}/verify`, { method: 'POST' })
      } else if (action === 'reset_password') {
        res = await fetch(`/api/auth/admin/users/${userId}/reset-password`, { method: 'POST' })
      } else if (action === 'delete') {
        if (!window.confirm(`Permanently delete ${user.email}? This cannot be undone.`)) {
          setActionLoading(null)
          return
        }
        res = await fetch(`/api/auth/admin/users/${userId}`, { method: 'DELETE' })
      }
      if (res && !res.ok) {
        const err = await res.json().catch(() => ({}))
        setError(err.detail || 'Action failed')
      } else {
        // Refresh drawer data + parent
        const refreshed = await fetch(`/api/auth/admin/users/${userId}`).then(r => r.json()).catch(() => null)
        if (refreshed) setUser(refreshed)
        if (onAction) onAction()
      }
    } catch {
      setError('Network error')
    } finally {
      setActionLoading(null)
    }
  }

  if (!userId) return null

  const plan = user ? getUserPlan(user) : 'free'
  const isComped = user?.sub_status === 'comped'
  const daysSinceSignup = user?.created_at
    ? Math.floor((Date.now() - new Date(user.created_at).getTime()) / 86400000)
    : null

  return (
    <>
      <div className={styles.drawerBackdrop} onClick={onClose} />
      <div className={styles.drawer}>
        <div className={styles.drawerHeader}>
          <h2 className={styles.drawerTitle}>User Details</h2>
          <button className={styles.drawerClose} onClick={onClose}>&times;</button>
        </div>

        {loading ? (
          <div className={styles.loading}>Loading...</div>
        ) : error && !user ? (
          <div className={styles.error}>{error}</div>
        ) : user ? (
          <div className={styles.drawerBody}>
            {error && <div className={styles.error}>{error}</div>}

            {/* User Header */}
            <div className={styles.drawerUserHeader}>
              <div className={styles.drawerEmail}>{user.email}</div>
              <div className={styles.drawerMeta}>
                {user.display_name && <span>{user.display_name}</span>}
                <PlanBadge plan={plan} />
                <StatusText status={user.sub_status} />
                {user.role === 'admin' && <span className={styles.adminTag}>ADMIN</span>}
              </div>
            </div>

            {/* Stats Row */}
            <div className={styles.drawerStats}>
              <div className={styles.drawerStat}>
                <span className={styles.drawerStatVal}>{user.journal_count ?? '\u2014'}</span>
                <span className={styles.drawerStatLbl}>Journal Entries</span>
              </div>
              <div className={styles.drawerStat}>
                <span className={styles.drawerStatVal}>{user.watchlist_count ?? '\u2014'}</span>
                <span className={styles.drawerStatLbl}>Watchlists</span>
              </div>
              <div className={styles.drawerStat}>
                <span className={styles.drawerStatVal}>{daysSinceSignup != null ? `${daysSinceSignup}d` : '\u2014'}</span>
                <span className={styles.drawerStatLbl}>Days Since Signup</span>
              </div>
            </div>

            {/* Subscription Details */}
            <div className={styles.drawerSection}>
              <div className={styles.drawerSectionTitle}>Subscription</div>
              <div className={styles.drawerFieldGrid}>
                <span className={styles.drawerFieldLabel}>Stripe ID</span>
                <span className={styles.drawerFieldValue}>
                  {user.stripe_customer_id
                    ? `${user.stripe_customer_id.slice(0, 14)}...`
                    : '\u2014'}
                </span>
                <span className={styles.drawerFieldLabel}>Period End</span>
                <span className={styles.drawerFieldValue}>{formatDate(user.current_period_end)}</span>
                <span className={styles.drawerFieldLabel}>Plan</span>
                <span className={styles.drawerFieldValue}>{plan}</span>
                <span className={styles.drawerFieldLabel}>Email Verified</span>
                <span className={styles.drawerFieldValue}>{user.email_verified ? 'Yes' : 'No'}</span>
                <span className={styles.drawerFieldLabel}>Last Login</span>
                <span className={styles.drawerFieldValue}>{user.last_login_at ? timeAgo(user.last_login_at) : '\u2014'}</span>
                <span className={styles.drawerFieldLabel}>Signed Up</span>
                <span className={styles.drawerFieldValue}>{formatDate(user.created_at)}</span>
              </div>
            </div>

            {/* Recent Activity */}
            {user.recent_activity && user.recent_activity.length > 0 && (
              <div className={styles.drawerSection}>
                <div className={styles.drawerSectionTitle}>Recent Activity</div>
                <div className={styles.drawerActivityList}>
                  {user.recent_activity.slice(0, 10).map((a, i) => (
                    <div key={i} className={styles.drawerActivityRow}>
                      <span className={styles.activityTime}>{timeAgo(a.timestamp)}</span>
                      <ActionBadge action={a.action} />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Actions */}
            <div className={styles.drawerSection}>
              <div className={styles.drawerSectionTitle}>Actions</div>
              <div className={styles.drawerActions}>
                {isComped ? (
                  <button
                    className={styles.revokeBtn}
                    onClick={() => handleAction('revoke')}
                    disabled={actionLoading === 'revoke'}
                  >
                    {actionLoading === 'revoke' ? '...' : 'Revoke Comp'}
                  </button>
                ) : (
                  <button
                    className={styles.compBtn}
                    onClick={() => handleAction('comp')}
                    disabled={actionLoading === 'comp'}
                  >
                    {actionLoading === 'comp' ? '...' : 'Comp Access'}
                  </button>
                )}
                {!user.email_verified && (
                  <button
                    className={styles.actionBtn}
                    onClick={() => handleAction('force_verify')}
                    disabled={actionLoading === 'force_verify'}
                  >
                    {actionLoading === 'force_verify' ? '...' : 'Force Verify'}
                  </button>
                )}
                <button
                  className={styles.actionBtn}
                  onClick={() => handleAction('reset_password')}
                  disabled={actionLoading === 'reset_password'}
                >
                  {actionLoading === 'reset_password' ? '...' : 'Reset Password'}
                </button>
                <button
                  className={styles.deleteBtn}
                  onClick={() => handleAction('delete')}
                  disabled={actionLoading === 'delete'}
                >
                  {actionLoading === 'delete' ? '...' : 'Delete User'}
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </>
  )
}

// ── Main Admin Page ──
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

  // Activity
  const [activity, setActivity] = useState([])
  const [activityLoading, setActivityLoading] = useState(true)

  // Drawer
  const [drawerUserId, setDrawerUserId] = useState(null)

  // Comp action
  const [compLoading, setCompLoading] = useState(null)

  // Stripe sync
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState('')

  // Health
  const [health, setHealth] = useState(null)

  // Error
  const [error, setError] = useState('')

  // ── Fetch Stats ──
  const fetchStats = useCallback(() => {
    setStatsLoading(true)
    fetch('/api/auth/admin/stats')
      .then(r => { if (!r.ok) throw new Error('Failed'); return r.json() })
      .then(d => setStats(d))
      .catch(() => setError('Failed to load stats'))
      .finally(() => setStatsLoading(false))
  }, [])

  useEffect(() => { fetchStats() }, [fetchStats])

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

  // ── Fetch Activity ──
  const fetchActivity = useCallback(() => {
    setActivityLoading(true)
    fetch('/api/auth/admin/activity?limit=30')
      .then(r => { if (!r.ok) throw new Error('Failed'); return r.json() })
      .then(d => setActivity(Array.isArray(d) ? d : d.items || []))
      .catch(() => {})
      .finally(() => setActivityLoading(false))
  }, [])

  useEffect(() => { fetchActivity() }, [fetchActivity])

  // ── Fetch Health ──
  useEffect(() => {
    fetch('/api/health')
      .then(r => r.json())
      .then(d => setHealth(d))
      .catch(() => {})
  }, [])

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
      fetchUsers()
      fetchStats()
    } catch {
      setError('Network error')
    } finally {
      setCompLoading(null)
    }
  }

  // ── Force Verify ──
  async function handleForceVerify(userId) {
    try {
      const res = await fetch(`/api/auth/admin/users/${userId}/verify`, { method: 'POST' })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        setError(err.detail || 'Verify failed')
        return
      }
      fetchUsers()
      fetchStats()
    } catch {
      setError('Network error')
    }
  }

  // ── Delete User ──
  async function handleDelete(userId, email) {
    if (!window.confirm(`Permanently delete ${email}? This cannot be undone.`)) return
    try {
      const res = await fetch(`/api/auth/admin/users/${userId}`, { method: 'DELETE' })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        setError(err.detail || 'Delete failed')
        return
      }
      fetchUsers()
      fetchStats()
    } catch {
      setError('Network error')
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
      fetchUsers()
      fetchStats()
    } catch {
      setSyncMsg('Sync failed')
    } finally {
      setSyncing(false)
    }
  }

  // ── Drawer callbacks ──
  function handleDrawerAction() {
    fetchUsers()
    fetchStats()
    fetchActivity()
  }

  // ── Derived stats ──
  const conversionRate = stats && stats.total_users > 0
    ? ((stats.pro_subscribers / stats.total_users) * 100).toFixed(1)
    : '0.0'

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.heading}>Admin</h1>
      </div>

      {error && <div className={styles.error}>{error}</div>}

      {/* ── Section 1: Stats Cards (Row 1) ── */}
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

      {/* ── Stats Cards (Row 2) ── */}
      <div className={styles.statsGrid}>
        <div className={styles.statCard}>
          <span className={styles.statNumber}>{statsLoading ? '\u2014' : `${conversionRate}%`}</span>
          <span className={styles.statLabel}>Conversion Rate</span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statNumber}>{statsLoading ? '\u2014' : stats?.unverified_users ?? 0}</span>
          <span className={styles.statLabel}>Unverified Users</span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statNumber}>{statsLoading ? '\u2014' : stats?.active_sessions ?? 0}</span>
          <span className={styles.statLabel}>Active Sessions</span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statNumber}>{statsLoading ? '\u2014' : stats?.churn_30d ?? 0}</span>
          <span className={styles.statLabel}>30d Churn</span>
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

      {/* ── Section 3: Activity Feed ── */}
      <ActivityFeed
        items={activity}
        loading={activityLoading}
        onRefresh={fetchActivity}
      />

      {/* ── Section 4: User Management Table ── */}
      <div className={styles.usersSection}>
        <div className={styles.sectionHeader}>
          <span className={styles.sectionTitle}>User Management</span>
          <button
            className={styles.csvBtn}
            onClick={() => exportUsersCSV(users)}
            disabled={users.length === 0}
          >
            Export CSV
          </button>
        </div>

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
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Display Name</th>
                  <th>Plan</th>
                  <th>Status</th>
                  <th className={styles.hideOnMobile}>Verified</th>
                  <th className={styles.hideOnMobile}>Last Login</th>
                  <th>Signup</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.length === 0 ? (
                  <tr><td colSpan={8} className={styles.emptyRow}>No users found</td></tr>
                ) : users.map(u => {
                  const plan = getUserPlan(u)
                  const isComped = u.sub_status === 'comped'
                  return (
                    <tr key={u.id}>
                      <td
                        className={styles.emailCell}
                        onClick={() => setDrawerUserId(u.id)}
                        title="Click to view details"
                      >
                        {u.email}
                      </td>
                      <td className={styles.nameCell}>{u.display_name || '\u2014'}</td>
                      <td><PlanBadge plan={plan} /></td>
                      <td><StatusText status={u.sub_status} /></td>
                      <td className={styles.hideOnMobile}>
                        {u.email_verified
                          ? <span className={styles.verifiedYes}>&#10003;</span>
                          : <span className={styles.verifiedNo}>&#10007;</span>
                        }
                      </td>
                      <td className={`${styles.dateCell} ${styles.hideOnMobile}`}>
                        {u.last_login_at ? timeAgo(u.last_login_at) : '\u2014'}
                      </td>
                      <td className={styles.dateCell}>{formatDate(u.created_at)}</td>
                      <td className={styles.actionsCell}>
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
                        {!u.email_verified && (
                          <button
                            className={styles.verifyBtn}
                            onClick={() => handleForceVerify(u.id)}
                            title="Force verify email"
                          >
                            Verify
                          </button>
                        )}
                        <button
                          className={styles.deleteBtn}
                          onClick={() => handleDelete(u.id, u.email)}
                          title="Delete user"
                        >
                          Del
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Section 6: System Health ── */}
      <div className={styles.healthSection}>
        <div className={styles.sectionTitle}>System Health</div>
        <div className={styles.healthGrid}>
          <div className={styles.healthItem}>
            <span className={styles.healthLabel}>Wire Data</span>
            <span className={styles.healthValue}>
              {health?.wire_date || health?.wire_data_date || '\u2014'}
            </span>
          </div>
          <div className={styles.healthItem}>
            <span className={styles.healthLabel}>Stripe Sync</span>
            <div className={styles.healthSyncRow}>
              <button
                className={styles.syncBtn}
                onClick={handleSync}
                disabled={syncing}
              >
                {syncing ? 'Syncing...' : 'Sync Subscriptions'}
              </button>
              {syncMsg && <span className={styles.syncMsg}>{syncMsg}</span>}
            </div>
          </div>
        </div>
      </div>

      {/* ── User Detail Drawer ── */}
      {drawerUserId && (
        <UserDetailDrawer
          userId={drawerUserId}
          onClose={() => setDrawerUserId(null)}
          onAction={handleDrawerAction}
        />
      )}
    </div>
  )
}
