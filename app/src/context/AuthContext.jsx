import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react'
import { clearIntroSeen } from '../components/intro/introStorage'

export const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [plan, setPlan] = useState('free')
  const [subscription, setSubscription] = useState(null)
  // full-access trial: { active, days_left } from the auth responses.
  // Drives the trial banner AND counts toward isPaid (full-access equivalence).
  const [trial, setTrial] = useState(null)
  // Whether an annual Stripe price is configured (pricing page honest copy).
  const [annualAvailable, setAnnualAvailable] = useState(false)
  const [loading, setLoading] = useState(true)
  // R2 (2026-08-22 stress repro): a TRANSIENT failure on session validation
  // (5xx, or the fetch itself threw) must never read as "logged out" — only a
  // definitive answer from the backend (ok, or a 4xx rejection) may decide
  // auth state. True only when the INITIAL /api/auth/me could not answer for
  // a transient reason; AuthGuard renders its splash + auto-retries on it
  // instead of bouncing to /login.
  const [authTransient, setAuthTransient] = useState(false)

  // Mirror of `user` for fetchUser's transient branch. fetchUser is a stable
  // useCallback([]) — reading the `user` state inside it would be a stale
  // closure, so the ref tracks the last committed value instead.
  const userRef = useRef(null)
  useEffect(() => { userRef.current = user }, [user])

  const fetchUser = useCallback(async () => {
    // The backend did not ANSWER (>=500, or fetch threw). Distinct from a
    // 401/403, which is the backend answering "no".
    const transientFailure = () => {
      if (!userRef.current) {
        // Initial load: we don't KNOW yet — flag it rather than committing
        // user=null-as-logged-out.
        setAuthTransient(true)
      }
      // A refetch blip with a user already in state: keep the user and ALL
      // plan state untouched — a 503 must not log anyone out.
      return { plan: 'free', role: null, transient: true }
    }
    try {
      const res = await fetch('/api/auth/me')
      if (res.ok) {
        const data = await res.json()
        setUser(data.user)
        setPlan(data.plan)
        setSubscription(data.subscription || null)
        setTrial(data.trial || null)
        setAnnualAvailable(!!(data.billing && data.billing.annual_available))
        setAuthTransient(false)
        return { plan: data.plan, role: data.user?.role }
      } else if (res.status >= 500) {
        return transientFailure()
      } else {
        // Definitive rejection — 401/403 (and every other 4xx, unchanged
        // from today's behavior): logged out, and any transient flag clears.
        setUser(null)
        setPlan('free')
        setSubscription(null)
        setTrial(null)
        setAuthTransient(false)
        return { plan: 'free', role: null }
      }
    } catch {
      return transientFailure()
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchUser() }, [fetchUser])

  const login = async (email, password) => {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
    if (!res.ok) {
      const err = await res.json()
      throw new Error(err.detail || 'Login failed')
    }
    const data = await res.json()
    // 2FA accounts don't get a session from the password alone — the caller
    // shows the code step and finishes via verifyTotp.
    if (data.requires_totp) return data
    setUser(data.user)
    setPlan(data.plan)
    setTrial(data.trial || null)
    setAnnualAvailable(!!(data.billing && data.billing.annual_available))
    return data
  }

  // Second half of a 2FA login: the challenge token from login() plus a
  // 6-digit authenticator code (or a backup code) → real session.
  const verifyTotp = async (challengeToken, code) => {
    const res = await fetch('/api/auth/login/totp-verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ challenge_token: challengeToken, code }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      const e = new Error(err.detail || 'Verification failed')
      e.status = res.status
      throw e
    }
    const data = await res.json()
    setUser(data.user)
    setPlan(data.plan)
    setTrial(data.trial || null)
    setAnnualAvailable(!!(data.billing && data.billing.annual_available))
    return data
  }

  const signup = async (email, password, displayName, referralCode) => {
    const body = { email, password, display_name: displayName }
    if (referralCode) body.referral_code = referralCode
    const res = await fetch('/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const err = await res.json()
      throw new Error(err.detail || 'Signup failed')
    }
    const data = await res.json()
    setUser(data.user)
    setPlan(data.plan)
    setTrial(data.trial || null)
    setAnnualAvailable(!!(data.billing && data.billing.annual_available))
    return data
  }

  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' })
    setUser(null)
    setPlan('free')
    setTrial(null)
    clearIntroSeen()
  }

  const startCheckout = async (billing = 'monthly') => {
    const res = await fetch('/api/auth/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan: billing === 'annual' ? 'annual' : 'monthly' }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.detail || 'Failed to create checkout session')
    }
    const data = await res.json()
    window.location.href = data.checkout_url
  }

  const openPortal = async () => {
    const res = await fetch('/api/auth/portal', { method: 'POST' })
    if (!res.ok) throw new Error('Failed to create portal session')
    const data = await res.json()
    window.location.href = data.portal_url
  }

  // Single source of truth for "is this a paying user" — gates every
  // API-cost feature (Compass, voice, read-aloud). Mirrors the backend
  // is_paid_or_trial() chokepoint: admin OR paid plan OR active trial.
  // Admins always pass; trial users get full feature access.
  const isPaid = user?.role === 'admin'
    || ['pro', 'premium', 'lifetime'].includes(plan)
    || !!(trial && trial.active)

  return (
    <AuthContext.Provider value={{ user, plan, isPaid, subscription, trial, annualAvailable, loading, authTransient, login, verifyTotp, signup, logout, startCheckout, openPortal, refetch: fetchUser, retryAuth: fetchUser }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}

/**
 * Safe paid-status read for gating API-cost UI (Compass, voice, read-aloud).
 * Returns isPaid from context, but defaults to `true` when no AuthProvider is
 * mounted — that only happens in isolated component tests, never in the real
 * app (AuthProvider wraps the root). The authoritative cost protection is the
 * backend 402 gate; this hook only decides whether to render the affordance.
 */
export function useIsPaid() {
  const ctx = useContext(AuthContext)
  return ctx ? ctx.isPaid : true
}
