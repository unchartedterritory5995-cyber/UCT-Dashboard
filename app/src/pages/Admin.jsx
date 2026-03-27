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
  if (isNaN(then)) return '\u2014'
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

function copyToClipboard(text) {
  navigator.clipboard.writeText(text).catch(() => {})
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

// ── Tag System ──
const PREDEFINED_TAGS = ['VIP', 'Beta Tester', 'At Risk', 'Whale', 'Influencer', 'Support Priority']
const TAG_COLORS = {
  'VIP': 'tagVip',
  'Beta Tester': 'tagBeta',
  'At Risk': 'tagRisk',
  'Whale': 'tagWhale',
  'Influencer': 'tagInfluencer',
  'Support Priority': 'tagPriority',
}

function TagPill({ tag, onRemove }) {
  const cls = TAG_COLORS[tag] || ''
  return (
    <span className={`${styles.tagPill} ${cls ? styles[cls] : ''}`}>
      {tag}
      {onRemove && (
        <button className={styles.tagRemove} onClick={e => { e.stopPropagation(); onRemove(tag) }}>&times;</button>
      )}
    </span>
  )
}

function StarRating({ value }) {
  return (
    <span style={{ color: '#c9a84c', letterSpacing: 1 }}>
      {[1, 2, 3, 4, 5].map(n => (
        <span key={n} style={{ opacity: n <= value ? 1 : 0.2 }}>&#9733;</span>
      ))}
    </span>
  )
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
              <span className={styles.activityTime}>{timeAgo(a.created_at)}</span>
              <span className={styles.activityEmail}>{a.email || a.display_name || '\u2014'}</span>
              <ActionBadge action={a.action} />
            </div>
          ))
        )}
      </div>
    </div>
  )
}

// ── MRR Popover ──
function MRRPopover({ stats, visible, onClose }) {
  const ref = useRef(null)

  useEffect(() => {
    if (!visible) return
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) onClose()
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [visible, onClose])

  if (!visible || !stats) return null

  return (
    <div className={styles.mrrPopover} ref={ref}>
      <div className={styles.mrrPopoverRow}>
        <span>{stats.paying_subscribers ?? (stats.pro_subscribers - (stats.comped_count ?? 0))}</span>
        <span className={styles.mrrPopoverLabel}>&times; $20/mo subscribers</span>
      </div>
      <div className={styles.mrrPopoverRow}>
        <span>{stats.comped_count ?? 0}</span>
        <span className={styles.mrrPopoverLabel}>comped (free)</span>
      </div>
      <div className={styles.mrrPopoverDivider} />
      <div className={styles.mrrPopoverRow}>
        <span className={styles.mrrPopoverTotal}>${(stats.mrr ?? 0).toLocaleString()}</span>
        <span className={styles.mrrPopoverLabel}>monthly recurring</span>
      </div>
    </div>
  )
}

// ── Announcement Section ──
function AnnouncementSection() {
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [audience, setAudience] = useState('all')
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')

  async function handleSend() {
    if (!subject.trim() || !message.trim()) {
      setError('Subject and message are required')
      return
    }
    if (!window.confirm(`Send this announcement to ${audience === 'all' ? 'ALL users' : audience === 'pro' ? 'Pro users only' : 'Free users only'}?`)) {
      return
    }
    setSending(true)
    setError('')
    setResult(null)
    try {
      const res = await fetch('/api/auth/admin/send-announcement', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject: subject.trim(), message: message.trim(), audience }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        setError(err.detail || 'Failed to send')
        return
      }
      const data = await res.json()
      setResult(`Sent to ${data.sent} of ${data.total} recipients`)
      setSubject('')
      setMessage('')
    } catch {
      setError('Network error')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className={styles.announcementSection}>
      <div className={styles.sectionTitle}>Send Announcement</div>
      <div className={styles.announcementForm}>
        <input
          type="text"
          className={styles.announcementInput}
          placeholder="Subject line..."
          value={subject}
          onChange={e => setSubject(e.target.value)}
        />
        <textarea
          className={styles.announcementTextarea}
          placeholder="Message body (plain text)..."
          rows={5}
          value={message}
          onChange={e => setMessage(e.target.value)}
        />
        <div className={styles.announcementControls}>
          <div className={styles.audiencePills}>
            {[
              { key: 'all', label: 'All Users' },
              { key: 'pro', label: 'Pro Only' },
              { key: 'free', label: 'Free Only' },
            ].map(a => (
              <button
                key={a.key}
                className={audience === a.key ? styles.pillActive : styles.pill}
                onClick={() => setAudience(a.key)}
              >
                {a.label}
              </button>
            ))}
          </div>
          <button
            className={styles.sendBtn}
            onClick={handleSend}
            disabled={sending || !subject.trim() || !message.trim()}
          >
            {sending ? 'Sending...' : 'Send Announcement'}
          </button>
        </div>
        {error && <div className={styles.error}>{error}</div>}
        {result && <div className={styles.successMsg}>{result}</div>}
      </div>
    </div>
  )
}

