import { useState } from 'react'
import { Link } from 'react-router-dom'
import styles from './AuthForm.module.css'

export default function ForgotPassword() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.detail || 'Something went wrong')
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
        <h1 className={styles.title}>Reset your password</h1>
        <p className={styles.subtitle}>We'll send you a link to reset it</p>

        {sent ? (
          <>
            <div className={styles.success}>Check your email for a reset link</div>
            <p className={styles.info}>
              If an account exists for {email}, you'll receive an email with instructions to reset your password.
            </p>
          </>
        ) : (
          <>
            {error && <div className={styles.error}>{error}</div>}
            <form onSubmit={handleSubmit} className={styles.form}>
              <label className={styles.label}>
                Email
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className={styles.input}
                  required
                  autoFocus
                  autoComplete="email"
                />
              </label>
              <button type="submit" className={styles.submit} disabled={loading}>
                {loading ? 'Sending...' : 'Send Reset Link'}
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
