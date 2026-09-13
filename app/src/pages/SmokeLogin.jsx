import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import styles from './AuthForm.module.css'

/**
 * `/smoke-login#token=…` — the redemption page for an admin-issued, single-use login link.
 *
 * ⛔ NO MEMBER EVER REACHES THIS PAGE. It exists so a real-device test session can be signed in
 * without anyone typing a password into a mirrored phone: an admin mints a link from the API, the
 * operator types the URL into the device's address bar, and this page trades the token for the
 * ordinary session cookie. The backend refuses everything unless `SMOKE_LOGIN_LINK_ENABLED` is
 * set, the target is the one synthetic account, and the token is unused and under five minutes
 * old — so with the flag off (its state everywhere by default) this page can only ever say no.
 *
 * ⛔⛔ THE TOKEN ARRIVES IN THE FRAGMENT, AND THAT IS THE WHOLE POINT. A `#fragment` is never
 * transmitted to any server — not to this one, not to a CDN, and not to a search engine if the URL
 * is mistyped into a search box instead of the address bar. It also stays out of access logs and
 * out of the `Referer` header. ⚰️ It was a query string until 2026-09-12, when a mistyped
 * navigation on a BrowserStack mirror ran a Google SEARCH for the whole URL and sent a live token
 * to a third party. With the token after the `#`, that same slip leaks the path and nothing else.
 *
 * ⭐ So the secret reaches the server only in a POST BODY, put there by this component.
 *
 * ⛔ READ `location.hash` DIRECTLY, NOT `useSearchParams`. React Router's search params parse the
 * part BEFORE the `#`; asking them for `token` here returns null forever, and the page would show
 * "no longer valid" for a link that is perfectly good.
 *
 * ⭐ EVERY FAILURE READS THE SAME. Expired, already redeemed, wrong purpose, never existed, flag
 * off — all of them render "This link is no longer valid". That is not vagueness for its own
 * sake: a page that distinguished them would tell an attacker which of their guesses was closest,
 * and the operator's remedy is identical in every case (mint another link, which takes a second).
 */
export default function SmokeLogin() {
  const navigate = useNavigate()
  const { refetch } = useAuth()
  // Read once, at mount. `location.hash` is "#token=abc": strip the leading "#" and parse the
  // rest as a query string, so an empty or malformed hash yields null rather than throwing.
  const [token] = useState(() => {
    try {
      const raw = (window.location.hash || '').replace(/^#/, '')
      return new URLSearchParams(raw).get('token')
    } catch {
      return null
    }
  })

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

    // ⭐ Drop the token out of the address bar as soon as it has been read. It never reached a
    // server, but it is still sitting in the URL bar and history of a SHARED test phone.
    // `replaceState` leaves no new entry to navigate back to.
    try {
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`)
    } catch { /* a failure here must never stop the redemption below */ }

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