// ── Revenue Chart (MRR over time) ──
function RevenueChart({ data }) {
  if (!data || data.length === 0) return null

  const mrrs = data.map(d => d.mrr)
  const maxMrr = Math.max(...mrrs, 1)
  const minMrr = Math.min(...mrrs, 0)
  const range = maxMrr - minMrr || 1

  const w = 600
  const h = 160
  const padX = 0
  const padY = 10

  const points = data.map((d, i) => {
    const x = padX + (i / Math.max(data.length - 1, 1)) * (w - padX * 2)
    const y = padY + (1 - (d.mrr - minMrr) / range) * (h - padY * 2)
    return `${x},${y}`
  }).join(' ')

  // Fill polygon (area under line)
  const firstX = padX
  const lastX = padX + ((data.length - 1) / Math.max(data.length - 1, 1)) * (w - padX * 2)
  const fillPoints = `${firstX},${h} ${points} ${lastX},${h}`

  const currentMrr = data[data.length - 1]?.mrr ?? 0
  const thirtyAgo = data.length > 30 ? data[data.length - 31]?.mrr : data[0]?.mrr
  const mrrChange = thirtyAgo != null ? currentMrr - thirtyAgo : null
  const mrrChangePct = thirtyAgo ? ((currentMrr - thirtyAgo) / thirtyAgo * 100).toFixed(1) : null

  const currentSubs = data[data.length - 1]?.pro_subscribers ?? 0
  const firstSubs = data[0]?.pro_subscribers ?? 0
  const subsTrend = currentSubs - firstSubs

  return (
    <div className={styles.revenueChart}>
      <div className={styles.sectionHeader}>
        <span className={styles.sectionTitle}>Revenue — MRR Over Time</span>
      </div>
      <div className={styles.revenueStats}>
        <div className={styles.revenueStat}>
          <span className={styles.revenueStatVal}>${currentMrr.toLocaleString()}</span>
          <span className={styles.revenueStatLbl}>Current MRR</span>
        </div>
        <div className={styles.revenueStat}>
          <span className={styles.revenueStatVal} style={{ color: mrrChange > 0 ? '#4ade80' : mrrChange < 0 ? '#f87171' : 'var(--text-muted)' }}>
            {mrrChange != null ? `${mrrChange >= 0 ? '+' : ''}$${mrrChange}` : '\u2014'}
            {mrrChangePct != null && <span style={{ fontSize: 11, marginLeft: 4 }}>({mrrChange >= 0 ? '+' : ''}{mrrChangePct}%)</span>}
          </span>
          <span className={styles.revenueStatLbl}>30d Change</span>
        </div>
        <div className={styles.revenueStat}>
          <span className={styles.revenueStatVal} style={{ color: subsTrend > 0 ? '#4ade80' : subsTrend < 0 ? '#f87171' : 'var(--text-muted)' }}>
            {currentSubs} <span style={{ fontSize: 11 }}>({subsTrend >= 0 ? '+' : ''}{subsTrend})</span>
          </span>
          <span className={styles.revenueStatLbl}>Subscribers</span>
        </div>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} className={styles.revenueSvg} preserveAspectRatio="none">
        <defs>
          <linearGradient id="mrrFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--ut-gold)" stopOpacity="0.25" />
            <stop offset="100%" stopColor="var(--ut-gold)" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        <polygon points={fillPoints} fill="url(#mrrFill)" />
        <polyline
          points={points}
          fill="none"
          stroke="var(--ut-gold)"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </svg>
    </div>
  )
}

// ── Admin Audit Log ──
const ADMIN_ACTIONS = new Set([
  'comp_granted', 'comp_revoked', 'force_verified', 'delete_user',
  'COMP_GRANTED', 'COMP_REVOKED', 'FORCE_VERIFIED', 'DELETE_USER',
  'ANNOUNCEMENT_SENT', 'announcement_sent',
])

