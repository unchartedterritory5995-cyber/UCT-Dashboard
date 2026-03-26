import { useState } from 'react'
import { Link, useSearchParams, useNavigate } from 'react-router-dom'
import styles from './AuthForm.module.css'

export default function ResetPassword() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const token = searchParams.get('token')

  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    if (password.length < 8) {
      setError('Password must be at least 8 characters')
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match')
      return
    }
    setLoading(true)
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, new_password: password }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.detail || 'Reset failed')
      }
      setSuccess(true)
      setTimeout(() => navigate('/login', { replace: true }), 2000)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  if (!token) {
    return (
      <div className={styles.page}>
        <div className={styles.card}>
          <Link to="/" className={styles.brand}>UCT</Link>
          <h1 className={styles.title}>Invalid link</h1>
          <p className={styles.info}>This password reset link is missing or malformed.</p>
          <p className={styles.switchText}>
            <Link to="/forgot-password" className={styles.switchLink}>Request a new link</Link>
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <Link to="/" className={styles.brand}>UCT</Link>
        <h1 className={styles.title}>Set new password</h1>
        <p className={styles.subtitle}>Enter your new password below</p>

        {success ? (
          <div className={styles.success}>Password reset! Redirecting to login...</div>
        ) : (
          <>
            {error && <div className={styles.error}>{error}</div>}
            <form onSubmit={handleSubmit} className={styles.form}>
              <label className={styles.label}>
                New Password
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={styles.input}
                  required
                  minLength={8}
                  placeholder="Min 8 characters"
                  autoComplete="new-password"
                  autoFocus
                />
              </label>
              <label className={styles.label}>
                Confirm Password
                <input
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  className={styles.input}
                  required
                  minLength={8}
                  autoComplete="new-password"
                />
              </label>
              <button type="submit" className={styles.submit} disabled={loading}>
                {loading ? 'Resetting...' : 'Reset Password'}
              </button>
            </form>
          </>
        )}

        <p className={styles.switchText}>
          <Link to="/login" className={styles.switchLink}>Back to login</Link>
        </p>
      </div>
    </div>
  )
}
