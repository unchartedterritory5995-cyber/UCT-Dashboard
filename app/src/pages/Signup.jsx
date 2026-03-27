import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import styles from './AuthForm.module.css'

export default function Signup() {
  const { signup, startCheckout } = useAuth()
  const [searchParams] = useSearchParams()
  const checkoutCanceled = searchParams.get('checkout') === 'canceled'
  const referralCode = searchParams.get('ref') || ''

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await signup(email, password, displayName || undefined, referralCode || undefined)
      // After signup, always redirect to Stripe Checkout
      try {
        await startCheckout()
        // startCheckout does window.location.href — won't reach here
      } catch (checkoutErr) {
        setError('Payment setup failed: ' + checkoutErr.message + '. Go to Settings to subscribe.')
        return
      }
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
        <h1 className={styles.title}>Create your account</h1>
        <p className={styles.subtitle}>Sign up and subscribe to get full access</p>

        {checkoutCanceled && (
          <div className={styles.warning}>Checkout was canceled. You can subscribe later from Settings.</div>
        )}
        {error && <div className={styles.error}>{error}</div>}

        <form onSubmit={handleSubmit} className={styles.form}>
          <label className={styles.label}>
            Display Name <span className={styles.optional}>(optional)</span>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className={styles.input}
              placeholder="How you want to be known"
              autoComplete="name"
            />
          </label>
          <label className={styles.label}>
            Email
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={styles.input}
              required
              autoComplete="email"
            />
          </label>
          <label className={styles.label}>
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={styles.input}
              required
              minLength={8}
              placeholder="Min 8 characters"
              autoComplete="new-password"
            />
          </label>
          <button type="submit" className={styles.submitPro} disabled={loading}>
            {loading ? 'Creating account...' : 'Create Account & Subscribe \u2014 $20/mo'}
          </button>
        </form>

        <p className={styles.switchText}>
          Already have an account? <Link to="/login" className={styles.switchLink}>Log in</Link>
        </p>
      </div>
    </div>
  )
}
