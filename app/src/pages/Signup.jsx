import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import styles from './AuthForm.module.css'

export default function Signup() {
  const { signup } = useAuth()
  const [searchParams] = useSearchParams()
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
      // Signup complete — AuthContext will redirect to dashboard
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
        <p className={styles.subtitle}>Create a free account to get started</p>

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
          <button type="submit" className={styles.submit} disabled={loading}>
            {loading ? 'Creating account...' : 'Create Free Account'}
          </button>
        </form>

        <p className={styles.switchText}>
          Already have an account? <Link to="/login" className={styles.switchLink}>Log in</Link>
        </p>
      </div>
    </div>
  )
}
