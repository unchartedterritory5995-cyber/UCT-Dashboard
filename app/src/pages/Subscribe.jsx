import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import styles from './AuthForm.module.css'

export default function Subscribe() {
  const { user, startCheckout, logout } = useAuth()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubscribe() {
    setLoading(true)
    setError('')
    try {
      await startCheckout()
    } catch (err) {
      setError('Failed to start checkout: ' + err.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleLogout() {
    await logout()
    navigate('/', { replace: true })
  }

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <div className={styles.brand}>UCT</div>
        <h1 className={styles.title}>Subscribe to Continue</h1>
        <p className={styles.subtitle}>
          Hey{user?.display_name ? ` ${user.display_name}` : ''} — you need an active subscription to access the dashboard.
        </p>

        {error && <div className={styles.error}>{error}</div>}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 20 }}>
          <button
            className={styles.submitPro}
            onClick={handleSubscribe}
            disabled={loading}
            style={{ width: '100%', padding: '12px 24px', fontSize: 15, fontWeight: 700, cursor: 'pointer' }}
          >
            {loading ? 'Redirecting to Stripe...' : 'Subscribe — $20/mo'}
          </button>

          <button
            onClick={() => navigate('/settings')}
            style={{
              background: 'rgba(255,255,255,0.08)', color: '#ccc', border: '1px solid rgba(255,255,255,0.12)',
              padding: '10px 20px', borderRadius: 6, fontSize: 13, cursor: 'pointer',
            }}
          >
            Go to Settings
          </button>

          <button
            onClick={handleLogout}
            style={{
              background: 'none', color: '#888', border: 'none',
              padding: '8px', fontSize: 12, cursor: 'pointer',
            }}
          >
            Log out
          </button>
        </div>
      </div>
    </div>
  )
}
