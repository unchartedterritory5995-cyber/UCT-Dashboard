import { createContext, useContext, useState, useEffect, useCallback } from 'react'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [plan, setPlan] = useState('free')
  const [loading, setLoading] = useState(true)

  const fetchUser = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/me')
      if (res.ok) {
        const data = await res.json()
        setUser(data.user)
        setPlan(data.plan)
        return { plan: data.plan, role: data.user?.role }
      } else {
        setUser(null)
        setPlan('free')
        return { plan: 'free', role: null }
      }
    } catch {
      setUser(null)
      setPlan('free')
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
    return data
  }

  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' })
    setUser(null)
    setPlan('free')
  }

  const startCheckout = async () => {
    const res = await fetch('/api/auth/checkout', { method: 'POST' })
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

  return (
    <AuthContext.Provider value={{ user, plan, loading, login, signup, logout, startCheckout, openPortal, refetch: fetchUser }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
