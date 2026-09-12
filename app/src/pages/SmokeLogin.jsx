import { useState, useEffect, useRef } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import styles from './AuthForm.module.css'

/**
 * `/smoke-login?token=…` — the redemption page for an admin-issued, single-use login link.
 *
 * ⛔ NO MEMBER EVER REACHES THIS PAGE. It exists so a real-device test session can be signed in
 * without anyone typing a password into a mirrored phone: an admin mints a link from the API, the
 * operator types the URL into the device's address bar, and this page trades the token for the
 * ordinary session cookie. The backend refuses everything unless `SMOKE_LOGIN_LINK_ENABLED` is
 * set, the target is the one synthetic account, and the token is unused and under five minutes
 * old — so with the flag off (its state everywhere by default) this page can only ever say no.
 *
 * ⭐ EVERY FAILURE READS THE SAME. Expired, already redeemed, wrong purpose, never existed, flag
 * off — all of them render "This link is no longer valid". That is not vagueness for its own
 * sake: a page that distinguished them would tell an attacker which of their guesses was closest,
 * and the operator's remedy is identical in every case (mint another link, which takes a second).
 */
export default function SmokeLogin() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { refetch } = useAuth()
  const token = searchParams.get('token')

  const [status, setStatus] = useState('loading') // loading | error

  // ⛔ STRICTMODE RUNS EFFECTS TWICE IN DEV, AND THIS TOKEN IS SINGLE-USE. Without the guard the
  // second invocation redeems a token the first one already burned, and the page a developer sees
  // locally is the failure page — for a link that worked. The ref is the fix rather than
  // `[]`-dependency trickery because the hazard is re-INVOCATION, not re-render.
  const redeemed = useRef(false)

  useEffect(() => {
    if (!token) {
      setStatus('error')
      return
    }
    if (redeemed.current) return
    redeemed.current = true

    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/auth/smoke-login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        })
        if (cancelled) return
        if (!res.ok) {
          setStatus('error')
          return
        }
        // The cookie is already set by the response; `refetch` makes the client's own auth state
        // agree with it before we navigate, so /dashboard does not mount against a stale "logged
        // out" context and bounce straight back to /login.
        await refetch()
        if (cancelled) return
        navigate('/dashboard', { replace: true })
      } catch {
        if (!cancelled) setStatus('error')
      }
    })()
    return () => { cancelled = true }
  }, [token, navigate, refetch])

  return (
    <div className={styles.wrap}>
      <div className={styles.card} data-testid="smoke-login-card">
        {status === 'loading' ? (
          <p data-testid="smoke-login-status">Signing in…</p>
        ) : (
          <p data-testid="smoke-login-status">This link is no longer valid.</p>
        )}
      </div>
    </div>
  )
}
