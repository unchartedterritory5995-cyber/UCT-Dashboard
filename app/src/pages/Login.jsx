import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import styles from './AuthForm.module.css'

export default function Login() {
  const { login, verifyTotp } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  // 2FA: set when the password was right but the account wants a code too.
  const [challengeToken, setChallengeToken] = useState(null)
  const [code, setCode] = useState('')

  const finishLogin = (data) => {
    // Dashboard is paid-only; free users land on Morning Wire (the only free page).
    const paid = data?.user?.role === 'admin' || ['pro', 'premium', 'lifetime'].includes(data?.plan)
    navigate(paid ? '/dashboard' : '/morning-wire', { replace: true })
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const data = await login(email, password)
      if (data?.requires_totp) {
        setChallengeToken(data.challenge_token)
        setCode('')
        return
      }
      finishLogin(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleTotpSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const data = await verifyTotp(challengeToken, code)
      finishLogin(data)
    } catch (err) {
      // An expired challenge means the password step has to happen again.
      if (err.status === 401 && /expired/i.test(err.message)) {
        setChallengeToken(null)
        setCode('')
      }
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  if (challengeToken) {
    return (
      <div className={styles.page}>
        <div className={styles.card}>
          <Link to="/" className={styles.brand}>UCT</Link>
          <h1 className={styles.title}>Two-factor check</h1>
          <p className={styles.subtitle}>
            Enter the 6-digit code from your authenticator app — or one of
            your backup codes.
          </p>

          {error && <div className={styles.error}>{error}</div>}

          <form onSubmit={handleTotpSubmit} className={styles.form}>
            <label className={styles.label}>
              Code
              <input
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                className={styles.input}
                required
                autoFocus
                autoComplete="one-time-code"
                inputMode="text"
                maxLength={12}
                placeholder="123456 or XXXX-XXXX"
              />
            </label>
            <button type="submit" className={styles.submitPro} disabled={loading || !code.trim()}>
              {loading ? 'Checking...' : 'Verify'}
            </button>
          </form>

          <p className={styles.switchText}>
            <button
              type="button"
              className={styles.switchLink}
              style={{ background: 'none', border: 'none', cursor: 'pointer', font: 'inherit', padding: 0 }}
              onClick={() => { setChallengeToken(null); setCode(''); setError('') }}
            >
              ← Back to password
            </button>
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <Link to="/" className={styles.brand}>UCT</Link>
        <h1 className={styles.title}>Welcome back</h1>
        <p className={styles.subtitle}>Log in to your dashboard</p>

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
          <label className={styles.label}>
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={styles.input}
              required
              autoComplete="current-password"
            />
          </label>
          <Link to="/forgot-password" className={styles.forgotLink}>Forgot password?</Link>
          <button type="submit" className={styles.submitPro} disabled={loading}>
            {loading ? 'Logging in...' : 'Log In'}
          </button>
        </form>

        <p className={styles.switchText}>
          Don't have an account? <Link to="/signup" className={styles.switchLink}>Sign up</Link>
        </p>
      </div>
    </div>
  )
}
