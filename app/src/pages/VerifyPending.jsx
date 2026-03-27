import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import styles from './AuthForm.module.css'

export default function VerifyPending() {
  const { user, logout } = useAuth()
  const [sent, setSent] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleResend = async () => {
    setError('')
    setLoading(true)
    setSent(false)
    try {
      const res = await fetch('/api/auth/resend-verification', { method: 'POST' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.detail || 'Failed to resend')
      }
      setSent(true)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <Link to="/" className={styles.brand}>UCT</Link>
        <h1 className={styles.title}>Verify your email</h1>
        <p className={styles.info}>
          We sent a verification email to<br />
          <strong style={{ color: 'var(--text-bright)' }}>{user?.email}</strong>
        </p>
        <p className={styles.info}>
          Click the link in the email to activate your account. Check your spam folder if you don't see it.
        </p>

        {sent && <div className={styles.success}>Verification email sent!</div>}
        {error && <div className={styles.error}>{error}</div>}

        <div className={styles.form}>
          <button
            type="button"
            className={styles.submitPro}
            onClick={handleResend}
            disabled={loading}
          >
            {loading ? 'Sending...' : 'Resend Verification Email'}
          </button>
        </div>

        <p className={styles.switchText}>
          <Link to="/" onClick={logout} className={styles.switchLink}>Log out</Link>
        </p>
      </div>
    </div>
  )
}