function AuditLogSection({ activity }) {
  const [showAuditOnly, setShowAuditOnly] = useState(false)

  const items = showAuditOnly
    ? activity.filter(a => ADMIN_ACTIONS.has(a.action))
    : activity

  return (
    <div className={styles.auditSection}>
      <div className={styles.sectionHeader}>
        <span className={styles.sectionTitle}>Admin Audit Log</span>
        <button
          className={showAuditOnly ? styles.auditToggleActive : styles.auditToggle}
          onClick={() => setShowAuditOnly(v => !v)}
        >
          {showAuditOnly ? 'Showing Admin Only' : 'Show Admin Actions Only'}
        </button>
      </div>
      <div className={styles.activityList}>
        {items.length === 0 ? (
          <div className={styles.emptyActivity}>No admin actions found</div>
        ) : items.map((a, i) => (
          <div key={i} className={styles.activityRow}>
            <span className={styles.activityTime}>{timeAgo(a.created_at)}</span>
            <span className={styles.activityEmail}>{a.email || '\u2014'}</span>
            <ActionBadge action={a.action} />
            {a.details && <span className={styles.auditDetails}>{a.details}</span>}
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Page Analytics ──
function PageAnalytics() {
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/auth/admin/analytics?days=7')
      .then(r => { if (!r.ok) throw new Error('Failed'); return r.json() })
      .then(d => setData(Array.isArray(d) ? d : []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div className={styles.loading}>Loading analytics...</div>
  if (data.length === 0) return null

  const maxViews = Math.max(...data.map(d => d.views), 1)

  return (
    <div className={styles.analyticsSection}>
      <div className={styles.sectionTitle}>Page Analytics — Last 7 Days</div>
      <div className={styles.analyticsBars}>
        {data.slice(0, 10).map(d => (
          <div key={d.page} className={styles.analyticsBarRow}>
            <span className={styles.analyticsBarLabel}>{d.page}</span>
            <div className={styles.analyticsBarTrack}>
              <div
                className={styles.analyticsBar}
                style={{ width: `${(d.views / maxViews) * 100}%` }}
              />
            </div>
            <span className={styles.analyticsBarVal}>{d.views}</span>
            <span className={styles.analyticsBarUsers}>{d.unique_users}u</span>
          </div>
        ))}
      </div>
      <div className={styles.analyticsTable}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Page</th>
              <th>Views</th>
              <th>Unique Users</th>
            </tr>
          </thead>
          <tbody>
            {data.map(d => (
              <tr key={d.page}>
                <td className={styles.analyticsPageCell}>{d.page}</td>
                <td>{d.views}</td>
                <td>{d.unique_users}</td>
              </tr>
            ))}
          </tbody>
        </table>
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
  const [copied, setCopied] = useState(false)
  const [noteText, setNoteText] = useState('')
  const [noteLoading, setNoteLoading] = useState(false)
  const [customTagInput, setCustomTagInput] = useState('')

  async function handleAddTag(tag) {
    try {
      await fetch(`/api/auth/admin/users/${userId}/tags`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tag }),
      })
      const refreshed = await fetch(`/api/auth/admin/users/${userId}`).then(r => r.json()).catch(() => null)
      if (refreshed) setUser(refreshed)
      if (onAction) onAction()
    } catch { /* silent */ }
  }

  async function handleRemoveTag(tag) {
    try {
      await fetch(`/api/auth/admin/users/${userId}/tags/${encodeURIComponent(tag)}`, { method: 'DELETE' })
      const refreshed = await fetch(`/api/auth/admin/users/${userId}`).then(r => r.json()).catch(() => null)
      if (refreshed) setUser(refreshed)
      if (onAction) onAction()
    } catch { /* silent */ }
  }

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

  // Escape key closes drawer
  useEffect(() => {
    if (!userId) return
    function handleKey(e) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [userId, onClose])

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

  function handleCopyStripeId() {
    const stripeId = user?.subscription?.stripe_customer_id || user?.stripe_customer_id
    if (stripeId) {
      copyToClipboard(stripeId)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  async function handleAddNote() {
    if (!noteText.trim()) return
    setNoteLoading(true)
    try {
      const res = await fetch(`/api/auth/admin/users/${userId}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: noteText.trim() }),
      })
      if (res.ok) {
        setNoteText('')
        // Refresh drawer
        const refreshed = await fetch(`/api/auth/admin/users/${userId}`).then(r => r.json()).catch(() => null)
        if (refreshed) setUser(refreshed)
      }
    } catch { /* silent */ }
    finally { setNoteLoading(false) }
  }

  if (!userId) return null

  const plan = user ? getUserPlan(user) : 'free'
  const isComped = user?.sub_status === 'comped'
  const daysSinceSignup = user?.created_at
    ? Math.floor((Date.now() - new Date(user.created_at).getTime()) / 86400000)
    : null
  const stripeId = user?.subscription?.stripe_customer_id || user?.stripe_customer_id

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

            {/* Subscription Lifecycle Timeline */}
            <div className={styles.drawerSection}>
              <div className={styles.drawerSectionTitle}>Lifecycle</div>
              <div className={styles.timeline}>
                <div className={styles.timelineNode}>
                  <span className={styles.timelineDot} style={{ background: '#4ade80' }} />
                  <span className={styles.timelineLabel}>Signed Up</span>
                  <span className={styles.timelineDate}>{formatDate(user.created_at)}</span>
                </div>
                <div className={styles.timelineNode}>
                  <span className={styles.timelineDot} style={{ background: user.email_verified ? '#60a5fa' : '#666' }} />
                  <span className={styles.timelineLabel}>{user.email_verified ? 'Email Verified' : 'Email Not Verified'}</span>
                  <span className={styles.timelineDate}>
                    {user.email_verified
                      ? (user.recent_activity?.find(a => a.action === 'email_verified')
                          ? formatDate(user.recent_activity.find(a => a.action === 'email_verified').created_at)
                          : '\u2713')
                      : '\u23F3 pending'}
                  </span>
                </div>
                <div className={styles.timelineNode}>
                  <span className={styles.timelineDot} style={{ background: user.subscription ? '#c9a84c' : '#666' }} />
                  <span className={styles.timelineLabel}>{user.subscription ? 'Subscribed' : 'No Subscription'}</span>
                  <span className={styles.timelineDate}>
                    {user.subscription ? formatDate(user.subscription.created_at) : '\u23F3 free'}
                  </span>
                </div>
                <div className={styles.timelineNode}>
                  <span className={styles.timelineDot} style={{ background: user.last_login_at ? '#4ade80' : '#666' }} />
                  <span className={styles.timelineLabel}>Last Active</span>
                  <span className={styles.timelineDate}>
                    {user.last_login_at ? timeAgo(user.last_login_at) : '\u2014'}
                  </span>
                </div>
              </div>
            </div>

            {/* Subscription Details */}
            <div className={styles.drawerSection}>
              <div className={styles.drawerSectionTitle}>Subscription</div>
              <div className={styles.drawerFieldGrid}>
                <span className={styles.drawerFieldLabel}>Stripe ID</span>
                <span className={styles.drawerFieldValue}>
                  {stripeId ? (
                    <>
                      {stripeId.slice(0, 14)}...
                      <button
                        className={styles.copyBtn}
                        onClick={handleCopyStripeId}
                        title="Copy full Stripe ID"
                      >
                        {copied ? 'Copied' : 'Copy'}
                      </button>
                    </>
                  ) : '\u2014'}
                </span>
                <span className={styles.drawerFieldLabel}>Period End</span>
                <span className={styles.drawerFieldValue}>
                  {formatDate(user.subscription?.current_period_end || user.current_period_end)}
                </span>
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
                      <span className={styles.activityTime}>{timeAgo(a.created_at)}</span>
                      <ActionBadge action={a.action} />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Login History */}
            {user.login_history && user.login_history.length > 0 && (
              <div className={styles.drawerSection}>
                <div className={styles.drawerSectionTitle}>Login History</div>
                <div className={styles.loginHistoryList}>
                  {user.login_history.map((l, i) => (
                    <div key={i} className={styles.loginEntry}>
                      <span className={styles.activityTime}>{timeAgo(l.created_at)}</span>
                      <span className={styles.loginIp}>{l.ip_address || 'unknown'}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Engagement */}
            {user.engagement && (
              <div className={styles.drawerSection}>
                <div className={styles.drawerSectionTitle}>Engagement</div>
                <div className={styles.drawerFieldGrid}>
                  <span className={styles.drawerFieldLabel}>Page Views</span>
                  <span className={styles.drawerFieldValue}>{user.engagement.total_page_views ?? 0}</span>
                  <span className={styles.drawerFieldLabel}>Unique Pages</span>
                  <span className={styles.drawerFieldValue}>{user.engagement.unique_pages ?? 0}</span>
                  <span className={styles.drawerFieldLabel}>Last Page</span>
                  <span className={styles.drawerFieldValue}>{user.engagement.last_active_page || '\u2014'}</span>
                </div>
              </div>
            )}

            {/* Tags */}
            <div className={styles.drawerSection}>
              <div className={styles.drawerSectionTitle}>Tags</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                {(user.tags || []).map(t => (
                  <TagPill key={t} tag={t} onRemove={handleRemoveTag} />
                ))}
                {(user.tags || []).length === 0 && (
                  <span style={{ fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic' }}>No tags</span>
                )}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
                {PREDEFINED_TAGS.filter(t => !(user.tags || []).includes(t)).map(t => (
                  <button
                    key={t}
                    className={styles.actionBtn}
                    style={{ fontSize: 10, padding: '2px 8px' }}
                    onClick={() => handleAddTag(t)}
                  >
                    + {t}
                  </button>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  type="text"
                  className={styles.noteInput}
                  placeholder="Custom tag..."
                  value={customTagInput}
                  onChange={e => setCustomTagInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && customTagInput.trim()) {
                      handleAddTag(customTagInput.trim())
                      setCustomTagInput('')
                    }
                  }}
                  style={{ flex: 1 }}
                />
                <button
                  className={styles.noteBtn}
                  onClick={() => {
                    if (customTagInput.trim()) {
                      handleAddTag(customTagInput.trim())
                      setCustomTagInput('')
                    }
                  }}
                  disabled={!customTagInput.trim()}
                >
                  Add
                </button>
              </div>
            </div>

            {/* Admin Notes */}
            <div className={styles.drawerSection}>
              <div className={styles.drawerSectionTitle}>Admin Notes</div>
              <div className={styles.notesList}>
                {(user.notes || []).length === 0 ? (
                  <div className={styles.emptyActivity} style={{ padding: 8 }}>No notes yet</div>
                ) : (user.notes || []).map(n => (
                  <div key={n.id} className={styles.noteItem}>
                    <div className={styles.noteHeader}>
                      <span className={styles.noteAdmin}>{n.admin_email}</span>
                      <span className={styles.noteTime}>{timeAgo(n.created_at)}</span>
                    </div>
                    <div className={styles.noteBody}>{n.note}</div>
                  </div>
                ))}
              </div>
              <div className={styles.noteInputRow}>
                <input
                  type="text"
                  className={styles.noteInput}
                  placeholder="Add a note..."
                  value={noteText}
                  onChange={e => setNoteText(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleAddNote() }}
                />
                <button
                  className={styles.noteBtn}
                  onClick={handleAddNote}
                  disabled={noteLoading || !noteText.trim()}
                >
                  {noteLoading ? '...' : 'Add'}
                </button>
              </div>
            </div>

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

// ── Ticket Drawer ──
const TICKET_STATUSES = ['open', 'in_progress', 'resolved']
const TICKET_PRIORITIES = ['low', 'normal', 'high', 'urgent']
const PRIORITY_COLORS = { low: '#706b5e', normal: 'var(--text-bright)', high: '#fbbf24', urgent: '#f87171' }

function TicketDrawer({ ticketId, onClose, onRefresh }) {
  const [thread, setThread] = useState(null)
  const [loading, setLoading] = useState(true)
  const [replyText, setReplyText] = useState('')
  const [replying, setReplying] = useState(false)
  const [statusVal, setStatusVal] = useState('')
  const [priorityVal, setPriorityVal] = useState('')
  const messagesEndRef = useRef(null)

  const fetchThread = useCallback(() => {
    if (!ticketId) return
    setLoading(true)
    fetch(`/api/auth/admin/tickets/${ticketId}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        setThread(d)
        if (d?.ticket) {
          setStatusVal(d.ticket.status)
          setPriorityVal(d.ticket.priority || 'normal')
        }
      })
      .catch(() => setThread(null))
      .finally(() => setLoading(false))
  }, [ticketId])

  useEffect(() => { fetchThread() }, [fetchThread])

  useEffect(() => {
    if (thread && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [thread])

  useEffect(() => {
    if (!ticketId) return
    function handleKey(e) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [ticketId, onClose])

  async function handleReply() {
    if (!replyText.trim()) return
    setReplying(true)
    try {
      const res = await fetch(`/api/auth/admin/tickets/${ticketId}/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: replyText.trim() }),
      })
      if (res.ok) {
        setReplyText('')
        fetchThread()
        if (onRefresh) onRefresh()
      }
    } catch { /* silent */ }
    finally { setReplying(false) }
  }

  async function handleStatusChange(newStatus) {
    setStatusVal(newStatus)
    try {
      await fetch(`/api/auth/admin/tickets/${ticketId}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      })
      if (onRefresh) onRefresh()
    } catch { /* silent */ }
  }

  async function handlePriorityChange(newPriority) {
    setPriorityVal(newPriority)
    try {
      await fetch(`/api/auth/admin/tickets/${ticketId}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: statusVal, priority: newPriority }),
      })
      if (onRefresh) onRefresh()
    } catch { /* silent */ }
  }

  if (!ticketId) return null

  return (
    <>
      <div className={styles.drawerBackdrop} onClick={onClose} />
      <div className={styles.drawer}>
        <div className={styles.drawerHeader}>
          <h2 className={styles.drawerTitle}>Ticket Details</h2>
          <button className={styles.drawerClose} onClick={onClose}>&times;</button>
        </div>

        {loading ? (
          <div className={styles.loading}>Loading...</div>
        ) : !thread ? (
          <div className={styles.loading}>Ticket not found</div>
        ) : (
          <div className={styles.drawerBody}>
            {/* Ticket header */}
            <div className={styles.ticketDrawerSubject}>{thread.ticket.subject}</div>
            <div className={styles.ticketDrawerMeta}>
              <span style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                {thread.ticket.email || thread.ticket.user_id}
              </span>
              <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                {timeAgo(thread.ticket.created_at)}
              </span>
            </div>

            {/* Status & Priority selectors */}
            <div className={styles.ticketDrawerControls}>
              <div className={styles.ticketDrawerControl}>
                <label className={styles.ticketDrawerLabel}>Status</label>
                <select
                  className={styles.ticketDrawerSelect}
                  value={statusVal}
                  onChange={e => handleStatusChange(e.target.value)}
                >
                  {TICKET_STATUSES.map(s => (
                    <option key={s} value={s}>
                      {s === 'in_progress' ? 'In Progress' : s.charAt(0).toUpperCase() + s.slice(1)}
                    </option>
                  ))}
                </select>
              </div>
              <div className={styles.ticketDrawerControl}>
                <label className={styles.ticketDrawerLabel}>Priority</label>
                <select
                  className={styles.ticketDrawerSelect}
                  value={priorityVal}
                  onChange={e => handlePriorityChange(e.target.value)}
                  style={{ color: PRIORITY_COLORS[priorityVal] || 'inherit' }}
                >
                  {TICKET_PRIORITIES.map(p => (
                    <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Message thread */}
            <div className={styles.ticketDrawerMessages}>
              {thread.messages.map(m => (
                <div
                  key={m.id}
                  className={`${styles.ticketDrawerMsg} ${m.sender_role === 'admin' ? styles.ticketMsgAdmin : styles.ticketMsgUser}`}
                >
                  <div className={styles.ticketMsgMeta}>
                    <span className={styles.ticketMsgSender}>
                      {m.sender_role === 'admin' ? (m.display_name || 'Admin') : (m.display_name || m.email || 'User')}
                    </span>
                    <span className={styles.ticketMsgTime}>{timeAgo(m.created_at)}</span>
                  </div>
                  <div className={styles.ticketMsgText}>{m.message}</div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>

            {/* Admin reply */}
            <div className={styles.ticketDrawerReply}>
              <textarea
                className={styles.ticketDrawerReplyInput}
                value={replyText}
                onChange={e => setReplyText(e.target.value)}
                placeholder="Type admin reply..."
                onKeyDown={e => {
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault()
                    handleReply()
                  }
                }}
              />
              <button
                className={styles.ticketDrawerReplyBtn}
                onClick={handleReply}
                disabled={replying || !replyText.trim()}
              >
                {replying ? 'Sending...' : 'Send Reply'}
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  )
}

// ── Main Admin Page ──
export default function Admin() {
  // Stats
  const [stats, setStats] = useState(null)
  const [statsLoading, setStatsLoading] = useState(true)
  const [mrrOpen, setMrrOpen] = useState(false)

  // Users
  const [users, setUsers] = useState([])
  const [usersLoading, setUsersLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [planFilter, setPlanFilter] = useState(null)
  const debounceRef = useRef(null)

  // Activity
  const [activity, setActivity] = useState([])
  const [activityLoading, setActivityLoading] = useState(true)

  // MRR History
  const [mrrHistory, setMrrHistory] = useState([])

  // Drawer
  const [drawerUserId, setDrawerUserId] = useState(null)

  // Comp action
  const [compLoading, setCompLoading] = useState(null)

  // Stripe sync
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState('')

  // Health
  const [health, setHealth] = useState(null)

  // Active now
  const [activeNow, setActiveNow] = useState(null)
  const [activePopover, setActivePopover] = useState(false)
  const activeRef = useRef(null)

  // Referrals
  const [referralStats, setReferralStats] = useState(null)

  // Error
  const [error, setError] = useState('')

  // Maintenance mode
  const [maintenanceMode, setMaintenanceMode] = useState(false)
  const [maintenanceLoading, setMaintenanceLoading] = useState(false)

  // Feedback
  const [feedback, setFeedback] = useState([])
  const [feedbackLoading, setFeedbackLoading] = useState(true)

  // Support Tickets
  const [ticketStats, setTicketStats] = useState(null)
  const [adminTickets, setAdminTickets] = useState([])
  const [ticketsLoading, setTicketsLoading] = useState(true)
  const [ticketFilter, setTicketFilter] = useState(null)
  const [ticketDrawerId, setTicketDrawerId] = useState(null)

  // Bulk selection
  const [selectedUsers, setSelectedUsers] = useState(new Set())
  const [bulkTagOpen, setBulkTagOpen] = useState(false)

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

  // ── Fetch MRR History ──
  useEffect(() => {
    fetch('/api/auth/admin/mrr-history?days=90')
      .then(r => { if (!r.ok) throw new Error('Failed'); return r.json() })
      .then(d => setMrrHistory(Array.isArray(d) ? d : []))
      .catch(() => {})
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

  // ── Fetch Active Now (every 30s) ──
  const fetchActiveNow = useCallback(() => {
    fetch('/api/auth/admin/active-now')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setActiveNow(d) })
      .catch(() => {})
  }, [])

  useEffect(() => {
    fetchActiveNow()
    const interval = setInterval(fetchActiveNow, 30000)
    return () => clearInterval(interval)
  }, [fetchActiveNow])

  // Close active popover on outside click
  useEffect(() => {
    if (!activePopover) return
    function handleClick(e) {
      if (activeRef.current && !activeRef.current.contains(e.target)) setActivePopover(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [activePopover])

  // ── Fetch Referral Stats ──
  useEffect(() => {
    fetch('/api/auth/admin/referrals')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setReferralStats(d) })
      .catch(() => {})
  }, [])

  // ── Fetch Maintenance State ──
  useEffect(() => {
    fetch('/api/maintenance')
      .then(r => r.json())
      .then(d => setMaintenanceMode(!!d.maintenance))
      .catch(() => {})
  }, [])

  // ── Toggle Maintenance ──
  async function handleToggleMaintenance() {
    setMaintenanceLoading(true)
    try {
      const res = await fetch('/api/auth/admin/maintenance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !maintenanceMode }),
      })
      if (res.ok) {
        const d = await res.json()
        setMaintenanceMode(d.maintenance)
      }
    } catch { /* silent */ }
    finally { setMaintenanceLoading(false) }
  }

  // ── Fetch Feedback ──
  const fetchFeedback = useCallback(() => {
    setFeedbackLoading(true)
    fetch('/api/auth/admin/feedback?limit=50')
      .then(r => { if (!r.ok) throw new Error('Failed'); return r.json() })
      .then(d => setFeedback(Array.isArray(d) ? d : []))
      .catch(() => {})
      .finally(() => setFeedbackLoading(false))
  }, [])

  useEffect(() => { fetchFeedback() }, [fetchFeedback])

  // ── Fetch Support Tickets ──
  const fetchTicketStats = useCallback(() => {
    fetch('/api/auth/admin/tickets/stats')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setTicketStats(d) })
      .catch(() => {})
  }, [])

  const fetchAdminTickets = useCallback(() => {
    setTicketsLoading(true)
    const params = new URLSearchParams()
    if (ticketFilter) params.set('status', ticketFilter)
    fetch(`/api/auth/admin/tickets?${params}`)
      .then(r => r.ok ? r.json() : [])
      .then(d => setAdminTickets(Array.isArray(d) ? d : []))
      .catch(() => setAdminTickets([]))
      .finally(() => setTicketsLoading(false))
  }, [ticketFilter])

  useEffect(() => { fetchTicketStats() }, [fetchTicketStats])
  useEffect(() => { fetchAdminTickets() }, [fetchAdminTickets])

  // ── Bulk Actions ──
  function toggleSelectUser(userId) {
    setSelectedUsers(prev => {
      const next = new Set(prev)
      if (next.has(userId)) next.delete(userId)
      else next.add(userId)
      return next
    })
  }

  function toggleSelectAll() {
    if (selectedUsers.size === users.length) {
      setSelectedUsers(new Set())
    } else {
      setSelectedUsers(new Set(users.map(u => u.id)))
    }
  }

  async function handleBulkComp() {
    for (const uid of selectedUsers) {
      const u = users.find(x => x.id === uid)
      if (u) {
        await fetch('/api/auth/admin/comp-access', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: u.email, action: 'grant' }),
        }).catch(() => {})
      }
    }
    setSelectedUsers(new Set())
    fetchUsers()
    fetchStats()
  }

  async function handleBulkVerify() {
    for (const uid of selectedUsers) {
      await fetch(`/api/auth/admin/users/${uid}/verify`, { method: 'POST' }).catch(() => {})
    }
    setSelectedUsers(new Set())
    fetchUsers()
    fetchStats()
  }

  async function handleBulkTag(tag) {
    for (const uid of selectedUsers) {
      await fetch(`/api/auth/admin/users/${uid}/tags`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tag }),
      }).catch(() => {})
    }
    setBulkTagOpen(false)
    setSelectedUsers(new Set())
    fetchUsers()
  }

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
      // Small delay to let DB commit propagate before re-fetching
      await new Promise(r => setTimeout(r, 300))
      fetchUsers()
      fetchStats()
      fetchActivity()
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
        <h1 className={styles.heading}>
          Admin
          {activeNow && (
            <span
              className={styles.onlineBadge}
              onClick={() => setActivePopover(v => !v)}
              ref={activeRef}
              style={{ position: 'relative' }}
            >
              <span className={styles.onlineDot} />
              {activeNow.count} online
              {activePopover && activeNow.users && (
                <div className={styles.onlinePopover}>
                  {activeNow.users.length === 0 ? (
                    <div className={styles.emptyActivity}>No one online</div>
                  ) : activeNow.users.map((u, i) => (
                    <div key={i} className={styles.onlinePopoverRow}>
                      <span className={styles.onlinePopoverEmail}>{u.email}</span>
                      <span className={styles.onlinePopoverPage}>{u.page}</span>
                    </div>
                  ))}
                </div>
              )}
            </span>
          )}
        </h1>
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
        <div
          className={`${styles.statCard} ${styles.statCardClickable}`}
          onClick={() => setMrrOpen(v => !v)}
          style={{ position: 'relative' }}
        >
          <span className={styles.statNumber}>
            {statsLoading ? '\u2014' : `$${(stats?.mrr ?? 0).toLocaleString()}`}
          </span>
          <span className={styles.statLabel}>MRR</span>
          <MRRPopover stats={stats} visible={mrrOpen} onClose={() => setMrrOpen(false)} />
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
          <span className={styles.statNumber}>{statsLoading ? '\u2014' : stats?.unverified_count ?? 0}</span>
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

      {/* ── Section 2b: Revenue Chart (MRR over time) ── */}
      <RevenueChart data={mrrHistory} />

      {/* ── Section 3: Page Analytics ── */}
      <PageAnalytics />

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
                  <th style={{ width: 32 }}>
                    <input
                      type="checkbox"
                      className={styles.checkbox}
                      checked={users.length > 0 && selectedUsers.size === users.length}
                      onChange={toggleSelectAll}
                    />
                  </th>
                  <th>Email</th>
                  <th>Display Name</th>
                  <th>Tags</th>
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
                  <tr><td colSpan={10} className={styles.emptyRow}>No users found</td></tr>
                ) : users.map(u => {
                  const plan = getUserPlan(u)
                  const isComped = u.sub_status === 'comped'
                  return (
                    <tr key={u.id}>
                      <td>
                        <input
                          type="checkbox"
                          className={styles.checkbox}
                          checked={selectedUsers.has(u.id)}
                          onChange={() => toggleSelectUser(u.id)}
                        />
                      </td>
                      <td
                        className={styles.emailCell}
                        onClick={() => setDrawerUserId(u.id)}
                        title="Click to view details"
                      >
                        {u.email}
                      </td>
                      <td className={styles.nameCell}>{u.display_name || '\u2014'}</td>
                      <td>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                          {(u.tags || []).map(t => <TagPill key={t} tag={t} />)}
                        </div>
                      </td>
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
                        {u.stripe_customer_id && (
                          <a
                            href={`https://dashboard.stripe.com/customers/${u.stripe_customer_id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={styles.stripeLink}
                            title="Open in Stripe"
                            onClick={e => e.stopPropagation()}
                          >
                            $
                          </a>
                        )}
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

      {/* ── Section 5: Send Announcement ── */}
      <AnnouncementSection />

      {/* ── Section 6: Referral Program ── */}
      {referralStats && (
        <div className={styles.referralSection}>
          <div className={styles.sectionTitle}>Referral Program</div>
          <div className={styles.statsGrid} style={{ marginTop: 12, marginBottom: 12 }}>
            <div className={styles.statCard}>
              <span className={styles.statNumber}>{referralStats.total_referrals}</span>
              <span className={styles.statLabel}>Total Referrals</span>
            </div>
            <div className={styles.statCard}>
              <span className={styles.statNumber}>{referralStats.completed_referrals}</span>
              <span className={styles.statLabel}>Completed</span>
            </div>
            <div className={styles.statCard}>
              <span className={styles.statNumber}>{referralStats.conversion_rate}%</span>
              <span className={styles.statLabel}>Conversion</span>
            </div>
          </div>
          {referralStats.top_referrers && referralStats.top_referrers.length > 0 && (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Email</th>
                    <th>Code</th>
                    <th>Referrals</th>
                  </tr>
                </thead>
                <tbody>
                  {referralStats.top_referrers.map((r, i) => (
                    <tr key={i}>
                      <td className={styles.emailCell}>{r.email}</td>
                      <td className={styles.dateCell}>{r.code}</td>
                      <td>{r.successful}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Section 7: System Health ── */}
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
          <div className={styles.healthItem}>
            <span className={styles.healthLabel}>Maintenance</span>
            <div className={styles.healthSyncRow}>
              <label className={styles.maintenanceToggle}>
                <input
                  type="checkbox"
                  checked={maintenanceMode}
                  onChange={handleToggleMaintenance}
                  disabled={maintenanceLoading}
                />
                <span className={styles.maintenanceSwitch} />
              </label>
              <span style={{ fontSize: 12, color: maintenanceMode ? '#f87171' : 'var(--text-muted)' }}>
                {maintenanceMode ? 'ON' : 'OFF'}
              </span>
              {maintenanceMode && (
                <span className={styles.maintenanceWarning}>All non-admin users are locked out</span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Section 8: User Feedback ── */}
      <div className={styles.healthSection}>
        <div className={styles.sectionHeader}>
          <span className={styles.sectionTitle}>User Feedback</span>
          <button className={styles.refreshBtn} onClick={fetchFeedback} disabled={feedbackLoading}>
            {feedbackLoading ? 'Loading...' : 'Refresh'}
          </button>
        </div>
        <div className={styles.feedbackList}>
          {feedbackLoading && feedback.length === 0 ? (
            <div className={styles.loading}>Loading feedback...</div>
          ) : feedback.length === 0 ? (
            <div className={styles.emptyActivity}>No feedback yet</div>
          ) : (
            feedback.map(fb => (
              <div key={fb.id} className={styles.feedbackItem}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <span style={{ fontSize: 12, color: 'var(--text-bright)', fontFamily: 'var(--font-mono)' }}>{fb.email}</span>
                  <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{timeAgo(fb.created_at)}</span>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
                  {fb.page && <span style={{ fontSize: 10, color: 'var(--text-muted)', background: 'rgba(255,255,255,0.04)', padding: '1px 6px', borderRadius: 4 }}>{fb.page}</span>}
                  {fb.rating && <StarRating value={fb.rating} />}
                </div>
                <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.5 }}>{fb.message}</div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* ── Section 9: Support Tickets ── */}
      <div className={styles.healthSection}>
        <div className={styles.sectionHeader}>
          <span className={styles.sectionTitle}>Support Tickets</span>
          <button className={styles.refreshBtn} onClick={() => { fetchTicketStats(); fetchAdminTickets() }} disabled={ticketsLoading}>
            {ticketsLoading ? 'Loading...' : 'Refresh'}
          </button>
        </div>

        {/* Stats row */}
        {ticketStats && (
          <div className={styles.ticketStatsRow}>
            {[
              { label: 'Open', value: ticketStats.open, cls: styles.ticketStatOpen },
              { label: 'In Progress', value: ticketStats.in_progress, cls: styles.ticketStatProgress },
              { label: 'Resolved', value: ticketStats.resolved, cls: styles.ticketStatResolved },
            ].map(s => (
              <div key={s.label} className={`${styles.ticketStatMini} ${s.cls}`}>
                <span className={styles.ticketStatMiniVal}>{s.value}</span>
                <span className={styles.ticketStatMiniLabel}>{s.label}</span>
              </div>
            ))}
          </div>
        )}

        {/* Filter pills */}
        <div className={styles.ticketFilters}>
          {[
            { key: null, label: 'All' },
            { key: 'open', label: 'Open' },
            { key: 'in_progress', label: 'In Progress' },
            { key: 'resolved', label: 'Resolved' },
          ].map(f => (
            <button
              key={f.label}
              className={`${styles.ticketFilterPill} ${ticketFilter === f.key ? styles.ticketFilterActive : ''}`}
              onClick={() => setTicketFilter(f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Ticket table */}
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Email</th>
                <th>Subject</th>
                <th>Category</th>
                <th>Status</th>
                <th>Msgs</th>
                <th>Priority</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {ticketsLoading && adminTickets.length === 0 ? (
                <tr><td colSpan={7} className={styles.loading}>Loading tickets...</td></tr>
              ) : adminTickets.length === 0 ? (
                <tr><td colSpan={7} className={styles.emptyActivity}>No tickets</td></tr>
              ) : (
                adminTickets.map(t => (
                  <tr
                    key={t.id}
                    className={styles.ticketRow}
                    onClick={() => setTicketDrawerId(t.id)}
                  >
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{t.email}</td>
                    <td>
                      {t.subject}
                      {t.last_sender === 'admin' && <span className={styles.ticketAdminDot} />}
                    </td>
                    <td><span className={`${styles.ticketCatPill} ${styles[`tCat_${t.category}`] || ''}`}>{t.category}</span></td>
                    <td>
                      <span className={`${styles.ticketStatusPill} ${styles[`tStatus_${t.status}`] || ''}`}>
                        {t.status === 'in_progress' ? 'In Progress' : t.status}
                      </span>
                    </td>
                    <td style={{ textAlign: 'center' }}>{t.message_count}</td>
                    <td>
                      <span style={{ color: t.priority === 'urgent' ? '#f87171' : t.priority === 'high' ? '#fbbf24' : 'var(--text-muted)', fontSize: 11, textTransform: 'capitalize' }}>
                        {t.priority || 'normal'}
                      </span>
                    </td>
                    <td style={{ fontSize: 11, color: 'var(--text-muted)' }}>{timeAgo(t.updated_at)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Ticket Drawer ── */}
      {ticketDrawerId && (
        <TicketDrawer
          ticketId={ticketDrawerId}
          onClose={() => setTicketDrawerId(null)}
          onRefresh={() => { fetchTicketStats(); fetchAdminTickets() }}
        />
      )}

      {/* ── Section 10: Activity Feed (least priority — bottom) ── */}
      <ActivityFeed
        items={activity}
        loading={activityLoading}
        onRefresh={fetchActivity}
      />

      {/* ── Section 11: Admin Audit Log ── */}
      <AuditLogSection activity={activity} />

      {/* ── Bulk Action Bar ── */}
      {selectedUsers.size > 0 && (
        <div className={styles.bulkBar}>
          <span style={{ fontSize: 13, color: 'var(--text-bright)', fontWeight: 600 }}>
            {selectedUsers.size} user{selectedUsers.size !== 1 ? 's' : ''} selected
          </span>
          <button className={styles.compBtn} onClick={handleBulkComp}>Bulk Comp</button>
          <button className={styles.verifyBtn} onClick={handleBulkVerify}>Bulk Verify</button>
          <div style={{ position: 'relative' }}>
            <button className={styles.actionBtn} onClick={() => setBulkTagOpen(v => !v)}>Bulk Tag</button>
            {bulkTagOpen && (
              <div style={{
                position: 'absolute', bottom: '100%', left: 0, marginBottom: 8,
                background: '#1a1c17', border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 8, padding: 8, display: 'flex', flexDirection: 'column', gap: 4,
                zIndex: 210, minWidth: 140,
              }}>
                {PREDEFINED_TAGS.map(t => (
                  <button
                    key={t}
                    className={styles.actionBtn}
                    style={{ fontSize: 11, textAlign: 'left' }}
                    onClick={() => handleBulkTag(t)}
                  >
                    {t}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            className={styles.actionBtn}
            onClick={() => setSelectedUsers(new Set())}
          >
            Clear
          </button>
        </div>
      )}

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
