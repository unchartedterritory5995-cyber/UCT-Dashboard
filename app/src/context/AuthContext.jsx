import { createContext, useContext, useState, useEffect, useCallback } from 'react'
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

  const fetchUser = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/me')
      if (res.ok) {
        const data = await res.json()
        setUser(data.user)
        setPlan(data.plan)
        setSubscription(data.subscription || null)
        setTrial(data.trial || null)
        setAnnualAvailable(!!(data.billing && data.billing.annual_available))
        return { plan: data.plan, role: data.user?.role }
      } else {
        setUser(null)
        setPlan('free')
        setSubscription(null)
        setTrial(null)
        return { plan: 'free', role: null }
      }
    } catch {
      setUser(null)
      setPlan('free')
      setSubscription(null)
      setTrial(null)
      return { plan: 'free', role: null }
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
    <AuthContext.Provider value={{ user, plan, isPaid, subscription, trial, annualAvailable, loading, login, signup, logout, startCheckout, openPortal, refetch: fetchUser }}>
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
