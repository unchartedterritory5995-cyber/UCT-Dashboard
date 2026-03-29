import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import usePreferences from '../hooks/usePreferences'
import TileCard from '../components/TileCard'
import ColorPicker from '../components/chart/ColorPicker'
import { CHART_DEFAULTS, PRESETS, mergeChartSettings } from '../components/chart/chartDefaults'
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
// ─── Chart Settings Section ──────────────────────────────────────────────────

const CHART_TYPES = [
  { value: 'candles', label: 'Candles' },
  { value: 'hollow',  label: 'Hollow' },
  { value: 'bars',    label: 'Bars' },
  { value: 'line',    label: 'Line' },
  { value: 'area',    label: 'Area' },
]

const CROSSHAIR_STYLES = [
  { value: 0, label: 'Solid' },
  { value: 2, label: 'Dashed' },
  { value: 3, label: 'Dotted' },
]

const DRAWING_WIDTHS = [1, 2, 3]

function ChartSettingsSection({ prefs, setPref }) {
  const cs = useMemo(() => mergeChartSettings(prefs.chart_settings), [prefs.chart_settings])

  const update = useCallback((path, value) => {
    const next = { ...cs }
    if (path.includes('.')) {
      const [section, key] = path.split('.')
      if (section === 'overlays') {
        // overlays.0.color etc
        const [, idx, field] = path.split('.')
        next.overlays = next.overlays.map((o, i) =>
          i === parseInt(idx) ? { ...o, [field]: field === 'period' ? parseInt(value) || o.period : value } : o
        )
      } else {
        next[section] = { ...next[section], [key]: value }
      }
    } else {
      next[path] = value
    }
    next.preset = 'custom'
    setPref('chart_settings', JSON.stringify(next))
  }, [cs, setPref])

  const updateOverlay = useCallback((idx, field, value) => {
    const next = { ...cs }
    next.overlays = next.overlays.map((o, i) =>
      i === idx ? { ...o, [field]: field === 'period' ? (parseInt(value) || o.period) : value } : o
    )
    next.preset = 'custom'
    setPref('chart_settings', JSON.stringify(next))
  }, [cs, setPref])

  const applyPreset = useCallback((key) => {
    const preset = PRESETS[key]
    if (preset) setPref('chart_settings', JSON.stringify(preset.settings))
  }, [setPref])

  const resetToDefaults = useCallback(() => {
    if (confirm('Reset all chart settings to defaults?')) {
      setPref('chart_settings', JSON.stringify(CHART_DEFAULTS))
    }
  }, [setPref])

  return (
    <TileCard title="Chart Settings">
      <div className={styles.section}>

        {/* ── Preset Picker ── */}
        <div className={styles.chartSubsection}>
          <span className={styles.chartSubLabel}>Preset Theme</span>
          <div className={styles.themeGrid}>
            {Object.entries(PRESETS).map(([key, p]) => (
              <button
                key={key}
                className={`${styles.themeCard} ${cs.preset === key ? styles.themeCardActive : ''}`}
                onClick={() => applyPreset(key)}
              >
                <span className={styles.themeSwatch}>
                  <span className={styles.themeSwatchColor} style={{ background: p.swatch }} />
                </span>
                <span className={styles.themeCardLabel}>{p.label}</span>
                <span className={styles.themeCardDesc}>{p.desc}</span>
              </button>
            ))}
          </div>
        </div>

        {/* ── Chart Type ── */}
        <div className={styles.chartSubsection}>
          <span className={styles.chartSubLabel}>Chart Type</span>
          <div className={styles.chartPills}>
            {CHART_TYPES.map(ct => (
              <button
                key={ct.value}
                className={`${styles.chartPill} ${cs.chartType === ct.value ? styles.chartPillActive : ''}`}
                onClick={() => update('chartType', ct.value)}
              >
                {ct.label}
              </button>
            ))}
          </div>
        </div>

        {/* ── Candle Colors ── */}
        <div className={styles.chartSubsection}>
          <span className={styles.chartSubLabel}>Candle Colors</span>
          <div className={styles.chartRow}>
            <ColorPicker label="Up" value={cs.candles.upColor} onChange={v => {
              const next = { ...cs, candles: { ...cs.candles, upColor: v, upBorder: v, upWick: v }, preset: 'custom' }
              setPref('chart_settings', JSON.stringify(next))
            }} />
            <ColorPicker label="Down" value={cs.candles.downColor} onChange={v => {
              const next = { ...cs, candles: { ...cs.candles, downColor: v, downBorder: v, downWick: v }, preset: 'custom' }
              setPref('chart_settings', JSON.stringify(next))
            }} />
          </div>
        </div>

        {/* ── Background & Grid ── */}
        <div className={styles.chartSubsection}>
          <span className={styles.chartSubLabel}>Background & Grid</span>
          <div className={styles.chartRow}>
            <ColorPicker label="Background" value={cs.background} onChange={v => update('background', v)} />
            <ColorPicker label="Text" value={cs.textColor} onChange={v => update('textColor', v)} />
          </div>
          <div className={styles.chartRow} style={{ marginTop: 8 }}>
            <ColorPicker label="Grid" value={cs.grid.color} onChange={v => update('grid.color', v)} />
            <label className={styles.chartToggle}>
              <input type="checkbox" checked={cs.grid.visible} onChange={e => update('grid.visible', e.target.checked)} />
              <span>Show grid</span>
            </label>
          </div>
        </div>

        {/* ── Indicators ── */}
        <div className={styles.chartSubsection}>
          <span className={styles.chartSubLabel}>Indicators</span>
          {cs.overlays.map((ov, i) => (
            <div key={i} className={styles.overlayRow}>
              <label className={styles.chartToggle}>
                <input type="checkbox" checked={ov.enabled} onChange={e => updateOverlay(i, 'enabled', e.target.checked)} />
              </label>
              <select
                className={styles.overlaySelect}
                value={ov.type}
                onChange={e => updateOverlay(i, 'type', e.target.value)}
              >
                <option value="SMA">SMA</option>
                <option value="EMA">EMA</option>
              </select>
              <input
                type="number"
                className={styles.overlayPeriod}
                value={ov.period}
                min={1}
                max={500}
                onChange={e => updateOverlay(i, 'period', e.target.value)}
              />
              <ColorPicker value={ov.color} onChange={v => updateOverlay(i, 'color', v)} />
            </div>
          ))}
        </div>

        {/* ── Volume ── */}
        <div className={styles.chartSubsection}>
          <span className={styles.chartSubLabel}>Volume</span>
          <div className={styles.chartRow}>
            <label className={styles.chartToggle}>
              <input type="checkbox" checked={cs.volume.visible} onChange={e => update('volume.visible', e.target.checked)} />
              <span>Show volume</span>
            </label>
            <label className={styles.chartToggle}>
              <input type="checkbox" checked={cs.volume.hvcEnabled} onChange={e => update('volume.hvcEnabled', e.target.checked)} />
              <span>HVC highlight</span>
            </label>
          </div>
          <div className={styles.chartRow} style={{ marginTop: 8 }}>
            <ColorPicker label="Up vol" value={cs.volume.upColor} onChange={v => update('volume.upColor', v)} />
            <ColorPicker label="Down vol" value={cs.volume.downColor} onChange={v => update('volume.downColor', v)} />
          </div>
        </div>

        {/* ── Crosshair ── */}
        <div className={styles.chartSubsection}>
          <span className={styles.chartSubLabel}>Crosshair</span>
          <div className={styles.chartRow}>
            <ColorPicker label="Color" value={cs.crosshair.color} onChange={v => update('crosshair.color', v)} />
            <div className={styles.chartRow} style={{ gap: 6 }}>
              <span className={styles.chartMiniLabel}>Style</span>
              <select
                className={styles.overlaySelect}
                value={cs.crosshair.style}
                onChange={e => update('crosshair.style', parseInt(e.target.value))}
              >
                {CROSSHAIR_STYLES.map(s => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* ── Watermark ── */}
        <div className={styles.chartSubsection}>
          <span className={styles.chartSubLabel}>Watermark</span>
          <div className={styles.chartRow}>
            <label className={styles.chartToggle}>
              <input type="checkbox" checked={cs.watermark.visible} onChange={e => update('watermark.visible', e.target.checked)} />
              <span>Show ticker watermark</span>
            </label>
          </div>
          <div className={styles.chartRow} style={{ marginTop: 8, alignItems: 'center' }}>
            <span className={styles.chartMiniLabel}>Opacity</span>
            <input
              type="range"
              className={styles.opacitySlider}
              min={0.02}
              max={0.2}
              step={0.01}
              value={cs.watermark.opacity}
              onChange={e => update('watermark.opacity', parseFloat(e.target.value))}
            />
            <span className={styles.chartMiniLabel}>{Math.round(cs.watermark.opacity * 100)}%</span>
          </div>
        </div>

        {/* ── Drawing Defaults ── */}
        <div className={styles.chartSubsection}>
          <span className={styles.chartSubLabel}>Drawing Defaults</span>
          <div className={styles.chartRow}>
            <ColorPicker label="Color" value={cs.drawingDefaults.color} onChange={v => update('drawingDefaults.color', v)} />
            <div className={styles.chartRow} style={{ gap: 6 }}>
              <span className={styles.chartMiniLabel}>Width</span>
              <div className={styles.chartPills}>
                {DRAWING_WIDTHS.map(w => (
                  <button
                    key={w}
                    className={`${styles.chartPill} ${cs.drawingDefaults.width === w ? styles.chartPillActive : ''}`}
                    onClick={() => update('drawingDefaults.width', w)}
                    style={{ minWidth: 32 }}
                  >
                    {w}px
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* ── Reset ── */}
        <div className={styles.chartSubsection} style={{ borderTop: '1px solid #2e3127', paddingTop: 12 }}>
          <button className={styles.btnDanger} onClick={resetToDefaults} style={{ fontSize: 11 }}>
            Reset All Chart Settings
          </button>
        </div>

      </div>
    </TileCard>
  )
}

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
  const [editingFullName, setEditingFullName] = useState(false)
  const [newFullName, setNewFullName] = useState('')
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

  async function handleUpdateField(field, value, setEditing) {
    if (!value.trim()) return
    setNameMsg('')
    try {
      const res = await fetch('/api/auth/update-profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: value.trim() }),
      })
      if (res.ok) {
        setNameMsg('Updated')
        setEditing(false)
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
              <span className={styles.rowLabel}>Full Name</span>
              {!editingFullName ? (
                <span className={styles.rowValue}>
                  {user?.full_name || '—'}
                  <button
                    className={styles.inlineBtn}
                    onClick={() => { setNewFullName(user?.full_name || ''); setEditingFullName(true) }}
                  >
                    Edit
                  </button>
                </span>
              ) : (
                <span className={styles.rowValue}>
                  <input
                    type="text"
                    value={newFullName}
                    onChange={e => setNewFullName(e.target.value)}
                    className={styles.inlineInput}
                    autoFocus
                    placeholder="First Last"
                    onKeyDown={e => { if (e.key === 'Enter') handleUpdateField('full_name', newFullName, setEditingFullName); if (e.key === 'Escape') setEditingFullName(false) }}
                  />
                  <button className={styles.inlineBtn} onClick={() => handleUpdateField('full_name', newFullName, setEditingFullName)}>Save</button>
                  <button className={styles.inlineBtnMuted} onClick={() => setEditingFullName(false)}>Cancel</button>
                </span>
              )}
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
                    placeholder="Your public name"
                    onKeyDown={e => { if (e.key === 'Enter') handleUpdateField('display_name', newName, setEditingName); if (e.key === 'Escape') setEditingName(false) }}
                  />
                  <button className={styles.inlineBtn} onClick={() => handleUpdateField('display_name', newName, setEditingName)}>Save</button>
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

        {/* ── Chart Settings ── */}
        <ChartSettingsSection prefs={prefs} setPref={setPref} />

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
