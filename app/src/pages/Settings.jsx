import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import usePreferences from '../hooks/usePreferences'
import TileCard from '../components/TileCard'
import styles from './Settings.module.css'

const TF_OPTIONS = [
  { value: '5', label: '5 min' },
  { value: '30', label: '30 min' },
  { value: '60', label: '1 hr' },
  { value: 'D', label: 'Daily' },
  { value: 'W', label: 'Weekly' },
]

const THEME_OPTIONS = [
  { value: 'midnight', label: 'Midnight', desc: 'Deep dark green', swatch: '#0e0f0d' },
  { value: 'oled', label: 'OLED Black', desc: 'Pure black for AMOLED', swatch: '#000000' },
  { value: 'dim', label: 'Dim', desc: 'Softer for daytime', swatch: '#1a1d1a' },
  { value: 'system', label: 'System', desc: 'Match your OS', swatch: null },
]

// ── Helpers ──
function formatDate(dateStr) {
  if (!dateStr) return '—'
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function daysUntil(dateStr) {
  if (!dateStr) return null
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return null
  const diff = Math.ceil((d.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
  return diff
}

function memberDuration(dateStr) {
  if (!dateStr) return '—'
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return '—'
  const now = Date.now()
  const diffMs = now - d.getTime()
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24))
  if (days < 1) return 'Today'
  if (days < 30) return `${days} day${days !== 1 ? 's' : ''}`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months} month${months !== 1 ? 's' : ''}`
  const years = Math.floor(months / 12)
  const rem = months % 12
  return rem > 0 ? `${years}y ${rem}mo` : `${years} year${years !== 1 ? 's' : ''}`
}

// ── Avatar Upload ──
function AvatarUpload({ user }) {
  const fileRef = useRef(null)
  const [avatarUrl, setAvatarUrl] = useState(null)
  const [uploading, setUploading] = useState(false)

  const userId = user?.id
  const initial = (user?.display_name || user?.email || '?')[0].toUpperCase()

  useEffect(() => {
    if (!userId) return
    // Check if avatar exists (non-transparent response)
    fetch(`/api/auth/avatar/${userId}`)
      .then(r => {
        if (r.ok && r.headers.get('content-type')?.includes('webp')) {
          setAvatarUrl(`/api/auth/avatar/${userId}?t=${Date.now()}`)
        }
      })
      .catch(() => {})
  }, [userId])

  async function handleUpload(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch('/api/auth/avatar', { method: 'POST', body: fd })
      if (res.ok) {
        setAvatarUrl(`/api/auth/avatar/${userId}?t=${Date.now()}`)
      }
    } catch { /* ignore */ }
    finally { setUploading(false) }
    if (fileRef.current) fileRef.current.value = ''
  }

  async function handleRemove() {
    await fetch('/api/auth/avatar', { method: 'DELETE' }).catch(() => {})
    setAvatarUrl(null)
  }

  return (
    <div className={styles.avatarSection}>
      <div className={styles.avatarCircle}>
        {avatarUrl ? (
          <img src={avatarUrl} alt="Avatar" className={styles.avatarImg} />
        ) : (
          <span className={styles.avatarInitials}>{initial}</span>
        )}
      </div>
      <div className={styles.avatarActions}>
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          style={{ display: 'none' }}
          onChange={handleUpload}
        />
        <button
          className={styles.avatarChangeBtn}
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
        >
          {uploading ? 'Uploading...' : 'Change Photo'}
        </button>
        {avatarUrl && (
          <button className={styles.avatarRemoveBtn} onClick={handleRemove}>
            Remove
          </button>
        )}
      </div>
    </div>
  )
}

// ── Referral Section ──
function ReferralSection() {
  const [referral, setReferral] = useState(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    fetch('/api/auth/my-referral')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setReferral(d) })
      .catch(() => {})
  }, [])

  function handleCopy() {
    if (!referral?.code) return
    navigator.clipboard.writeText(`https://uctintelligence.com/signup?ref=${referral.code}`).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (!referral) return null

  return (
    <TileCard title="Referral Program">
      <div className={styles.section}>
        <p className={styles.hint} style={{ marginBottom: 12 }}>
          Share your link and earn rewards when friends subscribe.
        </p>
        <div className={styles.referralLinkBox}>
          <span className={styles.referralLink}>
            uctintelligence.com/signup?ref={referral.code}
          </span>
          <button className={styles.copyBtn} onClick={handleCopy}>
            {copied ? '✓ Copied' : 'Copy'}
          </button>
        </div>
        <div className={styles.row} style={{ marginTop: 12 }}>
          <span className={styles.rowLabel}>Successful Referrals</span>
          <span className={styles.rowValue}>
            {referral.successful_referrals || 0}
          </span>
        </div>
      </div>
    </TileCard>
  )
}

