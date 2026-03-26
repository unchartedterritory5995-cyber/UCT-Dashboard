import { useState, useEffect } from 'react'
import { Link, useSearchParams, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import styles from './AuthForm.module.css'

export default function VerifyEmail() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { refetch } = useAuth()
  const token = searchParams.get('token')

  const [status, setStatus] = useState('loading') // loading | success | error
  const [error, setError] = useState('')

  useEffect(() => {
    if (!token) {
      setStatus('error')
      setError('Missing verification token')
      return
    }

    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/auth/verify-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        })
        if (cancelled) return
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          throw new Error(data.detail || 'Verification failed')
        }
        setStatus('success')
        // Refresh auth state so emailVerified updates
        await refetch()
        setTimeout(() => navigate('/dashboard', { replace: true }), 2000)
      } catch (err) {
        if (!cancelled) {
          setStatus('error')
          setError(err.message)
        }
      }
    })()

    return () => { cancelled = true }
  }, [token, navigate, refetch])

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <Link to="/" className={styles.brand}>UCT</Link>

        {status === 'loading' && (
          <>
            <h1 className={styles.title}>Verifying your email...</h1>
            <p className={styles.info}>Please wait a moment.</p>
          </>
        )}

        {status === 'success' && (
          <>
            <h1 className={styles.title}>Email verified</h1>
            <div className={styles.success}>Your email has been verified. Redirecting to dashboard...</div>
          </>
        )}

        {status === 'error' && (
          <>
            <h1 className={styles.title}>Verification failed</h1>
            <div className={styles.error}>{error}</div>
            <p className={styles.info}>The link may have expired or already been used.</p>
            <p className={styles.switchText}>
              <Link to="/login" className={styles.switchLink}>Go to login</Link>
            </p>
          </>
        )}
      </div>
    </div>
  )
}
