import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import TileCard from '../components/TileCard'
import styles from './Settings.module.css'

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
        <div className={styles.row}>
          <span className={styles.rowLabel}>Your Referral Link</span>
          <span className={styles.rowValue} style={{ fontSize: 11 }}>
            uctintelligence.com/signup?ref={referral.code}
          </span>
        </div>
        <button className={styles.btn} onClick={handleCopy} style={{ marginTop: 8 }}>
          {copied ? 'Copied!' : 'Copy Link'}
        </button>
        <div className={styles.row} style={{ marginTop: 8 }}>
          <span className={styles.rowLabel}>Referrals</span>
          <span className={styles.rowValue}>
            {referral.successful_referrals} user{referral.successful_referrals !== 1 ? 's' : ''} referred
          </span>
        </div>
      </div>
    </TileCard>
  )
}

export default function Settings() {
  const { user, plan, logout, startCheckout, openPortal } = useAuth()
  const navigate = useNavigate()
  const [changingPw, setChangingPw] = useState(false)
  const [pwForm, setPwForm] = useState({ current: '', newPw: '', confirm: '' })
  const [pwMsg, setPwMsg] = useState('')
  const [pwError, setPwError] = useState('')
  const [billingLoading, setBillingLoading] = useState(false)

  async function handleLogout() {
    await logout()
    navigate('/login', { replace: true })
  }

  async function handleManageBilling() {
    setBillingLoading(true)
    try {
      await openPortal()
    } catch {
      // If no subscription exists, offer checkout instead
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

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.heading}>Settings</h1>
      </div>

      <div className={styles.grid}>
        {/* Account Info */}
        <TileCard title="Account">
          <div className={styles.section}>
            <div className={styles.row}>
              <span className={styles.rowLabel}>Email</span>
              <span className={styles.rowValue}>{user?.email || '—'}</span>
            </div>
            <div className={styles.row}>
              <span className={styles.rowLabel}>Display Name</span>
              <span className={styles.rowValue}>{user?.display_name || '—'}</span>
            </div>
            <div className={styles.row}>
              <span className={styles.rowLabel}>Plan</span>
              <span className={`${styles.rowValue} ${styles.planBadge}`}>
                {plan === 'pro' ? 'PRO' : plan?.toUpperCase() || 'FREE'}
              </span>
            </div>
            <div className={styles.row}>
              <span className={styles.rowLabel}>Member Since</span>
              <span className={styles.rowValue}>
                {user?.created_at ? new Date(user.created_at).toLocaleDateString() : '—'}
              </span>
            </div>
          </div>
        </TileCard>

        {/* Billing */}
        <TileCard title="Billing & Subscription">
          <div className={styles.section}>
            {plan === 'pro' ? (
              <>
                <p className={styles.statusText}>
                  <span className={styles.activeDot} /> Active Pro subscription
                </p>
                <button className={styles.btn} onClick={handleManageBilling} disabled={billingLoading}>
                  {billingLoading ? 'Loading...' : 'Manage Billing'}
                </button>
                <p className={styles.hint}>Update payment method, view invoices, or cancel</p>
              </>
            ) : (
              <>
                <p className={styles.statusText}>You're on the Free plan</p>
                <button className={styles.btnPro} onClick={() => startCheckout()}>
                  Upgrade to Pro — $20/mo
                </button>
                <p className={styles.hint}>Full access to all features</p>
              </>
            )}
          </div>
        </TileCard>

        {/* Security */}
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

        {/* Referral Program */}
        <ReferralSection />

        {/* Logout */}
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