// ── Main Settings Page ──
export default function Settings() {
  const { user, plan, subscription, logout, startCheckout, openPortal } = useAuth()
  const { prefs, setPref } = usePreferences()
  const navigate = useNavigate()
  const [changingPw, setChangingPw] = useState(false)
  const [pwForm, setPwForm] = useState({ current: '', newPw: '', confirm: '' })
  const [pwMsg, setPwMsg] = useState('')
  const [pwError, setPwError] = useState('')
  const [billingLoading, setBillingLoading] = useState(false)
  const [editingName, setEditingName] = useState(false)
  const [newName, setNewName] = useState('')
  const [nameMsg, setNameMsg] = useState('')

  const renewalDays = daysUntil(subscription?.current_period_end)
  const isComped = subscription?.status === 'comped'
  const isCanceling = subscription?.status === 'canceled' || subscription?.status === 'past_due'

  async function handleLogout() {
    await logout()
    navigate('/login', { replace: true })
  }

  async function handleManageBilling() {
    setBillingLoading(true)
    try {
      await openPortal()
    } catch {
      try { await startCheckout() } catch { /* ignore */ }
    } finally {
      setBillingLoading(false)
    }
  }

  async function handleChangePassword(e) {
    e.preventDefault()
    setPwMsg('')
    setPwError('')
    if (pwForm.newPw !== pwForm.confirm) {
      setPwError('Passwords do not match')
      return
    }
    if (pwForm.newPw.length < 8) {
      setPwError('Password must be at least 8 characters')
      return
    }
    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ current_password: pwForm.current, new_password: pwForm.newPw }),
      })
      if (!res.ok) {
        const err = await res.json()
        setPwError(err.detail || 'Failed to change password')
        return
      }
      setPwMsg('Password changed successfully')
      setPwForm({ current: '', newPw: '', confirm: '' })
      setChangingPw(false)
    } catch {
      setPwError('Network error')
    }
  }

  async function handleUpdateName() {
    if (!newName.trim()) return
    setNameMsg('')
    try {
      const res = await fetch('/api/auth/update-profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ display_name: newName.trim() }),
      })
      if (res.ok) {
        setNameMsg('Updated')
        setEditingName(false)
        // Refresh user data
        window.location.reload()
      }
    } catch { /* ignore */ }
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.heading}>Settings</h1>
      </div>

      <div className={styles.grid}>

        {/* ── Profile ── */}
        <TileCard title="Profile">
          <div className={styles.section}>
            <AvatarUpload user={user} />
            <div className={styles.row}>
              <span className={styles.rowLabel}>Email</span>
              <span className={styles.rowValue}>{user?.email || '—'}</span>
            </div>
            <div className={styles.row}>
              <span className={styles.rowLabel}>Display Name</span>
              {!editingName ? (
                <span className={styles.rowValue}>
                  {user?.display_name || '—'}
                  <button
                    className={styles.inlineBtn}
                    onClick={() => { setNewName(user?.display_name || ''); setEditingName(true) }}
                  >
                    Edit
                  </button>
                </span>
              ) : (
                <span className={styles.rowValue}>
                  <input
                    type="text"
                    value={newName}
                    onChange={e => setNewName(e.target.value)}
                    className={styles.inlineInput}
                    autoFocus
                    onKeyDown={e => { if (e.key === 'Enter') handleUpdateName(); if (e.key === 'Escape') setEditingName(false) }}
                  />
                  <button className={styles.inlineBtn} onClick={handleUpdateName}>Save</button>
                  <button className={styles.inlineBtnMuted} onClick={() => setEditingName(false)}>Cancel</button>
                </span>
              )}
            </div>
            {nameMsg && <div className={styles.success}>{nameMsg}</div>}
            <div className={styles.row}>
              <span className={styles.rowLabel}>Email Verified</span>
              <span className={styles.rowValue}>
                {user?.email_verified ? (
                  <span className={styles.verifiedBadge}>✓ Verified</span>
                ) : (
                  <span className={styles.unverifiedBadge}>✗ Not verified</span>
                )}
              </span>
            </div>
            <div className={styles.row}>
              <span className={styles.rowLabel}>Member Since</span>
              <span className={styles.rowValue}>
                {formatDate(user?.created_at)}
              </span>
            </div>
            <div className={styles.row}>
              <span className={styles.rowLabel}>Membership Duration</span>
              <span className={styles.rowValue}>
                {memberDuration(user?.created_at)}
              </span>
            </div>
          </div>
        </TileCard>

        {/* ── Subscription & Billing ── */}
        <TileCard title="Subscription & Billing">
          <div className={styles.section}>
            {plan === 'pro' || isComped ? (
              <>
                <div className={styles.planHeader}>
                  <span className={styles.activeDot} />
                  <span className={styles.planTitle}>
                    {isComped ? 'Pro (Complimentary)' : 'Pro — $20/mo'}
                  </span>
                </div>

                <div className={styles.subDetails}>
                  <div className={styles.row}>
                    <span className={styles.rowLabel}>Status</span>
                    <span className={styles.rowValue}>
                      <span className={`${styles.statusPill} ${
                        isCanceling ? styles.statusCanceling :
                        isComped ? styles.statusComped :
                        styles.statusActive
                      }`}>
                        {isCanceling ? 'Canceling' : isComped ? 'Comped' : 'Active'}
                      </span>
                    </span>
                  </div>

                  {!isComped && subscription?.current_period_end && (
                    <>
                      <div className={styles.row}>
                        <span className={styles.rowLabel}>
                          {isCanceling ? 'Access Ends' : 'Next Renewal'}
                        </span>
                        <span className={styles.rowValue}>
                          {formatDate(subscription.current_period_end)}
                          {renewalDays != null && renewalDays >= 0 && (
                            <span className={styles.daysTag}>
                              {renewalDays === 0 ? 'Today' : `in ${renewalDays}d`}
                            </span>
                          )}
                        </span>
                      </div>
                      <div className={styles.row}>
                        <span className={styles.rowLabel}>Billing Cycle</span>
                        <span className={styles.rowValue}>Monthly</span>
                      </div>
                    </>
                  )}
                </div>

                {!isComped && (
                  <>
                    <button className={styles.btn} onClick={handleManageBilling} disabled={billingLoading}>
                      {billingLoading ? 'Loading...' : 'Manage Billing'}
                    </button>
                    <p className={styles.hint}>Update payment method, view invoices, or cancel</p>
                  </>
                )}
              </>
            ) : (
              <>
                <div className={styles.planHeader}>
                  <span className={styles.freeDot} />
                  <span className={styles.planTitle}>Free Plan</span>
                </div>
                <p className={styles.hint} style={{ margin: '8px 0 16px' }}>
                  Upgrade to Pro for full access to every tool in the dashboard.
                </p>
                <button className={styles.btnPro} onClick={() => startCheckout()}>
                  Upgrade to Pro — $20/mo
                </button>
              </>
            )}
          </div>
        </TileCard>

        {/* ── Security ── */}
        <TileCard title="Security">
          <div className={styles.section}>
            {!changingPw ? (
              <button className={styles.btn} onClick={() => setChangingPw(true)}>
                Change Password
              </button>
            ) : (
              <form onSubmit={handleChangePassword} className={styles.pwForm}>
                <input
                  type="password"
                  placeholder="Current password"
                  value={pwForm.current}
                  onChange={e => setPwForm(f => ({ ...f, current: e.target.value }))}
                  className={styles.input}
                  required
                />
                <input
                  type="password"
                  placeholder="New password (min 8 chars)"
                  value={pwForm.newPw}
                  onChange={e => setPwForm(f => ({ ...f, newPw: e.target.value }))}
                  className={styles.input}
                  required
                  minLength={8}
                />
                <input
                  type="password"
                  placeholder="Confirm new password"
                  value={pwForm.confirm}
                  onChange={e => setPwForm(f => ({ ...f, confirm: e.target.value }))}
                  className={styles.input}
                  required
                />
                {pwError && <div className={styles.error}>{pwError}</div>}
                {pwMsg && <div className={styles.success}>{pwMsg}</div>}
                <div className={styles.pwActions}>
                  <button type="submit" className={styles.btn}>Save</button>
                  <button type="button" className={styles.btnMuted} onClick={() => { setChangingPw(false); setPwError('') }}>Cancel</button>
                </div>
              </form>
            )}
          </div>
        </TileCard>

        {/* ── Preferences ── */}
        <TileCard title="Preferences">
          <div className={styles.section}>
            <div className={styles.prefRow}>
              <div className={styles.prefLabelGroup}>
                <span className={styles.prefLabel}>Default Chart Timeframe</span>
                <span className={styles.prefDesc}>Opens charts in this view by default</span>
              </div>
              <select
                className={styles.prefSelect}
                value={prefs.default_chart_tf}
                onChange={e => setPref('default_chart_tf', e.target.value)}
              >
                {TF_OPTIONS.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
            <div className={styles.prefRow}>
              <div className={styles.prefLabelGroup}>
                <span className={styles.prefLabel}>App Theme</span>
                <span className={styles.prefDesc}>Customize your visual experience</span>
              </div>
              <div className={styles.themeGrid}>
                {THEME_OPTIONS.map(o => (
                  <button
                    key={o.value}
                    className={`${styles.themeCard} ${prefs.theme === o.value ? styles.themeCardActive : ''}`}
                    onClick={() => setPref('theme', o.value)}
                  >
                    <span className={styles.themeSwatch}>
                      {o.swatch ? (
                        <span className={styles.themeSwatchColor} style={{ background: o.swatch }} />
                      ) : (
                        <span className={styles.themeSwatchSystem}>⊘</span>
                      )}
                    </span>
                    <span className={styles.themeCardLabel}>{o.label}</span>
                    <span className={styles.themeCardDesc}>{o.desc}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </TileCard>

        {/* ── Data & Privacy ── */}
        <TileCard title="Data & Privacy">
          <div className={styles.section}>
            <div className={styles.prefRow}>
              <div className={styles.prefLabelGroup}>
                <span className={styles.prefLabel}>Export My Data</span>
                <span className={styles.prefDesc}>Download your watchlists, journal, trades, and settings as JSON</span>
              </div>
              <button className={styles.btn} onClick={async () => {
                try {
                  const res = await fetch('/api/auth/export-data')
                  if (!res.ok) return
                  const blob = await res.blob()
                  const url = URL.createObjectURL(blob)
                  const a = document.createElement('a')
                  a.href = url
                  a.download = `uct-data-${new Date().toISOString().slice(0, 10)}.json`
                  a.click()
                  URL.revokeObjectURL(url)
                } catch { /* ignore */ }
              }}>
                Download
              </button>
            </div>
            <div className={styles.linksRow} style={{ marginTop: 8 }}>
              <a href="/terms" className={styles.footerLink}>Terms of Service</a>
              <span className={styles.linkDivider}>·</span>
              <a href="/privacy" className={styles.footerLink}>Privacy Policy</a>
            </div>
          </div>
        </TileCard>

        {/* ── Referral Program ── */}
        <ReferralSection />

        {/* ── Support ── */}
        <TileCard title="Help & Support">
          <div className={styles.section}>
            <button className={styles.btn} onClick={() => navigate('/support')}>
              Open Support
            </button>
            <p className={styles.hint}>Submit a ticket, report a bug, or request a feature</p>
          </div>
        </TileCard>

        {/* ── Session ── */}
        <TileCard title="Session">
          <div className={styles.section}>
            <button className={styles.btnDanger} onClick={handleLogout}>
              Log Out
            </button>
          </div>
        </TileCard>
      </div>
    </div>
  )
}
