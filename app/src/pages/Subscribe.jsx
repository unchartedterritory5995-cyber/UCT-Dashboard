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
        <h1 className={styles.title}>Unlock the Intelligence Layer</h1>
        <p className={styles.subtitle}>
          Hey{user?.display_name ? ` ${user.display_name}` : ''} — Pro adds these on top of your free tools:
        </p>

        <ul style={{
          listStyle: 'none', margin: '16px 0 0', padding: 0, textAlign: 'left',
          display: 'flex', flexDirection: 'column', gap: 8,
        }}>
          {[
            'Morning Wire — daily pre-market brief & top picks',
            'Screener & Patterns — the setup scanner + pattern engine',
            'UCT 20 leadership, Theme Tracker & Calendar',
            'Research dossiers — fundamentals, analyst & ownership depth',
            'Compass — AI coaching, voice & pre-trade verdicts',
          ].map((b) => (
            <li key={b} style={{ position: 'relative', paddingLeft: 22, fontSize: 13, color: '#ddd', lineHeight: 1.4 }}>
              <span style={{ position: 'absolute', left: 0, color: 'var(--ut-gold, #c9a84c)', fontWeight: 700 }}>✓</span>
              {b}
            </li>
          ))}
        </ul>

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
            onClick={() => navigate('/settings?section=billing')}
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
